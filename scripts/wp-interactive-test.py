"""Interactive wallpaper-manager test against the live router."""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 1000},
                        locale='zh-CN')
    pg = ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append('CONSOLE-err: ' + m.text)
          if m.type == 'error' else None)

    pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded',
            timeout=45000)
    try:
        pg.fill('#luci_username', 'root', timeout=8000)
        pg.fill('#luci_password', PASSWORD, timeout=8000)
        pg.click('button[type="submit"], .cbi-button', timeout=8000)
    except Exception as e:
        print('login skip:', e)
    pg.wait_for_timeout(2500)
    pg.goto(BASE + '/cgi-bin/luci/admin/system/mint-wallpaper/settings',
            wait_until='domcontentloaded', timeout=45000)

    for i in range(10):
        pg.wait_for_timeout(1200)
        n = pg.evaluate("() => document.querySelectorAll('.mz-wp-card').length")
        st = pg.evaluate(
            "() => { const e = document.getElementById('mz-wp-status');"
            " return e ? e.textContent : ''; }")
        gl = pg.evaluate(
            "() => { const g = document.getElementById('mz-wp-grid');"
            " return g ? g.children.length : -1; }")
        print('wait %d: items=%d gridChildren=%d status=%r'
              % (i + 1, n, gl, st[:70]))
        if n > 0:
            break

    thumbs = pg.query_selector_all('.mz-wp-card')
    if thumbs:
        pg.evaluate("() => localStorage.setItem('mz-wp-ver', '0')")
        thumbs[2].click()
        pg.wait_for_timeout(4500)
        print('ver after apply  :',
              pg.evaluate("() => localStorage.getItem('mz-wp-ver')"))
        print('wp after apply   :',
              pg.evaluate(
                  "() => document.documentElement.style"
                  ".getPropertyValue('--mz-wallpaper')")[:130])
        print('status after apply:',
              pg.evaluate(
                  "() => document.getElementById('mz-wp-status')"
                  ".textContent")[:90])

        btn = pg.query_selector('#mz-wp-refresh-cache')
        if btn:
            btn.click()
            pg.wait_for_timeout(6000)
            print('status after refresh:',
                  pg.evaluate(
                      "() => document.getElementById('mz-wp-status')"
                      ".textContent")[:90])
            print('ver after refresh :',
                  pg.evaluate("() => localStorage.getItem('mz-wp-ver')"))
            print('wp after refresh  :',
                  pg.evaluate(
                      "() => document.documentElement.style"
                      ".getPropertyValue('--mz-wallpaper')")[:130])

        # navigate away: wallpaper must survive
        pg.goto(BASE + '/cgi-bin/luci/admin/status/overview',
                wait_until='domcontentloaded', timeout=45000)
        pg.wait_for_timeout(2500)
        print('wp after nav     :',
              pg.evaluate(
                  "() => document.documentElement.style"
                  ".getPropertyValue('--mz-wallpaper')")[:130])
        print('has-wallpaper    :',
              pg.evaluate(
                  "() => document.body.classList.contains("
                  "'mz-has-wallpaper')"))
        pg.screenshot(path='docs/shots/11-wallpaper-applied.png')
    else:
        print('NO THUMBNAILS - grid never rendered')

    print('errors:', errs if errs else 'none')
    b.close()
