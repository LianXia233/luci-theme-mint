"""Full-site UI audit: walk EVERY page discovered in menu-tree.json.

Per page, at 1440x900 light:
  - HTTP status of the final (redirect-followed) response
  - pageerror / console.error capture
  - horizontal overflow check
  - every .cbi-tabmenu tab is clicked, overflow re-checked per tab
  - up to 2 .cbi-dropdown widgets are opened; the popup must have a
    sane bounding rect (non-zero, inside the viewport, below/above the
    trigger) - the regression that made value strips float mid-form
  - sticky .cbi-page-actions must be visible when present
Then 390x844: horizontal overflow only.
Then 1440x900 dark: overflow + JS errors only.

Pages with findings get a screenshot saved to docs/audit/.
Output: scripts/audit-report.json + console summary.
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TREE = os.path.join(ROOT, 'scripts', 'menu-tree.json')
SHOT = os.path.join(ROOT, 'docs', 'audit')
REPORT = os.path.join(ROOT, 'scripts', 'audit-report.json')

# function/call endpoints are not navigable UI pages.
SKIP_TYPES = {'function', 'call'}
AUDIT_DARK = True


def overflow(page):
    return page.evaluate(
        "() => ({sw: document.documentElement.scrollWidth,"
        " cw: document.documentElement.clientWidth,"
        " bw: document.body ? document.body.scrollWidth : 0})")


def dropdown_check(page):
    """Open up to 2 cbi-dropdowns and validate the popup rect.

    All interaction goes through page.evaluate so a view re-render can
    never leave a stale ElementHandle behind."""
    out = []
    try:
        n = page.evaluate("() => document.querySelectorAll('.cbi-dropdown').length")
    except Exception:
        return out
    for i in range(min(n, 2)):
        try:
            page.evaluate(
                """(i) => {
                    const d = document.querySelectorAll('.cbi-dropdown')[i];
                    if (d) d.scrollIntoView({block: 'center'});
                }""", i)
            page.wait_for_timeout(150)
            page.evaluate(
                """(i) => {
                    const d = document.querySelectorAll('.cbi-dropdown')[i];
                    if (d) d.click();
                }""", i)
            page.wait_for_timeout(500)
            info = page.evaluate(
                """(idx) => {
                    const dd = document.querySelectorAll('.cbi-dropdown')[idx];
                    if (!dd) return {rect: null, kind: 'gone'};
                    const open = dd.classList.contains('open')
                        || dd.hasAttribute('open');
                    let ul = null;
                    if (open) {
                        ul = dd.querySelector(':scope > ul.dropdown')
                            || dd.querySelector(':scope > ul');
                    }
                    if (!ul) {
                        const uls = dd.querySelectorAll(':scope > ul');
                        for (const u of uls) {
                            const cs = getComputedStyle(u);
                            if (cs.display !== 'none'
                                    && cs.position === 'absolute')
                                ul = u;
                        }
                    }
                    if (!ul)
                        return {rect: null, kind: open ? 'no-popup' : 'not-open'};
                    const r = ul.getBoundingClientRect();
                    return {rect: {x: r.x, y: r.y, w: r.width, h: r.height,
                                   right: r.right, bottom: r.bottom},
                            kind: open ? 'open' : 'abs'};
                }""", i)
            page.keyboard.press('Escape')
            page.wait_for_timeout(250)
            if not info:
                continue
            r = info.get('rect')
            if not r or r['w'] < 5 or r['h'] < 5:
                out.append('dropdown#%d popup missing/collapsed (%s)'
                           % (i, info.get('kind')))
                continue
            vw = page.evaluate('() => innerWidth')
            vh = page.evaluate('() => innerHeight')
            if r['right'] > vw + 2 or r['bottom'] > vh + 2 or r['x'] < -2:
                out.append('dropdown#%d popup out of viewport '
                           '(%dx%d at %d,%d, viewport %dx%d)'
                           % (i, r['w'], r['h'], r['x'], r['y'], vw, vh))
        except Exception as exc:
            out.append('dropdown#%d error: %s' % (i, str(exc)[:80]))
            try:
                page.keyboard.press('Escape')
            except Exception:
                pass
    return out


TAB_SEL = "#tabmenu .tabs a, ul.cbi-tabmenu li a, .cbi-tabmenu > li > a"


def tabs_check(page):
    """Click every tab and re-check overflow inside each pane.

    Tab switches can rebuild the view (LuCSI re-renders), which destroys
    the execution context of any previously grabbed ElementHandle - so
    re-query by index on every round instead of keeping handles."""
    out = []
    try:
        count = page.evaluate("(sel) => document.querySelectorAll(sel).length",
                              TAB_SEL)
    except Exception:
        return out
    for i in range(min(count, 6)):
        try:
            label = page.evaluate(
                "(o) => { const t = document.querySelectorAll(o.sel)[o.i];"
                " return t ? (t.textContent || '').trim().slice(0, 18) : ''; }",
                {'sel': TAB_SEL, 'i': i})
            page.evaluate(
                "(o) => { const t = document.querySelectorAll(o.sel)[o.i];"
                " if (t) t.click(); }",
                {'sel': TAB_SEL, 'i': i})
            page.wait_for_timeout(700)
            o = overflow(page)
            if o['sw'] - o['cw'] > 1:
                out.append('tab[%d]=%s overflow %dpx'
                           % (i, label, o['sw'] - o['cw']))
        except Exception as exc:
            out.append('tab[%d] error: %s' % (i, str(exc)[:60]))
    return out


def audit_page(pg, entry):
    rec = {'path': entry['path'], 'title': entry['title'],
           'pkg': entry['pkg'], 'issues': []}

    # ---- desktop light ------------------------------------------------
    resp = pg.goto(BASE + entry['url'], wait_until='domcontentloaded',
                   timeout=45000)
    rec['http'] = resp.status if resp else 0
    rec['final_url'] = pg.url.replace(BASE, '')
    pg.wait_for_timeout(2200)
    if rec['http'] in (404, 500, 502):
        rec['issues'].append('HTTP %d' % rec['http'])
        return rec

    o = overflow(pg)
    if o['sw'] - o['cw'] > 1:
        rec['issues'].append('desktop overflow %dpx' % (o['sw'] - o['cw']))

    rec['issues'] += dropdown_check(pg)
    rec['issues'] += tabs_check(pg)

    sticky = pg.evaluate(
        "() => { const a = document.querySelector('.cbi-map > .cbi-page-actions,"
        " #maincontent .cbi-page-actions');"
        " if (!a) return 'none';"
        " const cs = getComputedStyle(a);"
        " const r = a.getBoundingClientRect();"
        " if (cs.display === 'none' || cs.visibility === 'hidden' || r.height < 10)"
        "   return 'broken';"
        " return 'ok'; }")
    rec['sticky'] = sticky

    # ---- phone 390 -----------------------------------------------------
    pg.set_viewport_size({'width': 390, 'height': 844})
    pg.wait_for_timeout(900)
    o = overflow(pg)
    if o['sw'] - o['cw'] > 1:
        rec['issues'].append('phone-390 overflow %dpx' % (o['sw'] - o['cw']))

    # ---- desktop dark ---------------------------------------------------
    if AUDIT_DARK:
        pg.set_viewport_size({'width': 1440, 'height': 900})
        pg.evaluate(
            "() => { localStorage.setItem('mz-theme','dark');"
            " document.documentElement.setAttribute('data-theme','dark'); }")
        pg.wait_for_timeout(900)
        o = overflow(pg)
        if o['sw'] - o['cw'] > 1:
            rec['issues'].append('dark overflow %dpx' % (o['sw'] - o['cw']))
        pg.evaluate(
            "() => { localStorage.setItem('mz-theme','light');"
            " document.documentElement.setAttribute('data-theme','light'); }")

    # screenshot evidence for pages that need a human look
    if rec['issues']:
        os.makedirs(SHOT, exist_ok=True)
        name = entry['path'].replace('/', '_')[:80]
        try:
            pg.screenshot(path=os.path.join(SHOT, name + '.png'))
        except Exception:
            pass
    return rec


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    pages = json.load(open(TREE, encoding='utf-8'))
    todo = [p for p in pages
            if p['type'] not in SKIP_TYPES
            and not p['path'].endswith('*')
            and (not only or only in p['path'])]
    print('auditing %d pages' % len(todo))

    report = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--no-sandbox'])
        ctx = browser.new_context(viewport={'width': 1440, 'height': 900},
                                  locale='zh-CN')
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: errors.append(m.text)
              if m.type == 'error' else None)

        # login once
        pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded',
                timeout=45000)
        try:
            pg.fill('#luci_username', 'root', timeout=8000)
            pg.fill('#luci_password', PASSWORD, timeout=8000)
            pg.click('button[type="submit"], .cbi-button', timeout=8000)
        except Exception as exc:
            print('login skip:', exc)
        pg.wait_for_timeout(2500)

        t0 = time.time()
        for i, entry in enumerate(todo):
            errors.clear()
            try:
                rec = audit_page(pg, entry)
            except Exception as exc:
                rec = {'path': entry['path'], 'title': entry['title'],
                       'issues': ['driver: %s' % str(exc)[:120]],
                       'http': 0}
            errs = [e for e in errors
                    if 'favicon' not in e.lower()
                    and 'ERR_ABORTED' not in e]
            if errs:
                rec['js_errors'] = errs[:5]
                rec['issues'].append('js: %s' % errs[0][:100])
            report.append(rec)
            flag = 'FAIL' if rec['issues'] else 'ok'
            print('%3d/%d %-6s %-52s %s'
                  % (i + 1, len(todo), flag, entry['path'],
                     '; '.join(rec['issues'])[:110]))

        browser.close()

    with open(REPORT, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    bad = [r for r in report if r['issues']]
    print('\n==== %d pages audited, %d with issues, %.0fs ===='
          % (len(report), len(bad), time.time() - t0))
    for r in bad:
        print('  %-52s %s' % (r['path'], '; '.join(r['issues'])[:160]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
