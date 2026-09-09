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
#   apk - gzip stream(s) containing .PKGINFO (apk metadata) + payload
#   ipk - ar archive containing debian-binary, control.tar.* and data.tar.*
#
# A renamed apk fails immediately: it has neither .PKGINFO nor an ar member
# layout, so the "not a renamed package" requirement is enforced, not
# assumed.
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

# ---------------------------------------------------------------------------
# python helper: dump metadata + payload listing for both formats
# ---------------------------------------------------------------------------

read_pkg_py() {
	python3 - "$1" <<'PY'
import gzip, io, os, sys, tarfile, subprocess, zlib

path = sys.argv[1]
data = open(path, 'rb').read()

def members_from_tar_bytes(blob):
    names, meta = [], {}
    try:
        tf = tarfile.open(fileobj=io.BytesIO(blob))
    except Exception as e:
        return names, meta, [], 'tar-error: %s' % e
    xfiles = []
    for m in tf.getmembers():
        names.append(m.name)
        if m.mode & 0o111:
            xfiles.append(m.name)
        if os.path.basename(m.name) in ('.PKGINFO', 'control'):
            try:
                meta = parse_control(tf.extractfile(m).read().decode('utf-8', 'replace'))
            except Exception:
                pass
    return names, meta, xfiles, None

def parse_control(text):
    out = {}
    def add(k, v):
        if k in ('depend', 'control_depends'):
            out[k] = (out[k] + ' ' if out.get(k) else '') + v
        else:
            out.setdefault(k, v)
    for line in text.splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        if ':' in line:                      # ipk control (RFC822)
            k, v = line.split(':', 1)
            add('control_' + k.strip().lower(), v.strip())
        elif ' = ' in line:                  # apk .PKGINFO
            k, v = line.split(' = ', 1)
            add(k.strip().lower(), v.strip())
    return out

def decompress(blob, kind):
    if kind == 'gzip':
        return gzip.decompress(blob)
    if kind == 'zstd':
        p = subprocess.run(['zstd', '-d', '-c'], input=blob,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        return p.stdout if p.returncode == 0 else None
    return blob

result = {'kind': 'unknown', 'members': [], 'files': [], 'xfiles': [], 'meta': {}, 'errors': []}

if data[:8] == b'!<arch>\n':
    # ---- ipk: ar archive ------------------------------------------------
    result['kind'] = 'ipk'
    pos, names = 8, []
    while pos + 60 <= len(data):
        hdr = data[pos:pos + 60]
        if hdr[58:60] != b'\x60\x0a':
            result['errors'].append('bad ar header at %d' % pos)
            break
        name = hdr[0:16].decode('ascii', 'replace').strip()
        size = int(hdr[48:58].decode('ascii', 'replace').strip() or 0)
        body = data[pos + 60:pos + 60 + size]
        pos += 60 + size + (size % 2)
        names.append(name)
        if name.startswith('control.tar'):
            blob = decompress(body, 'zstd' if name.endswith('.zst') else 'gzip')
            if blob is None:
                result['errors'].append('cannot decompress %s' % name)
                continue
            _, meta, xfiles, err = members_from_tar_bytes(blob)
            result['meta'].update(meta)
            if err:
                result['errors'].append(err)
        elif name.startswith('data.tar'):
            blob = decompress(body, 'zstd' if name.endswith('.zst') else 'gzip')
            if blob is None:
                result['errors'].append('cannot decompress %s' % name)
                continue
            try:
                tf = tarfile.open(fileobj=io.BytesIO(blob))
                for m in tf.getmembers():
                    result['files'].append(m.name)
                    if m.mode & 0o111:
                        result['xfiles'].append(m.name)
            except Exception as e:
                result['errors'].append('data.tar: %s' % e)
    result['members'] = names

elif data[:2] == b'\x1f\x8b':
    # ---- apk: concatenated gzip streams (sig / .PKGINFO / payload) -------
    result['kind'] = 'apk'
    pos = 0
    while pos < len(data):
        # Each apk section (signature / .PKGINFO / payload) is an
        # independently compressed stream; walk them one by one.
        if data[pos:pos + 2] == b'\x1f\x8b':
            d = zlib.decompressobj(31)          # 31 = gzip
            try:
                blob = d.decompress(data[pos:])
            except Exception as e:
                result['errors'].append('gzip stream at %d: %s' % (pos, e))
                break
            consumed = len(data) - pos - len(d.unused_data)
        elif data[pos:pos + 4] == b'\x28\xb5\x2f\xfd':
            p = subprocess.run(['zstd', '-d', '-c'], input=data[pos:],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            if p.returncode != 0:
                result['errors'].append('zstd stream at %d failed' % pos)
                break
            blob, consumed = p.stdout, len(data) - pos
        else:
            break
        if consumed <= 0:
            break
        pos += consumed
        try:
            tf = tarfile.open(fileobj=io.BytesIO(blob))
        except Exception as e:
            result['errors'].append('tar stream: %s' % e)
            continue
        for m in tf.getmembers():
            if m.name.startswith('.SIGN.'):
                continue
            result['files'].append(m.name)
            if m.mode & 0o111:
                result['xfiles'].append(m.name)
            if os.path.basename(m.name) == '.PKGINFO':
                try:
                    result['meta'].update(
                        parse_control(tf.extractfile(m).read().decode('utf-8', 'replace')))
                except Exception:
                    pass
else:
    result['errors'].append('unrecognised container (not ar, not gzip)')

def emit(key, value):
    print('%s=%s' % (key, value))

emit('kind', result['kind'])
emit('size', len(data))
for k in ('pkgname', 'pkgver', 'arch', 'origin', 'pkgdesc', 'url', 'size'):
    if k in result['meta']:
        emit('meta_' + k, result['meta'][k])
for k, v in result['meta'].items():
    if k.startswith('control_'):
        emit(k, v.replace('\n', ' | '))
if 'depend' in result['meta']:
    emit('depend', result['meta']['depend'])
for n in result['members']:
    emit('member', n)
for f in result['files']:
    emit('file', f)
for f in result['xfiles']:
    emit('xfile', f)
for e in result['errors']:
    emit('error', e)
PY
}

# ---------------------------------------------------------------------------
# per-package checks
# ---------------------------------------------------------------------------

# NOTE: luci.mk installs ucode/ into UCODE_LIBRARYDIR = /usr/share/ucode/luci
# (NOT /usr/share/ucode), so the on-device paths carry the extra "luci"
# segment - the LuCI template runtime (modules/luci-base/ucode/runtime.uc)
# reads /usr/share/ucode/luci/template and resolves modules like
# luci.mint.wallpaper against /usr/share/ucode/luci.
REQUIRED_FILES=(
	"usr/share/ucode/luci/template/themes/mint/header.ut"
	"usr/share/ucode/luci/template/themes/mint/footer.ut"
	"usr/share/ucode/luci/template/themes/mint/sysauth.ut"
	"usr/share/ucode/luci/mint/wallpaper.uc"
	"www/luci-static/mint/cascade.css"
	"usr/share/luci/menu.d/luci-theme-mint.json"
	"usr/share/rpcd/acl.d/luci-theme-mint.json"
	"etc/config/mint"
	"etc/uci-defaults/30_luci-theme-mint"
	"usr/libexec/rpcd/mint"
	"usr/bin/mz-wallpaper-fetch.sh"
)

# Payload of the translation package (luci.mk LuciTranslation): the compiled
# catalog plus the uci-defaults that registers the language.
I18N_REQUIRED_FILES=(
	"usr/lib/lua/luci/i18n/luci-theme-mint.zh-cn.lmo"
	"etc/uci-defaults/luci-i18n-mint-zh-cn"
)

# Payload entries that MUST carry the executable bit. luci.mk copies root/
# with `cp -pR`, so a script committed as 0644 lands on the device as 0644:
# cron then cannot run /usr/bin/mz-wallpaper-fetch.sh at all (R-01). This
# assertion exists so that class of mistake can never ship silently again.
REQUIRED_EXEC=(
	"usr/bin/mz-wallpaper-fetch.sh"
	"usr/libexec/rpcd/mint"
	"etc/uci-defaults/30_luci-theme-mint"
)

for pkg in "${FILES[@]}"; do
	log "────────────────────────────────────────────"
	log "package: $pkg"
	[ -s "$pkg" ] || { fail "$pkg does not exist or is empty"; continue; }

	# Package mode: the theme proper, or the auto-generated translation
	# package (the official LuCI API keeps translations separate from the
	# theme; the release ships both, so both must verify).
	I18N=0
	case "$(basename "$pkg")" in
	luci-i18n-mint-*) I18N=1 ;;
	esac
	if [ "$I18N" = 1 ]; then
		EXPECT_NAME_PKG="luci-i18n-mint-zh-cn"
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
			|| fail "$pkg carries no .PKGINFO - not a real apk"
		;;
	*.ipk)
		[ "$kind" = ipk ] || fail "$pkg has .ipk extension but container is '${kind}' (renamed apk?)"
		for m in debian-binary control.tar; do
			get member | grep -q "^${m}" \
				|| fail "$pkg is missing ar member '${m}'"
		done
		get member | grep -q '^data.tar' \
			|| fail "$pkg is missing ar member 'data.tar.*'"
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

	if [ "$I18N" = 1 ]; then
		# translation: must depend on the theme it translates
		case " $depends " in
		*luci-theme-mint*) : ;;
		*) fail "dependency luci-theme-mint missing (got: ${depends:-<none>})" ;;
		esac
	else
		# Dependencies: the theme needs luci-base (ucode + rpcd come with it)
		# and curl for the wallpaper fetcher - and nothing kernel/target
		# specific.
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
			*" $bad"*) fail "unexpected kernel-bound dependency '${bad}' in a data-only theme" ;;
			esac
		done
	fi

	# Payload sanity: every file the package needs must be inside it.
	mapfile -t payload < <(get file | sed 's|^\./||' | sort -u)
	log "  payload   : ${#payload[@]} entries"
	[ "${#payload[@]}" -gt 0 ] || fail "$pkg payload is empty"

	if [ "$I18N" = 1 ]; then
		REQ_FILES=("${I18N_REQUIRED_FILES[@]}")
	else
		REQ_FILES=("${REQUIRED_FILES[@]}")
	fi
	for req in "${REQ_FILES[@]}"; do
		printf '%s\n' "${payload[@]}" | grep -qx "$req" \
			|| fail "$pkg is missing ${req}"
	done

	if [ "$I18N" = 0 ]; then
		mapfile -t xpayload < <(get xfile | sed 's|^\./||' | sort -u)
		for req in "${REQUIRED_EXEC[@]}"; do
			printf '%s\n' "${xpayload[@]}" | grep -qx "$req" \
				|| fail "$pkg ships ${req} WITHOUT the executable bit"
		done

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
