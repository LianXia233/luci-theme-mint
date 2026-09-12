"""Targeted check: menu caret uniqueness/alignment, container translucency,
cache-bust revision on the wire."""
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')
with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='zh-CN')
    pg = ctx.new_page()
    pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded', timeout=45000)
    pg.fill('#luci_username', 'root', timeout=8000)
    pg.fill('#luci_password', PASSWORD, timeout=8000)
    pg.click('button[type="submit"]')
    pg.wait_for_load_state('networkidle', timeout=45000)
    pg.goto(BASE + '/cgi-bin/luci/admin/network/network', wait_until='networkidle')

    r = pg.evaluate("""() => {
      const carets = [...document.querySelectorAll('.mz-menu-caret')];
      const groups = [...document.querySelectorAll('.mz-menu-group > a')];
      const view = document.querySelector('.mz-view');
      const cs = view ? getComputedStyle(view) : null;
      const aligned = carets.slice(0, 12).map(c => {
        const a = c.closest('a'); const acs = getComputedStyle(a);
        const bb = c.getBoundingClientRect(); const ab = a.getBoundingClientRect();
        return { right: Math.round(ab.right - bb.right),
                 vCenter: Math.abs((bb.top + bb.bottom) / 2 - (ab.top + ab.bottom) / 2) < 2,
                 svg: !!c.querySelector('svg') };
      });
      // old compat triangle must be gone
      const ghost = groups.filter(a => getComputedStyle(a, '::after').content !== 'none'
                                      && getComputedStyle(a, '::after').content !== '""');
      const doubleArrow = groups.filter(a =>
        a.querySelector('.mz-menu-caret') && a.querySelector('.mz-menu-caret svg')
        && getComputedStyle(a, '::after').content.includes(''));
      return {
        caretCount: carets.length, groupCount: groups.length,
        caretSample: carets[0] ? carets[0].outerHTML.slice(0, 140) : null,
        aligned, ghostAfter: ghost.length,
        viewBg: cs ? cs.backgroundColor : null,
        viewRadius: cs ? cs.borderRadius : null,
        viewShadow: cs ? cs.boxShadow.slice(0, 60) : null,
        cascadeHref: [...document.querySelectorAll('link[rel=stylesheet]')]
          .map(l => l.getAttribute('href')).filter(h => h && h.includes('cascade')),
      };
    }""")
    import json
    print(json.dumps(r, ensure_ascii=False, indent=1))
    pg.screenshot(path='docs/shots/11-caret-check.png')
    b.close()
