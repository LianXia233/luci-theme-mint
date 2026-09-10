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
#   ipk   -> opkg --offline-root <root> install --force-depends --nodeps
# The payload is otherwise unpacked with the same layout the package manager
# would produce (scripts/pkg-inspect.py), so the file-level assertions below
# always run.
#
# Note: OpenWrt >= 25.12 packages are apk-tools v3 "ADB" containers; the
# apk-tools available on the runners (where present) is v2 and cannot read
# them, so apk packages are always unpacked structurally rather than with a
# mismatched `apk` binary.
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

# Resolve the shared inspector relative to this script, so install-test works
# no matter what directory it is invoked from.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ---------------------------------------------------------------------------
# install
# ---------------------------------------------------------------------------

case "$FILE" in
*.apk)
	FORMAT=apk
	# OpenWrt >= 25.12 apk packages are apk-tools v3 "ADB" containers; the
	# apk-tools on the runners is v2 and cannot read them, so unpack
	# structurally with the shared inspector (same file layout apk writes).
	log "unpacking apk payload"
	python3 "$SCRIPT_DIR/pkg-inspect.py" extract "$FILE" "$ROOT" \
		|| fail "apk unpack failed"
	;;
*.ipk)
	FORMAT=ipk
	if command -v opkg >/dev/null 2>&1; then
		log "installing with opkg (--offline-root)"
		if opkg --offline-root "$ROOT" --force-depends --nodeps \
			--force-overwrite install "$FILE" 2>/dev/null; then
			log "opkg install OK"
		else
			log "opkg failed - unpacking payload instead"
			python3 "$SCRIPT_DIR/pkg-inspect.py" extract "$FILE" "$ROOT" \
				|| fail "ipk unpack failed"
		fi
	else
		log "opkg not available - unpacking payload instead"
		python3 "$SCRIPT_DIR/pkg-inspect.py" extract "$FILE" "$ROOT" \
			|| fail "ipk unpack failed"
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
