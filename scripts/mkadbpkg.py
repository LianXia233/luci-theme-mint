#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# mkadbpkg.py - build an apk-tools v3 (ADB) package with the same byte layout
# as `apk mkpkg` (apk-tools 3.0.5), for local CI fixture generation.
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# This mirrors what OpenWrt's include/package-pack.mk produces for apk:
#
#   apk mkpkg --info name:... --info version:... --info arch:noarch \
#             --info description:... --info license:... --info origin:... \
#             --info url:... --info maintainer:... --info depends:... \
#             --files <dir> --output <file.apk>
#
# Output container (default compression, identical to mkpkg):
#   "ADBd" + raw-deflate( 8-byte file header "ADB."+"pckg" + blocks )
#   block 0 = ADB metadata object, block 2 = DATA (file payloads).
#
# The ADB object model is taken from apk-tools 3.0.5 src/adb.c / apk_adb.h:
#   adb_val_t = u32, high 4 bits type, low 28 bits offset (from object start).
#   Object/array = [u32 count][count-1 values]; field i lives at words[i].

import argparse
import hashlib
import os
import struct
import sys
import zlib

ADB_FORMAT_MAGIC = 0x2e424441    # "ADB."
ADB_SCHEMA_PACKAGE = 0x676b6370  # "pckg"

TYPE_INT = 0x1
TYPE_INT_32 = 0x2
TYPE_INT_64 = 0x3
TYPE_BLOB_8 = 0x8
TYPE_BLOB_16 = 0x9
TYPE_BLOB_32 = 0xa
TYPE_ARRAY = 0xd
TYPE_OBJECT = 0xe

# field indices (apk-tools 3.0.5, src/apk_adb.h)
PI_NAME = 1
PI_VERSION = 2
PI_HASHES = 3
PI_DESCRIPTION = 4
PI_ARCH = 5
PI_LICENSE = 6
PI_ORIGIN = 7
PI_MAINTAINER = 8
PI_URL = 9
PI_INSTALLED_SIZE = 12
PI_DEPENDS = 15
ADBI_PI_MAX = 0x16

PKG_PKGINFO = 1
PKG_PATHS = 2
ADBI_PKG_MAX = 6

DI_NAME = 1
DI_ACL = 2
DI_FILES = 3
ADBI_DI_MAX = 4

FI_NAME = 1
FI_ACL = 2
FI_SIZE = 3
FI_MTIME = 4
FI_HASHES = 5
FI_TARGET = 6
ADBI_FI_MAX = 7

ACL_MODE = 1
ACL_USER = 2
ACL_GROUP = 3
ADBI_ACL_MAX = 5

DEP_NAME = 1
ADBI_DEP_MAX = 4

S_IFLNK = 0o120000


class DB:
    def __init__(self):
        self.buf = bytearray()

    def raw(self, data, alignment):
        while len(self.buf) % alignment:
            self.buf.append(0)
        off = len(self.buf)
        self.buf += data
        return off


def val(t, off):
    return (t << 28) | (off & 0x0fffffff)


def write_int(db, v):
    if v >= 0x100000000:
        off = db.raw(struct.pack('<Q', v), 4)
        return val(TYPE_INT_64, off)
    if v >= 0x10000000:
        off = db.raw(struct.pack('<I', v), 4)
        return val(TYPE_INT_32, off)
    return val(TYPE_INT, v)


def write_blob(db, b):
    """Return (adb_val_t, data_offset). data_offset = start of blob bytes."""
    if len(b) > 0xffff:
        off = db.raw(struct.pack('<I', len(b)), 4)
        doff = db.raw(b, 1)
        return val(TYPE_BLOB_32, off), doff
    if len(b) > 0xff:
        off = db.raw(struct.pack('<H', len(b)), 2)
        doff = db.raw(b, 1)
        return val(TYPE_BLOB_16, off), doff
    if len(b) > 0:
        off = db.raw(bytes([len(b)]), 1)
        doff = db.raw(b, 1)
        return val(TYPE_BLOB_8, off), doff
    return 0, 0  # ADB_NULL


def write_obj(db, fields, kind):
    """fields: list whose [0] is the count slot, [1..] are values."""
    n = len(fields)
    while n > 1 and fields[n - 1] == 0:
        n -= 1
    if n <= 1:
        return 0
    words = [n] + fields[1:n]
    off = db.raw(struct.pack('<%dI' % len(words), *words), 4)
    return val(kind, off)


class Obj:
    def __init__(self, db, num_fields):
        self.db = db
        self.fields = [0] * (num_fields + 1)

    def i(self, idx, v):
        self.fields[idx] = v

    def integer(self, idx, v):
        self.fields[idx] = write_int(self.db, v)

    def blob(self, idx, b):
        self.fields[idx] = write_blob(self.db, b)[0]

    def blob_off(self, idx, b):
        v, doff = write_blob(self.db, b)
        self.fields[idx] = v
        return doff

    def obj(self, idx, o):
        self.fields[idx] = o.commit()

    def commit(self):
        return write_obj(self.db, self.fields, TYPE_OBJECT)


class Arr:
    def __init__(self, db):
        self.db = db
        self.items = []

    def append_obj(self, o):
        self.items.append(o.commit())

    def append_val(self, v):
        self.items.append(v)

    def commit(self):
        # apk mkpkg commits these arrays via adb_wo_obj -> adb_w_obj, which
        # tags them TYPE_OBJECT on the wire (TYPE_ARRAY is reserved for
        # xattr arrays written with adb_w_arr). The slot layout is identical
        # for both, so the reader treats them the same.
        return write_obj(self.db, [0] + self.items, TYPE_OBJECT)


def scan_dirs(root):
    """Return ['', subdir1, ...] - root first, then subdirs sorted (mkpkg)."""
    subdirs = set()
    for dp, dn, _ in os.walk(root):
        rel = os.path.relpath(dp, root)
        if rel == '.':
            rel = ''
        for d in dn:
            subdirs.add((rel + '/' + d) if rel else d)
    return [''] + sorted(subdirs)


def build_package(name, version, arch, origin, url, license_, maintainer,
                  description, depends, files_dir, out):
    db = DB()
    # struct adb_hdr: u8 compat_ver, u8 ver, u16 reserved, u32 root
    db.raw(b'\x00\x00\x00\x00' + struct.pack('<I', 0), 8)

    pkginfo = Obj(db, ADBI_PI_MAX)
    pkginfo.blob(PI_NAME, name.encode())
    pkginfo.blob(PI_VERSION, version.encode())
    pkginfo.blob(PI_ARCH, arch.encode())
    if license_:
        pkginfo.blob(PI_LICENSE, license_.encode())
    if origin:
        pkginfo.blob(PI_ORIGIN, origin.encode())
    if url:
        pkginfo.blob(PI_URL, url.encode())
    if maintainer:
        pkginfo.blob(PI_MAINTAINER, maintainer.encode())
    if description:
        pkginfo.blob(PI_DESCRIPTION, description.encode())
    if depends:
        dep_arr = Arr(db)
        for d in depends:
            dep = Obj(db, ADBI_DEP_MAX)
            dep.blob(DEP_NAME, d.encode())
            dep_arr.append_obj(dep)
        pkginfo.obj(PI_DEPENDS, dep_arr)

    # scan payload -> paths array + per-file data, following mkpkg ordering
    dirs = scan_dirs(files_dir)
    paths = Arr(db)
    installed_size = 0
    data_blocks = []

    for dirname in dirs:
        base = os.path.join(files_dir, dirname) if dirname else files_dir
        farr = Arr(db)
        try:
            entries = sorted(os.listdir(base))
        except OSError:
            entries = []
        file_idx = 0
        for e in entries:
            full = os.path.join(base, e)
            st = os.lstat(full)
            if os.path.isdir(full) and not os.path.islink(full):
                continue
            file_idx += 1
            fobj = Obj(db, ADBI_FI_MAX)
            fobj.blob(FI_NAME, e.encode())
            if os.path.islink(full):
                target = os.readlink(full)
                tb = struct.pack('<H', S_IFLNK) + target.encode()
                fobj.blob(FI_TARGET, tb)
                fobj.integer(FI_SIZE, 0)
                fobj.integer(FI_MTIME, int(st.st_mtime))
            else:
                content = open(full, 'rb').read()
                fobj.blob(FI_HASHES, hashlib.sha256(content).digest())
                fobj.integer(FI_SIZE, len(content))
                fobj.integer(FI_MTIME, int(st.st_mtime))
                installed_size += len(content)
                if content:
                    data_blocks.append((len(paths.items) + 1, file_idx, content))
            acl = Obj(db, ADBI_ACL_MAX)
            acl.integer(ACL_MODE, st.st_mode & 0o7777)
            acl.blob(ACL_USER, b'root')
            acl.blob(ACL_GROUP, b'root')
            fobj.obj(FI_ACL, acl)
            farr.append_obj(fobj)

        dobj = Obj(db, ADBI_DI_MAX)
        if dirname:
            dobj.blob(DI_NAME, dirname.encode())
        st = os.stat(base)
        dacl = Obj(db, ADBI_ACL_MAX)
        dacl.integer(ACL_MODE, st.st_mode & 0o7777)
        dacl.blob(ACL_USER, b'root')
        dacl.blob(ACL_GROUP, b'root')
        dobj.obj(DI_ACL, dacl)
        dobj.obj(DI_FILES, farr)
        paths.append_obj(dobj)

    if not installed_size:
        installed_size = 1
    pkginfo.integer(PI_INSTALLED_SIZE, installed_size)
    # hashes = uid = first 20 bytes of SHA256 of the whole metadata blob;
    # written as a 20-byte blob and patched in place once the blob is done.
    hash_off = pkginfo.blob_off(PI_HASHES, b'\x00' * 20)

    pkg = Obj(db, ADBI_PKG_MAX)
    pkg.obj(PKG_PKGINFO, pkginfo)
    pkg.obj(PKG_PATHS, paths)
    root_val = pkg.commit()
    db.buf[4:8] = struct.pack('<I', root_val)

    uid = hashlib.sha256(bytes(db.buf)).digest()[:20]
    db.buf[hash_off:hash_off + 20] = uid

    # assemble container
    body = bytearray()
    body += struct.pack('<II', ADB_FORMAT_MAGIC, ADB_SCHEMA_PACKAGE)

    def block(btype, payload):
        rawsize = 4 + len(payload)
        hdr = struct.pack('<I', (btype << 30) | rawsize)
        pad = (-rawsize) % 8
        return hdr + payload + b'\x00' * pad

    body += block(0, bytes(db.buf))
    for path_idx, file_idx, content in data_blocks:
        hdr = struct.pack('<II', path_idx, file_idx)
        body += block(2, hdr + content)

    # apk mkpkg's default is raw deflate at level 0 (stored blocks); match it.
    comp = zlib.compressobj(0, zlib.DEFLATED, -15)
    payload = comp.compress(bytes(body)) + comp.flush()
    with open(out, 'wb') as fh:
        fh.write(b'ADBd' + payload)


def split_depends(s):
    out = []
    for tok in s.replace(',', ' ').split():
        tok = tok.strip()
        if tok:
            out.append(tok)
    return out


def main():
    ap = argparse.ArgumentParser(description='build an apk-tools v3 (ADB) package')
    ap.add_argument('--name', required=True)
    ap.add_argument('--version', required=True)
    ap.add_argument('--arch', default='noarch')
    ap.add_argument('--origin', default='')
    ap.add_argument('--url', default='')
    ap.add_argument('--license', dest='license_', default='')
    ap.add_argument('--maintainer', default='')
    ap.add_argument('--desc', dest='description', default='')
    ap.add_argument('--depends', default='')
    ap.add_argument('--files', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    build_package(args.name, args.version, args.arch, args.origin, args.url,
                  args.license_, args.maintainer, args.description,
                  split_depends(args.depends), args.files, args.out)


if __name__ == '__main__':
    main()
