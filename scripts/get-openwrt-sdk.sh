#!/usr/bin/env bash
#
# get-openwrt-sdk.sh - resolve, download and unpack an official OpenWrt SDK.
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# Nothing about the SDK is hardcoded: the release series, the concrete
# version, the tarball name and the compression are all discovered from the
# official download index at run time, so a new OpenWrt point release never
# breaks the build.
#
# Usage:
#   ./scripts/get-openwrt-sdk.sh --version 25.12 --target x86/64 \
#        [--workdir DIR] [--sdk-dir DIR] [--format apk|ipk]
#
# Options:
#   --version  25.12 | 25.12.5 | 24.10 | 23.05 | snapshot   (required)
#   --target   <target>/<subtarget>, e.g. x86/64, mediatek/filogic (required)
#   --workdir  where to download / unpack            (default: ./build)
#   --sdk-dir  final SDK path                        (default: $workdir/sdk)
#   --format   apk | ipk - only affects capability reporting
#   --print    print resolved metadata and exit without downloading
#
# Outputs (stdout, and $GITHUB_OUTPUT when running inside Actions):
#   sdk_dir, sdk_url, sdk_file, openwrt_release, openwrt_series,
#   openwrt_base_url, kernel_version, supports_apk, supports_ipk
#
# The script is also safe to source from build-package.sh: main() only runs
# when the file is executed directly.

set -euo pipefail

# Official mirror. Overridable so downstream users (and the offline tests in
# this repo) can point at a local mirror without touching the logic.
OPENWRT_BASE_URL="${OPENWRT_BASE_URL:-https://downloads.openwrt.org}"

log()  { printf '[sdk] %s\n' "$*"; }
warn() { printf '[sdk] warning: %s\n' "$*" >&2; }
die()  { printf '[sdk] error: %s\n' "$*" >&2; exit 1; }

github_out() {
	# Emit a key/value pair for GitHub Actions when the output file is set.
	[ -n "${GITHUB_OUTPUT:-}" ] || return 0
	printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
}

# ---------------------------------------------------------------------------
# index helpers
# ---------------------------------------------------------------------------

# Fetch a directory index (or any URL) with retries. GitHub runners
# occasionally get a transient 5xx from the download mirrors.
fetch_into() {
	local url="$1" dest="$2"
	curl -fsSL --retry 4 --retry-delay 5 --retry-all-errors \
		--connect-timeout 20 --max-time 300 "$url" -o "$dest" 2>/dev/null
}

fetch_url() {
	local url="$1" tmp
	tmp="$(mktemp)"
	fetch_into "$url" "$tmp" || true
	# Some mirrors (and local test mirrors) serve nothing for a bare
	# directory URL and only expose an explicit index file.
	if [ ! -s "$tmp" ] && [[ "$url" == */ ]]; then
		fetch_into "${url}index.html" "$tmp" || true
	fi
	if [ ! -s "$tmp" ]; then
		rm -f "$tmp"
		return 1
	fi
	cat "$tmp"
	rm -f "$tmp"
}

# Does the URL resolve? Used for the "25.12.x" style rolling directories that
# only exist for some series.
url_exists() {
	curl -fsSIL --retry 2 --retry-delay 2 --connect-timeout 15 \
		--max-time 60 -o /dev/null "$1" 2>/dev/null
}

# Latest concrete release of a series, e.g. series 25.12 -> 25.12.5.
# Release candidates (25.12.0-rc1) are excluded.
latest_release_of_series() {
	local series="$1" idx
	idx="$(fetch_url "${OPENWRT_BASE_URL}/releases/")" \
		|| die "cannot read ${OPENWRT_BASE_URL}/releases/"
	printf '%s' "$idx" \
		| grep -oE "${series//./\\.}[0-9]*\.[0-9]+/" \
		| grep -vE 'rc|RC' \
		| tr -d '/' \
		| sort -V \
		| tail -n1
}

# Resolve a user supplied version into a concrete download base URL.
#   25.12      -> releases/25.12.x if it exists, else releases/25.12.<latest>
#   25.12.5    -> releases/25.12.5
#   snapshot   -> snapshots
resolve_base_url() {
	local version="$1" series latest

	case "$version" in
	snapshot|SNAPSHOT|main|master)
		printf '%s/snapshots' "$OPENWRT_BASE_URL"
		return 0
		;;
	esac

	if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
		printf '%s/releases/%s' "$OPENWRT_BASE_URL" "$version"
		return 0
	fi

	if [[ "$version" =~ ^[0-9]+\.[0-9]+$ ]]; then
		series="$version"
		# Preferred: the rolling "<series>.x" directory that always points at
		# the newest point release (kept for series that publish it).
		if url_exists "${OPENWRT_BASE_URL}/releases/${series}.x/targets/"; then
			printf '%s/releases/%s.x' "$OPENWRT_BASE_URL" "$series"
			return 0
		fi
		latest="$(latest_release_of_series "$series")"
		[ -n "$latest" ] || die "no release found for series ${series}"
		warn "no ${series}.x directory, using ${latest}"
		printf '%s/releases/%s' "$OPENWRT_BASE_URL" "$latest"
		return 0
	fi

	die "unsupported version '${version}' (use 25.12, 25.12.5, 24.10 or snapshot)"
}

# Pick the SDK tarball from a target directory index.
# Stable releases and snapshots name SDK archives with "sdk" in the filename,
# but the exact position varies (for example, openwrt-25.12.5-...-SDK...).
find_sdk_file() {
	local dir_url="$1" idx sdk

	idx="$(fetch_url "$dir_url")" \
		|| die "cannot read SDK index ${dir_url}"

	sdk="$(printf '%s' "$idx" \
		| grep -ioE 'openwrt-[A-Za-z0-9._+-]*sdk[A-Za-z0-9._+-]*\.tar\.(zst|xz|zstd)' \
		| sort -u \
		| grep -E 'Linux-x86_64' \
		| sort -V \
		| tail -n1)"

	[ -n "$sdk" ] || die "no openwrt-sdk-*.tar.zst|xz found under ${dir_url}"
	printf '%s' "$sdk"
}

# Which package backends does this SDK actually provide?
#   24.10 / 25.12 / master all ship include/package-pack.mk with a
#   CONFIG_USE_APK switch; the ipk path additionally needs scripts/ipkg-build.
#   Older releases (<= 23.05) ship include/package-ipkg.mk and can only build
#   ipk.
detect_backends() {
	local sdk="$1" supports_apk=0 supports_ipk=0

	if [ -f "$sdk/include/package-pack.mk" ]; then
		if grep -q 'CONFIG_USE_APK' "$sdk/include/package-pack.mk"; then
			supports_apk=1
			supports_ipk=1
		fi
		# ipk additionally needs the legacy builder script
		if [ "$supports_ipk" = 1 ] && [ ! -f "$sdk/scripts/ipkg-build" ]; then
			supports_ipk=0
		fi
	fi

	# <= 23.05: dedicated ipk backend, no apk at all
	if [ -f "$sdk/include/package-ipkg.mk" ]; then
		supports_ipk=1
		supports_apk=0
	fi

	printf '%s %s' "$supports_apk" "$supports_ipk"
}

# Kernel version the SDK targets, straight from its own metadata. Never
# guessed, never overridden.
detect_kernel_version() {
	local sdk="$1" ver=""

	if [ -f "$sdk/include/kernel-version.mk" ]; then
		# e.g. "LINUX_VERSION-6.12 = .94" -> 6.12.94
		# "LINUX_VERSION-6.12 = .94" (or ":=") -> 6.12.94
		ver="$(grep -oE '^LINUX_VERSION-[0-9.]+[[:space:]]*:?=[[:space:]]*[0-9.]+' \
			"$sdk/include/kernel-version.mk" \
			| sed -E 's/^LINUX_VERSION-([0-9.]+)[[:space:]]*:?=[[:space:]]*\.?([0-9.]+)/\1.\2/' \
			| sort -V | tail -n1)"
	fi
	if [ -z "$ver" ] && [ -f "$sdk/include/kernel.mk" ]; then
		ver="$(grep -m1 -oE '^LINUX_VERSION[[:space:]]*:=[[:space:]]*[0-9.]+' \
			"$sdk/include/kernel.mk" | awk '{print $NF}')"
	fi
	printf '%s' "${ver:-unknown}"
}

# OpenWrt release string baked into the SDK (e.g. 25.12.5 / SNAPSHOT).
detect_release() {
	local sdk="$1"
	if [ -f "$sdk/include/version.mk" ]; then
		grep -m1 -oE '^VERSION_NUMBER[[:space:]]*:=[[:space:]]*[A-Za-z0-9.~+-]+' \
			"$sdk/include/version.mk" | sed -E 's/.*:=[[:space:]]*//'
	fi
}

unpack_sdk() {
	local file="$1" dest_parent="$2" extracted

	case "$file" in
	*.tar.zst|*.tar.zstd)
		if tar --zstd -xf "$file" -C "$dest_parent" 2>/dev/null; then
			:
		else
			# Older tar without --zstd: decompress first, then unpack.
			zstd -d -f "$file" -o "${file%.zst*}.tar" \
				|| zstd -d -f "$file" -o "${file%.zstd}.tar"
			tar -xf "${file%.zst*}.tar" -C "$dest_parent" 2>/dev/null \
				|| tar -xf "${file%.zstd}.tar" -C "$dest_parent"
		fi
		;;
	*.tar.xz)
		tar -xJf "$file" -C "$dest_parent"
		;;
	*)
		die "unsupported SDK archive: $file"
		;;
	esac

	extracted="$(find "$dest_parent" -maxdepth 1 -type d -name 'openwrt-sdk-*' \
		| sort -V | tail -n1)"
	# Fallback: some snapshot tarballs use a differently named top directory.
	[ -n "$extracted" ] || extracted="$(find "$dest_parent" -mindepth 1 -maxdepth 1 \
		-type d | sort | head -n1)"
	[ -n "$extracted" ] || die "no openwrt-sdk-* directory after unpacking $file"
	printf '%s' "$extracted"
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

sdk_main() {
	local version="" target="" workdir="build" sdk_dir="" format="" print_only=0

	while [ $# -gt 0 ]; do
		case "$1" in
		--version) version="${2:-}"; shift 2 ;;
		--target)  target="${2:-}"; shift 2 ;;
		--workdir) workdir="${2:-}"; shift 2 ;;
		--sdk-dir) sdk_dir="${2:-}"; shift 2 ;;
		--format)  format="${2:-}"; shift 2 ;;
		--print)   print_only=1; shift ;;
		-h|--help) sed -n '2,30p' "$0"; exit 0 ;;
		*) die "unknown argument: $1" ;;
		esac
	done

	[ -n "$version" ] || die "--version is required"
	[ -n "$target" ]  || die "--target is required (e.g. x86/64)"
	[[ "$target" == */* ]] || die "--target must be <target>/<subtarget>"

	[ -n "$sdk_dir" ] || sdk_dir="$workdir/sdk"

	local base_url dir_url sdk_file sdk_url release kernel backends s_apk s_ipk
	base_url="$(resolve_base_url "$version")"
	dir_url="${base_url}/targets/${target}/"

	if [ "$print_only" = 1 ]; then
		sdk_file="$(find_sdk_file "$dir_url")"
		printf 'base_url=%s\n' "$base_url"
		printf 'dir_url=%s\n' "$dir_url"
		printf 'sdk_url=%s\n' "${dir_url}${sdk_file}"
		printf 'sdk_file=%s\n' "$sdk_file"
		return 0
	fi

	mkdir -p "$workdir"
	sdk_file="$(find_sdk_file "$dir_url")"
	sdk_url="${dir_url}${sdk_file}"

	log "version      : ${version}"
	log "index        : ${dir_url}"
	log "sdk          : ${sdk_file}"

	local archive="$workdir/$sdk_file"
	if [ -s "$archive" ]; then
		log "reusing cached $(basename "$archive")"
	else
		log "downloading ${sdk_url}"
		curl -fsSL --retry 4 --retry-delay 5 --retry-all-errors \
			--connect-timeout 20 --max-time 1800 \
			"$sdk_url" -o "$archive.part" \
			|| die "download failed: ${sdk_url}"
		mv "$archive.part" "$archive"
	fi

	rm -rf "$sdk_dir"
	mkdir -p "$(dirname "$sdk_dir")"
	local tmp_parent="$workdir/.unpack"
	rm -rf "$tmp_parent"
	mkdir -p "$tmp_parent"

	log "unpacking ($(du -h "$archive" | cut -f1))"
	local extracted
	extracted="$(unpack_sdk "$archive" "$tmp_parent")"
	mv "$extracted" "$sdk_dir"
	rm -rf "$tmp_parent"

	release="$(detect_release "$sdk_dir")"
	kernel="$(detect_kernel_version "$sdk_dir")"
	read -r s_apk s_ipk <<<"$(detect_backends "$sdk_dir")"

	log "openwrt      : ${release:-unknown}"
	log "kernel       : ${kernel:-unknown}"
	log "backends     : apk=${s_apk} ipk=${s_ipk}"

	if [ "$format" = apk ] && [ "$s_apk" != 1 ]; then
		die "SDK at ${sdk_url} cannot build apk packages"
	fi
	if [ "$format" = ipk ] && [ "$s_ipk" != 1 ]; then
		die "SDK at ${sdk_url} cannot build ipk packages"
	fi

	github_out sdk_dir "$sdk_dir"
	github_out sdk_url "$sdk_url"
	github_out sdk_file "$sdk_file"
	github_out openwrt_release "${release:-unknown}"
	github_out openwrt_series "$version"
	github_out openwrt_base_url "$base_url"
	github_out kernel_version "${kernel:-unknown}"
	github_out supports_apk "$s_apk"
	github_out supports_ipk "$s_ipk"

	# Also emit a machine readable summary for build-package.sh / humans.
	printf 'sdk_dir=%s\n' "$sdk_dir"
	printf 'sdk_url=%s\n' "$sdk_url"
	printf 'openwrt_release=%s\n' "${release:-unknown}"
	printf 'kernel_version=%s\n' "${kernel:-unknown}"
	printf 'supports_apk=%s\n' "$s_apk"
	printf 'supports_ipk=%s\n' "$s_ipk"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	sdk_main "$@"
fi
