#!/usr/bin/env bash
#
# install-test.sh - install a built package into a throw-away root and check
# that the theme really lands where LuCI expects it.
#
# Works for both packages of the release:
#   luci-theme-mint          - the theme
#   luci-i18n-mint-zh-cn     - the translation (auto-detected by file name)
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# Real installation is attempted whenever the matching package manager is
# available on the runner:
#   apk   -> apk add --allow-untrusted --root <root> --initdb
#            (missing dependencies are satisfied by generated stub packages,
#             so dependency resolution is exercised for real)
#   ipk   -> opkg --offline-root <root> install --force-depends --nodeps
# If neither is installed (plain Ubuntu image) the payload is unpacked with
# the same layout the package manager would produce, so the file-level
# assertions below still run.
#
# Usage:
#   ./scripts/install-test.sh --file dist/foo.apk [--root /tmp/rootfs]

set -uo pipefail

log()  { printf '[install] %s\n' "$*"; }
fail() { printf '[install] FAIL: %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0
FILE="" ROOT=""

while [ $# -gt 0 ]; do
	case "$1" in
	--file) FILE="${2:-}"; shift 2 ;;
	--root) ROOT="${2:-}"; shift 2 ;;
	-h|--help) sed -n '2,26p' "$0"; exit 0 ;;
	*) printf '[install] unknown argument: %s\n' "$1" >&2; exit 2 ;;
	esac
done

[ -n "$FILE" ] || { log "--file is required"; exit 2; }
[ -s "$FILE" ] || { log "$FILE not found"; exit 2; }
[ -n "$ROOT" ] || ROOT="$(mktemp -d)/rootfs"

# The translation package is part of the release; its expected payload and
# dependency set differ from the theme's.
I18N=0
case "$(basename "$FILE")" in
luci-i18n-mint-*) I18N=1 ;;
esac

mkdir -p "$ROOT"
log "package : $FILE"
log "root    : $ROOT"

# ---------------------------------------------------------------------------
# install
# ---------------------------------------------------------------------------

# A minimal unsigned apk (one gzip stream holding only .PKGINFO, no payload)
# that satisfies a single dependency inside an otherwise empty root, so the
# real package can be installed through the real apk resolver.
make_stub_apk() {
	local name="$1" outdir="$2"
	local d
	d="$(mktemp -d)"
	{
		printf 'pkgname = %s\n' "$name"
		printf 'pkgver = 0.1\n'
		printf 'arch = noarch\n'
		printf 'origin = %s-stub\n' "$name"
	} > "$d/.PKGINFO"
	( cd "$d" && tar -cf - .PKGINFO | gzip -9 -c > "$outdir/${name}.stub.apk" )
	rm -rf "$d"
}

case "$FILE" in
*.apk)
	FORMAT=apk
	if command -v apk >/dev/null 2>&1; then
		log "installing with apk (--allow-untrusted)"
		stubs="$(mktemp -d)"
		if [ "$I18N" = 1 ]; then
			make_stub_apk luci-theme-mint "$stubs"
		else
			make_stub_apk luci-base "$stubs"
			make_stub_apk curl "$stubs"
		fi
		apk add --allow-untrusted --root "$ROOT" --initdb --no-network \
			--force-overwrite "$stubs"/*.stub.apk \
			|| fail "apk add (dependency stubs) failed"
		apk add --allow-untrusted --root "$ROOT" --no-network \
			--force-overwrite "$FILE" \
			|| fail "apk add failed"
		rm -rf "$stubs"
	else
		log "apk not available - unpacking payload instead"
		python3 - "$FILE" "$ROOT" <<'PY' || fail "apk unpack failed"
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
	fi
	;;
*.ipk)
	FORMAT=ipk
	if command -v opkg >/dev/null 2>&1; then
		log "installing with opkg (--offline-root)"
		opkg --offline-root "$ROOT" --force-depends --nodeps \
			--force-overwrite install "$FILE" \
			|| fail "opkg install failed"
	else
		log "opkg not available - unpacking payload instead"
		tmp="$(mktemp -d)"
		( cd "$tmp" && ar x "$FILE" ) || fail "ar x failed"
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

# ---------------------------------------------------------------------------
# assertions: the package must be usable straight after installation
# ---------------------------------------------------------------------------

# NOTE: luci.mk installs ucode/ into UCODE_LIBRARYDIR = /usr/share/ucode/luci
# (NOT /usr/share/ucode) - the LuCI runtime resolves templates under
# /usr/share/ucode/luci/template and modules like luci.mint.wallpaper under
# /usr/share/ucode/luci.
REQUIRED=(
	"usr/share/ucode/luci/template/themes/mint/header.ut"
	"usr/share/ucode/luci/template/themes/mint/footer.ut"
	"usr/share/ucode/luci/template/themes/mint/sysauth.ut"
	"usr/share/ucode/luci/mint/wallpaper.uc"
	"www/luci-static/mint/cascade.css"
	"www/luci-static/resources/menu-mint.js"
	"usr/share/luci/menu.d/luci-theme-mint.json"
	"usr/share/rpcd/acl.d/luci-theme-mint.json"
	"etc/config/mint"
	"etc/uci-defaults/30_luci-theme-mint"
	"usr/libexec/rpcd/mint"
	"usr/bin/mz-wallpaper-fetch.sh"
)

# Translation package payload (luci.mk LuciTranslation): the compiled catalog
# plus the uci-defaults entry that registers the language.
I18N_REQUIRED=(
	"usr/lib/lua/luci/i18n/luci-theme-mint.zh-cn.lmo"
	"etc/uci-defaults/luci-i18n-mint-zh-cn"
)

if [ "$I18N" = 1 ]; then
	CHECK_LIST=("${I18N_REQUIRED[@]}")
else
	CHECK_LIST=("${REQUIRED[@]}")
fi

for f in "${CHECK_LIST[@]}"; do
	[ -e "$ROOT/$f" ] || fail "missing after install: $f"
done

if [ "$I18N" = 0 ]; then
	# Executable bit must survive packaging (R-01): cron executes
	# /usr/bin/mz-wallpaper-fetch.sh directly; a 0644 payload silently kills
	# the server-side wallpaper cache feature.
	# (The i18n package has no executable payloads of its own.)
	REQUIRED_EXEC=(
		"usr/bin/mz-wallpaper-fetch.sh"
		"usr/libexec/rpcd/mint"
		"etc/uci-defaults/30_luci-theme-mint"
	)

	for f in "${REQUIRED_EXEC[@]}"; do
		[ -e "$ROOT/$f" ] || continue
		[ -x "$ROOT/$f" ] || fail "not executable after install: $f"
	done
fi

# Shell scripts must be syntactically valid for the target shell (ash/dash).
while IFS= read -r script; do
	sh -n "$script" 2>/dev/null || fail "shell syntax error: ${script#$ROOT}"
done < <(find "$ROOT/etc/uci-defaults" "$ROOT/usr/bin" "$ROOT/usr/libexec" \
	-type f 2>/dev/null | sort)

# JSON shipped to LuCI / rpcd must parse (the translation package ships none).
for j in "$ROOT/usr/share/luci/menu.d/luci-theme-mint.json" \
	"$ROOT/usr/share/rpcd/acl.d/luci-theme-mint.json"; do
	if [ -f "$j" ]; then
		python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$j" \
			|| fail "invalid JSON: ${j#$ROOT}"
	fi
done

log "installed files: $(find "$ROOT" -type f | wc -l)"
if [ "$FAILURES" -gt 0 ]; then
	printf '[install] %d check(s) failed\n' "$FAILURES" >&2
	exit 1
fi
log "$FORMAT installation OK: $(basename "$FILE")"
