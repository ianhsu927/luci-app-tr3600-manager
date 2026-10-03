 'use strict';
'require view';
'require rpc';
'require poll';
var getStatus = rpc.declare({object:'tr3600.manager', method:'status', params:[], expect:{}});
var getBoard = rpc.declare({object:'system', method:'board', expect:{}});
var getInterfaces = rpc.declare({object:'network.interface', method:'dump', expect:{interface:[]}});
var getFan = rpc.declare({object:'tr3600.fan',method:'status',params:[],expect:{}});
var setFan = rpc.declare({object:'tr3600.fan',method:'configure',params:['mode','level','t1','t2','t3','t4'],expect:{}});
var getLed = rpc.declare({object:'tr3600.led',method:'status',params:[],expect:{}});
var setLed = rpc.declare({object:'tr3600.led',method:'set',params:['disabled'],expect:{}});
function text(value) { return value == null || value === '' ? '不可读取' : String(value); }
function numeric(value) { return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null; }
function temperature(value) { var n = numeric(value); return n === null ? '不可读取' : (n / 1000).toFixed(1) + ' °C'; }
function slot(boot, key) {
 var direct = boot[key];
 if (direct === '0' || direct === '1') return direct;
 var match = String(boot.cmdline || '').match(new RegExp('(?:^|\\s)boot_param\\.' + key + '=([01])(?:\\s|$)'));
 return match ? match[1] : '不可读取';
}
function fanValue(fan) {
 var n = numeric(fan.value);
 if (n === null || n < 0) return '不可读取';
 if (fan.kind === 'rpm') return n + ' RPM';
 if (fan.kind === 'pwm') return 'PWM ' + n + '/255（驱动设定值）';
 return '冷却档位 ' + n + '/' + text(fan.max);
}
function filesystemCapacity(kib) {
 var n = Number(kib);
 return n >= 1048576 ? (n / 1048576).toFixed(2) + ' GiB' : (n / 1024).toFixed(1) + ' MiB';
}
function filesystemRows(output) {
 var rows = String(output || '').split('\n').map(function(line) {
  var match = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+%)\s+(.+)$/);
  return match ? [match[1], filesystemCapacity(match[2]), filesystemCapacity(match[3]),
   filesystemCapacity(match[4]), match[5], match[6]] : null;
 }).filter(function(row) { return row !== null; });
 return rows.filter(function(row) { return row[5] === '/overlay'; }).concat(
  rows.filter(function(row) { return row[5] !== '/overlay'; }));
}
function table(headers, rows, empty) {
 if (!rows.length) return E('p', {'class':'description'}, empty || '固件未提供可读取的数据。');
 return E('div', {'style':'overflow-x:auto'}, E('table', {'class':'table'}, [
 E('tr', {'class':'tr table-titles'}, headers.map(function(h){return E('th',{'class':'th'},h);})),
 ].concat(rows.map(function(row){return E('tr',{'class':'tr'},row.map(function(cell){return E('td',{'class':'td'},text(cell));}));}))));
}
function section(title, content) { return E('div', {'class':'cbi-section'}, [E('h3',{},title),content]); }
function bytes(value) { return Number.isFinite(value) && value >= 0 ? (value / 1048576).toFixed(1) + ' MiB' : '不可读取'; }
function evidenceDetails(attributes, children) {
 var open=attributes.open;
 delete attributes.open;
 var node=E('details',attributes,children);
 node.open=!!open;
 return node;
}
function evidenceValue(value, path, expanded) {
 if (value === null || value === undefined || value === '') return E('span',{'class':'description'},'未返回');
 if (typeof value !== 'object') return E('pre',{'style':'margin:0;white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;font-size:13px'},String(value));
 var keys=Object.keys(value);
 if (!keys.length) return E('span',{'class':'description'},'无记录');
 return E('div',{},keys.map(function(key){
  var item=value[key], id=path+'.'+key;
  if (item && typeof item==='object') {
   var name=Array.isArray(value)?'记录 '+(Number(key)+1)+(item.name || item.type || item.interface ? ' · '+(item.name || item.type || item.interface):''):key;
   return evidenceDetails({'data-evidence-id':id,open:expanded.indexOf(id)!==-1,'style':'margin:6px 0;padding:8px;border:1px solid #ddd;border-radius:4px'},[
    E('summary',{'style':'cursor:pointer;font-weight:600'},name),evidenceValue(item,id,expanded)
   ]);
  }
  return E('div',{'style':'display:grid;grid-template-columns:minmax(110px,30%) minmax(0,1fr);gap:12px;padding:8px 0;border-bottom:1px solid #eee'},[
   E('code',{'style':'overflow-wrap:anywhere'},key),evidenceValue(item,id,expanded)
  ]);
 }));
}
function evidencePanel(board, status, interfaces, previous) {
 var expanded=previous?Array.from(previous.querySelectorAll('details[open][data-evidence-id]')).map(function(node){return node.getAttribute('data-evidence-id');}):[];
 var groups=[
  ['device','设备与固件 · system.board',board],
  ['thermal','温度与风扇 · sysfs',{temperatures:status.temperatures,fans:status.fans,fan_switches:status.fan_switches}],
  ['network','网口与逻辑接口',{ports:status.ports,interfaces:interfaces}],
  ['boot','启动参数 · /proc/cmdline 与 boot_param',status.boot],
  ['storage','存储 · MTD / UBI / df',{partitions:status.partitions,volumes:status.volumes,ubi_devices:status.ubi_devices,filesystems:status.filesystems}],
  ['runtime','采集时间、运行时间与内存',{collected_at:status.collected_at,uptime:status.uptime,meminfo:status.meminfo}]
 ];
 var content=E('div',{},groups.map(function(group){return evidenceDetails({'data-evidence-id':group[0],open:expanded.indexOf(group[0])!==-1,'style':'margin:10px 0;padding:12px;border:1px solid #ddd;border-radius:6px'},[
  E('summary',{'style':'cursor:pointer;font-weight:600'},group[1]),evidenceValue(group[2],group[0],expanded)
 ]);}));
 var toggle=function(open){content.querySelectorAll('details').forEach(function(node){node.open=open;});};
 return evidenceDetails({'data-evidence-root':'1',open:previous?previous.open:false},[
  E('summary',{'style':'cursor:pointer;font-weight:600'},'查看原始证据'),
  E('p',{'class':'description'},'按来源分组，字段名和原始读数保留；多行内容直接展开显示。'),
  E('div',{'style':'display:flex;gap:8px;margin:12px 0'},[
   E('button',{'class':'cbi-button','click':function(){toggle(true);}},'展开全部'),
   E('button',{'class':'cbi-button','click':function(){toggle(false);}},'收起全部')
  ]),content,
  evidenceDetails({'data-evidence-id':'json',open:expanded.indexOf('json')!==-1},[
   E('summary',{'style':'cursor:pointer'},'完整 JSON'),
   E('pre',{'style':'white-space:pre-wrap;overflow-wrap:anywhere;max-height:500px;overflow:auto;font-size:13px'},JSON.stringify({board:board,status:status,interfaces:interfaces},null,2))
  ])
 ]);
}
return view.extend({
 load:function(){return getFan().catch(function(err){return {supported:false,reason:String(err)};});},
 render:function(fan) {
  fan=fan || {};
  var fanNote=E('p'), fanMessage=E('p'), mode=E('select',{'class':'cbi-input-select'},[
   E('option',{value:'system'},'系统默认'), E('option',{value:'curve'},'自定义温控曲线'), E('option',{value:'manual'},'手动最低档位')
  ]), level=E('select',{'class':'cbi-input-select'},[1,2,3,4].map(function(n){return E('option',{value:n},n+' 档');}));
  mode.value=fan.mode || 'system';level.value=fan.level || 1;
  var curve=[1,2,3,4].map(function(n){var input=E('input',{type:'number',min:40,max:85,step:1,'style':'width:75px'});input.value=fan['t'+n] || (40+n*10);return input;});
  var updateControl=function(){level.disabled=mode.value!=='manual';curve.forEach(function(input){input.disabled=mode.value==='system';});};
  mode.addEventListener('change',updateControl);updateControl();
  var apply=E('button',{'class':'cbi-button cbi-button-apply'},'保存并应用');
  apply.disabled=!fan.supported;
  apply.addEventListener('click',async function(){
   var temps=curve.map(function(input){return Number(input.value);});
   if (temps.some(function(n){return !Number.isInteger(n) || n<40 || n>85;}) || temps.some(function(n,i){return i>0 && n-temps[i-1]<5;})) {
    fanMessage.textContent='温度需为 40–85°C 的整数，依次至少相差 5°C。';return;
   }
   apply.disabled=true;fanMessage.textContent='正在应用…';
   try {
    var result=await setFan(mode.value,Number(level.value),temps[0],temps[1],temps[2],temps[3]);
    if (!result.ok) throw new Error(result.error || '配置失败');
    fanMessage.textContent='已保存并应用。'; await refresh();
   } catch(err){fanMessage.textContent='应用失败：'+String(err);}
   finally {apply.disabled=!fan.supported;}
  });
  var fanControls=section('风扇设置',E('div',{},[
   E('p',{},[E('label',{},['模式 ',mode]),' ',E('label',{},['最低档位 ',level])]),
   E('div',{'style':'display:flex;flex-wrap:wrap;gap:12px'},curve.map(function(input,i){return E('label',{},[(i+1)+' 档温度 ',input,' °C']);})),
   E('p',{'class':'description'},'降档滞回固定为 5°C。手动模式保留高温自动升档；自定义模式满档阈值不超过 85°C。'),
   apply,fanMessage,fanNote
  ]));
  if (!fan.supported) fanNote.textContent='控制不可用：'+text(fan.reason);

  var ledNote=E('p'), ledMessage=E('p'), ledNames=E('p'), ledBusy=false;
  var ledStatus={supported:false,count:0,leds:[]};
  var off=E('button',{'class':'cbi-button cbi-button-action'},'关闭指示灯');
  var on=E('button',{'class':'cbi-button cbi-button-neutral'},'恢复灯光');
  var updateLed=function(value){
   ledStatus=value;
   var available=value.supported && value.count>0;
   off.disabled=on.disabled=ledBusy || !available || !L.hasViewPermission();
   ledNote.textContent=value.error?'灯光状态读取失败：'+value.error:
    !value.supported?'当前固件暂不支持灯光开关':
    !value.count?'未检测到可控制的指示灯':
    value.disabled?(value.lit>0?'已设置关闭，但仍检测到亮灯':
     value.unreadable>0?'已设置关闭，部分灯光状态无法读取':'指示灯已关闭'):
     '指示灯按系统设置运行';
   ledNames.textContent=(value.leds || []).map(function(led){return led.name;}).join('、') || '未检测到';
  };
  var switchLed=async function(disabled){
   if (ledBusy) return;
   ledBusy=true;updateLed(ledStatus);ledMessage.textContent='正在应用…';
   try {
    var result=await setLed(disabled);
    if (!result.ok) throw new Error(result.error || '操作失败');
    updateLed(await getLed());ledMessage.textContent='已保存并应用。';
   } catch(err){ledMessage.textContent='应用失败：'+String(err);}
   finally {ledBusy=false;updateLed(ledStatus);}
  };
  off.addEventListener('click',function(){return switchLed(true);});
  on.addEventListener('click',function(){return switchLed(false);});
  updateLed(ledStatus);
  var ledControls=section('灯光开关',E('div',{},[
   ledNote,
   E('div',{'style':'display:flex;gap:12px;flex-wrap:wrap'},[off,on]),
   ledMessage,
   E('p',{'class':'description'},'设置会保留，重启进入 OpenWrt 后自动应用。'),
   E('details',{},[E('summary',{},'可控制的指示灯'),ledNames,
    E('p',{},'启动阶段的灯光、未提供控制接口的网口灯可能仍会亮。')])
  ]));

  var body=E('div'), button=E('button',{'class':'cbi-button cbi-button-action'},'刷新状态');
  var settings={enabled:true,seconds:10};
  try {
   var saved=JSON.parse(localStorage.getItem('tr3600-manager.refresh') || 'null');
   if (saved && typeof saved.enabled==='boolean') settings.enabled=saved.enabled;
   if (saved && Number.isInteger(saved.seconds) && saved.seconds>=3 && saved.seconds<=300) settings.seconds=saved.seconds;
  } catch(ignore) {}
  var automatic=E('input',{type:'checkbox'}), interval=E('input',{type:'number',min:3,max:300,step:1,'style':'width:80px'});
  automatic.checked=settings.enabled; interval.value=settings.seconds;
  var note=E('span',{'class':'description'}), next=0, busy=false;
  var updateSettings=function(){
   var value=Number(interval.value);
   if (!Number.isInteger(value) || value<3 || value>300) {
    interval.setCustomValidity('请输入 3 到 300 之间的整数秒数');
    interval.reportValidity(); interval.value=settings.seconds;
    return;
   }
   interval.setCustomValidity('');
   settings={enabled:automatic.checked,seconds:value}; next=Date.now()+value*1000;
   interval.disabled=!settings.enabled;
   note.textContent=settings.enabled?'每 '+value+' 秒自动刷新':'自动刷新已关闭';
   try {localStorage.setItem('tr3600-manager.refresh',JSON.stringify(settings));} catch(ignore) {}
  };
  automatic.addEventListener('change',updateSettings); interval.addEventListener('change',updateSettings);
  interval.addEventListener('input',function(){var n=Number(interval.value);if (Number.isInteger(n) && n>=3 && n<=300) updateSettings();});
  updateSettings();
  var refresh=async function(){
   if (busy) return;
   busy=true;
   button.disabled=true; button.textContent='正在读取…';
   try {
    var results=await Promise.all([getStatus(),getBoard().catch(function(){return {};}),getInterfaces().catch(function(){return [];} ),getFan().catch(function(err){return {supported:false,reason:String(err)};}),getLed().catch(function(err){return {supported:false,count:0,error:String(err),leds:[]};})]);
    var s=results[0], board=results[1], interfaces=results[2], boot=s.boot || {};
    var liveFan=results[3];
    if (!ledBusy) updateLed(results[4]);
    fanNote.textContent=liveFan.supported ? '当前模式：'+({system:'系统默认',curve:'自定义曲线',manual:'手动最低档位'}[liveFan.mode] || liveFan.mode)+(liveFan.protection?' · '+liveFan.protection:'')+(!liveFan.guard_running && liveFan.mode!=='system'?' · 散热保护服务未运行':'') : '控制不可用：'+text(liveFan.reason);
    var matched=Object.keys(board).some(function(k){return /tr3600/i.test(String(board[k]));});
    var zones=(s.temperatures || []).map(function(z){return [z.type,temperature(z.millidegrees)];});
    var fans=(s.fans || []).map(function(f){return [f.name,fanValue(f)];});
    (s.fan_switches || []).forEach(function(f){fans.push(['风扇开关 GPIO','逻辑值 '+text(f.value)]);});
    var ports=(s.ports || []).map(function(p){
     var roles=interfaces.filter(function(i){return i.device===p.name || i.l3_device===p.name || (p.master && (i.device===p.master || i.l3_device===p.master));}).map(function(i){return i.interface;}).join(', ');
     var speed=numeric(p.speed);
     return [p.name,roles || '未识别',p.carrier==='1'?'已连接':p.carrier==='0'?'未连接':text(p.state),p.carrier==='1' && speed!==null && speed>0?speed+' Mbps':'不可读取',p.carrier==='1'?text(p.duplex):'—'];
    });
    var volumeRows=(s.volumes || []).map(function(v){var a=numeric(v.reserved_ebs), b=numeric(v.usable_eb_size);return [v.name,v.type,a!==null && b!==null?bytes(a*b):'不可读取'];});
    var ubiRows=(s.ubi_devices || []).map(function(u){var a=numeric(u.available_blocks), b=numeric(u.eraseblock_size);return [u.source,a!==null && b!==null?bytes(a*b):'不可读取',u.bad_blocks];});
    body.replaceChildren(
     section('设备',table(['项目','状态'],[['型号',board.model],['固件',board.release && board.release.description],['采集时间',s.collected_at],['设备识别',matched?'TR3600':'未确认 TR3600，请核对型号']])),
     section('温度',table(['传感器','当前温度'],zones)),
     section('风扇',E('div',{},[table(['来源','读数'],fans,'没有可读取的风扇接口。'),E('p',{'class':'description'},'PWM 和冷却档位表示驱动设定，不代表实际转速；只有 RPM 读数可用于查看转速。')])),
     section('物理网络设备',table(['设备','逻辑接口','连接','速率','双工'],ports)),
     section('启动槽位',E('div',{},[table(['项目','值'],[['双镜像参数',boot.dual_boot==='Y' || boot.dual_boot==='1'?'已启用':text(boot.dual_boot)],['当前启动槽位',slot(boot,'boot_image_slot')],['升级目标槽位',slot(boot,'upgrade_image_slot')],['启动内核卷',boot.boot_kernel_part],['启动根文件系统卷',boot.boot_rootfs_part],['共享配置卷',boot.rootfs_data_part]]),E('p',{'class':'description'},'槽位来自本次启动参数，不表示备用镜像有效或可启动；未读取 U-Boot 有效性标记。')])),
     section('UBI 卷',table(['卷名','类型','预留容量'],volumeRows)),
     section('UBI 空间',table(['设备','未分配容量','坏块数'],ubiRows)),
     section('文件系统空间',E('div',{},[
      table(['文件系统','总容量','已用','可用','使用率','挂载点'],filesystemRows(s.filesystems),'没有可读取的文件系统空间数据。'),
      E('p',{'class':'description'},'/overlay 为可写存储；/rom 是只读固件，使用率 100% 属于正常情况。')
     ])),
     evidencePanel(board,s,interfaces,body.querySelector('[data-evidence-root]'))
    );
   } catch(err) {body.replaceChildren(E('div',{'class':'alert-message warning'},'读取失败：'+String(err)+'。请检查插件安装与 rpcd 服务。'));}
   finally {busy=false;next=Date.now()+settings.seconds*1000;button.disabled=false;button.textContent='刷新状态';}
  };
  button.addEventListener('click',refresh);
  refresh();
  var root=E('div',{},[E('h2',{},'TR3600 硬件管家'),
   E('div',{'style':'display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px'},[
    button,E('label',{},[automatic,' 自动刷新']),E('label',{},['间隔 ',interval,' 秒']),note
   ]),ledControls,fanControls,body]);
  var attached=false;
  var tick=function(){
   if (!root.isConnected) {if (attached) poll.remove(tick);return;}
   attached=true;
   if (settings.enabled && !document.hidden && !busy && Date.now()>=next) return refresh();
  };
  poll.add(tick,1);
  return root;
 },
 handleSave:null, handleSaveApply:null, handleReset:null
});
