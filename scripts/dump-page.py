"""Dump a rendered LuCI page from the router for manual inspection."""
import os
import re
import sys

import paramiko

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'router-deploy.py')
_spec = importlib.util.spec_from_file_location('rd', _p)
_rd = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_rd)

PAGE = sys.argv[1] if len(sys.argv) > 1 else '/cgi-bin/luci/admin/status/overview'

c = _rd.connect()
try:
    _rd.run(c, 'rm -f /tmp/mz-cookie.txt; curl -s -c /tmp/mz-cookie.txt '
               '-o /dev/null --max-time 20 -d "luci_username=%s&luci_password=%s" '
               'http://127.0.0.1/cgi-bin/luci/' % (_rd.USER, _rd.PASSWORD))
    rc, out, err = _rd.run(c, 'curl -s -L --max-time 20 -b /tmp/mz-cookie.txt '
                              '"http://127.0.0.1%s"' % PAGE)
    html = out
    open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      '..', 'render-dump.html'), 'w',
         encoding='utf-8', newline='\n').write(html)
    print('len', len(html))
    for k in ['cascade.css', 'mz-sidebar', 'mainmenu', 'mintWallpaper',
              'mzWpUtil', 'bumpVersion', 'data-theme', 'mz-has-wallpaper',
              'mz-menu-icon', 'mz-view', 'css/tokens.css', 'mz-footer-brand']:
        print(('HAVE ' if k in html else 'MISS '), k)
    m = re.search(r'--mz-wallpaper[^;]{0,120}', html)
    print('wallpaper var:', m.group(0)[:160] if m else '(none)')
    m = re.search(r'<html[^>]*>', html)
    print('html tag:', m.group(0) if m else '(none)')
    # Chinese UI check
    zh = re.findall(r'[\u4e00-\u9fff]{2,}', html)
    print('chinese fragments:', len(set(zh)), sorted(set(zh))[:25])
    eng = re.findall(r'>(Powered by|Wallpaper|Settings|Upload|Delete|Refresh)<', html)
    print('raw english UI nodes:', eng)
finally:
    c.close()
