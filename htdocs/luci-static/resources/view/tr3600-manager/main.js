 'use strict';
'require view';
'require rpc';
'require poll';
var getStatus = rpc.declare({object:'tr3600.manager', method:'status', params:[], expect:{}});
var getBoard = rpc.declare({object:'system', method:'board', expect:{}});
var getInterfaces = rpc.declare({object:'network.interface', method:'dump', expect:{interface:[]}});
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
function table(headers, rows, empty) {
 if (!rows.length) return E('p', {'class':'description'}, empty || '固件未提供可读取的数据。');
 return E('div', {'style':'overflow-x:auto'}, E('table', {'class':'table'}, [
 E('tr', {'class':'tr table-titles'}, headers.map(function(h){return E('th',{'class':'th'},h);})),
 ].concat(rows.map(function(row){return E('tr',{'class':'tr'},row.map(function(cell){return E('td',{'class':'td'},text(cell));}));}))));
}
function section(title, content) { return E('div', {'class':'cbi-section'}, [E('h3',{},title),content]); }
function bytes(value) { return Number.isFinite(value) && value >= 0 ? (value / 1048576).toFixed(1) + ' MiB' : '不可读取'; }
return view.extend({
 render:function() {
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
    var results=await Promise.all([getStatus(),getBoard().catch(function(){return {};}),getInterfaces().catch(function(){return [];} )]);
    var s=results[0], board=results[1], interfaces=results[2], boot=s.boot || {};
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
     section('文件系统空间',E('pre',{'style':'white-space:pre-wrap;overflow-wrap:anywhere'},text(s.filesystems))),
     E('details',{},[E('summary',{},'查看原始证据'),E('pre',{'style':'white-space:pre-wrap;overflow-wrap:anywhere'},JSON.stringify({board:board,status:s,interfaces:interfaces},null,2))])
    );
   } catch(err) {body.replaceChildren(E('div',{'class':'alert-message warning'},'读取失败：'+String(err)+'。请检查插件安装与 rpcd 服务。'));}
   finally {busy=false;next=Date.now()+settings.seconds*1000;button.disabled=false;button.textContent='刷新状态';}
  };
  button.addEventListener('click',refresh);
  refresh();
  var root=E('div',{},[E('h2',{},'TR3600 硬件管家'),
   E('div',{'style':'display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin-bottom:16px'},[
    button,E('label',{},[automatic,' 自动刷新']),E('label',{},['间隔 ',interval,' 秒']),note
   ]),body]);
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
