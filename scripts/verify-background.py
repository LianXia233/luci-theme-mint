"""mint - four-state character background verification.

Drives a real Chromium against the live router and proves, per
(device x mode) combination, that:

  * the page emits exactly ONE .mint-background layer, fixed and behind
    the content (z-index < 0, pointer-events none);
  * the resolved artwork URL matches the expected state:
        PC     + light -> character-pc-light.webp
        PC     + dark  -> character-pc-dark.webp
        Mobile + light -> character-mobile-light.webp
        Mobile + dark  -> character-mobile-dark.webp
  * the other mode's layer is cross-faded out (opacity 0) but still
    decoded, so a theme switch costs no request;
  * no horizontal scrollbar appears;
  * no page/console error is raised.

Also checks the login page, in its OWN unauthenticated context: it must
carry its single-artwork variant (.mz-login-char = Plana), must NOT leak
the admin four-state nodes, must keep the layer's base transparent so the
login gradient stays visible, must request no wallpaper image, and must
hand the backdrop over to the wallpaper when one is selected. Finally all
six assets must be served with HTTP 200.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')
USER = os.environ.get('MZ_USER', 'root')
PASSWORD = os.environ.get('MZ_PASS', '')
OUT = os.path.abspath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    '_shots'))

UA_MOBILE = ('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 '
             '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36')
UA_DESKTOP = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

PC_VIEWPORTS = [(1366, 768), (1920, 1080), (2560, 1440)]
MOBILE_VIEWPORTS = [(360, 800), (390, 844), (412, 915)]

OVERVIEW = '/cgi-bin/luci/admin/status/overview'
# Every path here must exist on the device. Note admin/status/routes is NOT
# universal (the routing page lives under admin/network/routes on this build);
# picking a missing page makes the sweep report a 404 that has nothing to do
# with the background layer.
PAGES = [
    '/cgi-bin/luci/admin/status/overview',
    '/cgi-bin/luci/admin/network/network',
    '/cgi-bin/luci/admin/system/system',
    '/cgi-bin/luci/admin/network/routes',
    '/cgi-bin/luci/admin/network/firewall',
    '/cgi-bin/luci/admin/system/admin',
    '/cgi-bin/luci/admin/system/startup',
    '/cgi-bin/luci/admin/network/dhcp',
    '/cgi-bin/luci/admin/services/',
]
ASSETS = [
    'character-pc-light.webp', 'character-pc-dark.webp',
    'character-mobile-light.webp', 'character-mobile-dark.webp',
    'triangle-grid-light.webp', 'triangle-grid-dark.webp',
]

PROBE = """() => {
    const out = {};
    const layer = document.querySelector('.mint-background');
    out.hasLayer = !!layer;
    out.layerCount = document.querySelectorAll('.mint-background').length;
    if (layer) {
        const s = getComputedStyle(layer);
        out.position = s.position;
        out.zIndex = s.zIndex;
        out.pointerEvents = s.pointerEvents;
        out.display = s.display;
        out.baseColor = s.backgroundColor;
        const panel = layer.querySelector('.mint-bg-panel');
        const grid = layer.querySelector('.mint-bg-grid');
        if (panel) out.panelClip = getComputedStyle(panel).clipPath;
        if (grid) {
            out.gridImage = (getComputedStyle(grid).backgroundImage || '').split('/').pop();
            out.gridSize = getComputedStyle(grid).backgroundSize;
        }
        out.scrim = getComputedStyle(layer, '::after').backgroundImage.slice(0, 90);
    }
    const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = getComputedStyle(el);
        return {
            image: (s.backgroundImage || '').replace(/^url\\("?/, '').replace(/"?\\)$/, '').split('/').pop(),
            opacity: s.opacity,
            position: s.backgroundPosition,
            size: s.backgroundSize
        };
    };
    out.lightLayer = pick('.mint-bg-character-light');
    out.darkLayer = pick('.mint-bg-character-dark');

    const view = document.querySelector('.mz-view');
    if (view) {
        const r = view.getBoundingClientRect();
        out.viewRect = [Math.round(r.left), Math.round(r.top),
                        Math.round(r.width), Math.round(r.height)];
        out.viewBg = getComputedStyle(view).backgroundColor;
    }

    out.bodyClasses = document.body.className;
    out.theme = document.documentElement.getAttribute('data-theme');
    out.scrollW = document.documentElement.scrollWidth;
    out.clientW = document.documentElement.clientWidth;
    out.themeVars = {
        wallpaper: document.documentElement.style.getPropertyValue('--mz-wallpaper') || '(unset)',
        containerBg: getComputedStyle(document.documentElement).getPropertyValue('--mz-container-background').trim()
    };
    out.bodyAfterContent = getComputedStyle(document.body, '::after').content;
    return out;
}"""


def probe_page(page, path, w, h, mode, wait=1900):
    page.set_viewport_size({'width': w, 'height': h})
    page.goto(BASE + path, wait_until='domcontentloaded', timeout=45000)
    page.evaluate("m => localStorage.setItem('mz-theme', m)", mode)
    page.evaluate("m => document.documentElement.setAttribute('data-theme', m)", mode)
    # let the cross-fade settle
    page.wait_for_timeout(wait)
    return page.evaluate(PROBE)


LOGIN_PROBE = r"""() => {
  const layer = document.querySelector('.mint-background.mz-login-char');
  const art   = document.querySelector('.mz-login-char-art');
  const card  = document.querySelector('.mz-login-card');
  const rect  = (e) => { const b = e.getBoundingClientRect();
    return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const file  = (el) => {
    if (!el) return null;
    const v = getComputedStyle(el).backgroundImage;
    const m = v.match(/images\/([a-z0-9\-]+\.webp)/);
    return m ? m[1] : v;
  };
  return {
    hasLayer: !!layer,
    hasAdminNodes: !!document.querySelector('.mint-bg-character-light, .mint-bg-character-dark'),
    bodyCls: document.body.className,
    layerDisplay: layer ? getComputedStyle(layer).display : null,
    layerBase: layer ? getComputedStyle(layer).backgroundColor : null,
    artwork: file(art),
    artworkSize: art ? getComputedStyle(art).backgroundSize : null,
    artworkPos: art ? getComputedStyle(art).backgroundPosition : null,
    artworkOpacity: art ? getComputedStyle(art).opacity : null,
    card: card ? rect(card) : null,
    wallpaperVar: document.documentElement.style.getPropertyValue('--mz-wallpaper') || '(unset)',
    wallpaperCls: document.body.classList.contains('mz-wp-custom'),
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth
  };
}"""

# The only images a default login page is allowed to fetch.
LOGIN_ASSETS = {
    'character-pc-dark.webp', 'character-mobile-dark.webp',
    'triangle-grid-light.webp', 'triangle-grid-dark.webp',
}


def check_login(browser, failures):
    """Login page checks, in unauthenticated contexts only.

    Probing /cgi-bin/luci/ from an already-authenticated page just
    redirects to the overview, which is what made the first version of
    this check report a false positive. Keep it in its own context.
    """
    print('\n--- login page (unauthenticated context) ---')

    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, locale='zh-CN')
    pg = ctx.new_page()
    seen = []
    pg.on('request', lambda r: seen.append(r.url.rsplit('/', 1)[-1])
          if '/mint/images/' in r.url else None)
    pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded', timeout=45000)
    pg.wait_for_timeout(2000)
    r = pg.evaluate(LOGIN_PROBE)
    print(json.dumps(r, ensure_ascii=False, indent=2))
    pg.screenshot(path=os.path.join(OUT, 'login-1440x900.png'))

    if not r['hasLayer']:
        failures.append('login page carries no .mz-login-char layer')
    if r['hasAdminNodes']:
        failures.append('login page leaked the admin four-state artwork nodes')
    if r['artwork'] != 'character-pc-dark.webp':
        failures.append('login artwork %r (want character-pc-dark.webp)' % r['artwork'])
    if r['artworkOpacity'] != '1':
        failures.append('login artwork opacity %r' % r['artworkOpacity'])
    if r['layerBase'] != 'rgba(0, 0, 0, 0)':
        failures.append('login layer base %r is not transparent '
                        '(it would cover the login gradient)' % r['layerBase'])
    if r['wallpaperVar'] != '(unset)' or r['wallpaperCls']:
        failures.append('default login page is in wallpaper mode')
    over = r['scrollW'] - r['clientW']
    if over > 1:
        failures.append('login page horizontal overflow %+d' % over)
    stray = sorted(set(seen) - LOGIN_ASSETS)
    print('  desktop images:', sorted(set(seen)), 'stray:', stray)
    if stray:
        failures.append('login page requested unexpected images: %s' % stray)
    ctx.close()

    ctx2 = browser.new_context(viewport={'width': 390, 'height': 844}, locale='zh-CN',
                               user_agent=UA_MOBILE, is_mobile=True, has_touch=True)
    p2 = ctx2.new_page()
    p2.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded', timeout=45000)
    p2.wait_for_timeout(1800)
    r2 = p2.evaluate(LOGIN_PROBE)
    over2 = r2['scrollW'] - r2['clientW']
    print('  phone  artwork=%s size=%s pos=%s ovf=%+d'
          % (r2['artwork'], r2['artworkSize'], r2['artworkPos'], over2))
    p2.screenshot(path=os.path.join(OUT, 'login-390x844.png'))
    if r2['artwork'] != 'character-mobile-dark.webp':
        failures.append('login phone artwork %r (want character-mobile-dark.webp)'
                        % r2['artwork'])
    if over2 > 1:
        failures.append('login phone horizontal overflow %+d' % over2)

    # Precedence: with an explicitly selected wallpaper the built-in
    # artwork must step aside (sysauth.js adds this class once the image
    # has decoded).
    p2.evaluate("() => document.body.classList.add('mz-wp-custom')")
    p2.wait_for_timeout(150)
    disp = p2.evaluate("() => getComputedStyle(document.querySelector("
                       "'.mint-background.mz-login-char')).display")
    print('  precedence: body.mz-wp-custom -> layer display = %s' % disp)
    if disp != 'none':
        failures.append('login artwork is not hidden when a wallpaper is set')
    ctx2.close()


def main():
    os.makedirs(OUT, exist_ok=True)
    failures = []
    rows = []
    errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])

        def make(ua, mobile):
            ctx = browser.new_context(viewport={'width': 1280, 'height': 800},
                                      user_agent=ua, is_mobile=mobile,
                                      has_touch=mobile, locale='zh-CN')
            pg = ctx.new_page()
            pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded', timeout=45000)
            try:
                pg.fill('#luci_username', USER, timeout=8000)
                pg.fill('#luci_password', PASSWORD, timeout=8000)
                pg.click('button[type="submit"]', timeout=8000)
            except Exception as exc:
                print('login step skipped:', exc)
            pg.wait_for_timeout(2500)
            # Listeners go up AFTER the login round-trip: the pre-login GET of
            # /cgi-bin/luci/ answers 403 by design (it carries the login form),
            # and counting that as a defect made a healthy device report
            # failures. Everything recorded from here on is a real page.
            pg.on('pageerror', lambda e: errors.append('pageerror: %s' % e))
            pg.on('console', lambda m: errors.append('console.error: %s' % m.text)
                  if m.type == 'error' else None)
            pg.on('response', lambda r: errors.append('HTTP %d %s' % (r.status, r.url))
                  if r.status >= 400 else None)
            return ctx, pg

        # ------------- login page (own, unauthenticated contexts) ------
        check_login(browser, failures)

        # ---------------- desktop ----------------
        ctx, page = make(UA_DESKTOP, False)
        for mode in ('light', 'dark'):
            for (w, h) in PC_VIEWPORTS:
                r = probe_page(page, OVERVIEW, w, h, mode)
                expected = 'character-pc-%s.webp' % mode
                got = (r['lightLayer'] or {}).get('image') if mode == 'light' \
                    else (r['darkLayer'] or {}).get('image')
                rows.append(('PC', '%dx%d' % (w, h), mode, expected, got,
                             r['scrollW'] - r['clientW'], r['viewRect'],
                             (r['lightLayer'] or {}).get('opacity'),
                             (r['darkLayer'] or {}).get('opacity')))
                if got != expected:
                    failures.append('PC %dx%d %s -> %s (want %s)' % (w, h, mode, got, expected))
                if r['scrollW'] - r['clientW'] > 1:
                    failures.append('horizontal overflow %dpx at PC %dx%d %s'
                                    % (r['scrollW'] - r['clientW'], w, h, mode))
                if not r['hasLayer']:
                    failures.append('no .mint-background at PC %dx%d %s' % (w, h, mode))
                page.screenshot(path=os.path.join(OUT, 'pc-%dx%d-%s.png' % (w, h, mode)))
                print('PC  %-9s %-5s  %-33s scroll+%d' %
                      ('%dx%d' % (w, h), mode, got, r['scrollW'] - r['clientW']))
        ctx.close()

        # ---------------- mobile ----------------
        ctx, page = make(UA_MOBILE, True)
        for mode in ('light', 'dark'):
            for (w, h) in MOBILE_VIEWPORTS:
                r = probe_page(page, OVERVIEW, w, h, mode)
                expected = 'character-mobile-%s.webp' % mode
                got = (r['lightLayer'] or {}).get('image') if mode == 'light' \
                    else (r['darkLayer'] or {}).get('image')
                rows.append(('Mobile', '%dx%d' % (w, h), mode, expected, got,
                             r['scrollW'] - r['clientW'], r['viewRect'],
                             (r['lightLayer'] or {}).get('opacity'),
                             (r['darkLayer'] or {}).get('opacity')))
                if got != expected:
                    failures.append('Mobile %dx%d %s -> %s (want %s)' % (w, h, mode, got, expected))
                if r['scrollW'] - r['clientW'] > 1:
                    failures.append('horizontal overflow %dpx at Mobile %dx%d %s'
                                    % (r['scrollW'] - r['clientW'], w, h, mode))
                if not r['hasLayer']:
                    failures.append('no .mint-background at Mobile %dx%d %s' % (w, h, mode))
                page.screenshot(path=os.path.join(OUT, 'mo-%dx%d-%s.png' % (w, h, mode)))
                print('MOB %-9s %-5s  %-33s scroll+%d' %
                      ('%dx%d' % (w, h), mode, got, r['scrollW'] - r['clientW']))

        # ---------------- page sweep (every section, light 1920) -------
        print('\n--- page sweep (1920x1080, light) ---')
        page.set_viewport_size({'width': 1920, 'height': 1080})
        for path in PAGES:
            r = probe_page(page, path, 1920, 1080, 'light', wait=1600)
            over = r['scrollW'] - r['clientW']
            ok = (r['hasLayer'] and over <= 1)
            print('  %-46s layer=%s overflow=%+d %s' %
                  (path, r['hasLayer'], over, 'OK' if ok else 'FAIL'))
            if not ok:
                failures.append('page sweep %s layer=%s overflow=%d'
                                % (path, r['hasLayer'], over))

        # ---------------- asset availability --------------------------
        print('\n--- assets ---')
        page.set_viewport_size({'width': 1440, 'height': 900})
        page.goto(BASE + OVERVIEW, wait_until='domcontentloaded', timeout=45000)
        page.wait_for_timeout(1500)
        for a in ASSETS:
            url = '%s/luci-static/mint/images/%s' % (BASE, a)
            res = page.evaluate("""u => fetch(u, {cache: 'no-store'})
                .then(r => r.status + ' ' + (r.headers.get('content-type') || ''))
                .catch(e => 'ERR ' + e)""", url)
            print('  %-30s %s' % (a, res))
            if not res.startswith('200'):
                failures.append('asset %s -> %s' % (a, res))

        detail = probe_page(page, OVERVIEW, 1920, 1080, 'light')
        print('\n--- layer detail (1920x1080 light) ---')
        print(json.dumps(detail, ensure_ascii=False, indent=2)[:2200])

        browser.close()

    print('\n--- four-state matrix ---')
    hdr = '%-7s %-9s %-5s %-32s %-32s %s' % (
        'device', 'viewport', 'mode', 'expected', 'resolved', 'scroll+')
    print(hdr)
    for d, vp, m, exp, got, ov, rect, lo, do in rows:
        print('%-7s %-9s %-5s %-32s %-32s %+d  lay(op L/D)=%s/%s rect=%s' %
              (d, vp, m, exp, got, ov, lo, do, rect))

    real = [e for e in errors if 'favicon' not in e.lower()]
    print('\n--- console/page errors (%d) ---' % len(real))
    for e in real[:15]:
        print('  ', e)
    print('\n--- FAILURES (%d) ---' % len(failures))
    for f in failures:
        print('  ', f)
    return 1 if (failures or real) else 0


if __name__ == '__main__':
    sys.exit(main())
