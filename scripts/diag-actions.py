"""Dump tab menu + action bar DOM/CSS for the mobile-nav fix."""
import os
import json
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')

JS = r"""() => {
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      html: el.outerHTML.slice(0, 1200),
      style: {display: cs.display, flexWrap: cs.flexWrap, overflowX: cs.overflowX,
              gap: cs.gap, padding: cs.padding}
    };
  };
  const acts = [];
  document.querySelectorAll('.cbi-page-actions, .cbi-section-actions').forEach((a) => {
    const cs = getComputedStyle(a);
    const r = a.getBoundingClientRect();
    acts.push({
      sel: a.tagName.toLowerCase() + '.' + String(a.className).slice(0, 40),
      parent: a.parentElement.tagName.toLowerCase() + '.' +
        String(a.parentElement.className).slice(0, 40),
      pos: cs.position, bottom: cs.bottom, display: cs.display,
      flexDir: cs.flexDirection, align: cs.alignItems, gap: cs.gap,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      html: a.outerHTML.slice(0, 700)
    });
  });
  return {
    tabmenu: pick('#tabmenu'),
    cbiTabmenu: pick('ul.cbi-tabmenu'),
    actions: acts,
    bodyCls: document.body.className
  };
}"""


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else \
        '/cgi-bin/luci/admin/modem/5g/status'
    vw = int(sys.argv[2]) if len(sys.argv) > 2 else 390
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--no-sandbox'])
        pg = br.new_context(viewport={'width': vw, 'height': 844},
                            locale='zh-CN').new_page()
        pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded',
                timeout=45000)
        pg.fill('#luci_username', 'root')
        pg.fill('#luci_password', PASSWORD)
        pg.click('button[type="submit"], .cbi-button')
        pg.wait_for_timeout(2500)
        pg.goto(BASE + url, wait_until='domcontentloaded', timeout=45000)
        pg.wait_for_timeout(2200)
        print(json.dumps(pg.evaluate(JS), ensure_ascii=False, indent=1))
        pg.screenshot(path='docs/audit/actions-%d.png' % vw)
        br.close()


if __name__ == '__main__':
    main()
