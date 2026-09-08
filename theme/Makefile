# SPDX-License-Identifier: Apache-2.0
#
# Copyright (C) 2026 LianXia233
#
# mint - a modern LuCI theme

include $(TOPDIR)/rules.mk

# luci.mk keys both PKG_NAME and the Build/Prepare hook name on LUCI_NAME,
# which defaults to $(notdir ${CURDIR}) - and this package's directory is
# literally "theme/". Pin it so the package name and hooks are correct no
# matter how the checkout is named or where it is symlinked into a feed.
LUCI_NAME:=luci-theme-mint
# Pure data (htdocs / root / ucode templates / po, no src/): arch-independent.
LUCI_PKGARCH:=all

LUCI_TITLE:=Mint Theme
# ucode-mod-fs / ucode-mod-uci / rpcd-mod-file are all pulled in by
# luci-base already. curl is NOT: mz-wallpaper-fetch.sh shells out to it and
# default images ship uclient-fetch only, so without this the cron job can
# only ever fail.
LUCI_DEPENDS:=+luci-base +curl
# Ship the ucode templates as source: header.ut imports the theme's own
# backend module (luci.mint.wallpaper), which the build host cannot
# resolve, so precompilation with ucode/host must be disabled.
LUCI_MINIFY_UT:=0

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LianXia233 <LianXia233@users.noreply.github.com>

# /etc/config/mint is SHIPPED as defaults and WRITTEN AT RUNTIME by the
# wallpaper settings page. Without this define the package manager owns it as
# an ordinary file and REPLACES it on upgrade, so an upgrade silently wipes
# the admin's sources / overlay / blur - and because uci-defaults only writes
# defaults when the section is absent, they never come back.
# Honoured by both formats (include/package-pack.mk: KEEP_$(1) -> apk
# .conffiles / ipk CONTROL/conffiles).
define Package/luci-theme-mint/conffiles
/etc/config/mint
endef

define Package/luci-theme-mint/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# One-shot cleanup of ACL leftovers from builds that predate the move to
	# rpcd ACLs. The package no longer ships this path (upstream LuCI has
	# not read /usr/share/luci/acl.d for years); this only removes residue.
	rm -f /usr/share/luci/acl.d/luci-theme-mint.json
	rm -f /usr/share/luci/acl.d/luci-theme-mintzero.json
	# Drop the menu / module caches so LuCI sees the theme without a reboot.
	rm -f /tmp/luci-indexcache*
	rm -rf /tmp/luci-modulecache/
	# RELOAD, NOT RESTART: rpcd holds ubus sessions in memory, so `restart`
	# logs out every LuCI user - including the admin who just installed the
	# theme. SIGHUP re-reads /usr/share/rpcd/acl.d/*, and that ACL refresh
	# is the only thing this package needs from rpcd.
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-theme-mint/postrm
#!/bin/sh
# opkg runs the OLD package's postrm with arg "upgrade" during a version
# upgrade and "remove" on a real removal; apk never runs it on upgrade.
# On upgrade this script MUST change nothing: the new package's uci-defaults
# only re-registers the theme at the NEXT boot, so anything torn down here
# (theme registration, cron, custom images) stays torn down until then, and
# restarting rpcd would log the admin out mid-upgrade.
case "$$1" in
	upgrade|deconfigure) exit 0 ;;
esac

[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.mint
	uci -q delete luci.themes.MintLight
	uci -q delete luci.themes.MintDark
	uci commit luci
	rm -f /usr/share/luci/acl.d/luci-theme-mint.json
	rm -f /usr/share/rpcd/acl.d/luci-theme-mint.json
	rm -f /www/luci-static/mint/custom-pc.jpg
	rm -f /www/luci-static/mint/custom-mobile.jpg
	rm -f /www/luci-static/mint/wallpaper-pc.img
	rm -f /www/luci-static/mint/wallpaper-mobile.img
	# Remove the wallpaper cache refresher cron line (marked) and the helper.
	if [ -f /etc/crontabs/root ]; then
		grep -v 'mz-wallpaper-fetch' /etc/crontabs/root > /tmp/mz-crontab.$$
		mv /tmp/mz-crontab.$$ /etc/crontabs/root
		/etc/init.d/cron restart >/dev/null 2>&1 || true
	fi
	rm -f /usr/bin/mz-wallpaper-fetch.sh
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
