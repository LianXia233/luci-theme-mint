#!/usr/bin/env bash
#
# verify-package.sh - structural verification of built .apk / .ipk packages.
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# The point of this check is to prove that a package was really produced by
# the OpenWrt package build system:
#
#   apk - apk-tools v3 ADB container ("ADBd"/"ADB." magic; OpenWrt >= 25.12)
#         or, for completeness, apk-tools v2 gzip streams (.PKGINFO + payload)
#   ipk - gzip( tar( debian-binary, data.tar.gz, control.tar.gz ) )
#         (this is what OpenWrt's scripts/ipkg-build has always emitted)
#
# A renamed apk fails immediately: it carries neither the ipk's
# debian-binary/data.tar members nor an ipk control file, so the "not a
# renamed package" requirement is enforced, not assumed.
#
# Parsing lives in scripts/pkg-inspect.py (the one implementation shared
# with install-test.sh), so both scripts always agree on the container.
#
# Usage:
#   ./scripts/verify-package.sh --file dist/foo.apk [--expect-arch all]
#   ./scripts/verify-package.sh --dir dist
#
# Exits non-zero when any check fails.

set -euo pipefail

log()  { printf '[verify] %s\n' "$*"; }
fail() { printf '[verify] FAIL: %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0
FILES=()
EXPECT_ARCH="${EXPECT_ARCH:-all}"
EXPECT_NAME="luci-theme-mint"

while [ $# -gt 0 ]; do
	case "$1" in
	--file)        FILES+=("${2:-}"); shift 2 ;;
	--dir)         while IFS= read -r f; do FILES+=("$f"); done \
			< <(find "${2:-}" -maxdepth 1 -type f \
				\( -name '*.apk' -o -name '*.ipk' \) | sort); shift 2 ;;
	--expect-arch) EXPECT_ARCH="${2:-}"; shift 2 ;;
	--expect-name) EXPECT_NAME="${2:-}"; shift 2 ;;
	-h|--help)     sed -n '2,24p' "$0"; exit 0 ;;
	*) printf '[verify] unknown argument: %s\n' "$1" >&2; exit 2 ;;
	esac
done

[ "${#FILES[@]}" -gt 0 ] || { log "no package files given"; exit 2; }

# Resolve the shared inspector relative to this script, so verify works no
# matter what directory it is invoked from.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------------------------------------------------------------------------
# helper: dump metadata + payload listing for both formats
# ---------------------------------------------------------------------------

read_pkg_py() {
	python3 "$SCRIPT_DIR/pkg-inspect.py" info "$1"
}

# ---------------------------------------------------------------------------
# per-package checks
# ---------------------------------------------------------------------------

# NOTE: luci.mk installs ucode/ into UCODE_LIBRARYDIR = /usr/share/ucode/luci
# (NOT /usr/share/ucode), so the on-device paths carry the extra "luci"
# segment - the LuCI template runtime (modules/luci-base/ucode/runtime.uc)
# reads /usr/share/ucode/luci/template and resolves modules like
# luci.mint.wallpaper against /usr/share/ucode/luci.
# luci-theme-mint: the theme's own UI. ucode/mint/wallpaper.uc STAYS here
# even though the wallpaper settings moved out (2026-09-11): header.ut
# imports it statically, so a missing module would break the login template.
REQUIRED_FILES=(
	"usr/share/ucode/luci/template/themes/mint/header.ut"
	"usr/share/ucode/luci/template/themes/mint/footer.ut"
	"usr/share/ucode/luci/template/themes/mint/sysauth.ut"
	"usr/share/ucode/luci/mint/wallpaper.uc"
	"www/luci-static/mint/cascade.css"
	"etc/uci-defaults/30_luci-theme-mint"
)

# luci-app-mint-wallpaper: everything that WRITES the wallpaper
# configuration, split out of the theme on 2026-09-11.
WALLPAPER_REQUIRED_FILES=(
	"www/luci-static/resources/view/mint/wallpaper.js"
	"etc/config/mint"
	"etc/uci-defaults/30_luci-app-mint-wallpaper"
	"usr/libexec/rpcd/mint"
	"usr/bin/mz-wallpaper-fetch.sh"
	"usr/share/luci/menu.d/luci-app-mint-wallpaper.json"
	"usr/share/rpcd/acl.d/luci-app-mint-wallpaper.json"
	"lib/upgrade/keep.d/luci-app-mint-wallpaper"
)

# Payload of the translation package (luci.mk LuciTranslation): the compiled
# catalog plus the uci-defaults that registers the language.
I18N_REQUIRED_FILES=(
	"usr/lib/lua/luci/i18n/luci-theme-mint.zh-cn.lmo"
	"etc/uci-defaults/luci-i18n-mint-zh-cn"
)

# luci-app-mint-wallpaper has its own catalogue since the split (2026-09-11).
I18N_WP_REQUIRED_FILES=(
	"usr/lib/lua/luci/i18n/luci-app-mint-wallpaper.zh-cn.lmo"
	"etc/uci-defaults/luci-i18n-mint-wallpaper-zh-cn"
)

# Payload entries that MUST carry the executable bit. luci.mk copies root/
# with `cp -pR`, so a script committed as 0644 lands on the device as 0644:
# cron then cannot run /usr/bin/mz-wallpaper-fetch.sh at all (R-01). This
# assertion exists so that class of mistake can never ship silently again.
REQUIRED_EXEC=(
	"etc/uci-defaults/30_luci-theme-mint"
)

WALLPAPER_REQUIRED_EXEC=(
	"usr/bin/mz-wallpaper-fetch.sh"
	"usr/libexec/rpcd/mint"
	"etc/uci-defaults/30_luci-app-mint-wallpaper"
)

for pkg in "${FILES[@]}"; do
	log "────────────────────────────────────────────"
	log "package: $pkg"
	[ -s "$pkg" ] || { fail "$pkg does not exist or is empty"; continue; }

	# Package mode: the theme proper, or the auto-generated translation
	# package (the official LuCI API keeps translations separate from the
	# theme; the release ships both, so both must verify).
	I18N=0
	I18N_WP=0
	WALLPAPER=0
	# Order matters: the wallpaper catalogue matches both i18n patterns, so
	# its (more specific) pattern has to be tested first.
	case "$(basename "$pkg")" in
	luci-i18n-mint-wallpaper-*) I18N_WP=1 ;;
	luci-i18n-mint-*) I18N=1 ;;
	luci-app-mint-wallpaper-*) WALLPAPER=1 ;;
	esac
	if [ "$I18N_WP" = 1 ]; then
		EXPECT_NAME_PKG="luci-i18n-mint-wallpaper-zh-cn"
	elif [ "$I18N" = 1 ]; then
		EXPECT_NAME_PKG="luci-i18n-mint-zh-cn"
	elif [ "$WALLPAPER" = 1 ]; then
		EXPECT_NAME_PKG="luci-app-mint-wallpaper"
	else
		EXPECT_NAME_PKG="$EXPECT_NAME"
	fi

	info="$(read_pkg_py "$pkg")" || { fail "cannot parse $pkg"; continue; }
	get()  { printf '%s\n' "$info" | sed -n "s/^$1=//p"; }
	get1() { printf '%s\n' "$info" | sed -n "s/^$1=//p" | head -n1; }

	kind="$(get1 kind)"
	arch="$(get1 meta_arch)"
	[ -z "$arch" ] && arch="$(get1 control_architecture)"
	name="$(get1 meta_pkgname)"
	[ -z "$name" ] && name="$(get1 control_package)"
	version="$(get1 meta_pkgver)"
	[ -z "$version" ] && version="$(get1 control_version)"
	depends="$(get1 depend)"
	[ -z "$depends" ] && depends="$(get1 control_depends)"

	for e in $(get error); do fail "$pkg: $e"; done

	case "$pkg" in
	*.apk)
		[ "$kind" = apk ] || fail "$pkg has .apk extension but container is '${kind}' (renamed ipk?)"
		[ -n "$(get1 meta_pkgname)" ] \
			|| fail "$pkg carries no package metadata - not a real apk"
		;;
	*.ipk)
		[ "$kind" = ipk ] || fail "$pkg has .ipk extension but container is '${kind}' (renamed apk?)"
		for m in debian-binary control.tar; do
			get member | grep -q "^${m}" \
				|| fail "$pkg is missing member '${m}'"
		done
		get member | grep -q '^data.tar' \
			|| fail "$pkg is missing member 'data.tar.*'"
		[ -n "$(get1 control_package)" ] \
			|| fail "$pkg carries no control file - not a real ipk"
		;;
	esac

	log "  format    : ${kind}"
	log "  name      : ${name}"
	log "  version   : ${version}"
	log "  arch      : ${arch:-<none>}"
	log "  depends   : ${depends:-<none>}"

	[ "$name" = "$EXPECT_NAME_PKG" ] \
		|| fail "package name is '${name}', expected '${EXPECT_NAME_PKG}'"
	[ -n "$version" ] || fail "package version is empty"
	# Arch-independent in either backend: the ipk control says "all", while
	# the apk backend stamps arch-independent packages as "noarch" (OpenWrt
	# package-pack.mk maps PKGARCH=all to arch:noarch). Anything else means
	# the package picked up target-specific content.
	if [ "$EXPECT_ARCH" = all ]; then
		case "$arch" in
		all|noarch) : ;;
		*) fail "architecture is '${arch}', expected all (ipk) / noarch (apk) - pure data package must stay arch-independent" ;;
		esac
	else
		[ "$arch" = "$EXPECT_ARCH" ] \
			|| fail "architecture is '${arch}', expected '${EXPECT_ARCH}'"
	fi

	if [ "$I18N_WP" = 1 ]; then
		# the wallpaper catalogue must depend on the app it translates
		case " $depends " in
		*luci-app-mint-wallpaper*) : ;;
		*) fail "dependency luci-app-mint-wallpaper missing (got: ${depends:-<none>})" ;;
		esac
	elif [ "$I18N" = 1 ]; then
		# translation: must depend on the theme it translates
		case " $depends " in
		*luci-theme-mint*) : ;;
		*) fail "dependency luci-theme-mint missing (got: ${depends:-<none>})" ;;
		esac
	elif [ "$WALLPAPER" = 1 ]; then
		# The wallpaper app needs luci-base, and curl for the cache fetcher
		# (default images ship uclient-fetch only) - and nothing
		# kernel/target specific.
		case " $depends " in
		*"luci-base"*) : ;;
		*) fail "dependency luci-base missing (got: ${depends:-<none>})" ;;
		esac
		case " $depends " in
		*curl*) : ;;
		*) fail "dependency curl missing (wallpaper fetcher needs it)" ;;
		esac
		for bad in kmod- kernel; do
			case " $depends " in
			*" $bad"*) fail "unexpected kernel-bound dependency '${bad}' in a data-only app" ;;
			esac
		done
	else
		# The theme itself needs luci-base only: curl and the wallpaper
		# backend moved to luci-app-mint-wallpaper on 2026-09-11.
		case " $depends " in
		*"luci-base"*) : ;;
		*) fail "dependency luci-base missing (got: ${depends:-<none>})" ;;
		esac
		for bad in kmod- kernel; do
			case " $depends " in
			*" $bad"*) fail "unexpected kernel-bound dependency '${bad}' in a data-only theme" ;;
			esac
		done
		# Pulling curl back in would mean the split regressed.
		case " $depends " in
		*curl*) fail "luci-theme-mint must not depend on curl any more (moved to luci-app-mint-wallpaper)" ;;
		esac
	fi

	# Payload sanity: every file the package needs must be inside it.
	mapfile -t payload < <(get file | sed 's|^\./||' | sort -u)
	log "  payload   : ${#payload[@]} entries"
	[ "${#payload[@]}" -gt 0 ] || fail "$pkg payload is empty"

	if [ "$I18N_WP" = 1 ]; then
		REQ_FILES=("${I18N_WP_REQUIRED_FILES[@]}")
	elif [ "$I18N" = 1 ]; then
		REQ_FILES=("${I18N_REQUIRED_FILES[@]}")
	elif [ "$WALLPAPER" = 1 ]; then
		REQ_FILES=("${WALLPAPER_REQUIRED_FILES[@]}")
	else
		REQ_FILES=("${REQUIRED_FILES[@]}")
	fi
	for req in "${REQ_FILES[@]}"; do
		printf '%s\n' "${payload[@]}" | grep -qx "$req" \
			|| fail "$pkg is missing ${req}"
	done

	if [ "$I18N" = 0 ] && [ "$I18N_WP" = 0 ]; then
		mapfile -t xpayload < <(get xfile | sed 's|^\./||' | sort -u)
		if [ "$WALLPAPER" = 1 ]; then
			EXEC_FILES=("${WALLPAPER_REQUIRED_EXEC[@]}")
		else
			EXEC_FILES=("${REQUIRED_EXEC[@]}")
		fi
		for req in "${EXEC_FILES[@]}"; do
			printf '%s\n' "${xpayload[@]}" | grep -qx "$req" \
				|| fail "$pkg ships ${req} WITHOUT the executable bit"
		done

	fi

	if [ "$I18N" = 0 ] && [ "$I18N_WP" = 0 ] && [ "$WALLPAPER" = 0 ]; then
		present_css="$(printf '%s\n' "${payload[@]}" | grep -c '^www/luci-static/mint/.*\.css$' || true)"
		present_js="$(printf '%s\n' "${payload[@]}" | grep -c '^www/luci-static/.*\.js$' || true)"
		[ "$present_css" -gt 0 ] || fail "$pkg ships no CSS"
		[ "$present_js" -gt 0 ] || fail "$pkg ships no JavaScript"
	fi

	log "  ok        : $(basename "$pkg")"
done

log "────────────────────────────────────────────"
if [ "$FAILURES" -gt 0 ]; then
	printf '[verify] %d check(s) failed\n' "$FAILURES" >&2
	exit 1
fi
log "all packages verified"
