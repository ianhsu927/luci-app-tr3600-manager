#!/bin/sh
# SPDX-License-Identifier: MIT

LED_ROOT=/sys/class/leds
LED_SERVICE=/etc/init.d/led
LED_LOCK=/var/lock/tr3600-led

led_supported() {
  [ -x "$LED_SERVICE" ] &&
    grep -q 'leds_off' "$LED_SERVICE" &&
    grep -q 'turnoff()' "$LED_SERVICE" &&
    grep -q 'turnon()' "$LED_SERVICE"
}

led_available() {
  local led
  for led in "$LED_ROOT"/*; do
    [ -w "$led/brightness" ] && return 0
  done
  return 1
}

led_apply() {
  local target="$1" previous action
  LED_ERROR=
  case "$target" in
    0|1) ;;
    *) LED_ERROR='参数无效'; return 1 ;;
  esac
  led_supported || { LED_ERROR='当前固件缺少原生灯光开关接口'; return 1; }
  led_available || { LED_ERROR='未发现可控制的指示灯'; return 1; }
  mkdir "$LED_LOCK" 2>/dev/null || {
    LED_ERROR='另一个灯光操作正在进行，请稍后重试'; return 1;
  }
  LED_SAVEDIR="$(mktemp -d /tmp/tr3600-led-uci.XXXXXX)" || {
    rmdir "$LED_LOCK"; LED_ERROR='无法创建临时配置目录'; return 1;
  }
  trap 'rm -rf "$LED_SAVEDIR"; rmdir "$LED_LOCK" 2>/dev/null' EXIT
  trap 'exit 1' HUP INT TERM
  # UCI 的 -t 仍会读取默认暂存路径；有待应用的系统配置时不提交。
  if [ -n "$(uci -q changes system)" ]; then
    LED_ERROR='请先应用或撤销待保存的系统设置，再切换灯光'; return 1
  fi
  previous="$(uci -t "$LED_SAVEDIR" -q get 'system.@system[-1].leds_off')"
  if ! uci -t "$LED_SAVEDIR" -q set "system.@system[-1].leds_off=$target" ||
     ! uci -t "$LED_SAVEDIR" -q commit system; then
    LED_ERROR='保存灯光设置失败'; return 1
  fi
  [ "$target" = 1 ] && action=turnoff || action=turnon
  if ! "$LED_SERVICE" "$action" >/dev/null 2>&1; then
    # 恢复本插件修改的选项，再恢复原先的灯光模式。
    if [ -n "$previous" ]; then
      uci -t "$LED_SAVEDIR" -q set "system.@system[-1].leds_off=$previous"
    else
      uci -t "$LED_SAVEDIR" -q delete 'system.@system[-1].leds_off'
    fi
    if ! uci -t "$LED_SAVEDIR" -q commit system; then
      LED_ERROR='灯光操作失败，配置回滚也失败，请检查系统日志'; return 1
    fi
    [ "$previous" = 1 ] && action=turnoff || action=turnon
    if ! "$LED_SERVICE" "$action" >/dev/null 2>&1; then
      LED_ERROR='灯光操作失败，已回滚配置，但灯光恢复失败'; return 1
    fi
    LED_ERROR='灯光操作失败，已恢复原设置'; return 1
  fi
}
