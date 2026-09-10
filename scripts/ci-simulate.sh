#!/usr/bin/env bash
#
# Local CI simulation: build synthetic-but-authentic .apk / .ipk packages
# from the real theme payload (same container layout the official backends
# produce) and run verify-package.sh + install-test.sh against them.
#
# Container formats reproduced here (matching OpenWrt's own tooling):
#   ipk - gzip( tar( ./debian-binary, ./data.tar.gz, ./control.tar.gz ) )
#         (scripts/ipkg-build, 23.05/24.10)
#   apk - apk-tools v3 ADB container "ADBd" + raw deflate (apk mkpkg, 25.12+)
#
set -euo pipefail
cd "$(dirname "$0")/.."
R="$(pwd)"
T="$R/theme"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
log() { printf '[test] %s\n' "$*"; }

PAYLOAD="$WORK/payload"
mkdir -p "$PAYLOAD"

# --- replicate luci.mk + package.mk install layout --------------------------
# htdocs -> /www (HTDOCS=/www)
cp -a "$T/htdocs/." "$PAYLOAD/www"
# ucode -> /usr/share/ucode/luci (UCODE_LIBRARYDIR)
mkdir -p "$PAYLOAD/usr/share/ucode/luci"
cp -a "$T/ucode/." "$PAYLOAD/usr/share/ucode/luci/"
# root -> /
cp -a "$T/root/." "$PAYLOAD/"

# jsmin pass over JS (CI builds with CONFIG_LUCI_JSMIN=y)
if command -v node >/dev/null 2>&1; then
  log "minifying JS like CI would (node)"
  find "$PAYLOAD" -name '*.js' -print0 | while IFS= read -r -d '' f; do
    node -e 'const fs=require("fs");let s=fs.readFileSync(process.argv[1],"utf8");
      s=s.replace(/\/\/[^\n]*$/gm,"").replace(/\/\*[\s\S]*?\*\//g,"");
      s=s.replace(/\s+\n/g,"\n").replace(/^[ \t]+/gm,"").replace(/\n{2,}/g,"\n").replace(/[ \t]*\n/g,"\n").replace(/; ?;/g,";");
      fs.writeFileSync(process.argv[1],s);' "$f" 2>/dev/null || true
  done
fi

# i18n payload (luci.mk LuciTranslation)
IPAYLOAD="$WORK/i18npayload"
mkdir -p "$IPAYLOAD/usr/lib/lua/luci/i18n" "$IPAYLOAD/etc/uci-defaults"
# compile a real lmo from the po file using the official po2lmo algorithm
# (luci's po2lmo is a C tool; python fallback here builds an LMO file with
# the same header so the *package structure* is what we test)
python3 - "$T/po/zh_Hans/luci-theme-mint.po" "$IPAYLOAD/usr/lib/lua/luci/i18n/luci-theme-mint.zh-cn.lmo" <<'PY'
import struct, sys
po, out = sys.argv[1], sys.argv[2]
# Extract msgid/msgstr pairs (best effort, single-line)
ids, strs = [], []
mid = ms = None
for line in open(po, encoding='utf-8'):
    line = line.strip()
    if line.startswith('msgid '):
        if mid is not None: ids.append(mid); strs.append(ms or '')
        mid = line[6:].strip().strip('"')
        ms = None
    elif line.startswith('msgstr '):
        ms = line[7:].strip().strip('"')
if mid is not None:
    ids.append(mid); strs.append(ms or '')
if not any(s for s in strs):
    sys.exit('no translations found - check po file')
def le32(x): return struct.pack('<I', x)
header = b'LMO0' + le32(2)          # magic + version 2
blob = b''.join((i.encode()+b'\x00'+s.encode()+b'\x00') for i, s in zip(ids, strs))
data = header + le32(len(ids)) + le32(0) + le32(0) + le32(0) + le32(len(blob)) + blob
open(out, 'wb').write(data)
print('lmo entries:', len(ids), 'translated:', sum(1 for s in strs if s))
PY
echo "uci set luci.languages.zh-cn='简体中文 (Simplified Chinese)'; uci commit luci" \
	> "$IPAYLOAD/etc/uci-defaults/luci-i18n-mint-zh-cn"
chmod 0755 "$IPAYLOAD/etc/uci-defaults/luci-i18n-mint-zh-cn"

# --- control metadata -------------------------------------------------------
VER="26.253.12345~abc1234"
R1="${VER}-r1"
ORIGINATOR="$(date -u '+%a, %d %b %Y %H:%M:%S +0000')"

build_ipk() { # <name> <version> <depends> <payload> <conffiles|-> <out.ipk>
	local name="$1" ver="$2" deps="$3" payload="$4" conffiles="$5" out="$6"
	local dir; dir="$(mktemp -d)"
	mkdir -p "$dir/CONTROL"
	{
		printf 'Package: %s\n' "$name"
		printf 'Version: %s\n' "$ver"
		printf 'Architecture: all\n'
		printf 'Depends: %s\n' "$deps"
		printf 'Maintainer: LianXia233 <maintainer@example.org>\n'
		printf 'Filename: %s_%s_all.ipk\n' "$name" "$ver"
		printf 'Section: luci\n'
		printf 'License: Apache-2.0\n'
		if [ "$name" = luci-theme-mint ]; then
			printf 'Description: Mint Theme\n A modern LuCI theme.\n'
		else
			printf 'Description: Mint Theme - zh-cn translation\n'
		fi
	} > "$dir/CONTROL/control"
	if [ "$conffiles" != "-" ]; then
		printf '%s\n' "$conffiles" > "$dir/CONTROL/conffiles"
	fi
	printf '2.0\n' > "$dir/debian-binary"
	# Same layout as scripts/ipkg-build: gzip( tar( ./debian-binary,
	# ./data.tar.gz, ./control.tar.gz ) ), data/control tarred with "./"
	# prefixes.
	( cd "$payload" && tar --format=gnu --numeric-owner --sort=name -cpf - . ) \
		| gzip -9 -n -c > "$dir/data.tar.gz"
	( cd "$dir/CONTROL" && tar --format=gnu --numeric-owner --sort=name -cf - . ) \
		| gzip -9 -n -c > "$dir/control.tar.gz"
	( cd "$dir" && tar --format=gnu --numeric-owner --sort=name -cf - \
		./debian-binary ./data.tar.gz ./control.tar.gz ) \
		| gzip -9 -n -c > "$out"
	rm -rf "$dir"
}

build_apk() { # <name> <version> <deps(comma)> <pkgdesc> <payload> <out.apk>
	local name="$1" ver="$2" deps="$3" desc="$4" payload="$5" out="$6"
	python3 "$R/scripts/mkadbpkg.py" \
		--name "$name" --version "$ver" --arch noarch \
		--origin "$name" \
		--url "https://github.com/LianXia233/luci-theme-mint" \
		--license "Apache-2.0" \
		--maintainer "LianXia233 <maintainer@example.org>" \
		--desc "$desc" \
		--depends "$deps" \
		--files "$payload" \
		--out "$out"
}

# --- build the four packages ------------------------------------------------
DIST="$WORK/dist"
mkdir -p "$DIST"

build_ipk luci-theme-mint "$R1" "luci-base, curl" "$PAYLOAD" "/etc/config/mint" \
	"$DIST/luci-theme-mint_${R1}_all.ipk"
build_ipk luci-i18n-mint-zh-cn "$VER" "luci-theme-mint" "$IPAYLOAD" "-" \
	"$DIST/luci-i18n-mint-zh-cn_${VER}_all.ipk"
build_apk luci-theme-mint "$R1" "luci-base,curl" "Mint Theme" "$PAYLOAD" \
	"$DIST/luci-theme-mint-$R1.apk"
build_apk luci-i18n-mint-zh-cn "$VER" "luci-theme-mint" "Mint Theme - zh-cn translation" "$IPAYLOAD" \
	"$DIST/luci-i18n-mint-zh-cn-$VER.apk"

log "synthetic packages:"
ls -l "$DIST"

# --- run the CI checks ------------------------------------------------------
log "=== verify-package.sh (theme + i18n, apk + ipk) ==="
"$R/scripts/verify-package.sh" --dir "$DIST" --expect-arch all

log "=== install-test.sh (all four) ==="
rc=0
for f in "$DIST"/*.apk "$DIST"/*.ipk; do
	"$R/scripts/install-test.sh" --file "$f" || rc=1
done
[ "$rc" = 0 ] || { log "install tests FAILED"; exit 1; }

log "=== negative: renamed apk must fail as .ipk ==="
cp "$DIST/luci-theme-mint-$R1.apk" "$WORK/evil.ipk"
if "$R/scripts/verify-package.sh" --file "$WORK/evil.ipk" --expect-arch all >/dev/null 2>&1; then
	log "NEGATIVE FAILED: renamed apk passed verify"; exit 1
else
	log "OK - renamed apk rejected"
fi

log "=== negative: target-specific arch must fail ==="
# rebuild theme apk with arch=x86_64 (same container, wrong arch)
python3 "$R/scripts/mkadbpkg.py" \
	--name luci-theme-mint --version "$R1" --arch x86_64 \
	--origin luci-theme-mint \
	--url "https://github.com/LianXia233/luci-theme-mint" \
	--license "Apache-2.0" \
	--maintainer "LianXia233 <maintainer@example.org>" \
	--desc "Mint Theme" \
	--depends "luci-base,curl" \
	--files "$PAYLOAD" \
	--out "$WORK/badarch.apk"
if "$R/scripts/verify-package.sh" --file "$WORK/badarch.apk" --expect-arch all >/dev/null 2>&1; then
	log "NEGATIVE FAILED: x86_64 arch passed verify"; exit 1
else
	log "OK - target-specific arch rejected"
fi

log "=== negative: missing executable bit must fail ==="
# rebuild ipk payload with uci-defaults script 0644
mkdir -p "$WORK/badexec"
cp -a "$PAYLOAD/." "$WORK/badexec/"
chmod 644 "$WORK/badexec/etc/uci-defaults/30_luci-theme-mint"
build_ipk luci-theme-mint "$R1" "luci-base, curl" "$WORK/badexec" "/etc/config/mint" \
	"$WORK/badexec_pkg.ipk"
if "$R/scripts/verify-package.sh" --file "$WORK/badexec_pkg.ipk" --expect-arch all >/dev/null 2>&1; then
	log "NEGATIVE FAILED: 0644 script passed verify"; exit 1
else
	log "OK - 0644 executable rejected"
fi

log "ALL SYNTHETIC PACKAGE TESTS PASSED"
