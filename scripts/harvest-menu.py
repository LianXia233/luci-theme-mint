"""Harvest the FULL LuCI menu tree from the live router.

Reads every /usr/share/luci/menu.d/*.json on the device, merges them and
emits the complete list of navigable admin pages (URL, title, source
package) as JSON. Third-party plugins are discovered dynamically - the
list is never hard-coded.
"""
import json
import os
import sys

import importlib.util

_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'router-deploy.py')
_spec = importlib.util.spec_from_file_location('rd', _p)
rd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rd)

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'scripts', 'menu-tree.json')


def main():
    c = rd.connect()
    try:
        rc, out, err = rd.run(c,
            'cd /usr/share/luci/menu.d 2>/dev/null && '
            'for f in *.json; do echo "===FILE=== $f"; cat "$f"; echo; done',
            timeout=60)
    finally:
        c.close()

    if rc != 0:
        print('failed to read menu.d:', err[:300])
        sys.exit(1)

    tree = {}
    cur = None
    buf = []
    for line in out.splitlines():
        if line.startswith('===FILE==='):
            if cur and buf:
                try:
                    tree[cur] = json.loads('\n'.join(buf))
                except Exception as e:
                    print('skip malformed', cur, e)
            cur = line.split(' ', 1)[1].strip()
            buf = []
        else:
            buf.append(line)
    if cur and buf:
        try:
            tree[cur] = json.loads('\n'.join(buf))
        except Exception as e:
            print('skip malformed', cur, e)

    pages = []
    for fname, entries in sorted(tree.items()):
        pkg = fname.replace('.json', '')
        for path, meta in entries.items():
            if not path.startswith('admin/'):
                continue
            action = meta.get('action') or {}
            pages.append({
                'path': path,
                'url': '/cgi-bin/luci/' + path,
                'title': meta.get('title') or path,
                'type': action.get('type') or '',
                'pkg': pkg,
            })

    pages.sort(key=lambda p: p['path'])
    with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(pages, fh, ensure_ascii=False, indent=1)
    print('discovered %d admin pages from %d menu files -> %s'
          % (len(pages), len(tree), OUT))
    for p in pages:
        print('  %-55s %-12s %s' % (p['path'], p['type'], p['title']))


if __name__ == '__main__':
    main()
