#!/usr/bin/env bash
#
# build-package.sh - build luci-theme-mint with an official OpenWrt SDK.
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# The package format is decided by the OpenWrt package build system itself
# (CONFIG_USE_APK in include/package-pack.mk on 24.10/25.12/master,
# include/package-ipkg.mk on <= 23.05). Nothing here renames, rewrites or
# post-processes a package: an .apk and an .ipk are produced by two separate
# real builds through the very same luci.mk package definition.
#
# Usage:
#   ./scripts/build-package.sh --version 25.12 --target x86/64 --format apk
#   ./scripts/build-package.sh --version 25.12 --target mediatek/filogic \
#        --format ipk --release-version v1.0.0 --out dist
#
# Options:
#   --version         25.12 | 25.12.5 | 24.10 | snapshot   (required)
#   --target          <target>/<subtarget>                 (required)
#   --format          apk | ipk                            (required)
#   --release-version version string used in artifact names (default: nightly)
#   --out             where the package + build info are dropped (default: dist)
#   --workdir         scratch directory                    (default: build)
#   --allow-legacy    when the requested SDK has no ipk backend, fall back to
#                     an older official SDK that does (never a fake ipk)
#   --luci-branch     override the LuCI branch (auto-detected by default)
#   --jobs            parallelism (default: nproc)
#
# Environment:
#   LUCI_FEED_URL     LuCI feed repository to pin (default:
#                     https://github.com/openwrt/luci.git). Point it at a
#                     mirror (or a local file:// clone) if GitHub is slow or
#                     unreachable from your network.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/get-openwrt-sdk.sh
. "$SCRIPT_DIR/get-openwrt-sdk.sh"

log()  { printf '[build] %s\n' "$*"; }
warn() { printf '[build] warning: %s\n' "$*" >&2; }
die()  { printf '[build] error: %s\n' "$*" >&2; exit 1; }

github_out() {
	[ -n "${GITHUB_OUTPUT:-}" ] || return 0
	printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
}

# LuCI branch that matches the OpenWrt version we build against. Mixing a
# stable SDK with LuCI master is exactly the kind of silent ABI drift this
# project wants to avoid.
luci_branch_for() {
	case "$1" in
	snapshot|SNAPSHOT|main|master) printf 'master' ;;
	25.12|25.12.*)                 printf 'openwrt-25.12' ;;
	24.10|24.10.*)                 printf 'openwrt-24.10' ;;
	23.05|23.05.*)                 printf 'openwrt-23.05' ;;
	*)
		if [[ "$1" =~ ^[0-9]+\.[0-9]+ ]]; then
			printf 'openwrt-%s.%s' "${BASH_REMATCH[0]%%.*}" "${BASH_REMATCH[0]##*.}"
		else
			printf 'master'
		fi
		;;
	esac
}

target_slug() { printf '%s' "${1//\//_}"; }

# Put a value into the SDK .config, replacing any previous definition.
# Note: for bool/tristate symbols the only valid "off" spelling is the
# canonical "# CONFIG_X is not set" line - "CONFIG_X=n" is not valid .config
# syntax for booleans.
set_config() {
	local sdk="$1" key="$2" value="$3"
	[ -f "$sdk/.config" ] || : > "$sdk/.config"
	sed -i "/^${key}=/d; /^# ${key} is not set$/d" "$sdk/.config"
	printf '%s\n' "$value" >> "$sdk/.config"
}

# Set up the SDK's feeds for a real build:
#  - keep the feed set the SDK itself ships.  The "base" feed is the pinned
#    OpenWrt core checkout the SDK was generated from (rpcd, ucode, libubox,
#    libubus, iwinfo, mbedtls, ...) and the packages feed provides curl, lua,
#    cgi-io, ... - luci-base's whole dependency chain needs them.
#    Overwriting feeds.conf.default with the luci feed alone starves that
#    chain: the metadata scan silently drops every unknown dependency
#    ("WARNING: ... has a dependency on 'curl', which does not exist") and
#    the build dies inside lucihttp/ucode-mod-html on missing lua.h /
#    ucode/module.h headers.
#  - re-point only the luci feed at the GitHub mirror of the branch matching
#    the SDK series (same content as the SDK's own luci line, faster clone),
#  - update and install everything (errors are fatal, never silenced),
#  - drop the theme into the luci feed and link it into the buildroot.
setup_feeds() {
	local sdk="$1" branch="$2"

	log "setting up feeds (luci pinned to ${branch})"
	# feeds.conf overrides feeds.conf.default - make sure only the SDK's own
	# feed set plus our luci pin is in effect.
	rm -f "$sdk/feeds.conf"
	if [ -f "$sdk/feeds.conf.default" ]; then
		sed -i -E '/^[[:space:]]*src-git([[:space:]]+--root=[^[:space:]]+)?[[:space:]]+luci[[:space:]]/d' \
			"$sdk/feeds.conf.default"
	else
		: > "$sdk/feeds.conf.default"
	fi
	printf 'src-git luci %s;%s\n' "$LUCI_FEED_URL" "$branch" \
		>> "$sdk/feeds.conf.default"

	log "feeds.conf.default:"
	sed 's/^/  /' "$sdk/feeds.conf.default" >&2

	( cd "$sdk" && ./scripts/feeds update -a )
	( cd "$sdk" && ./scripts/feeds install -a )

	LUCI_FEED_DIR="$sdk/feeds/luci"
	[ -d "$LUCI_FEED_DIR" ] || die "LuCI feed not found at $LUCI_FEED_DIR"

	# Install the theme into the feed so luci.mk resolves (include ../../luci.mk
	# expects <feed>/themes/<pkg>/Makefile -> <feed>/luci.mk).
	THEME_FEED_DIR="$LUCI_FEED_DIR/themes/luci-theme-mint"
	rm -rf "$THEME_FEED_DIR"
	mkdir -p "$THEME_FEED_DIR"
	cp -a "$THEME_SRC/." "$THEME_FEED_DIR/"
	[ -f "$THEME_FEED_DIR/Makefile" ] || die "theme Makefile missing after copy"

	# R-11: version the package by the THEME repository's own revision
	# (same <yy>.<doy>.<secs>~<hash> scheme luci.mk's findrev uses), not by
	# whatever HEAD feeds/luci happens to sit on. The Makefile ships
	# "PKG_VERSION ?=" exactly for this injection; a plain in-feed build
	# (no PKG_VERSION line match / no git) silently keeps stock behaviour.
	local trev thash tsecs tyday tver
	trev="$(git -C "$REPO_ROOT" log -1 --format='%ct' --abbrev=7 -- theme 2>/dev/null || true)"
	thash="$(git -C "$REPO_ROOT" log -1 --format='%h' --abbrev=7 -- theme 2>/dev/null || true)"
	if [ -n "$trev" ] && [ -n "$thash" ]; then
		tsecs=$((trev % 86400))
		tyday="$(date --utc --date="@$trev" '+%y.%j')"
		tver="$(printf '%s.%05d~%s' "$tyday" "$tsecs" "$thash")"
		sed -i "s/^PKG_VERSION ?=.*/PKG_VERSION := $tver/" "$THEME_FEED_DIR/Makefile" \
			&& log "theme version : ${tver} (from theme repo HEAD)" \
			|| warn "could not inject PKG_VERSION - luci.mk findrev fallback in effect"
	fi

	# feeds install cannot see directories injected after "update", so link it
	# in by hand - the same thing the buildroot does for regular feed packages.
	mkdir -p "$sdk/package/feeds/luci"
	ln -sfn "../../../feeds/luci/themes/luci-theme-mint" \
		"$sdk/package/feeds/luci/luci-theme-mint"
	[ -f "$sdk/package/feeds/luci/luci-theme-mint/Makefile" ] \
		|| die "theme package not visible to the buildroot"

	# The source packages that carry the theme's build-time dependency chain
	# must now be linked into the buildroot (base feed: rpcd, ubus, ucode,
	# lua, libubox; packages feed: curl, cgi-io; luci feed: lucihttp).
	# Note: subpackages such as libubus or ucode-mod-html have no symlink of
	# their own - their selection is verified against .config in
	# configure_sdk() after defconfig has resolved the full chain.
	local dep found missing=""
	for dep in luci-base lucihttp rpcd ubus ucode lua curl libubox cgi-io; do
		found="$(find "$sdk/package/feeds" -maxdepth 2 -name "$dep" -print -quit)"
		[ -n "$found" ] || missing="$missing $dep"
	done
	[ -z "$missing" ] \
		|| die "required source package(s) missing after feeds install:${missing} - the SDK feed set is incomplete"
}

# Write the build configuration and run defconfig.
# Returns 1 (without dying) when the SDK refuses the requested package
# format, so the caller can fall back to another SDK candidate; any other
# failure is fatal.
configure_sdk() {
	local sdk="$1" format="$2"

	log "configuring SDK"
	set_config "$sdk" CONFIG_PACKAGE_luci-theme-mint "CONFIG_PACKAGE_luci-theme-mint=m"
	set_config "$sdk" CONFIG_LUCI_JSMIN      "CONFIG_LUCI_JSMIN=y"
	set_config "$sdk" CONFIG_LUCI_CSSTIDY    "# CONFIG_LUCI_CSSTIDY is not set"
	set_config "$sdk" CONFIG_SIGNED_PACKAGES "CONFIG_SIGNED_PACKAGES=n"

	if [ "$format" = apk ]; then
		# apk is the native format of 25.12/master and supported since 24.10.
		set_config "$sdk" CONFIG_USE_APK "CONFIG_USE_APK=y"
	else
		# Leave the apk switch off: the buildroot then uses its ipk backend
		# (scripts/ipkg-build / include/package-ipkg.mk). This is the switch
		# the build system itself defines - not a renaming step.
		set_config "$sdk" CONFIG_USE_APK "# CONFIG_USE_APK is not set"
	fi

	( cd "$sdk" && make defconfig ) \
		|| die "make defconfig failed"

	grep -q '^CONFIG_PACKAGE_luci-theme-mint=m' "$sdk/.config" \
		|| { sed -n '1,40p' "$sdk/.config" >&2; die "theme package is not selectable"; }

	# The whole runtime dependency chain must have survived defconfig. If a
	# feed is missing, the metadata scan silently drops unknown dependencies
	# ("WARNING: ... has a dependency on 'curl', which does not exist") and
	# the build dies half-way through on missing headers - so verify the
	# resolved selection instead (subpackages like libubus or ucode-mod-html
	# are only visible here, not as feed directories).
	local dep ok=1
	for dep in luci-base curl rpcd ucode ucode-mod-html ucode-mod-uci \
		liblucihttp-ucode libubus libubox cgi-io; do
		grep -qE "^CONFIG_PACKAGE_${dep}=[my]" "$sdk/.config" || {
			warn "dependency package '${dep}' missing from .config - the SDK feed set is incomplete"
			ok=0
		}
	done
	[ "$ok" = 1 ] || die "the SDK's feed set cannot satisfy luci-base's dependency chain"

	# Sanity: the format we asked for is the format the SDK will emit.
	# Current SDKs bake USE_APK into a promptless kconfig symbol
	# (Config-build.in "config USE_APK / bool / default y"), and a promptless
	# symbol ignores the user request - "# CONFIG_USE_APK is not set" is
	# silently rewritten to =y by make defconfig.  Detect that here and let
	# the caller fall back to an SDK that really ships an ipk backend
	# instead of shipping a renamed apk.
	if [ "$format" = apk ]; then
		grep -q '^CONFIG_USE_APK=y' "$sdk/.config" && return 0
		die "SDK ignored CONFIG_USE_APK=y - it cannot emit apk packages"
	else
		grep -q '^CONFIG_USE_APK=y' "$sdk/.config" && return 1
		return 0
	fi
}

# ---------------------------------------------------------------------------
# arguments
# ---------------------------------------------------------------------------

VERSION="" TARGET="" FORMAT="" RELEASE_VERSION="nightly"
OUT="dist" WORKDIR="build" ALLOW_LEGACY=0 LUCI_BRANCH="" JOBS=""
LUCI_FEED_URL="${LUCI_FEED_URL:-https://github.com/openwrt/luci.git}"

while [ $# -gt 0 ]; do
	case "$1" in
	--version)         VERSION="${2:-}"; shift 2 ;;
	--target)          TARGET="${2:-}"; shift 2 ;;
	--format)          FORMAT="${2:-}"; shift 2 ;;
	--release-version) RELEASE_VERSION="${2:-}"; shift 2 ;;
	--out)             OUT="${2:-}"; shift 2 ;;
	--workdir)         WORKDIR="${2:-}"; shift 2 ;;
	--luci-branch)     LUCI_BRANCH="${2:-}"; shift 2 ;;
	--jobs)            JOBS="${2:-}"; shift 2 ;;
	--allow-legacy)    ALLOW_LEGACY=1; shift ;;
	-h|--help)         sed -n '2,32p' "$0"; exit 0 ;;
	*) die "unknown argument: $1" ;;
	esac
done

[ -n "$VERSION" ] || die "--version is required"
[ -n "$TARGET" ]  || die "--target is required"
[ -n "$FORMAT" ]  || die "--format is required (apk|ipk)"
[[ "$FORMAT" == apk || "$FORMAT" == ipk ]] || die "--format must be apk or ipk"
[ -n "$JOBS" ] || JOBS="$(nproc 2>/dev/null || echo 2)"

REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
THEME_SRC="$REPO_ROOT/theme"
[ -d "$THEME_SRC" ] || die "theme sources not found at $THEME_SRC"

# ---------------------------------------------------------------------------
# 1. SDK: requested version first, legacy fallbacks only for ipk
# ---------------------------------------------------------------------------

CANDIDATES="$VERSION"
if [ "$FORMAT" = ipk ] && [ "$ALLOW_LEGACY" = 1 ]; then
	# 24.10 is the newest series whose official repositories still publish
	# ipk packages; 23.05 is the last series with the dedicated
	# include/package-ipkg.mk backend. Both are real OpenWrt SDKs.
	for legacy in 24.10 23.05; do
		[ "$legacy" = "$VERSION" ] && continue
		CANDIDATES="$CANDIDATES $legacy"
	done
fi

SDK_DIR="" SDK_URL="" OPENWRT_RELEASE="" KERNEL_VERSION="" USED_VERSION=""
LEGACY=0 LUCI_FEED_DIR="" THEME_FEED_DIR=""

for cand in $CANDIDATES; do
	sdk_dir="$WORKDIR/sdk-$FORMAT"
	rm -rf "$sdk_dir"
	mkdir -p "$WORKDIR"
	meta_file="$WORKDIR/sdk-meta-${FORMAT}-${cand//\//_}.txt"
	rm -f "$meta_file"

	log "resolving SDK: version=${cand} target=${TARGET}"
	# Progress logs from get-openwrt-sdk.sh go to stderr (visible in CI).
	# Only the final key=value summary is written to stdout / meta_file.
	# GITHUB_OUTPUT is cleared so nested github_out calls do not clobber
	# the caller's step outputs with intermediate keys.
	rc=0
	GITHUB_OUTPUT= "$SCRIPT_DIR/get-openwrt-sdk.sh" \
		--version "$cand" --target "$TARGET" \
		--workdir "$WORKDIR" --sdk-dir "$sdk_dir" \
		--format "$FORMAT" >"$meta_file" || rc=$?
	if [ "$rc" -ne 0 ]; then
		warn "SDK resolution failed for ${cand} (exit ${rc})"
		continue
	fi
	out="$(cat "$meta_file" 2>/dev/null || true)"

	s_apk="$(printf '%s\n' "$out" | sed -n 's/^supports_apk=//p' | tail -n1)"
	s_ipk="$(printf '%s\n' "$out" | sed -n 's/^supports_ipk=//p' | tail -n1)"
	sdk_url="$(printf '%s\n' "$out" | sed -n 's/^sdk_url=//p' | tail -n1)"
	release="$(printf '%s\n' "$out" | sed -n 's/^openwrt_release=//p' | tail -n1)"
	kernel="$(printf '%s\n' "$out" | sed -n 's/^kernel_version=//p' | tail -n1)"

	if [ -z "$sdk_url" ] && [ -z "$s_apk$s_ipk" ]; then
		warn "${cand} SDK produced no machine-readable summary"
		continue
	fi

	if [ "$FORMAT" = apk ] && [ "$s_apk" != 1 ]; then
		warn "${cand} SDK cannot build apk (${sdk_url})"
		continue
	fi
	if [ "$FORMAT" = ipk ] && [ "$s_ipk" != 1 ]; then
		warn "${cand} SDK has no ipk backend (${sdk_url}) - not faking one"
		continue
	fi

	# Feeds + configuration happen per candidate so that an SDK which turns
	# out unable to emit the requested format (e.g. USE_APK baked to y) makes
	# us fall back to the next candidate instead of dying.
	cand_branch="${LUCI_BRANCH:-$(luci_branch_for "$cand")}"
	setup_feeds "$sdk_dir" "$cand_branch"
	if ! configure_sdk "$sdk_dir" "$FORMAT"; then
		warn "${cand} SDK forces CONFIG_USE_APK=y - it cannot emit ipk, trying next candidate"
		continue
	fi

	SDK_DIR="$sdk_dir"
	SDK_URL="$sdk_url"
	OPENWRT_RELEASE="${release:-unknown}"
	KERNEL_VERSION="${kernel:-unknown}"
	USED_VERSION="$cand"
	LUCI_BRANCH="$cand_branch"
	[ "$cand" = "$VERSION" ] || LEGACY=1
	break
done

[ -n "$SDK_DIR" ] || die "no official SDK could provide a ${FORMAT} backend for ${VERSION}/${TARGET}"
[ "$LEGACY" = 1 ] && warn "ipk built with compatibility SDK ${USED_VERSION} (requested ${VERSION})"

log "openwrt       : ${OPENWRT_RELEASE} (requested ${VERSION})"
log "kernel        : ${KERNEL_VERSION}"
log "luci branch   : ${LUCI_BRANCH}"
log "package format: ${FORMAT}"

# ---------------------------------------------------------------------------
# 2. build
# ---------------------------------------------------------------------------

# Host tools (po2lmo / jsmin) are a hard prerequisite for the luci feed's
# po compilation and JS minification - a failure here must stop the build,
# not be waved through.
log "building host tools (po2lmo / jsmin)"
( cd "$SDK_DIR" && make package/feeds/luci/luci-base/host/compile V=s -j"$JOBS" ) \
	|| die "luci-base host tools (po2lmo/jsmin) failed to build"

# This compiles the theme AND its full dependency chain (rpcd, ucode,
# lucihttp, curl, ...) from source with the SDK's cross toolchain. Errors
# are fatal - never IGNORE_ERRORS, never a renamed package.
log "building luci-theme-mint (${FORMAT})"
( cd "$SDK_DIR" && make package/feeds/luci/luci-theme-mint/compile V=s -j"$JOBS" ) \
	|| die "package build failed"

# ---------------------------------------------------------------------------
# 3. collect
# ---------------------------------------------------------------------------

mkdir -p "$OUT"
mapfile -t PKGS < <(find "$SDK_DIR/bin/packages" -type f \
	\( -name "luci-theme-mint*.${FORMAT}" \) 2>/dev/null | sort)

[ "${#PKGS[@]}" -gt 0 ] || {
	find "$SDK_DIR/bin" -type f | head -50 >&2 || true
	die "no luci-theme-mint *.${FORMAT} produced by the build system"
}

SLUG="$(target_slug "$TARGET")"
LABEL="$USED_VERSION"
PKG_VERSION="$(basename "${PKGS[0]}")"
PKG_VERSION="${PKG_VERSION#luci-theme-mint}"
PKG_VERSION="${PKG_VERSION%.*}"
PKG_VERSION="${PKG_VERSION%_all}"
PKG_VERSION="${PKG_VERSION#[_-]}"

FINAL_NAME="luci-theme-mint-${RELEASE_VERSION}-${LABEL}-${SLUG}-all.${FORMAT}"
cp -f "${PKGS[0]}" "$OUT/$FINAL_NAME"

log "package: $OUT/$FINAL_NAME"

# ---------------------------------------------------------------------------
# 4. build metadata (shipped next to the package as evidence)
# ---------------------------------------------------------------------------

LUCI_COMMIT="$(git -C "$LUCI_FEED_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
{
	printf 'package            : %s\n' "$FINAL_NAME"
	printf 'package_name       : luci-theme-mint\n'
	printf 'package_version    : %s\n' "$PKG_VERSION"
	printf 'package_format     : %s\n' "$FORMAT"
	printf 'package_arch       : all\n'
	printf 'openwrt_requested  : %s\n' "$VERSION"
	printf 'openwrt_release    : %s\n' "$OPENWRT_RELEASE"
	printf 'openwrt_series     : %s\n' "$USED_VERSION"
	printf 'openwrt_target     : %s\n' "$TARGET"
	printf 'kernel_version     : %s\n' "$KERNEL_VERSION"
	printf 'sdk_url            : %s\n' "$SDK_URL"
	printf 'luci_branch        : %s\n' "$LUCI_BRANCH"
	printf 'luci_commit        : %s\n' "$LUCI_COMMIT"
	printf 'legacy_compat_sdk  : %s\n' "$LEGACY"
	printf 'release_version    : %s\n' "$RELEASE_VERSION"
} > "$OUT/${FINAL_NAME%.${FORMAT}}.buildinfo.txt"

github_out package_file "$OUT/$FINAL_NAME"
github_out package_name "$FINAL_NAME"
github_out package_version "$PKG_VERSION"
github_out package_format "$FORMAT"
github_out package_arch all
github_out openwrt_release "$OPENWRT_RELEASE"
github_out openwrt_series "$USED_VERSION"
github_out openwrt_target "$TARGET"
github_out kernel_version "$KERNEL_VERSION"
github_out sdk_url "$SDK_URL"
github_out luci_branch "$LUCI_BRANCH"
github_out luci_commit "$LUCI_COMMIT"
github_out legacy_compat_sdk "$LEGACY"

printf 'package_file=%s\n' "$OUT/$FINAL_NAME"
printf 'package_name=%s\n' "$FINAL_NAME"
printf 'package_version=%s\n' "$PKG_VERSION"
printf 'package_format=%s\n' "$FORMAT"
printf 'package_arch=%s\n' "all"
printf 'openwrt_release=%s\n' "$OPENWRT_RELEASE"
printf 'openwrt_series=%s\n' "$USED_VERSION"
printf 'kernel_version=%s\n' "$KERNEL_VERSION"
printf 'legacy_compat_sdk=%s\n' "$LEGACY"
