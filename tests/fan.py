from pathlib import Path
import tempfile,subprocess
p=Path(__file__).resolve().parent.parent
helper=p/'root/usr/lib/tr3600-manager/fan.sh'
with tempfile.TemporaryDirectory() as tmp:
 zone=Path(tmp)/'zone';zone.mkdir();cdev=Path(tmp)/'cdev';cdev.mkdir()
 defaults={6:65000,7:72000,8:80000,9:88000}
 for k,v in defaults.items():(zone/f'trip_point_{k}_temp').write_text(str(v))
 (zone/'temp').write_text('68000');(cdev/'cur_state').write_text('1')
 prefix=f'. "{helper}"; FAN_ZONE="{zone}"; FAN_CDEV="{cdev}"; FAN_STATE="{tmp}/original"; fan_profile() {{ return 0; }}; mode=curve; level=1; t1=50; t2=60; t3=70; t4=80; '
 def run(s):return subprocess.run(['sh','-c',prefix+s],capture_output=True,text=True)
 assert run('fan_apply').returncode==0
 assert [(zone/f'trip_point_{n}_temp').read_text().strip() for n in range(6,10)]==['50000','60000','70000','80000']
 assert run('mode=manual; level=2; fan_apply').returncode==0
 assert (zone/'trip_point_7_temp').read_text().strip()=='2000'
 assert (zone/'trip_point_9_temp').read_text().strip()=='80000'
 assert run('mode=system; fan_apply').returncode==0
 assert all(int((zone/f'trip_point_{k}_temp').read_text())==v for k,v in defaults.items())
 for bad in ['mode=bad','level=0','level=5','t1=39','t4=86','t2=51','t1=050','t1=oops']:
  assert run(bad+'; fan_apply').returncode!=0,bad
  assert all(int((zone/f'trip_point_{k}_temp').read_text())==v for k,v in defaults.items())
 (zone/'temp').write_text('')
 assert run('fan_apply').returncode!=0
 assert run('fan_config() { mode=curve; }; fan_guard_once').returncode==0
 assert (cdev/'cur_state').read_text().strip()=='4'
 (zone/'temp').write_text('85000');(cdev/'cur_state').write_text('1')
 assert run('fan_config() { mode=manual; }; fan_guard_once').returncode==0
 assert (cdev/'cur_state').read_text().strip()=='4'
 # System mode must not overwrite kernel cooling state.
 (cdev/'cur_state').write_text('2')
 assert run('fan_config() { mode=system; }; fan_guard_once').returncode==0
 assert (cdev/'cur_state').read_text()=='2'
 print('PASS: curve/manual/system, 8 invalid inputs, missing sensor, high temperature and system guard behavior')
