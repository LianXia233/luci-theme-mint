# SPDX-License-Identifier: Apache-2.0
#
# Copyright (C) 2026 LianXia233
#
# luci-app-mint-wallpaper - wallpaper settings for the Mint LuCI theme.
#
# Split out of luci-theme-mint on 2026-09-11 so the theme ships UI only and
# the wallpaper settings (settings page, rpcd backend, cache cron, UCI
# config) can be installed, upgraded and removed on their own.
#
# NOTE: the theme template (ucode/template/themes/mint/header.ut) resolves
# the wallpaper configuration at RENDER time through the ucode module
# luci.mint.wallpaper, which stays in luci-theme-mint. That module only READS
# uci; everything that WRITES (settings page, rpcd save, defaults, cron)
# lives here. Splitting it any further is not possible: ucode imports are
# static, so a missing module would break the login page template itself.

include $(TOPDIR)/rules.mk

LUCI_NAME:=luci-app-mint-wallpaper
# Pure data (htdocs / root / uci-defaults, no src/): arch-independent.
LUCI_PKGARCH:=all

LUCI_TITLE:=Mint Wallpaper settings
# ucode-mod-fs / ucode-mod-uci / rpcd-mod-file are pulled in by luci-base
# already. curl is NOT: mz-wallpaper-fetch.sh shells out to it and default
# images ship uclient-fetch only, so without this the cron job can only ever
# fail.
LUCI_DEPENDS:=+luci-base +curl

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LianXia233 <LianXia233@users.noreply.github.com>

# See theme/Makefile for the provenance rationale: PKG_VERSION left empty for
# plain feed builds (stock findrev), CI injects this repository's revision.
PKG_VERSION ?=
PKG_PO_VERSION ?=

# /etc/config/mint is SHIPPED as defaults and WRITTEN AT RUNTIME by the
# wallpaper settings page. Without this define the package manager owns it as
# an ordinary file and REPLACES it on upgrade, so an upgrade silently wipes
# the admin's sources / overlay / blur - and because uci-defaults only writes
# defaults when the section is absent, they never come back.
define Package/luci-app-mint-wallpaper/conffiles
/etc/config/mint
endef

define Package/luci-app-mint-wallpaper/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	# Wallpaper library directory (user uploads). Same path uci-defaults
	# creates on first boot; do it here too so the settings page works
	# immediately after install without a reboot.
	mkdir -p /www/luci-static/mint/wallpapers
	chmod 0755 /www/luci-static/mint/wallpapers
	# Drop the menu / module caches so LuCI sees the entry without a reboot.
	rm -f /tmp/luci-indexcache*
	rm -rf /tmp/luci-modulecache/
	# RELOAD, NOT RESTART: rpcd holds ubus sessions in memory, so `restart`
	# logs out every LuCI user - including the admin who just installed this.
	# SIGHUP re-reads /usr/share/rpcd/acl.d/*, which is all this needs.
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

define Package/luci-app-mint-wallpaper/postrm
#!/bin/sh
# opkg runs the OLD package's postrm with arg "upgrade" during a version
# upgrade and "remove" on a real removal; apk never runs it on upgrade.
# On upgrade this script MUST change nothing.
case "$$1" in
	upgrade|deconfigure) exit 0 ;;
esac

[ -n "$${IPKG_INSTROOT}" ] || {
	# The wallpaper cache refresher cron line and its helper go with the
	# package. Uploaded custom images are left alone on purpose: they are
	# user data and only /lib/upgrade/keep.d protects them across sysupgrade.
	if [ -f /etc/crontabs/root ]; then
		grep -v 'mz-wallpaper-fetch' /etc/crontabs/root > /tmp/mz-crontab.$$
		mv /tmp/mz-crontab.$$ /etc/crontabs/root
		/etc/init.d/cron restart >/dev/null 2>&1 || true
	fi
	rm -f /usr/bin/mz-wallpaper-fetch.sh
	# Drop the menu cache so the removed entry disappears immediately.
	rm -f /tmp/luci-indexcache*
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
