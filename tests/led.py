"""Mock firmware checks; no router, host LEDs or host UCI are modified."""
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
COMMON = ROOT / 'root/usr/lib/tr3600-manager/led.sh'

for source in (COMMON, ROOT / 'root/usr/libexec/rpcd/tr3600.led'):
    subprocess.run(['sh', '-n', str(source)], check=True)
for source in ROOT.rglob('*.json'):
    json.loads(source.read_text())

UCI = '''#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    -t) shift; shift ;;
    -q) shift ;;
    *) break ;;
  esac
done
case "$1" in
  changes) [ "$MOCK_PENDING" = 1 ] && echo 'system.cfg.hostname=other'; exit 0 ;;
  get) [ -f "$MOCK_STATE" ] && cat "$MOCK_STATE" ;;
  set) printf '%s\\n' "${2##*=}" > "$MOCK_STATE" ;;
  delete) rm -f "$MOCK_STATE" ;;
  commit) [ "$MOCK_COMMIT_FAIL" != 1 ] ;;
  *) exit 1 ;;
esac
'''
SERVICE = '''#!/bin/sh
# leds_off turnoff() turnon()
printf '%s\\n' "$1" >> "$MOCK_LOG"
if [ "$MOCK_FAIL_ONCE" = 1 ] && [ ! -f "$MOCK_MARKER" ]; then
  touch "$MOCK_MARKER"
  exit 1
fi
case "$1" in
  turnoff) echo 0 > "$MOCK_LED/brightness" ;;
  turnon) echo 1 > "$MOCK_LED/brightness" ;;
esac
'''

def check(name, target, previous='0', pending=False, fail_once=False,
          unsupported=False, absent=False, success=True):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        led = root / 'leds/oem:green:blue'
        led.mkdir(parents=True)
        if not absent:
            (led / 'brightness').write_text('1\n')
        state = root / 'state'
        if previous is not None:
            state.write_text(previous + '\n')
        for path, content in [(root / 'uci', UCI),
                              (root / 'led', '#!/bin/sh\nexit 0\n' if unsupported else SERVICE)]:
            path.write_text(content)
            path.chmod(0o755)
        env = dict(os.environ, PATH=f'{root}:' + os.environ['PATH'],
                   MOCK_STATE=str(state), MOCK_LOG=str(root / 'log'),
                   MOCK_LED=str(led), MOCK_MARKER=str(root / 'marker'),
                   MOCK_PENDING=str(int(pending)), MOCK_FAIL_ONCE=str(int(fail_once)))
        script = f'''. {shlex.quote(str(COMMON))}
LED_ROOT={shlex.quote(str(root / 'leds'))}
LED_SERVICE={shlex.quote(str(root / 'led'))}
LED_LOCK={shlex.quote(str(root / 'lock'))}
led_apply {shlex.quote(target)}
result=$?
printf '%s\\n' "$LED_ERROR"
exit "$result"
'''
        result = subprocess.run(['sh', '-c', script], env=env, text=True, capture_output=True)
        assert (result.returncode == 0) == success, (name, result.stdout, result.stderr)
        assert not (root / 'lock').exists(), name
        current = state.read_text().strip() if state.exists() else None
        assert current == (target if success else previous), (name, current)
        if success:
            assert (led / 'brightness').read_text().strip() == ('0' if target == '1' else '1')
        elif fail_once:
            assert (root / 'log').read_text().splitlines() == ['turnoff', 'turnon']
        else:
            assert not (root / 'log').exists()
        print('PASS', name)

check('关灯并保留设置', '1')
check('恢复灯光', '0', previous='1')
check('原设置不存在时回滚', '1', previous=None, fail_once=True, success=False)
check('失败时恢复原设置', '1', fail_once=True, success=False)
check('拒绝提交其他待应用设置', '1', pending=True, success=False)
check('不支持的固件', '1', unsupported=True, success=False)
check('没有控制接口', '1', absent=True, success=False)
check('拒绝非开关参数', '; invalid', success=False)
print('PASS shell syntax and JSON')
