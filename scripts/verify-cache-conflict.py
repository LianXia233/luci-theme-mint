"""Regression test: the cached random wallpaper must never surface on the
login page, and the theme's own JS must be cache-stamped.

Three things are asserted, all against the live router:

  1. STAMP - the login page and the admin pages request the theme's own
     class modules (menu-mint.js, view/mint/sysauth.js) with the theme's
     MINT_ASSET_REV, not with LuCI's build string. Before the fix they
     carried LuCI's version, which never changes when the theme does.

  2. STALE BUILD, LOGIN PAGE - a previous theme build used to fetch the
     cron-cached random wallpaper (/luci-static/mint/wallpaper-mobile.img)
     onto the login page. Simulate exactly that: write --mz-wallpaper and
     mark .mz-login-bg as loaded, then prove the photo layer stays out of
     the box tree and the artwork layer stays opaque on top of it.

  3. STALE BUILD, ADMIN PAGE - with ui_random=0 the server states
     data-wp-random="0" on <html>; adding mz-has-wallpaper plus
     --mz-wallpaper (what a stale menu-mint.js does) must still produce no
     wallpaper pseudo-element.

Run:  python scripts/_verify_cache_conflict.py
Env:  MZ_BASE, MZ_PASS
"""
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', 'http://192.168.88.1')
PASS = os.environ.get('MZ_PASS', '')
UA = ('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36')

# A photo URL that is guaranteed to exist on the device: the cron cache.
FAKE_WP = '/luci-static/mint/wallpaper-mobile.img'

STALE_LOGIN = """(url) => {
  /* Exactly what the pre-1.3.0 sysauth.js did on a random-mode install. */
  document.documentElement.style.setProperty('--mz-wallpaper', 'url("' + url + '")');
  const bg = document.getElementById('mz-login-bg');
  if (bg) bg.classList.add('is-loaded');
}"""

READ_LOGIN = """() => {
  const bg = document.getElementById('mz-login-bg');
  const layer = document.querySelector('.mint-background.mz-login-char');
  const art = document.querySelector('.mz-login-char-art');
  const cs = getComputedStyle;
  return {
    bgDisplay: bg ? cs(bg).display : null,
    bgOpacity: bg ? cs(bg).opacity : null,
    bgImage: bg ? cs(bg).backgroundImage.slice(0, 60) : null,
    layerDisplay: layer ? cs(layer).display : null,
    layerImage: layer ? cs(layer).backgroundImage.slice(0, 60) : null,
    layerBase: layer ? cs(layer).backgroundColor : null,
    artOpacity: art ? cs(art).opacity : null,
    artImage: art ? cs(art).backgroundImage.slice(-42) : null,
    /* body::after is the admin wallpaper pseudo-element; it must not
       exist on the login page at all. */
    bodyAfter: cs(document.body, '::after').content,
    bodyCls: document.body.className,
    ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
}"""

READ_ADMIN = """() => {
  const cs = getComputedStyle;
  return {
    wpRandom: document.documentElement.getAttribute('data-wp-random'),
    hasWallpaperCls: document.body.classList.contains('mz-has-wallpaper'),
    wpCustom: document.body.classList.contains('mz-wp-custom'),
    bodyAfterContent: cs(document.body, '::after').content,
    bodyAfterImage: cs(document.body, '::after').backgroundImage.slice(0, 60),
    bodyBeforeContent: cs(document.body, '::before').content,
    charLayer: !!document.querySelector('.mint-background'),
    ovf: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
}"""

STALE_ADMIN = """() => {
  document.documentElement.style.setProperty('--mz-wallpaper',
    'url("/luci-static/mint/wallpaper-pc.img")');
  document.body.classList.add('mz-has-wallpaper');
}"""


def main():
    fails = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox'])

        # ---------------- login page, phone ----------------
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, locale='zh-CN',
                            user_agent=UA, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        reqs = []
        pg.on('request', lambda r: reqs.append(r.url))
        pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded', timeout=45000)
        pg.wait_for_timeout(2200)

        rev = pg.evaluate("() => (document.querySelector('meta[name=mz-asset-rev]')||{}).content")
        print('theme revision (meta):', rev)
        if not rev:
            fails.append('no meta[name=mz-asset-rev] on the login page')

        own = [u for u in reqs if re.search(r'/(menu-mint|view/mint/[a-z]+)\.js', u)]
        print('theme class modules requested:')
        for u in sorted(set(own)):
            print('   ', u)
        if not own:
            fails.append('login page requested no theme class module')
        for u in own:
            if ('?v=' + str(rev)) not in u:
                fails.append('login module not stamped with the theme revision: %s' % u)

        random_hits = [u for u in reqs if 'wallpaper-' in u and u.endswith('.img')]
        print('random-cache requests:', random_hits or '(none)')
        before = pg.evaluate(READ_LOGIN)
        print('clean state:', json.dumps({k: before[k] for k in
              ('bgDisplay', 'bgOpacity', 'layerBase', 'layerImage', 'bodyAfter')},
              ensure_ascii=False))
        if before['bgDisplay'] != 'none':
            fails.append('.mz-login-bg is not removed while no wallpaper is selected')
        if before['bodyAfter'] != 'none':
            fails.append('login page paints body::after')

        # simulate the stale build
        pg.evaluate(STALE_LOGIN, FAKE_WP)
        pg.wait_for_timeout(250)
        after = pg.evaluate(READ_LOGIN)
        print('after stale-build simulation:',
              json.dumps({k: after[k] for k in
                          ('bgDisplay', 'bgOpacity', 'layerBase', 'layerImage',
                           'artOpacity', 'bodyAfter')}, ensure_ascii=False))
        if after['bgDisplay'] != 'none':
            fails.append('stale build can still show the photo layer (%r)' % after['bgDisplay'])
        if after['bodyAfter'] != 'none':
            fails.append('stale build can still paint body::after on the login page')
        if after['artOpacity'] != '1' or 'character-mobile-dark' not in after['artImage']:
            fails.append('artwork layer changed: %r / %r' % (after['artOpacity'], after['artImage']))
        if after['ovf'] != 0:
            fails.append('login page overflow %+d' % after['ovf'])
        if not str(after['layerImage']).startswith('linear-gradient'):
            fails.append('artwork layer base is not the opaque gradient: %r' % after['layerImage'])
        else:
            print('artwork layer paints its own gradient -> opaque base OK')
        ctx.close()

        # ---------------- admin page ----------------
        ctx2 = b.new_context(viewport={'width': 390, 'height': 844}, locale='zh-CN',
                             user_agent=UA, is_mobile=True, has_touch=True)
        p2 = ctx2.new_page()
        reqs2 = []
        p2.on('request', lambda r: reqs2.append(r.url))
        p2.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded', timeout=45000)
        p2.fill('#luci_username', 'root', timeout=8000)
        p2.fill('#luci_password', PASS, timeout=8000)
        p2.click('button[type="submit"]', timeout=8000)
        p2.wait_for_timeout(3000)
        admin = p2.evaluate(READ_ADMIN)
        print('\nadmin page:', json.dumps(admin, ensure_ascii=False))
        own2 = [u for u in reqs2 if 'menu-mint.js' in u]
        for u in sorted(set(own2)):
            print('   menu-mint:', u)
            if ('?v=' + str(rev)) not in u:
                fails.append('admin module not stamped with the theme revision: %s' % u)
        if admin['wpRandom'] != '0':
            fails.append('data-wp-random is %r, expected "0" with ui_random off'
                         % admin['wpRandom'])
        if not admin['charLayer']:
            fails.append('admin page lost the character layer')
        admin_clean = admin['bodyAfterContent']
        print('clean body::after content:', admin_clean)

        p2.evaluate(STALE_ADMIN)
        p2.wait_for_timeout(250)
        admin2 = p2.evaluate(READ_ADMIN)
        print('after stale admin build:', json.dumps(
            {k: admin2[k] for k in ('hasWallpaperCls', 'wpCustom', 'bodyAfterContent',
                                    'bodyBeforeContent')}, ensure_ascii=False))
        if admin2['bodyAfterContent'] != 'none' or admin2['bodyBeforeContent'] != 'none':
            fails.append('stale build paints the random wallpaper pseudo-elements')
        if admin2['wpCustom']:
            fails.append('stale build claimed mz-wp-custom')
        ctx2.close()
        b.close()

    print('\n--- FAILURES (%d) ---' % len(fails))
    for f in fails:
        print('  ', f)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
