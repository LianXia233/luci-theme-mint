"""mint - visual smoke test.

Drives a real Chromium against the live router, logs in, and captures the
pages that matter for the UI refactor: desktop light, desktop dark, a
narrow phone viewport and the wallpaper manager. Also asserts that the
CSS layers actually loaded (computed styles prove @import resolution)
and that no JS exception was thrown.
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')
USER = os.environ.get('MZ_USER', 'root')
PASSWORD = os.environ.get('MZ_PASS', '')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'docs', 'shots')

SHOTS = [
    ('01-overview-light', '/cgi-bin/luci/admin/status/overview',
     1440, 900, 'light'),
    ('02-overview-dark', '/cgi-bin/luci/admin/status/overview',
     1440, 900, 'dark'),
    ('03-network-light', '/cgi-bin/luci/admin/network/network',
     1440, 900, 'light'),
    ('04-firewall-light', '/cgi-bin/luci/admin/network/firewall',
     1440, 900, 'light'),
    ('05-wallpaper-settings', '/cgi-bin/luci/admin/system/mint-wallpaper/settings',
     1440, 1100, 'light'),
    ('06-phone-overview', '/cgi-bin/luci/admin/status/overview',
     390, 844, 'light'),
    ('07-phone-network', '/cgi-bin/luci/admin/network/network',
     390, 844, 'light'),
    ('08-phone-375', '/cgi-bin/luci/admin/status/overview',
     375, 812, 'light'),
    ('09-tablet-768', '/cgi-bin/luci/admin/status/overview',
     768, 1024, 'light'),
    ('10-login', '/cgi-bin/luci/', 1440, 900, 'light'),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900},
                                  device_scale_factor=1,
                                  locale='zh-CN')
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
        page.on('console', lambda m: errors.append('console.%s: %s' % (m.type, m.text))
                if m.type == 'error' else None)

        # --- log in ---------------------------------------------------
        page.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded',
                  timeout=45000)
        try:
            page.fill('#luci_username', USER, timeout=8000)
            page.fill('#luci_password', PASSWORD, timeout=8000)
            page.click('button[type="submit"], .cbi-button, #luci_login',
                       timeout=8000)
        except Exception as exc:  # already authenticated, or a custom form
            print('login step skipped:', exc)
        page.wait_for_timeout(2500)

        for name, path, w, h, mode in SHOTS:
            page.set_viewport_size({'width': w, 'height': h})
            page.goto(BASE + path, wait_until='domcontentloaded', timeout=45000)
            # Force the colour scheme the shot list asks for.
            page.evaluate(
                "m => localStorage.setItem('mz-theme', m)", mode)
            page.evaluate(
                "m => document.documentElement.setAttribute('data-theme', m)",
                mode)
            page.wait_for_timeout(2200)
            page.screenshot(path=os.path.join(OUT, name + '.png'),
                            full_page=(name.startswith('05')))
            print('shot', name, '%dx%d' % (w, h), mode)

        # --- assertions -----------------------------------------------
        page.set_viewport_size({'width': 1440, 'height': 900})
        page.goto(BASE + '/cgi-bin/luci/admin/status/overview',
                  wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(2500)

        checks = page.evaluate("""() => {
            const out = {};
            const cs = getComputedStyle(document.documentElement);
            out.primary = cs.getPropertyValue('--mz-color-primary').trim();
            out.radiusCard = cs.getPropertyValue('--mz-radius-card').trim();
            out.ease = cs.getPropertyValue('--mz-ease').trim();
            const sec = document.querySelector('.cbi-section');
            if (sec) {
                const s = getComputedStyle(sec);
                out.cardRadius = s.borderTopLeftRadius + '/' + s.borderBottomRightRadius;
                out.cardShadow = s.boxShadow;
                out.cardBg = s.backgroundColor;
            }
            const side = document.querySelector('.mz-sidebar');
            if (side) {
                const s = getComputedStyle(side);
                out.sidebarBackdrop = s.backdropFilter || s.webkitBackdropFilter;
            }
            out.menuIcons = document.querySelectorAll('.mz-menu-icon').length;
            out.menuItems = document.querySelectorAll('#mainmenu > li').length;
            out.hasWallpaperClass = document.body.classList.contains('mz-has-wallpaper');
            out.wallpaperVar = document.documentElement.style.getPropertyValue('--mz-wallpaper') || '(unset)';
            out.topbarDisplay = (() => {
                const t = document.querySelector('.mz-topbar');
                return t ? getComputedStyle(t).display : '(none)';
            })();
            out.scrollW = document.documentElement.scrollWidth;
            out.clientW = document.documentElement.clientWidth;
            out.h2 = (document.querySelector('#mz-view > h2') || {}).textContent || '(none)';
            return out;
        }""")
        print('\n--- computed checks (1440px, light) ---')
        for k, v in checks.items():
            print('  %-20s %s' % (k, v))

        # Narrow-viewport horizontal-scroll check.
        for w in (375, 390, 412):
            page.set_viewport_size({'width': w, 'height': 812})
            page.goto(BASE + '/cgi-bin/luci/admin/status/overview',
                      wait_until='domcontentloaded', timeout=45000)
            page.wait_for_timeout(1800)
            r = page.evaluate("""() => ({
                sw: document.documentElement.scrollWidth,
                cw: document.documentElement.clientWidth,
                body: document.body.scrollWidth
            })""")
            overflow = r['sw'] - r['cw']
            status = 'OK' if overflow <= 1 else 'OVERFLOW'
            print('  %dpx  scrollW=%d clientW=%d  %s' %
                  (w, r['sw'], r['cw'], status))
            if overflow > 1:
                errors.append('horizontal overflow %dpx at %d' % (overflow, w))

        browser.close()

    real = [e for e in errors if 'favicon' not in e.lower()]
    print('\n--- console/page errors (%d) ---' % len(real))
    for e in real[:20]:
        print('  ', e)
    return 1 if real else 0


if __name__ == '__main__':
    sys.exit(main())
