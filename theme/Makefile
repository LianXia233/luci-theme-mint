# SPDX-License-Identifier: Apache-2.0
#
# Copyright (C) 2026 LianXia233
#
# mint - a modern LuCI theme

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Mint Theme
LUCI_DEPENDS:=+luci-base +ucode-mod-fs +ucode-mod-uci
# Ship the ucode templates as source: header.ut imports the theme's own
# backend module (luci.mint.wallpaper), which the build host cannot
# resolve, so precompilation with ucode/host must be disabled.
LUCI_MINIFY_UT:=0

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LianXia233 <LianXia233@users.noreply.github.com>

define Package/luci-theme-mint/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# Clean up stale ACL files left in the legacy luci acl.d directory by
	# older builds. They can take precedence over /usr/share/rpcd/acl.d/
	# and deny access to the wallpaper settings page.
	rm -f /usr/share/luci/acl.d/luci-theme-mint.json
	rm -f /usr/share/luci/acl.d/luci-theme-mintzero.json
	# Make sure the new rpcd ACLs and LuCI templates are picked up.
	# Without this, root's wildcard grants cannot see the wallpaper ACL
	# and the wallpaper settings page fails with uci/get Access denied.
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
	# Refresh uhttpd so templates and static assets are not served stale.
	/etc/init.d/uhttpd restart >/dev/null 2>&1 || true
}
endef

define Package/luci-theme-mint/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.mint
	uci -q delete luci.themes.MintLight
	uci -q delete luci.themes.MintDark
	uci commit luci
	rm -f /usr/share/luci/acl.d/luci-theme-mint.json
	rm -f /usr/share/rpcd/acl.d/luci-theme-mint.json
	rm -f /www/luci-static/mint/custom-pc.jpg
	rm -f /www/luci-static/mint/custom-mobile.jpg
	/etc/init.d/rpcd restart >/dev/null 2>&1 || true
	/etc/init.d/uhttpd restart >/dev/null 2>&1 || true
}
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
