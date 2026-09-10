#!/usr/bin/env bash
#
# build-direct.sh - assemble and pack luci-theme-mint as real .ipk / .apk
# without downloading or compiling an OpenWrt SDK.
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# The theme is a pure data package (htdocs / ucode templates / root config /
# po catalog, no src/). The previous CI still pulled a ~300 MB official SDK
# and compiled the whole luci-base dependency chain just to run luci.mk's
# file-assembly steps. This script performs exactly those assembly steps and
# writes the same container formats the official backends emit:
#
#   ipk - gzip( tar( ./debian-binary, ./data.tar.gz, ./control.tar.gz ) )
#         (OpenWrt scripts/ipkg-build, 23.05 / 24.10)
#   apk - apk-tools v3 ADB container "ADBd" + raw deflate
#         (OpenWrt include/package-pack.mk / apk mkpkg, 25.12+)
#
# Artifacts (arch-independent, installable on any target):
#   luci-theme-mint-<rel>-all.ipk / luci-theme-mint-<rel>.apk
#   luci-app-mint-wallpaper-<rel>-all.ipk / luci-app-mint-wallpaper-<rel>.apk
#   luci-i18n-mint-zh-cn-<rel>-all.ipk / luci-i18n-mint-zh-cn-<rel>.apk
#   luci-i18n-mint-wallpaper-zh-cn-<rel>-all.ipk / ...-<rel>.apk
#
# Usage:
#   ./scripts/build-direct.sh --release-version nightly --out dist
#
# Options:
#   --release-version  version label used in artifact names (default: nightly)
#   --out              output directory (default: dist)
#   --workdir          scratch directory (default: build)
#
# Environment:
#   GITHUB_OUTPUT      optional; step outputs are appended when set

set -euo pipefail

log()  { printf '[build] %s\n' "$*"; }
warn() { printf '[build] warning: %s\n' "$*" >&2; }
die()  { printf '[build] error: %s\n' "$*" >&2; exit 1; }

github_out() {
	[ -n "${GITHUB_OUTPUT:-}" ] || return 0
	printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
THEME_SRC="$REPO_ROOT/theme"
WALLPAPER_SRC="$REPO_ROOT/wallpaper"

RELEASE_VERSION="nightly"
OUT="dist"
WORKDIR="build"

while [ $# -gt 0 ]; do
	case "$1" in
	--release-version) RELEASE_VERSION="${2:-}"; shift 2 ;;
	--out)             OUT="${2:-}"; shift 2 ;;
	--workdir)         WORKDIR="${2:-}"; shift 2 ;;
	-h|--help)         sed -n '2,35p' "$0"; exit 0 ;;
	*) die "unknown argument: $1" ;;
	esac
done

[ -d "$THEME_SRC" ] || die "theme sources not found at $THEME_SRC"
[ -f "$THEME_SRC/Makefile" ] || die "theme Makefile missing"
[ -d "$WALLPAPER_SRC" ] || die "wallpaper app sources not found at $WALLPAPER_SRC"
[ -f "$WALLPAPER_SRC/Makefile" ] || die "wallpaper app Makefile missing"
[ -f "$SCRIPT_DIR/mkadbpkg.py" ] || die "scripts/mkadbpkg.py missing"
[ -f "$SCRIPT_DIR/po2lmo.py" ] || die "scripts/po2lmo.py missing"

# ---------------------------------------------------------------------------
# version provenance (same scheme luci.mk findrev / the old SDK CI used)
# ---------------------------------------------------------------------------

THEME_COMMIT="unknown"
PKG_VERSION="0.0.0"
if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
	# Both packages are versioned from the repository HEAD: the repo now
	# carries two loosely coupled packages (theme + wallpaper app), so
	# scoping the revision to one subdirectory would make the pair report
	# different versions for the same commit.
	trev="$(git -C "$REPO_ROOT" log -1 --format='%ct' 2>/dev/null || true)"
	thash="$(git -C "$REPO_ROOT" log -1 --format='%h' --abbrev=7 2>/dev/null || true)"
	THEME_COMMIT="${thash:-unknown}"
	if [ -n "$trev" ] && [ -n "$thash" ]; then
		tsecs=$((trev % 86400))
		tyday="$(date -u --date="@$trev" '+%y.%j' 2>/dev/null || date -u -r "$trev" '+%y.%j')"
		PKG_VERSION="$(printf '%s.%05d~%s' "$tyday" "$tsecs" "$thash")"
	fi
fi

# luci.mk: theme package gets PKG_RELEASE=1; the translation package is
# versioned by PKG_PO_VERSION alone (no -r1).
THEME_PKG_VERSION="${PKG_VERSION}-r1"
I18N_PKG_VERSION="$PKG_VERSION"

log "release_version : ${RELEASE_VERSION}"
log "theme_commit    : ${THEME_COMMIT}"
log "package_version : ${THEME_PKG_VERSION}"

# ---------------------------------------------------------------------------
# 1. assemble theme payload (luci.mk install layout)
#    htdocs -> /www, ucode -> /usr/share/ucode/luci, root -> /
# ---------------------------------------------------------------------------

STAGE="$WORKDIR/direct"
rm -rf "$STAGE"
PAYLOAD="$STAGE/payload"
WPAYLOAD="$STAGE/wpayload"
IPAYLOAD="$STAGE/i18npayload"
mkdir -p "$PAYLOAD" "$WPAYLOAD" "$IPAYLOAD"

log "assembling theme payload"
cp -a "$THEME_SRC/htdocs/." "$PAYLOAD/www"
mkdir -p "$PAYLOAD/usr/share/ucode/luci"
cp -a "$THEME_SRC/ucode/." "$PAYLOAD/usr/share/ucode/luci/"
cp -a "$THEME_SRC/root/." "$PAYLOAD/"

# luci-app-mint-wallpaper: pure data package (htdocs + root), no ucode.
# Its template-side helper (ucode/mint/wallpaper.uc) deliberately stays in
# the theme: header.ut imports it statically, so a missing module would
# break the login page itself.
log "assembling wallpaper app payload"
cp -a "$WALLPAPER_SRC/htdocs/." "$WPAYLOAD/www"
cp -a "$WALLPAPER_SRC/root/." "$WPAYLOAD/"

# Preserve executable bits on scripts that luci.mk would install via cp -pR.
# verify-package.sh rejects packages that ship these as non-executable.
# Shell chmod: helps Git Bash tar. Python chmod: best-effort on hosts that
# can represent Unix modes. mkadbpkg.py also gets --exec overrides below
# because NTFS cannot store 0755 for Python's os.lstat.
#
# The wallpaper helper, rpcd backend and uci-defaults moved to
# luci-app-mint-wallpaper (2026-09-11), so each payload is chmod'ed from its
# own root - a rename can no longer silently drop the executable bit.
for rel in \
	etc/uci-defaults/30_luci-theme-mint
do
	if [ -f "$PAYLOAD/$rel" ]; then
		chmod 0755 "$PAYLOAD/$rel" 2>/dev/null || true
	else
		warn "missing exec payload: $rel"
	fi
done
for rel in \
	usr/bin/mz-wallpaper-fetch.sh \
	usr/libexec/rpcd/mint \
	etc/uci-defaults/30_luci-app-mint-wallpaper
do
	if [ -f "$WPAYLOAD/$rel" ]; then
		chmod 0755 "$WPAYLOAD/$rel" 2>/dev/null || true
	else
		warn "missing exec payload: $rel"
	fi
done
python3 - "$PAYLOAD" "$WPAYLOAD" <<'PY'
import os, sys
theme_root, app_root = sys.argv[1], sys.argv[2]
for root, rels in (
    (theme_root, ("etc/uci-defaults/30_luci-theme-mint",)),
    (app_root, (
        "usr/bin/mz-wallpaper-fetch.sh",
        "usr/libexec/rpcd/mint",
        "etc/uci-defaults/30_luci-app-mint-wallpaper",
    )),
):
    for rel in rels:
        path = os.path.join(root, rel)
        if os.path.isfile(path):
            try:
                os.chmod(path, 0o755)
            except OSError:
                pass
PY

# ---------------------------------------------------------------------------
# 2. assemble i18n payload (luci.mk LuciTranslation)
# ---------------------------------------------------------------------------

log "compiling po -> lmo"
PO_FILE="$THEME_SRC/po/zh_Hans/luci-theme-mint.po"
[ -f "$PO_FILE" ] || die "po catalog not found: $PO_FILE"
mkdir -p "$IPAYLOAD/usr/lib/lua/luci/i18n" "$IPAYLOAD/etc/uci-defaults"
LMO_OUT="$IPAYLOAD/usr/lib/lua/luci/i18n/luci-theme-mint.zh-cn.lmo"
python3 "$SCRIPT_DIR/po2lmo.py" "$PO_FILE" "$LMO_OUT" \
	|| die "po2lmo failed"
[ -s "$LMO_OUT" ] || die "po2lmo produced an empty lmo"

# Register zh-cn in LuCI (same uci-defaults luci.mk emits for translation pkgs)
{
	printf '%s\n' "uci set luci.languages.zh-cn='简体中文 (Simplified Chinese)'"
	printf '%s\n' "uci commit luci"
} > "$IPAYLOAD/etc/uci-defaults/luci-i18n-mint-zh-cn"
chmod 0755 "$IPAYLOAD/etc/uci-defaults/luci-i18n-mint-zh-cn" 2>/dev/null || true
python3 -c 'import os,sys
try:
    os.chmod(sys.argv[1], 0o755)
except OSError:
    pass' "$IPAYLOAD/etc/uci-defaults/luci-i18n-mint-zh-cn"

# luci-app-mint-wallpaper carries its OWN catalogue since the split
# (2026-09-11): installing the wallpaper app without the theme's translation
# package still yields a Chinese settings page.
WPO_FILE="$WALLPAPER_SRC/po/zh_Hans/luci-app-mint-wallpaper.po"
[ -f "$WPO_FILE" ] || die "wallpaper po catalog not found: $WPO_FILE"
WIPAYLOAD="$STAGE/wi18npayload"
mkdir -p "$WIPAYLOAD/usr/lib/lua/luci/i18n" "$WIPAYLOAD/etc/uci-defaults"
WLMO_OUT="$WIPAYLOAD/usr/lib/lua/luci/i18n/luci-app-mint-wallpaper.zh-cn.lmo"
python3 "$SCRIPT_DIR/po2lmo.py" "$WPO_FILE" "$WLMO_OUT" \
	|| die "po2lmo failed for the wallpaper catalogue"
[ -s "$WLMO_OUT" ] || die "po2lmo produced an empty wallpaper lmo"
{
	printf '%s\n' "uci set luci.languages.zh-cn='简体中文 (Simplified Chinese)'"
	printf '%s\n' "uci commit luci"
} > "$WIPAYLOAD/etc/uci-defaults/luci-i18n-mint-wallpaper-zh-cn"
chmod 0755 "$WIPAYLOAD/etc/uci-defaults/luci-i18n-mint-wallpaper-zh-cn" 2>/dev/null || true
python3 -c 'import os,sys
try:
    os.chmod(sys.argv[1], 0o755)
except OSError:
    pass' "$WIPAYLOAD/etc/uci-defaults/luci-i18n-mint-wallpaper-zh-cn"

# ---------------------------------------------------------------------------
# 3. build .ipk (OpenWrt scripts/ipkg-build container layout)
# ---------------------------------------------------------------------------

build_ipk() {
	# <name> <version> <depends> <payload> <conffiles|-> <postinst|-> <postrm|-> <out.ipk>
	local name="$1" ver="$2" deps="$3" payload="$4" conffiles="$5"
	local postinst="$6" postrm="$7" out="$8"
	local dir
	dir="$(mktemp -d)"
	mkdir -p "$dir/CONTROL"

	{
		printf 'Package: %s\n' "$name"
		printf 'Version: %s\n' "$ver"
		printf 'Architecture: all\n'
		printf 'Depends: %s\n' "$deps"
		printf 'Maintainer: LianXia233 <LianXia233@users.noreply.github.com>\n'
		printf 'Filename: %s_%s_all.ipk\n' "$name" "$ver"
		printf 'Section: luci\n'
		printf 'License: Apache-2.0\n'
		case "$name" in
			luci-theme-mint)
				printf 'Description: Mint Theme\n A modern LuCI theme.\n' ;;
			luci-app-mint-wallpaper)
				printf 'Description: Mint Wallpaper settings\n Wallpaper settings for the Mint LuCI theme.\n' ;;
			luci-i18n-mint-wallpaper-zh-cn)
				printf 'Description: Mint Wallpaper - zh-cn translation\n' ;;
			*)
				printf 'Description: Mint Theme - zh-cn translation\n' ;;
		esac
	} > "$dir/CONTROL/control"

	if [ "$conffiles" != "-" ]; then
		printf '%s\n' "$conffiles" > "$dir/CONTROL/conffiles"
	fi
	if [ "$postinst" != "-" ]; then
		printf '%s\n' "$postinst" > "$dir/CONTROL/postinst"
		chmod 0755 "$dir/CONTROL/postinst"
	fi
	if [ "$postrm" != "-" ]; then
		printf '%s\n' "$postrm" > "$dir/CONTROL/postrm"
		chmod 0755 "$dir/CONTROL/postrm"
	fi

	printf '2.0\n' > "$dir/debian-binary"
	( cd "$payload" && tar --format=gnu --numeric-owner --sort=name -cpf - . ) \
		| gzip -9 -n -c > "$dir/data.tar.gz"
	( cd "$dir/CONTROL" && tar --format=gnu --numeric-owner --sort=name -cf - . ) \
		| gzip -9 -n -c > "$dir/control.tar.gz"
	( cd "$dir" && tar --format=gnu --numeric-owner --sort=name -cf - \
		./debian-binary ./data.tar.gz ./control.tar.gz ) \
		| gzip -9 -n -c > "$out"
	rm -rf "$dir"
}

# postinst/postrm bodies mirror theme/Makefile (the bits that must run on the
# device). UCI / rpcd calls are no-ops under IPKG_INSTROOT offline installs.
THEME_POSTINST='#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -f /usr/share/luci/acl.d/luci-theme-mint.json
	rm -f /usr/share/luci/acl.d/luci-theme-mintzero.json
	rm -f /tmp/luci-indexcache*
	rm -rf /tmp/luci-modulecache/
	uci -q delete luci.themes.MintLight
	uci -q delete luci.themes.MintDark
	uci -q delete luci.themes.MintzeroLight
	uci -q delete luci.themes.MintzeroDark
	_mzbase=$(uci -q get luci.main.mediaurlbase 2>/dev/null)
	case "$_mzbase" in
		*/mint-dark|*/mint-light|*/mintzero-dark|*/mintzero-light|*/mintzero)
			uci -q set luci.main.mediaurlbase=/luci-static/mint ;;
	esac
	uci -q commit luci
	# The wallpaper registrations moved to luci-app-mint-wallpaper
	# (2026-09-11). This is the copy that matters on a version upgrade:
	# opkg runs postrm with "upgrade" and it returns early, so ONLY postinst
	# removes the stale "Mint Wallpaper" entry.
	rm -f /usr/share/rpcd/acl.d/luci-theme-mint.json
	rm -f /usr/share/luci/menu.d/luci-theme-mint.json
	cd /usr/lib/lua/luci/i18n 2>/dev/null && {
		for f in luci-theme-mint.zh-cn.lmo; do
			[ -f "$f" ] || continue
			ln -sf "$f" "${f%.zh-cn.lmo}.zh_cn.lmo" 2>/dev/null || true
			ln -sf "$f" "${f%.zh-cn.lmo}.zh_CN.lmo" 2>/dev/null || true
		done
	}
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0'

THEME_POSTRM='#!/bin/sh
case "$1" in
	upgrade|deconfigure) exit 0 ;;
esac
[ -n "${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.mint
	uci -q delete luci.themes.MintLight
	uci -q delete luci.themes.MintDark
	uci -q delete luci.themes.MintzeroLight
	uci -q delete luci.themes.MintzeroDark
	uci commit luci
	rm -f /usr/share/luci/acl.d/luci-theme-mint.json
	# The wallpaper registrations moved to luci-app-mint-wallpaper
	# (2026-09-11); drop the stale ones so an upgrade cannot end up showing
	# the "Mint Wallpaper" entry twice.
	rm -f /usr/share/rpcd/acl.d/luci-theme-mint.json
	rm -f /usr/share/luci/menu.d/luci-theme-mint.json
	# The uploaded wallpapers (custom-*.jpg), cache images (wallpaper-*.img)
	# and the cron helper now belong to luci-app-mint-wallpaper; removing
	# the theme must not touch user data it no longer owns.
	rm -f /usr/lib/lua/luci/i18n/luci-theme-mint.zh_cn.lmo
	rm -f /usr/lib/lua/luci/i18n/luci-theme-mint.zh_CN.lmo
	rm -f /usr/lib/lua/luci/i18n/luci-theme-mintzero.zh_cn.lmo
	rm -f /usr/lib/lua/luci/i18n/luci-theme-mintzero.zh_CN.lmo
	rm -f /usr/share/luci/acl.d/luci-theme-mintzero.json
	# The wallpaper cache cron line and its helper moved to
	# luci-app-mint-wallpaper (2026-09-11); the postrm of that package
	# removes them.
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0'

# luci-app-mint-wallpaper postinst/postrm. Same conventions as the theme:
# reload rpcd instead of restarting it (a restart would log the admin out),
# and change nothing on an upgrade.
WALLPAPER_POSTINST='#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0'

WALLPAPER_POSTRM='#!/bin/sh
case "$1" in
	upgrade|deconfigure) exit 0 ;;
esac

[ -n "${IPKG_INSTROOT}" ] || {
	if [ -f /etc/crontabs/root ]; then
		grep -v "mz-wallpaper-fetch" /etc/crontabs/root > /tmp/mz-crontab.$$
		mv /tmp/mz-crontab.$$ /etc/crontabs/root
		/etc/init.d/cron restart >/dev/null 2>&1 || true
	fi
	rm -f /usr/bin/mz-wallpaper-fetch.sh
	rm -f /tmp/luci-indexcache*
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
exit 0'

# ---------------------------------------------------------------------------
# 4. build .apk (apk-tools v3 ADB, same layout as apk mkpkg)
# ---------------------------------------------------------------------------

build_apk() {
	# <name> <version> <depends> <desc> <payload> <out.apk> [extra mkadbpkg args...]
	local name="$1" ver="$2" deps="$3" desc="$4" payload="$5" out="$6"
	shift 6
	python3 "$SCRIPT_DIR/mkadbpkg.py" \
		--name "$name" \
		--version "$ver" \
		--arch noarch \
		--origin "$name" \
		--url "https://github.com/LianXia233/luci-theme-mint" \
		--license "Apache-2.0" \
		--maintainer "LianXia233 <LianXia233@users.noreply.github.com>" \
		--desc "$desc" \
		--depends "$deps" \
		--files "$payload" \
		--out "$out" \
		"$@"
}

# ---------------------------------------------------------------------------
# 5. pack all four artifacts
# ---------------------------------------------------------------------------

mkdir -p "$OUT"

THEME_IPK="$OUT/luci-theme-mint-${RELEASE_VERSION}-all.ipk"
WALLPAPER_IPK="$OUT/luci-app-mint-wallpaper-${RELEASE_VERSION}-all.ipk"
I18N_IPK="$OUT/luci-i18n-mint-zh-cn-${RELEASE_VERSION}-all.ipk"
WALLPAPER_I18N_IPK="$OUT/luci-i18n-mint-wallpaper-zh-cn-${RELEASE_VERSION}-all.ipk"
THEME_APK="$OUT/luci-theme-mint-${RELEASE_VERSION}.apk"
WALLPAPER_APK="$OUT/luci-app-mint-wallpaper-${RELEASE_VERSION}.apk"
I18N_APK="$OUT/luci-i18n-mint-zh-cn-${RELEASE_VERSION}.apk"
WALLPAPER_I18N_APK="$OUT/luci-i18n-mint-wallpaper-zh-cn-${RELEASE_VERSION}.apk"

log "packing ipk"
# The theme no longer depends on curl and no longer owns /etc/config/mint
# (both moved to the wallpaper app on 2026-09-11), so its conffiles are "-".
build_ipk luci-theme-mint "$THEME_PKG_VERSION" "luci-base" \
	"$PAYLOAD" "-" "$THEME_POSTINST" "$THEME_POSTRM" \
	"$THEME_IPK"
build_ipk luci-app-mint-wallpaper "$THEME_PKG_VERSION" "luci-base, curl" \
	"$WPAYLOAD" "/etc/config/mint" "$WALLPAPER_POSTINST" "$WALLPAPER_POSTRM" \
	"$WALLPAPER_IPK"
build_ipk luci-i18n-mint-zh-cn "$I18N_PKG_VERSION" "luci-theme-mint" \
	"$IPAYLOAD" "-" "-" "-" \
	"$I18N_IPK"
build_ipk luci-i18n-mint-wallpaper-zh-cn "$I18N_PKG_VERSION" "luci-app-mint-wallpaper" \
	"$WIPAYLOAD" "-" "-" "-" \
	"$WALLPAPER_I18N_IPK"

log "packing apk"
build_apk luci-theme-mint "$THEME_PKG_VERSION" "luci-base" \
	"Mint Theme" "$PAYLOAD" "$THEME_APK" \
	--exec etc/uci-defaults/30_luci-theme-mint
build_apk luci-app-mint-wallpaper "$THEME_PKG_VERSION" "luci-base,curl" \
	"Mint Wallpaper settings" "$WPAYLOAD" "$WALLPAPER_APK" \
	--exec usr/bin/mz-wallpaper-fetch.sh \
	--exec usr/libexec/rpcd/mint \
	--exec etc/uci-defaults/30_luci-app-mint-wallpaper
build_apk luci-i18n-mint-zh-cn "$I18N_PKG_VERSION" "luci-theme-mint" \
	"Mint Theme - zh-cn translation" "$IPAYLOAD" "$I18N_APK" \
	--exec etc/uci-defaults/luci-i18n-mint-zh-cn
build_apk luci-i18n-mint-wallpaper-zh-cn "$I18N_PKG_VERSION" "luci-app-mint-wallpaper" \
	"Mint Wallpaper - zh-cn translation" "$WIPAYLOAD" "$WALLPAPER_I18N_APK" \
	--exec etc/uci-defaults/luci-i18n-mint-wallpaper-zh-cn

for f in "$THEME_IPK" "$WALLPAPER_IPK" "$I18N_IPK" "$WALLPAPER_I18N_IPK" \
	"$THEME_APK" "$WALLPAPER_APK" "$I18N_APK" "$WALLPAPER_I18N_APK"; do
	[ -s "$f" ] || die "package not produced: $f"
	log "package: $f"
done

# ---------------------------------------------------------------------------
# 6. build metadata (shipped next to each package)
# ---------------------------------------------------------------------------

ORIGINATOR="$(date -u '+%a, %d %b %Y %H:%M:%S +0000')"

emit_buildinfo() {
	local final="$1" name="$2" ver="$3" fmt="$4" arch="$5"
	{
		printf 'package            : %s\n' "$final"
		printf 'package_name       : %s\n' "$name"
		printf 'package_version    : %s\n' "$ver"
		printf 'package_format     : %s\n' "$fmt"
		printf 'package_arch       : %s\n' "$arch"
		printf 'builder            : direct (pure-data assembly, no SDK)\n'
		printf 'theme_commit       : %s\n' "$THEME_COMMIT"
		printf 'theme_src_version  : %s\n' "$PKG_VERSION"
		printf 'release_version    : %s\n' "$RELEASE_VERSION"
		printf 'originator         : %s\n' "$ORIGINATOR"
	} > "$OUT/${final%.*}.buildinfo.txt"
}

emit_buildinfo "$(basename "$THEME_IPK")" luci-theme-mint "$THEME_PKG_VERSION" ipk all
emit_buildinfo "$(basename "$WALLPAPER_I18N_IPK")" luci-i18n-mint-wallpaper-zh-cn "$I18N_PKG_VERSION" ipk all
emit_buildinfo "$(basename "$WALLPAPER_IPK")" luci-app-mint-wallpaper "$THEME_PKG_VERSION" ipk all
emit_buildinfo "$(basename "$I18N_IPK")" luci-i18n-mint-zh-cn "$I18N_PKG_VERSION" ipk all
emit_buildinfo "$(basename "$THEME_APK")" luci-theme-mint "$THEME_PKG_VERSION" apk noarch
emit_buildinfo "$(basename "$WALLPAPER_I18N_APK")" luci-i18n-mint-wallpaper-zh-cn "$I18N_PKG_VERSION" apk noarch
emit_buildinfo "$(basename "$WALLPAPER_APK")" luci-app-mint-wallpaper "$THEME_PKG_VERSION" apk noarch
emit_buildinfo "$(basename "$I18N_APK")" luci-i18n-mint-zh-cn "$I18N_PKG_VERSION" apk noarch

# ---------------------------------------------------------------------------
# 7. step outputs
# ---------------------------------------------------------------------------

github_out package_version "$THEME_PKG_VERSION"
github_out i18n_package_version "$I18N_PKG_VERSION"
github_out theme_commit "$THEME_COMMIT"
github_out release_version "$RELEASE_VERSION"
github_out theme_ipk "$THEME_IPK"
github_out i18n_ipk "$I18N_IPK"
github_out theme_apk "$THEME_APK"
github_out i18n_apk "$I18N_APK"

printf 'package_version=%s\n' "$THEME_PKG_VERSION"
printf 'i18n_package_version=%s\n' "$I18N_PKG_VERSION"
printf 'theme_commit=%s\n' "$THEME_COMMIT"
ls -l "$OUT"
log "done"
