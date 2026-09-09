#!/usr/bin/env bash
#
# install-test.sh - install a built package into a throw-away root and check
# that the theme really lands where LuCI expects it.
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# Real installation is attempted whenever the matching package manager is
# available on the runner:
#   apk   -> apk extract (the payload extraction apk itself performs; a full
#            "apk add" is not possible without the dependency packages)
#   ipk   -> opkg --offline-root <root> install --force-depends --nodeps
# If neither is installed (plain Ubuntu image) the payload is unpacked with
# the same layout the package manager would produce, so the file-level
# assertions below still run:
#   ipk   -> the OpenWrt ipk is a gzip tar of debian-binary +
#            control.tar.* + data.tar.* (ipkg-build since ~2017); the legacy
#            ar-archive container is handled too
#   apk   -> APKv2 (concatenated gzip/zstd tar streams) is unpacked with
#            python; APKv3 (the "ADB" container apk-tools 3.x mkpkg writes,
#            used by 24.10+/25.12/master SDKs) needs the apk binary - pass
#            --apk-tool <path> (the SDK ships one in staging_dir/host/bin)
#
# Usage:
#   ./scripts/install-test.sh --file dist/foo.apk [--root /tmp/rootfs]
#                             [--apk-tool path/to/apk]

set -uo pipefail

log()  { printf '[install] %s\n' "$*"; }
fail() { printf '[install] FAIL: %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0
FILE="" ROOT="" APK_TOOL=""

while [ $# -gt 0 ]; do
	case "$1" in
	--file)     FILE="${2:-}"; shift 2 ;;
	--root)     ROOT="${2:-}"; shift 2 ;;
	--apk-tool) APK_TOOL="${2:-}"; shift 2 ;;
	-h|--help)  sed -n '2,25p' "$0"; exit 0 ;;
	*) printf '[install] unknown argument: %s\n' "$1" >&2; exit 2 ;;
	esac
done

[ -n "$FILE" ] || { log "--file is required"; exit 2; }
[ -s "$FILE" ] || { log "$FILE not found"; exit 2; }
[ -n "$ROOT" ] || ROOT="$(mktemp -d)/rootfs"

mkdir -p "$ROOT"
log "package : $FILE"
log "root    : $ROOT"

# first bytes decide the container: "!<arch>" (ar ipk), gzip magic (tar ipk
# or APKv2 streams) or the APKv3 "ADB" envelope ("ADB." plain, "ADBd"
# deflate, "ADBc" zstd - see adb_comp.c in apk-tools 3)
magic="$(head -c 4 "$FILE" 2>/dev/null | od -An -tx1 | tr -d ' \n')"

case "$FILE" in
*.apk)
	FORMAT=apk
	case "$magic" in
	4144422e|41444264|41444263)
		# "ADB." / "ADBd" / "ADBc" - APKv3 container, opaque to this
		# script; needs the apk binary (the SDK ships one)
		APK="${APK_TOOL:-$(command -v apk || true)}"
		if [ -n "$APK" ] && [ -x "$APK" ]; then
			log "extracting with apk ($(basename "$APK"))"
			# --allow-untrusted: OpenWrt's mkpkg does not sign packages
			"$APK" extract --allow-untrusted --destination "$ROOT" "$FILE" \
				|| fail "apk extract failed"
		else
			fail "APKv3 package but no apk tool available - pass --apk-tool (the SDK ships one in staging_dir/host/bin/apk)"
		fi
		;;
	*)
		# APKv2: concatenated gzip/zstd tar streams (.PKGINFO + payload)
		log "unpacking APKv2 streams"
		python3 - "$FILE" "$ROOT" <<'PY' || fail "apk unpack failed (not an APKv2 stream file?)"
import io, sys, tarfile, zlib, subprocess
pkg, root = sys.argv[1], sys.argv[2]
data = open(pkg, 'rb').read()
pos = 0
while pos < len(data):
    if data[pos:pos+2] == b'\x1f\x8b':
        d = zlib.decompressobj(31)
        try:
            blob = d.decompress(data[pos:])
        except Exception:
            break
        consumed = len(data) - pos - len(d.unused_data)
    elif data[pos:pos+4] == b'\x28\xb5\x2f\xfd':
        p = subprocess.run(['zstd', '-d', '-c'], input=data[pos:],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if p.returncode != 0:
            break
        blob, consumed = p.stdout, len(data) - pos
    else:
        break
    if consumed <= 0:
        break
    pos += consumed
    try:
        tf = tarfile.open(fileobj=io.BytesIO(blob))
    except Exception:
        continue
    for m in tf.getmembers():
        if m.name.startswith('.PKGINFO') or m.name.startswith('.SIGN.'):
            continue
        tf.extract(m, root)
PY
		;;
	esac
	;;
*.ipk)
	FORMAT=ipk
	if command -v opkg >/dev/null 2>&1; then
		log "installing with opkg (--offline-root)"
		opkg --offline-root "$ROOT" --force-depends --nodeps \
			--force-overwrite install "$FILE" \
			|| fail "opkg install failed"
	elif [ "$magic" = "213c6172" ]; then
		# "!<ar" - legacy ar container
		log "opkg not available - unpacking ar ipk"
		tmp="$(mktemp -d)"
		( cd "$tmp" && ar x "$FILE" ) || fail "ar x failed"
		data="$(find "$tmp" -name 'data.tar.*' | head -n1)"
		[ -n "$data" ] || fail "no data.tar.* inside $FILE"
		case "$data" in
		*.zst) zstd -d -c "$data" | tar -xf - -C "$ROOT" || fail "unpack failed" ;;
		*)     tar -xf "$data" -C "$ROOT" || fail "unpack failed" ;;
		esac
		rm -rf "$tmp"
	else
		# gzip tar of debian-binary + control.tar.* + data.tar.*
		log "opkg not available - unpacking tarball ipk"
		tmp="$(mktemp -d)"
		tar -xzf "$FILE" -C "$tmp" || fail "tar -xzf failed (not a gzip-tar ipk?)"
		data="$(find "$tmp" -name 'data.tar.*' | head -n1)"
		[ -n "$data" ] || fail "no data.tar.* inside $FILE"
		case "$data" in
		*.zst) zstd -d -c "$data" | tar -xf - -C "$ROOT" || fail "unpack failed" ;;
		*)     tar -xf "$data" -C "$ROOT" || fail "unpack failed" ;;
		esac
		rm -rf "$tmp"
	fi
	;;
*) log "unsupported file: $FILE"; exit 2 ;;
esac

# --------------------------------------------------------------------------- #
# assertions: the theme must be usable straight after installation
# --------------------------------------------------------------------------- #

REQUIRED=(
	"usr/share/ucode/template/themes/mint/header.ut"
	"usr/share/ucode/template/themes/mint/footer.ut"
	"usr/share/ucode/template/themes/mint/sysauth.ut"
	"usr/share/ucode/mint/wallpaper.uc"
	"www/luci-static/mint/cascade.css"
	"usr/share/luci/menu.d/luci-theme-mint.json"
	"usr/share/rpcd/acl.d/luci-theme-mint.json"
	"etc/config/mint"
	"etc/uci-defaults/30_luci-theme-mint"
	"usr/libexec/rpcd/mint"
)

for f in "${REQUIRED[@]}"; do
	[ -e "$ROOT/$f" ] || fail "missing after install: $f"
done

# Shell scripts must be syntactically valid for the target shell (ash/dash).
while IFS= read -r script; do
	sh -n "$script" 2>/dev/null || fail "shell syntax error: ${script#$ROOT}"
done < <(find "$ROOT/etc/uci-defaults" "$ROOT/usr/bin" "$ROOT/usr/libexec" \
	-type f 2>/dev/null | sort)

# JSON shipped to LuCI / rpcd must parse.
for j in "$ROOT/usr/share/luci/menu.d/luci-theme-mint.json" \
	"$ROOT/usr/share/rpcd/acl.d/luci-theme-mint.json"; do
	[ -f "$j" ] && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$j" \
		|| fail "invalid JSON: ${j#$ROOT}"
done

log "installed files: $(find "$ROOT" -type f | wc -l)"
if [ "$FAILURES" -gt 0 ]; then
	printf '[install] %d check(s) failed\n' "$FAILURES" >&2
	exit 1
fi
log "$FORMAT installation OK: $(basename "$FILE")"
