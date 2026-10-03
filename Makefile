include $(TOPDIR)/rules.mk
LUCI_TITLE:=LuCI TR3600 hardware manager
LUCI_DEPENDS:=+luci-base +rpcd +libubox +jshn +ubus +flock
LUCI_PKGARCH:=all
PKG_VERSION:=0.2.2
PKG_RELEASE:=1
PKG_LICENSE:=MIT

define Package/luci-app-tr3600-manager/conffiles
/etc/config/tr3600_fan
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
