"""mint - router probe / deploy (paramiko over SSH).

Usage:
  python scripts/router-deploy.py probe
  python scripts/router-deploy.py deploy
"""
import io
import os
import sys
import time

import paramiko

HOST = os.environ.get('MZ_HOST', '')
USER = 'root'
PASSWORD = os.environ.get('MZ_PASS', '')
PORT = 22

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_HTDOCS = os.path.join(REPO, 'theme', 'htdocs', 'luci-static')
WP_JS = os.path.join(REPO, 'wallpaper', 'htdocs', 'luci-static',
                     'resources', 'view', 'mint', 'wallpaper.js')

# local path -> remote path
FILES = [
    (os.path.join(THEME_HTDOCS, 'mint', 'cascade.css'),
     '/www/luci-static/mint/cascade.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'mz-ui.js'),
     '/www/luci-static/mint/mz-ui.js'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'compat.css'),
     '/www/luci-static/mint/css/compat.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'tokens.css'),
     '/www/luci-static/mint/css/tokens.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'base.css'),
     '/www/luci-static/mint/css/base.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'layout.css'),
     '/www/luci-static/mint/css/layout.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'navigation.css'),
     '/www/luci-static/mint/css/navigation.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'container.css'),
     '/www/luci-static/mint/css/container.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'overview-dashboard.css'),
     '/www/luci-static/mint/overview-dashboard.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'components.css'),
     '/www/luci-static/mint/css/components.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'wallpaper.css'),
     '/www/luci-static/mint/css/wallpaper.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'background.css'),
     '/www/luci-static/mint/css/background.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'dark.css'),
     '/www/luci-static/mint/css/dark.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'animations.css'),
     '/www/luci-static/mint/css/animations.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'responsive.css'),
     '/www/luci-static/mint/css/responsive.css'),
    (os.path.join(THEME_HTDOCS, 'mint', 'css', 'login.css'),
     '/www/luci-static/mint/css/login.css'),
    # Built-in character backdrop: four states (device x mode) plus the two
    # decorative grid patterns.
    (os.path.join(THEME_HTDOCS, 'mint', 'images', 'character-pc-light.webp'),
     '/www/luci-static/mint/images/character-pc-light.webp'),
    (os.path.join(THEME_HTDOCS, 'mint', 'images', 'character-pc-dark.webp'),
     '/www/luci-static/mint/images/character-pc-dark.webp'),
    (os.path.join(THEME_HTDOCS, 'mint', 'images', 'character-mobile-light.webp'),
     '/www/luci-static/mint/images/character-mobile-light.webp'),
    (os.path.join(THEME_HTDOCS, 'mint', 'images', 'character-mobile-dark.webp'),
     '/www/luci-static/mint/images/character-mobile-dark.webp'),
    (os.path.join(THEME_HTDOCS, 'mint', 'images', 'triangle-grid-light.webp'),
     '/www/luci-static/mint/images/triangle-grid-light.webp'),
    (os.path.join(THEME_HTDOCS, 'mint', 'images', 'triangle-grid-dark.webp'),
     '/www/luci-static/mint/images/triangle-grid-dark.webp'),
    (os.path.join(THEME_HTDOCS, 'resources', 'menu-mint.js'),
     '/www/luci-static/resources/menu-mint.js'),
    (os.path.join(THEME_HTDOCS, 'resources', 'view', 'mint', 'sysauth.js'),
     '/www/luci-static/resources/view/mint/sysauth.js'),
    (os.path.join(REPO, 'theme', 'ucode', 'template', 'themes', 'mint', 'header.ut'),
     '/usr/share/ucode/luci/template/themes/mint/header.ut'),
    (os.path.join(REPO, 'theme', 'ucode', 'template', 'themes', 'mint', 'footer.ut'),
     '/usr/share/ucode/luci/template/themes/mint/footer.ut'),
    (os.path.join(REPO, 'theme', 'ucode', 'template', 'themes', 'mint', 'sysauth.ut'),
     '/usr/share/ucode/luci/template/themes/mint/sysauth.ut'),
    (WP_JS,
     '/www/luci-static/resources/view/mint/wallpaper.js'),
]

PAGES = [
    '/cgi-bin/luci/',
    '/cgi-bin/luci/admin/status/overview',
    '/cgi-bin/luci/admin/network/network',
    '/cgi-bin/luci/admin/system/system',
]


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, password=PASSWORD,
              timeout=20, allow_agent=False, look_for_keys=False)
    return c


def run(c, cmd, timeout=60):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def mkdir_p(sftp, path):
    parts = [p for p in path.split('/') if p]
    cur = ''
    for p in parts:
        cur += '/' + p
        try:
            sftp.stat(cur)
        except IOError:
            sftp.mkdir(cur)


def probe():
    c = connect()
    try:
        rc, out, err = run(c, 'ls -la /www/luci-static/mint/ | head -30; '
                              'echo "---"; '
                              'uci -q get luci.main.mediaurlbase; '
                              'echo "---"; '
                              'ls /usr/share/ucode/luci/template/themes/mint/ 2>/dev/null; '
                              'echo "---"; '
                              'cat /etc/openwrt_release 2>/dev/null | head -5')
        print('rc=%d' % rc)
        print(out)
        if err.strip():
            print('STDERR:', err)
    finally:
        c.close()


def deploy():
    c = connect()
    try:
        # Back up whatever is on the device first so a bad push is one
        # `cp` away from being undone.
        stamp = time.strftime('%Y%m%d-%H%M%S')
        rc, out, err = run(c,
            'mkdir -p /tmp/mint-bak-%s && '
            'cp -a /www/luci-static/mint/cascade.css /tmp/mint-bak-%s/ 2>/dev/null; '
            'cp -a /www/luci-static/resources/menu-mint.js /tmp/mint-bak-%s/ 2>/dev/null; '
            'cp -a /usr/share/ucode/luci/template/themes/mint/header.ut /tmp/mint-bak-%s/ 2>/dev/null; '
            'cp -a /usr/share/ucode/luci/template/themes/mint/footer.ut /tmp/mint-bak-%s/ 2>/dev/null; '
            'cp -a /usr/share/ucode/luci/template/themes/mint/sysauth.ut /tmp/mint-bak-%s/ 2>/dev/null; '
            'echo /tmp/mint-bak-%s' % (stamp, stamp, stamp, stamp, stamp, stamp, stamp))
        print('backup:', out.strip())

        sftp = c.open_sftp()
        for local, remote in FILES:
            if not os.path.isfile(local):
                print('MISSING local:', local)
                continue
            mkdir_p(sftp, os.path.dirname(remote))
            sftp.put(local, remote)
            print('uploaded ->', remote)
        sftp.close()

        # Drop the LuCI menu / module cache so the new templates are used.
        rc, out, err = run(c, 'rm -f /tmp/luci-indexcache*; '
                              'rm -rf /tmp/luci-modulecache/; '
                              'echo cleared')
        print(out.strip(), 'rc=%d' % rc)
    finally:
        c.close()


def verify():
    c = connect()
    try:
        rc, out, err = run(c, 'ls -la /www/luci-static/mint/css/')
        print('--- css dir ---')
        print(out)

        for p in PAGES:
            rc, out, err = run(c,
                'curl -s -o /dev/null -w "%%{http_code}" '
                '--max-time 15 http://127.0.0.1%s' % p)
            print('%-45s HTTP %s' % (p, out.strip()))

        # Confirm the entry sheet resolves every @import target.
        rc, out, err = run(c, 'grep -o "css/[a-z]*\\.css" '
                              '/www/luci-static/mint/cascade.css | '
                              'while read f; do '
                              '  if [ -f "/www/luci-static/mint/$f" ]; then '
                              '    echo "OK   $f"; else echo "MISS $f"; fi; '
                              'done')
        print('--- imports ---')
        print(out)
    finally:
        c.close()


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'probe'
    if mode == 'probe':
        probe()
    elif mode == 'deploy':
        deploy()
    elif mode == 'verify':
        verify()
    elif mode == 'all':
        deploy()
        verify()
    else:
        print('unknown mode', mode)
        sys.exit(2)
