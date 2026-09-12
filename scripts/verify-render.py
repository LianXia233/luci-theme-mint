"""mint - on-router render verification.

Logs in through the ubus session API, then fetches the real rendered
LuCI pages and asserts that the theme templates, the modular CSS and the
wallpaper payload all survive a live request. Runs on the router via SSH
so no browser and no local network route are needed.
"""
import importlib.util
import json
import os
import sys

import paramiko

# router-deploy.py has a hyphen in its name, so it cannot be imported the
# normal way - load it by path instead of duplicating the connection code.
_rd = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'router-deploy.py')
_spec = importlib.util.spec_from_file_location('router_deploy', _rd)
_rdmod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_rdmod)
connect = _rdmod.connect
run = _rdmod.run
USER = _rdmod.USER
PASSWORD = _rdmod.PASSWORD

CHECK_PAGES = [
    ('登录页', '/cgi-bin/luci/'),
    ('概览', '/cgi-bin/luci/admin/status/overview'),
    ('网络-接口', '/cgi-bin/luci/admin/network/network'),
    ('无线', '/cgi-bin/luci/admin/network/wireless'),
    ('防火墙', '/cgi-bin/luci/admin/network/firewall'),
    ('系统', '/cgi-bin/luci/admin/system/system'),
    ('管理权', '/cgi-bin/luci/admin/system/admin'),
    ('软件包', '/cgi-bin/luci/admin/system/opkg'),
    ('启动项', '/cgi-bin/luci/admin/system/startup'),
    ('实时图表', '/cgi-bin/luci/admin/status/realtime'),
    ('NFTables', '/cgi-bin/luci/admin/status/nftables'),
    ('壁纸设置', '/cgi-bin/luci/admin/system/mint-wallpaper/settings'),
]

# Strings that must appear in a healthy themed page.
MUST_HAVE = [
    'cascade.css',
    'mz-sidebar',
    'mainmenu',
]
# Strings that indicate a broken template / backend call.
MUST_NOT = [
    'ucode:',
    'Syntax error',
    'Failed to render',
    'Attempt to index',
]


def login(c):
    """Log in the way a browser does: POST the sysauth form to LuCI and
    keep the cookie jar. uhttpd owns the session, so a bare ubus
    session id is not accepted as a cookie by every build."""
    rc, out, err = run(c,
        'rm -f /tmp/mz-cookie.txt; '
        'curl -s -c /tmp/mz-cookie.txt -o /tmp/mz-login.html '
        '-w "%%{http_code}" --max-time 20 '
        '-d "luci_username=%s&luci_password=%s" '
        'http://127.0.0.1/cgi-bin/luci/' % (USER, PASSWORD))
    code = out.strip().splitlines()[-1] if out.strip() else '?'
    rc2, jar, err2 = run(c, 'grep -c sysauth /tmp/mz-cookie.txt 2>/dev/null || echo 0')
    if '0' == jar.strip():
        raise RuntimeError('login did not yield a sysauth cookie '
                           '(HTTP %s)' % code)
    return code


def fetch(c, sid, path):
    cmd = ('curl -s -L -o /tmp/mz-page.html -w "%%{http_code}" --max-time 20 '
           '-b /tmp/mz-cookie.txt "http://127.0.0.1%s"' % path)
    rc, out, err = run(c, cmd)
    code = out.strip().splitlines()[-1] if out.strip() else '?'
    return code


def inspect(c):
    cmd = r"""python3 - <<'PY'
import io, sys
s = io.open('/tmp/mz-page.html', encoding='utf-8', errors='replace').read()
must = ['cascade.css', 'mz-sidebar', 'mainmenu']
bad  = ['ucode:', 'Syntax error', 'Failed to render', 'Attempt to index']
print('LEN', len(s))
for m in must:
    print(('HAVE  ' if m in s else 'MISS  ') + m)
for b in bad:
    print(('BAD!  ' if b in s else 'clean ') + b)
for k in ['mintWallpaper', 'data-theme', 'mz-has-wallpaper', 'mz-menu-icon', 'css/tokens.css']:
    print(('HAVE  ' if k in s else '----  ') + k)
PY"""
    rc, out, err = run(c, cmd)
    return out


def main():
    c = connect()
    try:
        code = login(c)
        print('login ok (HTTP %s)\n' % code)
        failures = []
        for label, path in CHECK_PAGES:
            code = fetch(c, None, path)
            if code != '200':
                failures.append('%s %s -> HTTP %s' % (label, path, code))
                print('%-12s %-50s HTTP %s  <-- FAIL' % (label, path, code))
                continue
            info = inspect(c)
            bad = [l for l in info.splitlines() if l.startswith('BAD!') or l.startswith('MISS')]
            status = 'FAIL' if bad else 'ok'
            if bad:
                failures.append('%s: %s' % (label, '; '.join(bad)))
            print('%-12s %-50s HTTP %s  %s' % (label, path, code, status))
            if bad:
                for b in bad:
                    print('      ', b)
        print()
        if failures:
            print('FAILURES (%d):' % len(failures))
            for f in failures:
                print('  ', f)
            return 1
        print('ALL PAGES OK')
        return 0
    finally:
        c.close()


if __name__ == '__main__':
    sys.exit(main())
