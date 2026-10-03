#!/bin/sh
# Only this exact verified TR3600 profile is writable. Keep kernel governor enabled.
FAN_ZONE=/sys/class/thermal/thermal_zone0
FAN_CDEV=/sys/class/thermal/cooling_device0
umask 077
FAN_STATE=/var/run/tr3600-manager/original
read_fan() { cat "$1" 2>/dev/null; }
fan_error() { FAN_ERROR="$1"; return 1; }
fan_profile() {
 [ "$(read_fan /sys/firmware/devicetree/base/compatible | tr '\000' '\n' | head -1)" = 'cudy,tr3600-v1' ] || { fan_error '设备型号不受支持'; return 1; }
 [ "$(read_fan "$FAN_CDEV/type")" = pwm-fan ] && [ "$(read_fan "$FAN_CDEV/max_state")" = 4 ] || { fan_error '风扇驱动档位不匹配'; return 1; }
 [ "$(read_fan "$FAN_ZONE/mode")" = enabled ] && [ "$(read_fan "$FAN_ZONE/policy")" = step_wise ] || { fan_error '内核温控策略不匹配'; return 1; }
 base=/sys/firmware/devicetree/base/thermal-zones/cpu-thermal
 handle=$(hexdump -v -e '4/1 "%02x" "\n"' /sys/firmware/devicetree/base/pwm-fan/phandle 2>/dev/null)
 levels=$(hexdump -v -e '4/1 "%02x" "\n"' /sys/firmware/devicetree/base/pwm-fan/cooling-levels 2>/dev/null | tr '\n' ' ')
 [ "$levels" = '00000000 00000040 00000080 000000c0 000000ff ' ] || { fan_error 'PWM 档位表不匹配'; return 1; }
 for stage in 1 2 3 4; do
  trip=$((stage+5)); map=$((stage-1)); bind=$((stage+2))
  [ "$(read_fan "$FAN_ZONE/cdev${bind}_trip_point")" = "$trip" ] || { fan_error '温控绑定不匹配'; return 1; }
  [ "$(readlink -f "$FAN_ZONE/cdev$bind")" = "$(readlink -f "$FAN_CDEV")" ] || { fan_error '冷却设备绑定不匹配'; return 1; }
  [ "$(read_fan "$FAN_ZONE/trip_point_${trip}_type")" = active ] && [ "$(read_fan "$FAN_ZONE/trip_point_${trip}_hyst")" = 5000 ] || { fan_error '触发点类型不匹配'; return 1; }
  expected=$(printf '%08x' "$stage")
  mapping=$(hexdump -v -e '4/1 "%02x" "\n"' "$base/cooling-maps/map$map/cooling-device" 2>/dev/null | tr '\n' ' ')
  [ "$mapping" = "$handle $expected $expected " ] || { fan_error '设备树风扇映射不匹配'; return 1; }
  [ -w "$FAN_ZONE/trip_point_${trip}_temp" ] || { fan_error '温控触发点不可写'; return 1; }
 done
}
fan_uint() { case "$1" in ''|0*|*[!0-9]*) return 1 ;; esac; [ "${#1}" -le 3 ]; }
fan_validate() {
 case "$mode" in system|curve|manual) ;; *) fan_error '无效模式'; return 1 ;; esac
 for value in "$level" "$t1" "$t2" "$t3" "$t4"; do fan_uint "$value" || { fan_error '参数必须是整数'; return 1; }; done
 [ "$level" -ge 1 ] && [ "$level" -le 4 ] || { fan_error '手动档位必须为 1–4'; return 1; }
 [ "$t1" -ge 40 ] && [ "$t4" -le 85 ] && [ "$t2" -ge $((t1+5)) ] && [ "$t3" -ge $((t2+5)) ] && [ "$t4" -ge $((t3+5)) ] || { fan_error '曲线需在 40–85°C，依次至少相差 5°C'; return 1; }
}
fan_config() {
 mode=$(uci -q get tr3600_fan.main.mode); mode=${mode:-system}
 level=$(uci -q get tr3600_fan.main.level); level=${level:-1}
 t1=$(uci -q get tr3600_fan.main.t1); t1=${t1:-50}
 t2=$(uci -q get tr3600_fan.main.t2); t2=${t2:-60}
 t3=$(uci -q get tr3600_fan.main.t3); t3=${t3:-70}
 t4=$(uci -q get tr3600_fan.main.t4); t4=${t4:-80}
}
fan_snapshot() {
 [ -d "$FAN_STATE" ] && return 0
 mkdir -p "$FAN_STATE.new" || return 1
 for trip in 6 7 8 9; do
  read_fan "$FAN_ZONE/trip_point_${trip}_temp" > "$FAN_STATE.new/$trip" || return 1
 done
 mv "$FAN_STATE.new" "$FAN_STATE"
}
fan_restore() {
 [ -d "$FAN_STATE" ] || return 0
 for trip in 9 8 7 6; do
  value=$(read_fan "$FAN_STATE/$trip")
  case "$value" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s\n' "$value" > "$FAN_ZONE/trip_point_${trip}_temp" || return 1
 done
}
fan_apply() {
 fan_validate && fan_profile || return 1
 if [ "$mode" = system ]; then fan_restore || { fan_error '恢复系统曲线失败'; return 1; }; return 0; fi
 fan_snapshot || { fan_error '无法备份系统曲线'; return 1; }
 temp=$(read_fan "$FAN_ZONE/temp")
 case "$temp" in ''|*[!0-9]*) fan_error '温度不可读取，拒绝调整'; return 1 ;; esac
 [ "$temp" -ge 10000 ] && [ "$temp" -le 150000 ] || { fan_error '温度异常，拒绝调整'; return 1; }
 # Write upper protection stages first. Original hot/critical trips stay untouched.
 for stage in 4 3 2 1; do
  case "$stage" in 1) target=$t1 ;; 2) target=$t2 ;; 3) target=$t3 ;; 4) target=$t4 ;; esac
  if [ "$mode" = manual ] && [ "$stage" -le "$level" ]; then target=$stage; fi
  trip=$((stage+5)); wanted=$((target*1000))
  if ! printf '%s\n' "$wanted" > "$FAN_ZONE/trip_point_${trip}_temp" || [ "$(read_fan "$FAN_ZONE/trip_point_${trip}_temp")" != "$wanted" ]; then
   fan_restore
   fan_error '写入失败，已尝试恢复系统曲线'; return 1
  fi
 done
}
fan_guard_once() {
 fan_config
 [ "$mode" != system ] || return 0
 temp=$(read_fan "$FAN_ZONE/temp")
 case "$temp" in ''|*[!0-9]*) temp=999999 ;; esac
 if [ "$temp" -lt 10000 ] || [ "$temp" -ge 85000 ]; then
  printf '4\n' > "$FAN_CDEV/cur_state" 2>/dev/null
  printf '散热保护：高温或温度读数异常\n' > /tmp/tr3600-fan-guard
 else
  rm -f /tmp/tr3600-fan-guard
 fi
}

fan_running() {
 pid=$(read_fan /var/run/tr3600-fan.pid)
 case "$pid" in ''|*[!0-9]*) return 1 ;; esac
 kill -0 "$pid" 2>/dev/null && tr '\000' ' ' < "/proc/$pid/cmdline" | grep -q '/usr/sbin/tr3600-fan-guard'
}
