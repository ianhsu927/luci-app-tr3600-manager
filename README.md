# TR3600 硬件管家 0.1.0

LuCI 菜单：状态 → TR3600 硬件管家。手动刷新，只读采集，不写 GPIO、PWM、UCI 或 U-Boot 环境。

## 功能

- 型号、固件版本和采集时间。
- thermal_zone 温度（毫摄氏度换算），风扇 RPM/PWM 和冷却档位。
- 已导出的 fan_switch GPIO：只读，不导出 GPIO，不硬编码 GPIO 编号。
- 物理网络设备的 carrier、速率、双工以及可识别的逻辑接口。桥接成员通过 master 尝试映射，USB 设备可能无法映射到前面板端口，显示设备名而不猜测 WAN/LAN。
- boot_param 当前与升级目标槽位，读取不到时从 /proc/cmdline 回退。
- MTD 原始证据、UBI 卷预留容量、UBI 未分配容量与坏块计数、df 文件系统空间。

备用镜像有效性尚未读取，不能据槽位参数判断备用镜像可启动。两套镜像共享配置的设计不等于配置回滚。PWM 值不代表实际转速。UBI 预留容量和未分配容量不等于文件系统已用/可用容量。

## 构建与安装

放到匹配固件源码的 package/luci-app-tr3600-manager，启用 CONFIG_PACKAGE_luci-app-tr3600-manager 后执行：

```sh
make package/luci-app-tr3600-manager/compile V=s
```

使用固件对应的 apk 或 opkg 安装构建产物及依赖，重启 rpcd 后重新登录 LuCI。源码 ZIP 不是安装包。无需 Node.js 在路由器运行；本地源码检查使用 Node.js 22。

## 验证范围

已完成本地语法、只读权限协议、12 项显示边界测试，以及 Cudy TR3600 v1 / OpenWrt 25.12-SNAPSHOT 的真实 RPC 读取验证。开发版通过复制 LuCI/RPC 文件安装，尚未构建 apk 包。LuCI 浏览器验收待登录后完成。传感器与控制接口以实际固件驱动为准。

硬件定义依据：用户提供的 R126.dts、mt7987.dtsi、mt7987a.dtsi 和双镜像补丁。没有打包原始固件或复制设备资料到本插件。

## 本地测试

```sh
python3 tests/backend.py
node tests/frontend.cjs
sh -n root/usr/libexec/rpcd/tr3600.manager
node --check htdocs/luci-static/resources/view/tr3600-manager/main.js
```
