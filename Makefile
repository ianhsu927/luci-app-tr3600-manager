include $(TOPDIR)/rules.mk
LUCI_TITLE:=LuCI TR3600 hardware manager
LUCI_DEPENDS:=+rpcd +libubox +ubus
LUCI_PKGARCH:=all
PKG_VERSION:=0.1.1
PKG_RELEASE:=1
PKG_LICENSE:=MIT
include $(TOPDIR)/feeds/luci/luci.mk
