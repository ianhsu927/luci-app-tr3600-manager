#!/bin/sh
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
case "$1" in
 list) echo '{"status":{},"configure":{"mode":"","level":0,"t1":0,"t2":0,"t3":0,"t4":0}}'; exit 0 ;;
 call) ;;
 *) exit 1 ;;
esac
. /usr/share/libubox/jshn.sh
. /usr/lib/tr3600-manager/fan.sh
emit_error() { json_init; json_add_boolean ok 0; json_add_string error "$FAN_ERROR"; json_dump; }
case "$2" in
 status)
  fan_config
  supported=1; fan_profile || supported=0
  json_init
  json_add_boolean supported "$supported"
  json_add_string reason "$FAN_ERROR"
  json_add_string mode "$mode"
  json_add_int level "$level"
  json_add_int t1 "$t1"; json_add_int t2 "$t2"; json_add_int t3 "$t3"; json_add_int t4 "$t4"
  json_add_string protection "$(read_fan /tmp/tr3600-fan-guard)"
  json_add_boolean guard_running "$(fan_running && echo 1 || echo 0)"
  json_dump ;;
 configure)
  input=$(cat)
  json_load "$input" || exit 1
  json_get_var mode mode; json_get_var level level
  json_get_var t1 t1; json_get_var t2 t2; json_get_var t3 t3; json_get_var t4 t4
  fan_validate && fan_profile || { emit_error; exit 0; }
  exec 9>/var/lock/tr3600-fan.lock
  # BusyBox flock has no -w option. Bound retries using nonblocking locks.
  locked=0
  for attempt in 1 2 3; do
   if flock -n -x 9; then locked=1; break; fi
   [ "$attempt" = 3 ] || sleep 1
  done
  [ "$locked" = 1 ] || { FAN_ERROR='配置正在应用，请稍后重试'; emit_error; exit 0; }
  # Guard must be available before opting into custom settings.
  if [ "$mode" != system ] && ! fan_running; then FAN_ERROR='散热保护服务未运行'; emit_error; exit 0; fi
  transaction=/var/run/tr3600-manager/transaction
  mkdir -p "$transaction" || { FAN_ERROR='无法创建恢复点'; emit_error; exit 0; }
  cp /etc/config/tr3600_fan "$transaction/config" || { FAN_ERROR='配置备份失败'; emit_error; exit 0; }
  for trip in 6 7 8 9; do read_fan "$FAN_ZONE/trip_point_${trip}_temp" > "$transaction/$trip"; done
  rollback() {
   for trip in 9 8 7 6; do
    old=$(read_fan "$transaction/$trip")
    case "$old" in ''|*[!0-9]*) continue ;; esac
    printf '%s\n' "$old" > "$FAN_ZONE/trip_point_${trip}_temp"
   done
   uci -q revert tr3600_fan
   cp "$transaction/config" /etc/config/tr3600_fan
  }
  trap 'rm -rf "$transaction"' EXIT
  fan_apply || { rollback; emit_error; exit 0; }
  for key in mode level t1 t2 t3 t4; do
   case "$key" in mode) value=$mode ;; level) value=$level ;; t1) value=$t1 ;; t2) value=$t2 ;; t3) value=$t3 ;; t4) value=$t4 ;; esac
   uci -q set "tr3600_fan.main.$key=$value" || { rollback; FAN_ERROR='配置保存失败，已恢复上次设置'; emit_error; exit 0; }
  done
  uci commit tr3600_fan || { rollback; FAN_ERROR='配置提交失败，已恢复上次设置'; emit_error; exit 0; }
  fan_guard_once
  json_init; json_add_boolean ok 1; json_dump ;;
 *) exit 1 ;;
esac
