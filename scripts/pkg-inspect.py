#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# pkg-inspect.py - inspect / extract OpenWrt .ipk and .apk packages without a
# package manager.
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# The OpenWrt build system produces these container layouts, all handled here:
#
#   .ipk (OpenWrt, every series, scripts/ipkg-build):
#       gzip( tar( ./debian-binary, ./data.tar.gz, ./control.tar.gz ) )
#       where data.tar.gz / control.tar.gz are themselves gzip tars.
#       (OpenWrt has always used this gzip-tar form; the `ar` form below is
#       the Debian .deb layout, supported only for completeness.)
#
#   .ipk / .deb (legacy ar form):
#       ar archive: debian-binary, control.tar.{gz,zst}, data.tar.{gz,zst}
#
#   .apk (apk-tools v3, OpenWrt >= 25.12, produced by `apk mkpkg`):
#       "ADBd" + raw-deflate, or "ADB." (uncompressed), or "ADBc" (custom)
#       of an ADB container: 8-byte file header ("ADB." magic + schema)
#       followed by 8-byte-aligned blocks. Block 0 = metadata object +
#       string table; block 2 (DATA) blocks carry file contents.
#
#   .apk (apk-tools v2 / Alpine):
#       concatenated gzip streams: signature / .PKGINFO tar / payload tar.
#
# Subcommands:
#   info    <file>           -> key=value dump of metadata + payload listing
#   extract <file> <root>    -> unpack payload files (with modes) under <root>
#
# The `info` contract consumed by scripts/verify-package.sh emits:
#   kind, size, member, control_*, meta_*, depend, file, xfile, error
#
# Stdlib only; `zstd` is shelled out to when a .zst member is present
# (best effort - gzip is the default on every series this project builds).

import gzip
import io
import os
import subprocess
import sys
import tarfile
import zlib

# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def die(msg):
    sys.stderr.write('error=%s\n' % msg)
    sys.exit(1)


def gunzip(blob):
    return gzip.decompress(blob)


def raw_deflate(blob):
    d = zlib.decompressobj(-15)
    return d.decompress(blob) + d.flush()


def zstd_decompress(blob):
    p = subprocess.run(['zstd', '-d', '-c'], input=blob,
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if p.returncode != 0:
        raise ValueError('zstd decompression failed')
    return p.stdout


def decompress_tar_member(blob, name):
    if name.endswith('.zst'):
        return zstd_decompress(blob)
    return gunzip(blob)


def clean_path(name):
    """Normalise a tar/ADB member name to a rooted relative path or None."""
    name = name.replace('\\', '/')
    while name.startswith('./'):
        name = name[2:]
    name = name.lstrip('/')
    parts = []
    for p in name.split('/'):
        if p in ('', '.'):
            continue
        if p == '..':
            return None
        parts.append(p)
    return '/'.join(parts)


def safe_join(root, rel):
    if rel is None:
        return None
    p = os.path.normpath(os.path.join(root, rel))
    rp = os.path.normpath(root)
    if not (p == rp or p.startswith(rp + os.sep)):
        return None
    return p


def emit(key, value):
    sys.stdout.write('%s=%s\n' % (key, value))


# --------------------------------------------------------------------------
# ipk (gzip-tar and ar)
# --------------------------------------------------------------------------

def parse_control(text):
    """RFC822-style control file -> {lowercased key: value}."""
    out = {}
    key = None
    for raw in text.splitlines():
        line = raw.rstrip('\n')
        if not line.strip():
            continue
        if line[0] in ' \t':
            if key is not None:
                out[key] = out.get(key, '') + ' ' + line.strip()
            continue
        if ':' in line:
            k, v = line.split(':', 1)
            key = k.strip().lower()
            out[key] = v.strip()
    return out


def tar_listing(blob):
    """Return (members, files, xfiles) for a payload tar blob."""
    members = []
    files = []
    xfiles = []
    tf = tarfile.open(fileobj=io.BytesIO(blob))
    for m in tf.getmembers():
        members.append(m.name)
        rel = clean_path(m.name)
        if rel is None:
            continue
        if m.isdir():
            continue
        files.append(rel)
        if m.mode & 0o111:
            xfiles.append(rel)
    return members, files, xfiles


def ipk_outer_members(blob):
    """Map outer tar member basename -> bytes for a gzip-tar ipk."""
    outer = {}
    tf = tarfile.open(fileobj=io.BytesIO(blob))
    for m in tf.getmembers():
        base = os.path.basename(clean_path(m.name) or m.name)
        try:
            outer[base] = tf.extractfile(m).read()
        except Exception:
            pass
    return outer


def ipk_control_and_data(outer):
    """Return (control_text, data_blob) from an {name: bytes} member map."""
    control_text = None
    data_blob = None
    for name, blob in outer.items():
        if name.startswith('control.tar'):
            try:
                inner = decompress_tar_member(blob, name)
                tf = tarfile.open(fileobj=io.BytesIO(inner))
                for m in tf.getmembers():
                    if os.path.basename(m.name) == 'control':
                        control_text = tf.extractfile(m).read().decode('utf-8', 'replace')
                        break
            except Exception:
                pass
        elif name.startswith('data.tar'):
            try:
                data_blob = decompress_tar_member(blob, name)
            except Exception:
                data_blob = None
    return control_text, data_blob


def parse_ipk(data):
    """Return (kind, members, files, xfiles, control_text, errors)."""
    kind = 'ipk'
    members = []
    files = []
    xfiles = []
    control_text = None
    errors = []

    if data[:8] == b'!<arch>\n':
        # ---- legacy ar archive (Debian-style .deb) --------------------
        pos = 8
        outer = {}
        while pos + 60 <= len(data):
            hdr = data[pos:pos + 60]
            if hdr[58:60] != b'\x60\x0a':
                errors.append('bad ar header at %d' % pos)
                break
            name = hdr[0:16].decode('ascii', 'replace').strip()
            size = int(hdr[48:58].decode('ascii', 'replace').strip() or 0)
            body = data[pos + 60:pos + 60 + size]
            pos += 60 + size + (size % 2)
            members.append(name)
            outer[name] = body
        control_text, data_blob = ipk_control_and_data(outer)
        if data_blob is not None:
            _, files, xfiles = tar_listing(data_blob)
    else:
        # ---- gzip( tar( debian-binary, data.tar.gz, control.tar.gz ) ) --
        try:
            blob = gunzip(data)
        except Exception as e:
            errors.append('not a gzip ipk: %s' % e)
            return kind, members, files, xfiles, control_text, errors
        outer = ipk_outer_members(blob)
        for name in outer:
            members.append(name)
        control_text, data_blob = ipk_control_and_data(outer)
        if data_blob is not None:
            _, files, xfiles = tar_listing(data_blob)

    return kind, members, files, xfiles, control_text, errors


# --------------------------------------------------------------------------
# apk (v2 gzip streams and v3 ADB)
# --------------------------------------------------------------------------

# adb_val_t type codes (high nibble)
TYPE_INT = 0x1
TYPE_INT_32 = 0x2
TYPE_INT_64 = 0x3
TYPE_BLOB_8 = 0x8
TYPE_BLOB_16 = 0x9
TYPE_BLOB_32 = 0xa
TYPE_ARRAY = 0xd
TYPE_OBJECT = 0xe

# schema field indices (apk-tools 3.0.5, src/apk_adb.h)
PI_NAME = 1
PI_VERSION = 2
PI_DESCRIPTION = 4
PI_ARCH = 5
PI_ORIGIN = 7
PI_URL = 9
PI_INSTALLED_SIZE = 12
PI_DEPENDS = 15

PKG_PKGINFO = 1
PKG_PATHS = 2

DI_NAME = 1
DI_FILES = 3

FI_NAME = 1
FI_ACL = 2
FI_TARGET = 6

ACL_MODE = 1

DEP_NAME = 1

S_IFMT = 0o170000
S_IFLNK = 0o120000


class Adb:
    def __init__(self, buf):
        self.buf = buf

    def u32(self, o):
        return int.from_bytes(self.buf[o:o + 4], 'little')

    def vtype(self, v):
        return v >> 28

    def vvalue(self, v):
        return v & 0x0fffffff

    def blob(self, v):
        t = self.vtype(v)
        off = self.vvalue(v)
        if t == TYPE_BLOB_8:
            n = self.buf[off]
            return bytes(self.buf[off + 1:off + 1 + n])
        if t == TYPE_BLOB_16:
            n = int.from_bytes(self.buf[off:off + 2], 'little')
            return bytes(self.buf[off + 2:off + 2 + n])
        if t == TYPE_BLOB_32:
            n = int.from_bytes(self.buf[off:off + 4], 'little')
            return bytes(self.buf[off + 4:off + 4 + n])
        return None

    def integer(self, v):
        t = self.vtype(v)
        off = self.vvalue(v)
        if t == TYPE_INT:
            return off
        if t == TYPE_INT_32:
            return int.from_bytes(self.buf[off:off + 4], 'little')
        if t == TYPE_INT_64:
            return int.from_bytes(self.buf[off:off + 8], 'little')
        return None

    def obj(self, v):
        """Return the words at an OBJECT/ARRAY value: [count, item1, ...]."""
        t = self.vtype(v)
        if t not in (TYPE_OBJECT, TYPE_ARRAY):
            return None
        off = self.vvalue(v)
        n = self.u32(off)
        if n > 0x10000:
            return None
        return [self.u32(off + 4 * i) for i in range(n)]


def walk_adb_blocks(buf, start=8):
    """Yield (type, payload) for every block in the ADB container."""
    pos = start
    while pos + 4 <= len(buf):
        type_size = int.from_bytes(buf[pos:pos + 4], 'little')
        if (type_size >> 30) == 3:  # ADB_BLOCK_EXT
            if pos + 16 > len(buf):
                return
            btype = type_size & 0x3fffffff
            rawsize = int.from_bytes(buf[pos + 8:pos + 16], 'little')
            hdrsize = 16
        else:
            btype = type_size >> 30
            rawsize = type_size & 0x3fffffff
            hdrsize = 4
        payload_len = rawsize - hdrsize
        if payload_len < 0 or pos + hdrsize + payload_len > len(buf):
            return
        payload = buf[pos + hdrsize:pos + hdrsize + payload_len]
        yield btype, payload
        pos += (rawsize + 7) & ~7


def target_parts(blob):
    """Split a file TARGET blob into (mode, target-string-or-None)."""
    if blob is None or len(blob) < 2:
        return 0, None
    mode = int.from_bytes(blob[0:2], 'little')
    rest = blob[2:]
    return mode & S_IFMT, rest.decode('utf-8', 'replace')


class AdbPackage:
    """Parsed apk-tools v3 package."""

    def __init__(self, buf):
        self.buf = buf
        self.adb_blob = None
        self.data_blocks = []
        self.errors = []
        self.name = ''
        self.version = ''
        self.arch = ''
        self.origin = ''
        self.description = ''
        self.url = ''
        self.installed_size = None
        self.depends = []
        self.files = []   # dicts: path, mode, target (symlink string or None)
        self._parse()

    def _parse(self):
        if len(self.buf) < 8 or self.buf[0:4] != b'ADB.':
            self.errors.append('not an ADB v3 container')
            return
        for btype, payload in walk_adb_blocks(self.buf):
            if btype == 0:
                self.adb_blob = payload
            elif btype == 2:
                self.data_blocks.append(payload)
        if self.adb_blob is None or len(self.adb_blob) < 8:
            self.errors.append('no ADB metadata block')
            return
        db = Adb(self.adb_blob)
        root = db.u32(4)
        pkg = db.obj(root)
        if not pkg:
            self.errors.append('cannot read package object')
            return

        pi = db.obj(pkg[PKG_PKGINFO]) if len(pkg) > PKG_PKGINFO else None
        if pi:
            def _str(idx):
                return (db.blob(pi[idx]) or b'').decode('utf-8', 'replace') if len(pi) > idx else ''
            self.name = _str(PI_NAME)
            self.version = _str(PI_VERSION)
            self.arch = _str(PI_ARCH)
            self.origin = _str(PI_ORIGIN)
            self.description = _str(PI_DESCRIPTION)
            self.url = _str(PI_URL)
            if len(pi) > PI_INSTALLED_SIZE:
                self.installed_size = db.integer(pi[PI_INSTALLED_SIZE])
            if len(pi) > PI_DEPENDS:
                dep_arr = db.obj(pi[PI_DEPENDS])
                if dep_arr:
                    for d in dep_arr[1:]:
                        dobj = db.obj(d)
                        if not dobj or len(dobj) <= DEP_NAME:
                            continue
                        dn = db.blob(dobj[DEP_NAME])
                        if dn:
                            self.depends.append(dn.decode('utf-8', 'replace'))

        if len(pkg) > PKG_PATHS:
            self._parse_paths(db, pkg[PKG_PATHS])

    def _parse_paths(self, db, paths_val):
        dirs = db.obj(paths_val)
        if not dirs:
            return
        for d in dirs[1:]:
            dobj = db.obj(d)
            if not dobj:
                continue
            dirname = ''
            if len(dobj) > DI_NAME:
                blob = db.blob(dobj[DI_NAME])
                dirname = blob.decode('utf-8', 'replace') if blob else ''
            files_val = dobj[DI_FILES] if len(dobj) > DI_FILES else 0
            farr = db.obj(files_val) if files_val else None
            if not farr:
                continue
            for f in farr[1:]:
                fobj = db.obj(f)
                if not fobj or len(fobj) <= FI_NAME:
                    continue
                fnb = db.blob(fobj[FI_NAME])
                if not fnb:
                    continue
                rel = clean_path('%s/%s' % (dirname, fnb.decode('utf-8', 'replace')))
                if rel is None:
                    continue
                mode = 0o644
                if len(fobj) > FI_ACL:
                    aobj = db.obj(fobj[FI_ACL])
                    if aobj and len(aobj) > ACL_MODE:
                        m = db.integer(aobj[ACL_MODE])
                        if m is not None:
                            mode = m & 0o7777
                target = None
                if len(fobj) > FI_TARGET:
                    fmode, target = target_parts(db.blob(fobj[FI_TARGET]))
                    if fmode != S_IFLNK:
                        target = None
                self.files.append({'path': rel, 'mode': mode, 'target': target})


def parse_apk_v3(buf):
    pkg = AdbPackage(buf)
    meta = {
        'pkgname': pkg.name,
        'pkgver': pkg.version,
        'arch': pkg.arch,
        'origin': pkg.origin,
        'pkgdesc': pkg.description,
        'url': pkg.url,
    }
    if pkg.installed_size is not None:
        meta['size'] = str(pkg.installed_size)
    meta['depend'] = ' '.join(pkg.depends)
    files = []
    xfiles = []
    for f in pkg.files:
        files.append(f['path'])
        if f['mode'] & 0o111:
            xfiles.append(f['path'])
    return 'apk', meta, files, xfiles, pkg.errors


def parse_apk_v2(data):
    """apk-tools v2: concatenated gzip streams with a .PKGINFO tar."""
    meta = {}
    files = []
    xfiles = []
    errors = []
    pos = 0
    while pos < len(data):
        if data[pos:pos + 2] == b'\x1f\x8b':
            d = zlib.decompressobj(31)
            try:
                blob = d.decompress(data[pos:])
            except Exception as e:
                errors.append('gzip stream at %d: %s' % (pos, e))
                break
            consumed = len(data) - pos - len(d.unused_data)
        elif data[pos:pos + 4] == b'\x28\xb5\x2f\xfd':
            p = subprocess.run(['zstd', '-d', '-c'], input=data[pos:],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            if p.returncode != 0:
                errors.append('zstd stream at %d failed' % pos)
                break
            blob, consumed = p.stdout, len(data) - pos
        else:
            errors.append('unrecognised apk stream at %d' % pos)
            break
        if consumed <= 0:
            break
        pos += consumed
        try:
            tf = tarfile.open(fileobj=io.BytesIO(blob))
        except Exception:
            continue
        for m in tf.getmembers():
            if m.name.startswith('.SIGN.'):
                continue
            if m.isdir():
                continue
            rel = clean_path(m.name)
            if rel is None:
                continue
            if os.path.basename(m.name) == '.PKGINFO':
                try:
                    text = tf.extractfile(m).read().decode('utf-8', 'replace')
                    for line in text.splitlines():
                        if ' = ' in line:
                            k, v = line.split(' = ', 1)
                            k = k.strip().lower()
                            if k == 'depend':
                                meta[k] = (meta.get(k, '') + ' ' + v.strip()).strip()
                            else:
                                meta.setdefault(k, v.strip())
                except Exception:
                    pass
            else:
                files.append(rel)
                if m.mode & 0o111:
                    xfiles.append(rel)
    return meta, files, xfiles, errors


def sniff(data):
    """Return the container family of `data`."""
    if data[:8] == b'!<arch>\n':
        return 'ipk-ar'
    if data[:4] in (b'ADBd', b'ADB.', b'ADBc'):
        return 'apk-v3'
    if data[:2] == b'\x1f\x8b':
        try:
            probe = gunzip(data)
        except Exception:
            return 'unknown'
        if probe[:8] == b'!<arch>\n':
            return 'ipk-ar'
        try:
            tf = tarfile.open(fileobj=io.BytesIO(probe))
            names = [os.path.basename(m.name.rstrip('/')) for m in tf.getmembers()[:4]]
        except Exception:
            names = []
        if any(n.startswith('debian-binary') for n in names):
            return 'ipk'
        return 'apk-v2'
    return 'unknown'


def parse_apk(data):
    if data[:4] == b'ADBd':
        try:
            buf = raw_deflate(data[4:])
        except Exception as e:
            return 'apk', {}, [], [], ['ADBd deflate: %s' % e]
        return parse_apk_v3(buf)
    if data[:4] == b'ADB.':
        return parse_apk_v3(data)
    if data[:4] == b'ADBc':
        try:
            buf = zstd_decompress(data[4 + 12:])
        except Exception as e:
            return 'apk', {}, [], [], ['ADBc compression: %s' % e]
        return parse_apk_v3(buf)
    meta, files, xfiles, errors = parse_apk_v2(data)
    return 'apk', meta, files, xfiles, errors


# --------------------------------------------------------------------------
# extract
# --------------------------------------------------------------------------

def extract_tar(blob, root):
    tf = tarfile.open(fileobj=io.BytesIO(blob))
    for m in tf.getmembers():
        rel = clean_path(m.name)
        if rel is None:
            continue
        dest = safe_join(root, rel)
        if dest is None:
            continue
        if m.isdir():
            os.makedirs(dest, exist_ok=True)
            continue
        if m.issym() or m.islnk():
            parent = os.path.dirname(dest)
            os.makedirs(parent, exist_ok=True)
            if os.path.lexists(dest):
                os.unlink(dest)
            try:
                os.symlink(m.linkname, dest)
            except OSError:
                pass
            continue
        parent = os.path.dirname(dest)
        os.makedirs(parent, exist_ok=True)
        with open(dest, 'wb') as fh:
            src = tf.extractfile(m)
            if src:
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    fh.write(chunk)
        os.chmod(dest, m.mode & 0o7777)


def extract_ipk(data, root):
    if data[:8] == b'!<arch>\n':
        pos = 8
        data_blob = None
        while pos + 60 <= len(data):
            hdr = data[pos:pos + 60]
            if hdr[58:60] != b'\x60\x0a':
                break
            name = hdr[0:16].decode('ascii', 'replace').strip()
            size = int(hdr[48:58].decode('ascii', 'replace').strip() or 0)
            body = data[pos + 60:pos + 60 + size]
            pos += 60 + size + (size % 2)
            if name.startswith('data.tar'):
                try:
                    data_blob = decompress_tar_member(body, name)
                except Exception:
                    data_blob = None
        if data_blob is None:
            die('no data.tar.* inside ipk')
        extract_tar(data_blob, root)
        return
    blob = gunzip(data)
    outer = ipk_outer_members(blob)
    for name, body in outer.items():
        if name.startswith('data.tar'):
            inner = decompress_tar_member(body, name)
            extract_tar(inner, root)
            return
    die('no data.tar.* inside ipk')


def extract_apk_v2(data, root):
    pos = 0
    while pos < len(data):
        if data[pos:pos + 2] == b'\x1f\x8b':
            d = zlib.decompressobj(31)
            blob = d.decompress(data[pos:])
            consumed = len(data) - pos - len(d.unused_data)
        elif data[pos:pos + 4] == b'\x28\xb5\x2f\xfd':
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
            if m.isdir():
                continue
            rel = clean_path(m.name)
            if rel is None:
                continue
            dest = safe_join(root, rel)
            if dest is None:
                continue
            parent = os.path.dirname(dest)
            os.makedirs(parent, exist_ok=True)
            with open(dest, 'wb') as fh:
                src = tf.extractfile(m)
                if src:
                    while True:
                        chunk = src.read(1 << 20)
                        if not chunk:
                            break
                        fh.write(chunk)
            os.chmod(dest, m.mode & 0o7777)


def extract_apk_v3(buf, root):
    pkg = AdbPackage(buf)
    db = Adb(pkg.adb_blob)
    pobj = db.obj(db.u32(4))
    dirs = []
    if pobj and len(pobj) > PKG_PATHS:
        for d in db.obj(pobj[PKG_PATHS])[1:]:
            dobj = db.obj(d)
            if not dobj:
                dirs.append((None, []))
                continue
            dn = (db.blob(dobj[DI_NAME]) or b'').decode('utf-8', 'replace') if len(dobj) > DI_NAME else ''
            farr = db.obj(dobj[DI_FILES]) if len(dobj) > DI_FILES else None
            fl = []
            if farr:
                for f in farr[1:]:
                    fobj = db.obj(f)
                    fn = (db.blob(fobj[FI_NAME]) or b'').decode('utf-8', 'replace') if fobj and len(fobj) > FI_NAME else ''
                    fl.append(fn)
            dirs.append((dn, fl))

    data_map = {}
    for payload in pkg.data_blocks:
        if len(payload) < 8:
            continue
        path_idx = int.from_bytes(payload[0:4], 'little')
        file_idx = int.from_bytes(payload[4:8], 'little')
        if not (1 <= path_idx <= len(dirs)):
            continue
        dn, fl = dirs[path_idx - 1]
        if not (1 <= file_idx <= len(fl)):
            continue
        rel = clean_path('%s/%s' % (dn, fl[file_idx - 1]))
        if rel:
            data_map[rel] = payload[8:]

    for f in pkg.files:
        rel = f['path']
        dest = safe_join(root, rel)
        if dest is None:
            continue
        parent = os.path.dirname(dest)
        os.makedirs(parent, exist_ok=True)
        if f['target'] is not None:
            if os.path.lexists(dest):
                os.unlink(dest)
            try:
                os.symlink(f['target'], dest)
            except OSError:
                pass
            continue
        content = data_map.get(rel, b'')
        with open(dest, 'wb') as fh:
            fh.write(content)
        os.chmod(dest, f['mode'] & 0o7777)


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def cmd_info(path):
    with open(path, 'rb') as fh:
        data = fh.read()
    emit('size', len(data))

    kind = sniff(data)
    if kind in ('ipk', 'ipk-ar'):
        _, members, files, xfiles, control_text, errors = parse_ipk(data)
        emit('kind', 'ipk')
        for m in members:
            emit('member', m)
        if control_text:
            for k, v in parse_control(control_text).items():
                emit('control_%s' % k, v.replace('\n', ' | '))
    elif kind == 'apk-v3':
        _, meta, files, xfiles, errors = parse_apk(data)
        emit('kind', 'apk')
        for k, v in meta.items():
            if k == 'depend':
                emit('depend', v)
            elif v:
                emit('meta_%s' % k, v)
    elif kind == 'apk-v2':
        _, meta, files, xfiles, errors = parse_apk_v2(data)
        emit('kind', 'apk')
        for k, v in meta.items():
            if k == 'depend':
                emit('depend', v)
            elif v:
                emit('meta_%s' % k, v)
    else:
        files, xfiles, errors = [], [], ['unrecognised container (not ipk, not apk)']
        emit('kind', 'unknown')

    for f in sorted(set(files)):
        emit('file', f)
    for f in sorted(set(xfiles)):
        emit('xfile', f)
    for e in errors:
        emit('error', e)


def cmd_extract(path, root):
    os.makedirs(root, exist_ok=True)
    with open(path, 'rb') as fh:
        data = fh.read()
    kind = sniff(data)
    if kind == 'ipk':
        extract_ipk(data, root)
    elif kind == 'ipk-ar':
        extract_ipk(data, root)
    elif kind == 'apk-v3':
        if data[:4] == b'ADBd':
            buf = raw_deflate(data[4:])
        elif data[:4] == b'ADB.':
            buf = data
        else:
            buf = zstd_decompress(data[4 + 12:])
        extract_apk_v3(buf, root)
    elif kind == 'apk-v2':
        extract_apk_v2(data, root)
    else:
        die('unrecognised container in %s' % path)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    cmd = sys.argv[1]
    if cmd == 'info' and len(sys.argv) >= 3:
        cmd_info(sys.argv[2])
    elif cmd == 'extract' and len(sys.argv) >= 4:
        cmd_extract(sys.argv[2], sys.argv[3])
    else:
        print(__doc__)
        sys.exit(2)
