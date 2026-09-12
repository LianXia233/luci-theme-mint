"""Print computed box properties for suspicious selectors on one page."""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')
JS = r"""(sel) => {
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    const cs = getComputedStyle(el);
    out.push({
      label: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' +
        String(el.className || '').slice(0, 40),
      bg: cs.backgroundColor,
      bt: cs.borderTopWidth, bb: cs.borderBottomWidth,
      bl: cs.borderLeftWidth,
      br: cs.borderTopLeftRadius + '/' + cs.borderBottomRightRadius,
      sh: cs.boxShadow.slice(0, 40),
      bd: cs.backdropFilter
    });
  }
  return out;
}"""

SELS = ['div.cbi-section', 'div.cbi-map-descr', 'ul.cbi-tabmenu',
        'div.cbi-map', 'main.mz-view']


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else \
        '/cgi-bin/luci/admin/services/homeproxy/client'
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--no-sandbox'])
        pg = br.new_context(viewport={'width': 1440, 'height': 900},
                            locale='zh-CN').new_page()
        pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded',
                timeout=45000)
        pg.fill('#luci_username', 'root')
        pg.fill('#luci_password', PASSWORD)
        pg.click('button[type="submit"], .cbi-button')
        pg.wait_for_timeout(2500)
        pg.goto(BASE + url, wait_until='domcontentloaded', timeout=45000)
        pg.wait_for_timeout(1800)
        print('== stylesheets ==')
        for s in pg.evaluate(
                "() => Array.from(document.styleSheets).map(x=>x.href||'inline')"):
            print('  ', s)
        for sel in SELS:
            print('==', sel, '==')
            for r in pg.evaluate(JS, sel)[:4]:
                print('  ', r)
        br.close()


if __name__ == '__main__':
    main()
