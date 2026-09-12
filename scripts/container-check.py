"""Detect nested visual containers (card-in-card) on real pages.

An element counts as a VISUAL CONTAINER when it paints a non-transparent
background AND at least one of border / radius / shadow. The rule the
theme must satisfy: inside one page there is exactly ONE such element
in the ancestor chain of the content (.mz-view). Anything reported as a
"nested" pair is a card-in-card regression.

Also reports:
  - horizontal overflow
  - elements that open a stacking context inside the container
    (transform / filter / backdrop-filter / opacity < 1), because those
    trap a cbi-dropdown (z 1000) below the sidebar
  - overflow:hidden|auto|scroll boxes that could clip a popup

Usage: python scripts/container-check.py [path-filter]
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TREE = os.path.join(ROOT, 'scripts', 'menu-tree.json')
SHOT = os.path.join(ROOT, 'docs', 'audit')

PROBE = r"""() => {
  const isPainted = (cs) => {
    const bg = cs.backgroundColor || 'rgba(0, 0, 0, 0)';
    const m = bg.match(/rgba?\(([^)]+)\)/);
    if (!m) return bg !== 'transparent' && bg !== 'none';
    const parts = m[1].split(',').map((s) => parseFloat(s));
    const a = parts.length > 3 ? parts[3] : 1;
    return a > 0.02;
  };
  const hasFrame = (cs) => {
    const bw = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
                'borderLeftWidth'].some((k) => parseFloat(cs[k] || '0') > 0);
    const br = ['borderTopLeftRadius', 'borderTopRightRadius',
                'borderBottomRightRadius', 'borderBottomLeftRadius']
                .some((k) => parseFloat(cs[k] || '0') > 0);
    const sh = cs.boxShadow && cs.boxShadow !== 'none';
    return bw || br || sh;
  };
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = (el.className || '').toString().trim().split(/\s+/)
      .filter((x) => x).slice(0, 3);
    if (c.length) s += '.' + c.join('.');
    return s;
  };

  // a "box" is a structural container; controls, table cells and
  // popups are content and must not be reported.
  // .mz-view is the one legal container; anything painted inside it is
  // a nested box, EXCEPT the sticky action bar, which the design spec
  // explicitly allows as a FUNCTIONAL layer (fill + one hairline, no
  // border box / radius / shadow of its own).
  const isAction = (el) => el.classList.contains('cbi-page-actions') ||
    el.classList.contains('cbi-section-actions');
  const isBox = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || tag === 'input' || tag === 'select' ||
        tag === 'textarea' || tag === 'a' || tag === 'label' ||
        tag === 'span' || tag === 'li' || tag === 'th' || tag === 'td' ||
        tag === 'tr' || tag === 'legend' || tag === 'code' ||
        tag === 'pre' || tag === 'img' || tag === 'svg' ||
        tag === 'canvas' || tag === 'h1' || tag === 'h2' ||
        tag === 'h3' || tag === 'h4') return false;
    const cl = el.classList;
    if (cl.contains('cbi-button') || cl.contains('btn') ||
        cl.contains('badge') || cl.contains('label') ||
        cl.contains('cbi-dropdown') || cl.contains('chip') ||
        cl.contains('cbi-tooltip') || cl.contains('modal') ||
        cl.contains('cbi-input-text') ||
        cl.contains('cbi-section-table-cell')) return false;
    return true;
  };

  const containers = [];
  const stacking = [];
  const clippers = [];

  const all = document.querySelectorAll('#maincontent *');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (cs.position === 'fixed') continue;
    if (isAction(el)) continue;
    if (isPainted(cs) && hasFrame(cs) && isBox(el)) {
      containers.push(label(el));
    }
    const bf = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
    const tf = cs.transform || 'none';
    const fl = cs.filter || 'none';
    const op = parseFloat(cs.opacity || '1');
    if ((bf && bf !== 'none') || (tf && tf !== 'none') ||
        (fl && fl !== 'none') || op < 1) {
      stacking.push(label(el) + ' [' +
        [bf !== 'none' ? 'backdrop' : '', tf !== 'none' ? 'transform' : '',
         fl !== 'none' ? 'filter' : '', op < 1 ? 'opacity' : '']
          .filter((x) => x).join(',') + ']');
    }
    const ov = (cs.overflowX + '/' + cs.overflowY);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      clippers.push(label(el) + ' ' + ov);
    }
  }

  // ancestor chains: for each container, does it have a container
  // ancestor inside #maincontent?
  const nested = [];
  const byLabel = new Map();
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || !isBox(el) || isAction(el)) continue;
    if (isPainted(cs) && hasFrame(cs)) byLabel.set(el, label(el));
  }
  for (const [el, lab] of byLabel) {
    // .mz-view is the one legal container; anything painted inside it
    // is a nested box.
    if (el.classList.contains('mz-view')) continue;
    let p = el.parentElement;
    while (p && p.id !== 'maincontent') {
      if (byLabel.has(p) && !p.classList.contains('mz-view'))
        nested.push(lab + '  <inside>  ' + byLabel.get(p));
      p = p.parentElement;
    }
    if (el.closest('.mz-view')) nested.push(lab + '  <inside>  main.mz-view');
  }

  return {
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    containers: containers.slice(0, 40),
    nested: Array.from(new Set(nested)).slice(0, 30),
    stacking: stacking.slice(0, 20),
    clippers: clippers.slice(0, 20)
  };
}"""


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    pages = json.load(open(TREE, encoding='utf-8'))
    todo = [p for p in pages
            if p.get('type') not in ('function', 'call')
            and not p['path'].endswith('*')
            and (not only or only in p['path'])]
    print('container-check on %d pages' % len(todo))

    with sync_playwright() as p:
        br = p.chromium.launch(args=['--no-sandbox'])
        ctx = br.new_context(viewport={'width': 1440, 'height': 900},
                             locale='zh-CN')
        pg = ctx.new_page()
        pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded',
                timeout=45000)
        try:
            pg.fill('#luci_username', 'root', timeout=8000)
            pg.fill('#luci_password', PASSWORD, timeout=8000)
            pg.click('button[type="submit"], .cbi-button', timeout=8000)
        except Exception as exc:
            print('login:', exc)
        pg.wait_for_timeout(2500)

        bad = 0
        for entry in todo:
            try:
                pg.goto(BASE + entry['url'], wait_until='domcontentloaded',
                        timeout=45000)
                pg.wait_for_timeout(1600)
                r = pg.evaluate(PROBE)
            except Exception as exc:
                print('%-50s driver: %s' % (entry['path'], str(exc)[:70]))
                continue
            issues = []
            if r['sw'] - r['cw'] > 1:
                issues.append('overflow %dpx' % (r['sw'] - r['cw']))
            if r['nested']:
                issues.append('NESTED: ' + ' | '.join(r['nested'][:3]))
            if r['stacking']:
                issues.append('stacking: ' + ' | '.join(r['stacking'][:3]))
            if issues:
                bad += 1
                print('%-50s %s' % (entry['path'], ' ;; '.join(issues)[:180]))
                if r['nested']:
                    for c in r['containers'][:8]:
                        print('        container: %s' % c)
        br.close()
    print('\n==== %d/%d pages with findings ====' % (bad, len(todo)))


if __name__ == '__main__':
    sys.exit(main())
