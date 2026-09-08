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
# Progress and diagnostics go to stderr so callers can safely capture the
# machine-readable key=value summary from stdout.
#
# The script is also safe to source from build-package.sh: main() only runs
# when the file is executed directly.

set -euo pipefail

# Official mirrors. downloads.openwrt.org is the primary; archive.openwrt.org
# keeps older point releases after they rotate off the live mirror.
# Overridable so downstream users (and offline tests) can point elsewhere.
OPENWRT_BASE_URL="${OPENWRT_BASE_URL:-https://downloads.openwrt.org}"
if [ -z "${OPENWRT_MIRRORS:-}" ]; then
	if [ "$OPENWRT_BASE_URL" = "https://downloads.openwrt.org" ]; then
		OPENWRT_MIRRORS="https://downloads.openwrt.org https://archive.openwrt.org"
	else
		# Custom/local BASE_URL: do not also hit the public archive mirror.
		OPENWRT_MIRRORS="$OPENWRT_BASE_URL"
	fi
fi

# log/warn/die -> stderr. Callers capture stdout for key=value metadata only.
log()  { printf '[sdk] %s\n' "$*" >&2; }
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

# Fetch a directory index (or any URL). Retries only on transient transport
# failures - NOT on HTTP 404 (which --retry-all-errors would thrash on).
fetch_into() {
	local url="$1" dest="$2"
	curl -fsSL --retry 2 --retry-delay 2 \
		--connect-timeout 15 --max-time 60 \
		-A "luci-theme-mint-sdk-resolver/1.0" \
		"$url" -o "$dest" 2>/dev/null
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
	curl -fsSIL --retry 2 --retry-delay 2 --connect-timeout 10 \
		--max-time 30 -o /dev/null "$1" 2>/dev/null
}

# Run grep without tripping set -e/pipefail when there are no matches.
safe_grep() {
	grep "$@" || true
}

# Latest concrete release of a series, e.g. series 25.12 -> 25.12.5.
# Release candidates (25.12.0-rc1) are excluded.
latest_release_of_series() {
	local series="$1" base="$2" idx latest
	idx="$(fetch_url "${base}/releases/")" || return 1
	# Match "25.12.5/" but not "25.12.0-rc1/" or unrelated "25.120.1/".
	latest="$(printf '%s' "$idx" \
		| safe_grep -oE "${series//./\\.}\\.[0-9]+/" \
		| safe_grep -vE 'rc|RC' \
		| tr -d '/' \
		| sort -V \
		| tail -n1)"
	[ -n "$latest" ] || return 1
	printf '%s' "$latest"
}

# Resolve a user supplied version into a concrete download path suffix
# (without the mirror host):
#   25.12      -> releases/25.12.x if it exists, else releases/25.12.<latest>
#   25.12.5    -> releases/25.12.5
#   snapshot   -> snapshots
resolve_path_prefix() {
	local version="$1" base="$2" series latest

	case "$version" in
	snapshot|SNAPSHOT|main|master)
		printf 'snapshots'
		return 0
		;;
	esac

	if [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
		printf 'releases/%s' "$version"
		return 0
	fi

	if [[ "$version" =~ ^[0-9]+\.[0-9]+$ ]]; then
		series="$version"
		# Preferred: the rolling "<series>.x" directory that always points at
		# the newest point release (kept for series that publish it).
		if url_exists "${base}/releases/${series}.x/targets/"; then
			printf 'releases/%s.x' "$series"
			return 0
		fi
		latest="$(latest_release_of_series "$series" "$base")" || return 1
		warn "no ${series}.x directory on ${base}, using ${latest}"
		printf 'releases/%s' "$latest"
		return 0
	fi

	die "unsupported version '${version}' (use 25.12, 25.12.5, 24.10 or snapshot)"
}

# Extract an SDK tarball name from an index body (sha256sums or HTML).
# Always returns 0; prints the best match or nothing.
extract_sdk_name() {
	local body="$1" sdk=""

	# 1. Prefer the plain-text sha256sums / HTML href form used by the
	#    working build.yml workflow:
	#      openwrt-sdk-....Linux-x86_64.tar.zst
	sdk="$(printf '%s' "$body" \
		| safe_grep -oE 'openwrt-sdk-[^"<>[:space:]]+\.tar\.(zst|xz|zstd|gz)' \
		| safe_grep -E 'Linux-x86_64' \
		| sort -u \
		| sort -V \
		| tail -n1)"

	# 2. Broader pattern: "sdk" anywhere after the openwrt- prefix (covers
	#    unusual layouts such as openwrt-25.12.5-...-sdk-...).
	if [ -z "$sdk" ]; then
		sdk="$(printf '%s' "$body" \
			| safe_grep -ioE 'openwrt-[A-Za-z0-9._+-]*sdk[A-Za-z0-9._+-]*\.tar\.(zst|xz|zstd|gz)' \
			| safe_grep -iE 'Linux-x86_64' \
			| sort -u \
			| sort -V \
			| tail -n1)"
	fi

	# 3. Last resort: any openwrt-sdk-*.tar.* entry (host tag may vary).
	if [ -z "$sdk" ]; then
		sdk="$(printf '%s' "$body" \
			| safe_grep -oE 'openwrt-sdk-[^"<>[:space:]]+\.tar\.(zst|xz|zstd|gz)' \
			| sort -u \
			| sort -V \
			| tail -n1)"
	fi

	printf '%s' "$sdk"
}

# Pick the SDK tarball from a target directory. Tries sha256sums first (plain
# text, stable), then the HTML directory index. Prints
# "mirror|path_prefix|filename" on success.
find_sdk_on_mirrors() {
	local version="$1" target="$2"
	local mirror path_prefix dir_url body sdk
	local -a tried=()

	for mirror in $OPENWRT_MIRRORS; do
		mirror="${mirror%/}"
		path_prefix="$(resolve_path_prefix "$version" "$mirror")" || {
			warn "cannot resolve ${version} on ${mirror}"
			continue
		}
		dir_url="${mirror}/${path_prefix}/targets/${target}/"
		tried+=("$dir_url")

		# sha256sums is a small plain-text file - far more reliable than HTML.
		body="$(fetch_url "${dir_url}sha256sums" 2>/dev/null || true)"
		if [ -n "$body" ]; then
			sdk="$(extract_sdk_name "$body")"
			if [ -n "$sdk" ]; then
				log "found via sha256sums on ${mirror}"
				printf '%s|%s|%s\n' "$mirror" "$path_prefix" "$sdk"
				return 0
			fi
			warn "sha256sums at ${dir_url} has no SDK entry"
		fi

		# Fall back to the directory listing HTML.
		body="$(fetch_url "$dir_url" 2>/dev/null || true)"
		if [ -n "$body" ]; then
			sdk="$(extract_sdk_name "$body")"
			if [ -n "$sdk" ]; then
				log "found via directory index on ${mirror}"
				printf '%s|%s|%s\n' "$mirror" "$path_prefix" "$sdk"
				return 0
			fi
			warn "directory index at ${dir_url} has no SDK entry"
		else
			warn "cannot read ${dir_url}"
		fi
	done

	printf '[sdk] error: no openwrt-sdk-*.tar.* found for %s / %s\n' \
		"$version" "$target" >&2
	if [ "${#tried[@]}" -gt 0 ]; then
		printf '[sdk] error: tried:\n' >&2
		local u
		for u in "${tried[@]}"; do
			printf '[sdk] error:   %s\n' "$u" >&2
		done
	fi
	return 1
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
		ver="$(safe_grep -oE '^LINUX_VERSION-[0-9.]+[[:space:]]*:?=[[:space:]]*[0-9.]+' \
			"$sdk/include/kernel-version.mk" \
			| sed -E 's/^LINUX_VERSION-([0-9.]+)[[:space:]]*:?=[[:space:]]*\.?([0-9.]+)/\1.\2/' \
			| sort -V | tail -n1)"
	fi
	if [ -z "$ver" ] && [ -f "$sdk/include/kernel.mk" ]; then
		ver="$(safe_grep -m1 -oE '^LINUX_VERSION[[:space:]]*:=[[:space:]]*[0-9.]+' \
			"$sdk/include/kernel.mk" | awk '{print $NF}')"
	fi
	printf '%s' "${ver:-unknown}"
}

# OpenWrt release string baked into the SDK (e.g. 25.12.5 / SNAPSHOT).
detect_release() {
	local sdk="$1"
	if [ -f "$sdk/include/version.mk" ]; then
		safe_grep -m1 -oE '^VERSION_NUMBER[[:space:]]*:=[[:space:]]*[A-Za-z0-9.~+-]+' \
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
			local tar_out="${file%.tar.zst}"
			tar_out="${tar_out%.tar.zstd}.tar"
			zstd -d -f "$file" -o "$tar_out" \
				|| die "zstd decompress failed for $file"
			tar -xf "$tar_out" -C "$dest_parent" \
				|| die "tar extract failed for $tar_out"
		fi
		;;
	*.tar.xz)
		tar -xJf "$file" -C "$dest_parent" \
			|| die "tar -xJf failed for $file"
		;;
	*.tar.gz|*.tgz)
		tar -xzf "$file" -C "$dest_parent" \
			|| die "tar -xzf failed for $file"
		;;
	*)
		die "unsupported SDK archive: $file"
		;;
	esac

	extracted="$(find "$dest_parent" -maxdepth 1 -type d -name 'openwrt-sdk-*' \
		| sort -V | tail -n1 || true)"
	# Fallback: some snapshot tarballs use a differently named top directory.
	[ -n "$extracted" ] || extracted="$(find "$dest_parent" -mindepth 1 -maxdepth 1 \
		-type d | sort | head -n1 || true)"
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

	local mirror path_prefix sdk_file sdk_url base_url release kernel s_apk s_ipk
	local resolved

	log "resolving SDK for version=${version} target=${target}"
	resolved="$(find_sdk_on_mirrors "$version" "$target")" \
		|| die "SDK discovery failed for ${version}/${target}"

	IFS='|' read -r mirror path_prefix sdk_file <<<"$resolved"
	base_url="${mirror}/${path_prefix}"
	sdk_url="${base_url}/targets/${target}/${sdk_file}"

	if [ "$print_only" = 1 ]; then
		printf 'base_url=%s\n' "$base_url"
		printf 'dir_url=%s\n' "${base_url}/targets/${target}/"
		printf 'sdk_url=%s\n' "$sdk_url"
		printf 'sdk_file=%s\n' "$sdk_file"
		return 0
	fi

	mkdir -p "$workdir"

	log "version      : ${version}"
	log "mirror       : ${mirror}"
	log "index        : ${base_url}/targets/${target}/"
	log "sdk          : ${sdk_file}"

	local archive="$workdir/$(basename "$sdk_file")"
	if [ -s "$archive" ]; then
		log "reusing cached $(basename "$archive")"
	else
		log "downloading ${sdk_url}"
		curl -fsSL --retry 4 --retry-delay 5 --retry-all-errors \
			--connect-timeout 20 --max-time 1800 \
			-A "luci-theme-mint-sdk-resolver/1.0" \
			"$sdk_url" -o "$archive.part" \
			|| die "download failed: ${sdk_url}"
		# Reject tiny "downloads" that are clearly error pages.
		local sz
		sz="$(wc -c < "$archive.part" | tr -d ' ')"
		if [ "${sz:-0}" -lt 1000000 ]; then
			rm -f "$archive.part"
			die "downloaded file too small (${sz} bytes) from ${sdk_url}"
		fi
		mv "$archive.part" "$archive"
	fi

	rm -rf "$sdk_dir"
	mkdir -p "$(dirname "$sdk_dir")"
	local tmp_parent="$workdir/.unpack-$$"
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

	# Machine readable summary for build-package.sh / humans (stdout only).
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
