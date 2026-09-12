"""Walk the ancestor chain at a hit point and print every painted layer."""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')
JS = r"""(pt) => {
  const out = [];
  const el = document.elementFromPoint(pt.x, pt.y);
  let cur = el;
  while (cur && cur !== document.documentElement) {
    const cs = getComputedStyle(cur);
    out.push({
      label: cur.tagName.toLowerCase() + (cur.id ? '#' + cur.id : '') +
        '.' + String(cur.className || '').slice(0, 34),
      pos: cs.position, z: cs.zIndex,
      bg: cs.backgroundColor, bd: (cs.backdropFilter || 'none').slice(0, 26)
    });
    cur = cur.parentElement;
  }
  const b = getComputedStyle(document.body, '::after');
  const o = getComputedStyle(document.body, '::before');
  const m = getComputedStyle(document.querySelector('main'));
  return {chain: out, after: {z: b.zIndex, bg: b.backgroundImage.slice(0, 40)},
          before: {z: o.zIndex, bg: o.backgroundColor, bd: o.backdropFilter},
          main: {bg: m.backgroundColor, bd: m.backdropFilter}};
}"""


def main():
    x = float(sys.argv[1]) if len(sys.argv) > 1 else 1150.0
    y = float(sys.argv[2]) if len(sys.argv) > 2 else 420.0
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
        pg.goto(BASE + '/cgi-bin/luci/admin/status/overview',
                wait_until='domcontentloaded', timeout=45000)
        pg.wait_for_timeout(2000)
        import json
        r = pg.evaluate(JS, {'x': x, 'y': y})
        print(json.dumps(r, ensure_ascii=False, indent=1))
        pg.screenshot(path='docs/audit/probe.png')
        br.close()


if __name__ == '__main__':
    main()
