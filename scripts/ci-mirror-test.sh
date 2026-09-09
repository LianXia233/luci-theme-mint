#!/usr/bin/env bash
#
# ci-mirror-test.sh - offline test for get-openwrt-sdk.sh against a local
# mock OpenWrt mirror (python http.server).
#
# Covers:
#   - series resolution: releases/<series>.x -> newest point release
#   - sha256sums discovery + tarball_sha256 output (incl. GITHUB_OUTPUT)
#   - download + size guard + sha256 verification
#   - backend detection (baked CONFIG_USE_APK default y -> no ipk;
#     default n -> ipk ok) via the real Config-build.in / package-pack.mk
#     code paths
#   - --cache-dir: reuse, save, and rejection of a poisoned cache entry
#
# No OpenWrt network access required.

set -euo pipefail
cd "$(dirname "$0")/.."
R="$(pwd)"
WORK="$(mktemp -d)"
MOCK="$WORK/mirror"
PORT=8123
SERVER_PID=""
trap 'kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"' EXIT
log() { printf '[mock] %s\n' "$*"; }

# ---------------------------------------------------------------------------
# build the fake SDK tarballs
# ---------------------------------------------------------------------------

make_fake_sdk() { # <topdir> <use_apk_default> <release>
	local top="$1" use_apk="$2" release="$3"
	mkdir -p "$top/include" "$top/scripts"
	{
		printf 'config USE_APK\n'
		printf '\tbool\n'
		printf '\tdefault %s\n' "$use_apk"
		printf '\n'
		printf 'config VERSION_NUMBER\n'
		printf '\tstring\n'
		printf '\tdefault "%s"\n' "$release"
	} > "$top/Config-build.in"
	{
		printf 'ifneq ($(filter y,$(CONFIG_USE_APK)),)\n'
		printf 'APK_PACKAGE:=1\n'
		printf 'endif\n'
	} > "$top/include/package-pack.mk"
	touch "$top/scripts/ipkg-build"
	# pad past the 1 MB error-page size guard - incompressible on purpose
	# (a 1.2 MB zero block xz-squashes to ~1 KB and would trip the guard)
	dd if=/dev/urandom of="$top/.padding" bs=1024 count=1200 status=none
}

# snapshot: apk only (baked default y)
SNAP_DIR="$MOCK/snapshots/targets/x86/64"
SNAP_FILE="openwrt-sdk-snapshot-x86-64_gcc-14.4.0_musl.Linux-x86_64.tar.xz"
mkdir -p "$SNAP_DIR" "$WORK/src/$SNAP_FILE.root"
make_fake_sdk "$WORK/src/$SNAP_FILE.root/openwrt-sdk-snapshot-x86-64" y ""
( cd "$WORK/src/$SNAP_FILE.root" && tar -cJf "$SNAP_DIR/$SNAP_FILE" openwrt-sdk-snapshot-x86-64 )
SNAP_SHA="$(sha256sum "$SNAP_DIR/$SNAP_FILE" | awk '{print $1}')"
printf '%s  %s\n' "$SNAP_SHA" "$SNAP_FILE" > "$SNAP_DIR/sha256sums"
printf '%s' "$SNAP_SHA" > "$SNAP_DIR/.expected_sha"

# 24.10.8: ipk-capable (baked default n); note there is deliberately NO
# releases/24.10.x/ rolling directory - resolution must fall back to the
# newest point release found in the releases/ index.
REL_DIR="$MOCK/releases/24.10.8/targets/x86/64"
REL_FILE="openwrt-sdk-24.10.8-x86-64_gcc-13.3.0_musl.Linux-x86_64.tar.xz"
mkdir -p "$REL_DIR" "$WORK/src/$REL_FILE.root"
make_fake_sdk "$WORK/src/$REL_FILE.root/openwrt-sdk-24.10.8-x86-64" n "24.10.8"
( cd "$WORK/src/$REL_FILE.root" && tar -cJf "$REL_DIR/$REL_FILE" openwrt-sdk-24.10.8-x86-64 )
REL_SHA="$(sha256sum "$REL_DIR/$REL_FILE" | awk '{print $1}')"
printf '%s  %s\n' "$REL_SHA" "$REL_FILE" > "$REL_DIR/sha256sums"
printf '%s' "$REL_SHA" > "$REL_DIR/.expected_sha"
# release index with a couple of point releases (rc entries must be skipped)
mkdir -p "$MOCK/releases/24.10.3" "$MOCK/releases/24.10.0-rc1"

# ---------------------------------------------------------------------------
# serve the mock mirror
# ---------------------------------------------------------------------------
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$MOCK" \
	> "$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
	curl -fsS "http://127.0.0.1:$PORT/releases/" >/dev/null 2>&1 && break
	sleep 0.2
done
export OPENWRT_BASE_URL="http://127.0.0.1:$PORT"
export OPENWRT_MIRRORS="http://127.0.0.1:$PORT"

# ---------------------------------------------------------------------------
# 1) --print: series resolution + sha256 in output
# ---------------------------------------------------------------------------
log "=== 1) --print for 24.10 (no 24.10.x dir -> newest point release) ==="
out="$("$R/scripts/get-openwrt-sdk.sh" --version 24.10 --target x86/64 --format ipk --print)"
printf '%s\n' "$out"
printf '%s\n' "$out" | grep -q '^base_url=http://127.0.0.1:'"$PORT"'/releases/24.10.8$' \
	|| { log "FAIL: 24.10 did not resolve to 24.10.8"; exit 1; }
printf '%s\n' "$out" | grep -q "^tarball_sha256=$REL_SHA$" \
	|| { log "FAIL: tarball_sha256 missing/wrong"; exit 1; }
log "OK - resolved 24.10 -> 24.10.8 with sha256"

log "=== 2) --print writes GITHUB_OUTPUT ==="
GHOUT="$WORK/gh.out"; : > "$GHOUT"
GITHUB_OUTPUT="$GHOUT" "$R/scripts/get-openwrt-sdk.sh" --version snapshot --target x86/64 --format apk --print >/dev/null
grep -q "^tarball_sha256=$SNAP_SHA$" "$GHOUT" \
	|| { log "FAIL: GITHUB_OUTPUT missing tarball_sha256"; cat "$GHOUT"; exit 1; }
grep -q "^sdk_url=http://127.0.0.1:""$PORT""/snapshots/targets/x86/64/$SNAP_FILE$" "$GHOUT" \
	|| { log "FAIL: GITHUB_OUTPUT missing snapshot sdk_url"; exit 1; }
log "OK - GITHUB_OUTPUT carries sha256 + sdk_url"

# ---------------------------------------------------------------------------
# 3) full run: download + verify + backend detection (ipk-capable SDK)
# ---------------------------------------------------------------------------
log "=== 3) full build-side run for 24.10 (ipk) ==="
out="$(cd "$WORK" && "$R/scripts/get-openwrt-sdk.sh" \
	--version 24.10 --target x86/64 --format ipk \
	--workdir "$WORK" --sdk-dir "$WORK/sdk" --cache-dir "$WORK/cache" 2>/dev/null)"
printf '%s\n' "$out"
printf '%s\n' "$out" | grep -q '^supports_ipk=1$' \
	|| { log "FAIL: 24.10 SDK should support ipk"; exit 1; }
printf '%s\n' "$out" | grep -q '^supports_apk=0$' \
	|| { log "FAIL: baked default n must disable apk support"; exit 1; }
printf '%s\n' "$out" | grep -q "^openwrt_release=24.10.8" \
	|| { log "FAIL: openwrt_release not detected"; exit 1; }
[ -s "$WORK/cache/$REL_FILE" ] || { log "FAIL: cache not populated"; exit 1; }
log "OK - download verified, backends (apk=0, ipk=1), cache populated"

# ---------------------------------------------------------------------------
# 4) cache reuse + poisoned cache rejection
# ---------------------------------------------------------------------------
log "=== 4a) second run must reuse the shared cache (no re-download) ==="
rm -rf "$WORK/sdk" "$WORK/$REL_FILE"
out="$(cd "$WORK" && "$R/scripts/get-openwrt-sdk.sh" \
	--version 24.10 --target x86/64 --format ipk \
	--workdir "$WORK" --sdk-dir "$WORK/sdk" --cache-dir "$WORK/cache" \
	2>&1 >/dev/null)"
printf '%s\n' "$out" | grep -q 'from shared SDK cache' \
	|| { log "FAIL: cache reuse not detected"; exit 1; }
log "OK - cache reuse"

log "=== 4b) poisoned cache entry must be dropped + re-downloaded (self-heal) ==="
printf 'corrupted' >> "$WORK/cache/$REL_FILE"
rm -rf "$WORK/sdk" "$WORK/$REL_FILE"
out2="$( cd "$WORK" && "$R/scripts/get-openwrt-sdk.sh" \
	--version 24.10 --target x86/64 --format ipk \
	--workdir "$WORK" --sdk-dir "$WORK/sdk" --cache-dir "$WORK/cache" \
	2>&1 >/dev/null)"
printf '%s\n' "$out2" | grep -q 'dropping it and re-downloading' \
	|| { log "FAIL: poisoned cache was not detected"; exit 1; }
sha_now="$(sha256sum "$WORK/cache/$REL_FILE" | awk '{print $1}')"
[ "$sha_now" = "$REL_SHA" ] || { log "FAIL: cache not re-populated with verified tarball"; exit 1; }
log "OK - poisoned cache dropped, fresh verified tarball re-cached"

# ---------------------------------------------------------------------------
# 5) apk-only SDK (snapshot, baked default y) must report supports_ipk=0
# ---------------------------------------------------------------------------
log "=== 5) full run for snapshot (apk only) ==="
out="$(cd "$WORK" && "$R/scripts/get-openwrt-sdk.sh" \
	--version snapshot --target x86/64 --format apk \
	--workdir "$WORK" --sdk-dir "$WORK/sdk-snap" --cache-dir "$WORK/cache" 2>/dev/null)"
printf '%s\n' "$out" | grep -q '^supports_apk=1$' \
	|| { log "FAIL: snapshot must support apk"; exit 1; }
printf '%s\n' "$out" | grep -q '^supports_ipk=0$' \
	|| { log "FAIL: baked default y must disable ipk"; exit 1; }
log "OK - snapshot reports apk only"

log "ALL MOCK MIRROR TESTS PASSED"
