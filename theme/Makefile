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
# luci-base already. The wallpaper side (settings page, rpcd backend, cache
# cron) moved to luci-app-mint-wallpaper on 2026-09-11 - that app is the one
# that needs curl, so this package no longer drags it in.
LUCI_DEPENDS:=+luci-base
# Ship the ucode templates as source: header.ut imports the theme's own
# backend module (luci.mint.wallpaper), which the build host cannot
# resolve, so precompilation with ucode/host must be disabled.
LUCI_MINIFY_UT:=0

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=LianXia233 <LianXia233@users.noreply.github.com>

# Version provenance (R-11): luci.mk's findrev derives the package version
# from whichever git repository contains the build directory - for an
# out-of-tree checkout copied into feeds/luci that is the LUCIFeed's HEAD,
# not the theme's own commit, so two SDK builds of the same theme source
# could even report different versions. Leave this empty for plain feed
# builds (stock findrev behaviour); CI injects the theme repository's own
# revision in scripts/build-package.sh (setup_feeds), so released apk/ipk
# packages carry this repository's provenance.
PKG_VERSION ?=
# Same provenance for the auto-generated translation package
# (luci-i18n-mint-zh-cn): luci.mk versions it via PKG_PO_VERSION, which
# defaults to findrev over po/ (the LuCI feed's HEAD, or a file-mtime
# fallback when there is no git context). CI injects the theme revision
# here too, so the translation package is versioned together with the
# theme it belongs to.
PKG_PO_VERSION ?=

# NOTE: /etc/config/mint is NOT a conffile of this package any more. It moved
# to luci-app-mint-wallpaper together with the settings page that writes it
# (2026-09-11), and is declared as a conffile there. Listing it here as well
# would make two packages own the same path.

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
		# Only the single "Mint" variant exists now. Drop the removed
		# registrations and rewrite any stale variant mediaurlbase so CSS/JS
		# never 404 immediately after install (uci-defaults does the same on
		# the next boot).
		uci -q delete luci.themes.MintLight
		uci -q delete luci.themes.MintDark
		uci -q delete luci.themes.MintzeroLight
		uci -q delete luci.themes.MintzeroDark
		# 2026-09-11: the wallpaper settings moved to
		# luci-app-mint-wallpaper. Remove the registrations this package
		# used to ship, otherwise an upgrade leaves a duplicate
		# "Mint Wallpaper" entry next to the app's own one.
		rm -f /usr/share/rpcd/acl.d/luci-theme-mint.json
		rm -f /usr/share/luci/menu.d/luci-theme-mint.json
		_mzbase=$$(uci -q get luci.main.mediaurlbase 2>/dev/null)
		case "$$_mzbase" in
			*/mint-dark|*/mint-light|*/mintzero-dark|*/mintzero-light|*/mintzero) \
				uci -q set luci.main.mediaurlbase=/luci-static/mint ;;
		esac
		uci -q commit luci
	# The LuCI build compiles po/zh_Hans/ as luci-theme-mint.zh-cn.lmo, but
	# some firmwares set luci.main.lang to zh_cn / zh_CN. Provide symlinks
	# so those language codes still load the Simplified Chinese catalog.
	cd /usr/lib/lua/luci/i18n 2>/dev/null && {
		for f in luci-theme-mint.zh-cn.lmo; do
			[ -f "$$f" ] || continue
			ln -sf "$$f" "$${f%.zh-cn.lmo}.zh_cn.lmo" 2>/dev/null || true
			ln -sf "$$f" "$${f%.zh-cn.lmo}.zh_CN.lmo" 2>/dev/null || true
		done
	}
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
		uci -q delete luci.themes.MintzeroLight
		uci -q delete luci.themes.MintzeroDark
		uci commit luci
	rm -f /usr/share/luci/acl.d/luci-theme-mint.json
	rm -f /usr/share/rpcd/acl.d/luci-theme-mint.json
	rm -f /usr/share/luci/menu.d/luci-theme-mint.json
	# NOTE (2026-09-11): the uploaded wallpapers (custom-*.jpg), the cache
	# images (wallpaper-*.img) and the cron helper belong to
	# luci-app-mint-wallpaper and are NOT removed here - removing the theme
	# must not delete user data it no longer owns.
	# Remove zh_cn / zh_CN aliases created by postinst.
	rm -f /usr/lib/lua/luci/i18n/luci-theme-mint.zh_cn.lmo
	rm -f /usr/lib/lua/luci/i18n/luci-theme-mint.zh_CN.lmo
	# Remove leftovers from the long-removed mintzero variant.
	rm -f /usr/lib/lua/luci/i18n/luci-theme-mintzero.zh_cn.lmo
	rm -f /usr/lib/lua/luci/i18n/luci-theme-mintzero.zh_CN.lmo
	rm -f /usr/share/luci/acl.d/luci-theme-mintzero.json
	# The wallpaper cache refresher cron line, the helper and the rpcd
	# backend moved to luci-app-mint-wallpaper (2026-09-11); that package's
	# postrm removes them.
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
