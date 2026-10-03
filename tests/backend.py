from pathlib import Path
import json,subprocess
p=Path(__file__).resolve().parent.parent
backend=p/'root/usr/libexec/rpcd/tr3600.manager'
methods=json.loads(subprocess.check_output(['sh',str(backend),'list']))
assert set(methods)=={'status'}
acl=json.loads((p/'root/usr/share/rpcd/acl.d/luci-app-tr3600-manager.json').read_text())
assert set(acl['luci-app-tr3600-manager']['read']['ubus']['tr3600.manager'])==set(methods)
assert acl['luci-app-tr3600-manager']['write']=={'ubus':{'tr3600.fan':['configure'],'tr3600.led':['set']}}
fan_methods=json.loads(subprocess.check_output(['sh',str(p/'root/usr/libexec/rpcd/tr3600.fan'),'list']))
assert set(fan_methods)=={'status','configure'}
assert subprocess.run(['sh',str(backend),'call','bad'],capture_output=True).returncode!=0
for f in p.rglob('*.json'):json.loads(f.read_text())
print('PASS: protocol, read-only ACL, invalid method, JSON')

led_methods=json.loads(subprocess.check_output(['sh',str(p/'root/usr/libexec/rpcd/tr3600.led'),'list']))
assert set(led_methods)=={'status','set'}
assert acl['luci-app-tr3600-manager']['read']['ubus']['tr3600.led']==['status']
assert set(acl['luci-app-tr3600-manager']['write']['ubus']['tr3600.led'])=={'set'}
assert not (p/'root/usr/share/luci/menu.d/luci-app-tr3600-led.json').exists()
print('PASS: integrated LED protocol, ACL and single menu')
