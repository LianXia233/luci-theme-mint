#!/usr/bin/env bash
#
# verify-package.sh - structural verification of built .apk / .ipk packages.
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# The point of this check is to prove that a package was really produced by
# the OpenWrt package build system, in the format its file extension claims:
#
#   apk  - APKv3 "ADB" container (apk-tools 3.x mkpkg, used by 24.10+ and
#          25.12/master SDKs): envelope "ADB." (plain) / "ADBd" (deflate) /
#          "ADBc" (zstd) followed by sig/adb/data blocks with
#          .PKGINFO-equivalent metadata inside the adb block.
#          The block payloads are compressed, so metadata and file lists are
#          read with the apk tool itself (adbdump / extract applets)
#          ("apk adbdump", "apk extract") - pass --apk-tool or have apk in
#          PATH. Old APKv2 files (concatenated gzip/zstd tar streams with a
#          .PKGINFO member) are also recognised.
#   ipk  - gzip-compressed tar containing debian-binary, control.tar.gz and
#          data.tar.gz (the ipkg-build container used by every OpenWrt since
#          ~2017, including 23.05/24.10/25.12). The legacy ar-archive ipk
#          (pre-2017) is recognised too.
#
# A renamed package fails immediately: an .apk whose container is the ipk
# tar (or vice versa) is rejected before any metadata is even looked at.
#
# Usage:
#   ./scripts/verify-package.sh --file dist/foo.apk [--expect-arch all]
#   ./scripts/verify-package.sh --dir dist [--apk-tool path/to/apk]
#
# Exits non-zero when any check fails.

set -euo pipefail

log()  { printf '[verify] %s\n' "$*"; }
fail() { printf '[verify] FAIL: %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }

FAILURES=0
FILES=()
EXPECT_ARCH="${EXPECT_ARCH:-all}"
EXPECT_NAME="luci-theme-mint"
APK_TOOL=""

while [ $# -gt 0 ]; do
	case "$1" in
	--file)        FILES+=("${2:-}"); shift 2 ;;
	--dir)         while IFS= read -r f; do FILES+=("$f"); done \
		< <(find "${2:-}" -maxdepth 1 -type f \
			\( -name '*.apk' -o -name '*.ipk' \) | sort); shift 2 ;;
	--expect-arch) EXPECT_ARCH="${2:-}"; shift 2 ;;
	--expect-name) EXPECT_NAME="${2:-}"; shift 2 ;;
	--apk-tool)    APK_TOOL="${2:-}"; shift 2 ;;
	-h|--help)     sed -n '2,31p' "$0"; exit 0 ;;
	*) printf '[verify] unknown argument: %s\n' "$1" >&2; exit 2 ;;
	esac
done

[ "${#FILES[@]}" -gt 0 ] || { log "no package files given"; exit 2; }
[ -n "$APK_TOOL" ] || APK_TOOL="$(command -v apk || true)"

# --------------------------------------------------------------------------- #
# python helper: container detection + metadata + payload listing
# --------------------------------------------------------------------------- #
# Reads the package and emits key=value lines:
#   kind    = apk-v3 | apk-v2 | ipk-tgz | ipk-ar | unknown
#   meta_*  = fields from .PKGINFO (apk) / control (ipk)
#   member  = container members (ipk)
#   file    = payload paths (all formats)
#   error   = parse problems
#
# argv: <package-file> [apk-tool]
read_pkg_py() {
	python3 - "$1" "${APK_TOOL:-}" <<'PY'
import gzip, io, os, subprocess, sys, tarfile, tempfile, zlib

path, apk_tool = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else '')
data = open(path, 'rb').read()

def parse_kv(text):
    """ipk control (RFC822) + apk .PKGINFO ('k = v') style metadata."""
    out = {}
    def add(k, v):
        if k in ('depend', 'control_depends'):
            out[k] = (out[k] + ' ' if out.get(k) else '') + v
        else:
            out.setdefault(k, v)
    for line in text.splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        if ':' in line and ' = ' not in line:   # ipk control
            k, v = line.split(':', 1)
            add('control_' + k.strip().lower(), v.strip())
        elif ' = ' in line:                     # apk .PKGINFO
            k, v = line.split(' = ', 1)
            add(k.strip().lower(), v.strip())
    return out

def tar_names(blob):
    try:
        tf = tarfile.open(fileobj=io.BytesIO(blob))
        return tf, [m.name for m in tf.getmembers()]
    except Exception as e:
        return None, 'tar-error: %s' % e

def decompress(blob, kind):
    if kind == 'gzip':
        try:
            return gzip.decompress(blob)
        except Exception:
            return None
    if kind == 'zstd':
        p = subprocess.run(['zstd', '-d', '-c'], input=blob,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        return p.stdout if p.returncode == 0 else None
    return blob

result = {'kind': 'unknown', 'members': [], 'files': [], 'meta': {}, 'errors': []}

def ipk_load_members(members, get_member):
    """Shared handling for both ipk containers once members are iterable."""
    for name in members:
        if os.path.basename(name) == 'debian-binary':
            continue
        base = os.path.basename(name)
        if base.startswith('control.tar'):
            blob = decompress(get_member(name),
                              'zstd' if base.endswith('.zst') else 'gzip')
            if blob is None:
                result['errors'].append('cannot decompress %s' % base)
                continue
            tf, names = tar_names(blob)
            if tf is None:
                result['errors'].append(names)
                continue
            for m in tf.getmembers():
                if os.path.basename(m.name) == 'control':
                    result['meta'].update(
                        parse_kv(tf.extractfile(m).read().decode('utf-8', 'replace')))
        elif base.startswith('data.tar'):
            blob = decompress(get_member(name),
                              'zstd' if base.endswith('.zst') else 'gzip')
            if blob is None:
                result['errors'].append('cannot decompress %s' % base)
                continue
            tf, names = tar_names(blob)
            if tf is None:
                result['errors'].append(names)
                continue
            result['files'] += [m.name for m in tf.getmembers()]
    result['members'] = members

if data[:8] == b'!<arch>\n':
    # ---- legacy ipk: ar archive ---------------------------------------
    result['kind'] = 'ipk-ar'
    pos, members = 8, []
    control_blob = data_blob = None
    while pos + 60 <= len(data):
        hdr = data[pos:pos + 60]
        if hdr[58:60] != b'\x60\x0a':
            result['errors'].append('bad ar header at %d' % pos)
            break
        name = hdr[0:16].decode('ascii', 'replace').strip()
        size = int(hdr[48:58].decode('ascii', 'replace').strip() or 0)
        body = data[pos + 60:pos + 60 + size]
        pos += 60 + size + (size % 2)
        members.append(name)
        if name.startswith('control.tar'):
            control_blob = body
        elif name.startswith('data.tar'):
            data_blob = body
    result['members'] = members
    if control_blob is not None:
        kind = 'zstd' if any(m.startswith('control.tar') and m.endswith('.zst')
                             for m in members) else 'gzip'
        blob = decompress(control_blob, kind)
        if blob:
            tf, names = tar_names(blob)
            if tf:
                for m in tf.getmembers():
                    if os.path.basename(m.name) == 'control':
                        result['meta'].update(
                            parse_kv(tf.extractfile(m).read().decode('utf-8', 'replace')))
            else:
                result['errors'].append(names)
        else:
            result['errors'].append('cannot decompress control.tar')
    if data_blob is not None:
        base = 'data.tar.zst' if members and any(
            m.startswith('data.tar') and m.endswith('.zst') for m in members) else 'data.tar.gz'
        blob = decompress(data_blob, 'zstd' if base.endswith('.zst') else 'gzip')
        if blob:
            tf, names = tar_names(blob)
            if tf:
                result['files'] += [m.name for m in tf.getmembers()]
            else:
                result['errors'].append(names)
        else:
            result['errors'].append('cannot decompress %s' % base)

elif data[:3] == b'ADB' and data[3:4] in (b'.', b'd', b'c'):
    # ---- APKv3: the "ADB" container apk-tools 3.x mkpkg writes.
    # Envelope (adb_comp.c): "ADB." plain / "ADBd" deflate / "ADBc" zstd;
    # the payload itself is opaque to us and is read via the apk tool.
    result['kind'] = 'apk-v3'
    if not apk_tool:
        result['errors'].append(
            'APKv3 container needs the apk tool to inspect - '
            'pass --apk-tool <path> (the SDK ships one in staging_dir/host/bin/apk)')
    else:
        p = subprocess.run([apk_tool, 'adbdump', path],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if p.returncode != 0:
            result['errors'].append('apk adbdump failed: %s'
                                    % p.stderr.decode('utf-8', 'replace').strip())
        else:
            text = p.stdout.decode('utf-8', 'replace')
            # The package schema puts the info block first; its "name",
            # "version" and "arch" fields are the first of their kind in
            # the dump. Dependencies are objects below "depends:".
            section, deps = None, []
            def clean(v):
                return v.strip().strip('"\'')
            for line in text.splitlines():
                stripped = line.strip()
                if not stripped:
                    continue
                key = stripped.split(':', 1)[0] if ':' in stripped else None
                if key == 'depends':
                    section = 'depends'
                    continue
                if key in ('paths', 'scripts', 'triggers'):
                    section = None
                if section == 'depends' and stripped.startswith('- '):
                    item = clean(stripped[2:])
                    # adbdump emits plain scalars ("- curl"); a dependency
                    # object with extra fields serialises as "- name: curl"
                    if item.startswith('name:'):
                        item = clean(item.split(':', 1)[1])
                    if item:
                        deps.append(item.split()[0])
            for field in ('name', 'version', 'arch', 'origin', 'url'):
                for line in text.splitlines():
                    s = line.strip()
                    if s.startswith(field + ':'):
                        result['meta'][field] = clean(s.split(':', 1)[1])
                        break
            if deps:
                result['meta']['depend'] = ' '.join(deps)
        with tempfile.TemporaryDirectory() as td:
            # --allow-untrusted: OpenWrt's mkpkg does not sign packages
            p = subprocess.run([apk_tool, 'extract', '--allow-untrusted',
                                '--destination', td, path],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if p.returncode != 0:
                result['errors'].append('apk extract failed: %s'
                                        % p.stderr.decode('utf-8', 'replace').strip())
            else:
                for root, dirs, files in os.walk(td):
                    for f in files:
                        result['files'].append(
                            os.path.relpath(os.path.join(root, f), td))

elif data[:2] == b'\x1f\x8b' or data[:4] == b'\x28\xb5\x2f\xfd':
    # ---- gzip/zstd streams: tarball ipk or old APKv2 -------------------
    if data[:2] == b'\x1f\x8b':
        first = gzip.decompress(data)
    else:
        p = subprocess.run(['zstd', '-d', '-c'], input=data,
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        first = p.stdout if p.returncode == 0 else None
    tf, names = tar_names(first) if first else (None, 'cannot decompress first stream')
    if tf is None:
        result['errors'].append(names)
    else:
        basenames = [os.path.basename(n) for n in names]
        if 'debian-binary' in basenames:
            # ipk: the outer tar holds debian-binary + data.tar.* + control.tar.*
            result['kind'] = 'ipk-tgz'
            members = {}
            for m in tf.getmembers():
                members[m.name] = tf.extractfile(m).read()
            ipk_load_members(list(members), lambda n: members[n])
        else:
            # APKv2: concatenated streams (sig / .PKGINFO / payload)
            result['kind'] = 'apk-v2'
            pos, payload_seen = 0, False
            while pos < len(data):
                if data[pos:pos + 2] == b'\x1f\x8b':
                    d = zlib.decompressobj(31)
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
                tf2, _ = tar_names(blob)
                if tf2 is None:
                    continue
                for m in tf2.getmembers():
                    if m.name.startswith('.SIGN.'):
                        continue
                    result['files'].append(m.name)
                    if os.path.basename(m.name) == '.PKGINFO':
                        try:
                            result['meta'].update(parse_kv(
                                tf2.extractfile(m).read().decode('utf-8', 'replace')))
                        except Exception:
                            pass
else:
    result['errors'].append('unrecognised container (not ADB, not gzip/zstd, not ar)')

def emit(key, value):
    print('%s=%s' % (key, value))

emit('kind', result['kind'])
emit('size', len(data))
for k in ('pkgname', 'name', 'pkgver', 'version', 'arch', 'origin',
          'pkgdesc', 'url'):
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
for e in result['errors']:
    emit('error', e)
PY
}

# --------------------------------------------------------------------------- #
# per-package checks
# --------------------------------------------------------------------------- #

REQUIRED_FILES=(
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

# OpenWrt maps a PKGARCH=all package to "noarch" inside apk metadata
# (include/package-pack.mk: --info "arch:noarch") while ipk control keeps
# "Architecture: all". Both spellings mean "arch-independent data package".
case "$EXPECT_ARCH" in
all)     VALID_ARCHES="all noarch" ;;
noarch)  VALID_ARCHES="noarch all" ;;
*)       VALID_ARCHES="$EXPECT_ARCH" ;;
esac

for pkg in "${FILES[@]}"; do
	log "────────────────────────────────────────────"
	log "package: $pkg"
	[ -s "$pkg" ] || { fail "$pkg does not exist or is empty"; continue; }

	info="$(read_pkg_py "$pkg")" || { fail "cannot parse $pkg"; continue; }
	get()  { printf '%s\n' "$info" | sed -n "s/^$1=//p"; }
	get1() { printf '%s\n' "$info" | sed -n "s/^$1=//p" | head -n1; }

	kind="$(get1 kind)"
	arch="$(get1 meta_arch)"
	[ -z "$arch" ] && arch="$(get1 control_architecture)"
	name="$(get1 meta_pkgname)"
	[ -z "$name" ] && name="$(get1 meta_name)"
	[ -z "$name" ] && name="$(get1 control_package)"
	version="$(get1 meta_pkgver)"
	[ -z "$version" ] && version="$(get1 meta_version)"
	[ -z "$version" ] && version="$(get1 control_version)"
	depends="$(get1 depend)"
	[ -z "$depends" ] && depends="$(get1 control_depends)"

	while IFS= read -r e; do fail "$pkg: $e"; done < <(get error)

	case "$pkg" in
	*.apk)
		case "$kind" in
		apk-v3|apk-v2) : ;;
		*) fail "$pkg has .apk extension but container is '${kind}' (renamed ipk?)" ;;
		esac
		case "$kind" in
		apk-v2) [ -n "$(get1 meta_pkgname)" ] \
			|| fail "$pkg carries no .PKGINFO - not a real apk" ;;
		apk-v3) [ -n "$(get1 meta_name)" ] \
			|| fail "$pkg metadata could not be read via the apk tool" ;;
		esac
		;;
	*.ipk)
		case "$kind" in
		ipk-tgz) for m in debian-binary control.tar data.tar; do
				get member | grep -q "$m" \
					|| fail "$pkg is missing tar member '${m}'"
			done ;;
		ipk-ar)  for m in debian-binary control.tar data.tar; do
				get member | grep -q "^${m}" \
					|| fail "$pkg is missing ar member '${m}'"
			done ;;
		*) fail "$pkg has .ipk extension but container is '${kind}' (renamed apk?)" ;;
		esac
		[ -n "$(get1 control_package)" ] \
			|| fail "$pkg carries no control file - not a real ipk"
		;;
	esac

	log "  format    : ${kind}"
	log "  name      : ${name}"
	log "  version   : ${version}"
	log "  arch      : ${arch:-<none>}"
	log "  depends   : ${depends:-<none>}"

	[ "$name" = "$EXPECT_NAME" ] || fail "package name is '${name}', expected '${EXPECT_NAME}'"
	[ -n "$version" ] || fail "package version is empty"
	arch_ok=0
	for a in $VALID_ARCHES; do
		[ "$arch" = "$a" ] && arch_ok=1
	done
	[ "$arch_ok" = 1 ] \
		|| fail "architecture is '${arch}', expected arch-independent (${VALID_ARCHES}) - a data-only theme must not be target-bound"

	# Dependencies: the theme needs luci-base (ucode + rpcd come with it) and
	# curl for the wallpaper fetcher - and nothing kernel/target specific.
	case "$depends" in
	*luci-base*) : ;;
	*) fail "dependency luci-base missing (got: ${depends:-<none>})" ;;
	esac
	case "$depends" in
	*curl*) : ;;
	*) fail "dependency curl missing (wallpaper fetcher needs it)" ;;
	esac
	for bad in kmod- kernel; do
		case " $depends " in
		*" $bad"*) fail "unexpected kernel-bound dependency '${bad}' in a data-only theme" ;;
		esac
	done

	# Payload sanity: every file the theme needs must be inside the package.
	mapfile -t payload < <(get file | sed 's|^\./||' | sort -u)
	log "  payload   : ${#payload[@]} entries"
	[ "${#payload[@]}" -gt 0 ] || fail "$pkg payload is empty"

	for req in "${REQUIRED_FILES[@]}"; do
		printf '%s\n' "${payload[@]}" | grep -qx "$req" \
			|| fail "$pkg is missing ${req}"
	done

	present_css="$(printf '%s\n' "${payload[@]}" | grep -c '^www/luci-static/mint/.*\.css$' || true)"
	present_js="$(printf '%s\n' "${payload[@]}" | grep -c '^www/luci-static/.*\.js$' || true)"
	[ "$present_css" -gt 0 ] || fail "$pkg ships no CSS"
	[ "$present_js" -gt 0 ] || fail "$pkg ships no JavaScript"

	log "  ok        : $(basename "$pkg")"
done

log "────────────────────────────────────────────"
if [ "$FAILURES" -gt 0 ]; then
	printf '[verify] %d check(s) failed\n' "$FAILURES" >&2
	exit 1
fi
log "all packages verified"
