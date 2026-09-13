#!/usr/bin/env python3
"""mint - device-free regression check for the page action bar + container anchoring.

Why this exists
---------------
Both defects it guards were **invisible to `node --check` and to reading the
CSS**, and one of them could not even be reproduced on a desktop browser:
the phone media query won a specificity tie by source order. Reproducing the
real markup in a local Chromium is the only cheap way to catch that class of
bug without a device in the loop.

What it builds
--------------
A throwaway HTML fixture with the EXACT markup LuCI produces, derived from
source rather than from memory:

  luci.js  addFooter()  ->  div.cbi-page-actions
                              > div.cbi-dropdown.btn.cbi-button.cbi-button-apply.important
  ui.js    UIDropdown.render()/bind()
                              > ul > li[data-value=0][selected][display=0]   ('保存并应用')
                                   > li[data-value=1]                        ('强制应用')
                              > span.more '···'   span.open '▾'

The fixture links the real `cascade.css`, so what it measures is the shipped
stylesheet.

Invariants asserted
--------------------
1. closed split button shows EXACTLY ONE option  (the unselected one is hidden)
2. the `···` overflow affordance stays hidden - ui.js removes the `more`
   attribute for a non-multiple ComboButton, so it must not be drawn
3. the whole height chain (wrapper / caption ul / caption li / caret) is ONE
   height - no 38/36/32/36 mismatch
4. no horizontal overflow at any tested viewport
5. on desktop the container is anchored to the LEADING edge, with the surplus
   width on the trailing side - not split into two voids

Usage
-----
  PLAYWRIGHT_BROWSERS_PATH=<dir> python scripts/verify-action-bar.py

Credentials: none. This never touches the router.
"""
import os
import sys
import tempfile

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    print('SKIP: playwright is not installed in this interpreter')
    sys.exit(0)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASCADE = os.path.join(ROOT, 'theme', 'htdocs', 'luci-static', 'mint', 'cascade.css')
CASCADE_URL = 'file:///' + CASCADE.replace('\\', '/')

FIXTURE = """<!DOCTYPE html>
<html lang="zh-cn" data-theme="light">
<head><meta charset="utf-8"><title>mint action-bar fixture</title>
<link rel="stylesheet" href="%(css)s">
<style>html,body{margin:0}</style>
</head>
<body class="mz-char-bg">
  <aside class="mz-sidebar"><div class="mz-brand"><a class="mz-brand-link" href="#">Mint</a></div>
    <nav class="mz-nav"><ul class="mz-menu"></ul></nav></aside>
  <div class="mz-main" id="maincontent">
    <div class="mz-indicatorbar"><div id="indicators" class="mz-indicators"></div></div>
    <main id="mz-view" class="mz-view">
      <div id="tabmenu"><ul class="tabs"><li class="active"><a href="#">接口</a></li></ul></div>
      <div id="view">
        <div class="cbi-map">
          <h2>接口</h2>
          <div class="cbi-section"><h3>lan</h3>
            <div class="cbi-value"><label class="cbi-value-title">协议</label>
              <div class="cbi-value-field">静态地址</div></div>
          </div>
          <div class="cbi-page-actions">
            <div class="cbi-dropdown btn cbi-button cbi-button-apply important" tabindex="0">
              <ul tabindex="-1">
                <li data-value="0" selected display="0">保存并应用</li>
                <li data-value="1">强制应用</li>
              </ul>
              <span class="more" tabindex="-1">···</span>
              <span class="open" tabindex="-1">▾</span>
              <div></div>
            </div>
            <button class="cbi-button cbi-button-save">保存</button>
            <button class="cbi-button cbi-button-reset">重置</button>
          </div>
        </div>
      </div>
    </main>
    <footer class="mz-footer"><span class="mz-footer-brand">mint</span></footer>
  </div>
</body></html>
""" % {'css': CASCADE_URL}

PROBE = """
() => {
  const cs = el => getComputedStyle(el);
  const box = el => { const r = el.getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right)}; };
  const bar = document.querySelector('.cbi-page-actions');
  const dd  = bar.querySelector('.cbi-dropdown');
  const ul  = dd.querySelector(':scope > ul');
  const lis = Array.from(dd.querySelectorAll(':scope > ul > li'));
  const more = dd.querySelector(':scope > .more');
  const open = dd.querySelector(':scope > .open');
  const sv = document.querySelector('.mz-sidebar').getBoundingClientRect();
  const main = document.querySelector('.mz-main').getBoundingClientRect();
  const view = document.querySelector('.mz-view').getBoundingClientRect();
  return {
    viewport: [window.innerWidth, window.innerHeight],
    scrollW: document.documentElement.scrollWidth,
    items: lis.map(li => ({text: li.textContent.trim(), display: cs(li).display,
                           visible: li.getBoundingClientRect().height > 0,
                           h: Math.round(li.getBoundingClientRect().height),
                           selected: li.hasAttribute('selected')})),
    heights: {dd: box(dd).h, ul: box(ul).h, li: box(lis[0]).h, caret: box(open).h,
              moreDisplay: more ? cs(more).display : null, moreAttr: dd.hasAttribute('more'),
              save: box(bar.querySelector('.cbi-button-save')).h},
    gap: Math.round(view.left - sv.right),
    leftSlack: Math.round(view.left - main.left),
    rightSlack: Math.round(main.right - view.right),
  };
}
"""

failures = []


def check(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond:
        failures.append(msg)


def main() -> int:
    tmp = tempfile.mkdtemp(prefix='mint-ab-')
    fixture = os.path.join(tmp, 'action-bar.html')
    with open(fixture, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(FIXTURE)
    url = 'file:///' + fixture.replace('\\', '/')

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, h in ((390, 844), (768, 1024), (1440, 900), (1920, 1080), (2560, 1440)):
            page = browser.new_page(viewport={'width': w, 'height': h})
            page.goto(url, wait_until='load')
            page.wait_for_timeout(250)
            d = page.evaluate(PROBE)
            page.close()

            print(f'\n[{w}x{h}]')
            visible = [i for i in d['items'] if i['visible']]
            leaked = [i['text'] for i in visible if not i['selected']]
            check(len(visible) == 1, f'closed button shows exactly 1 option (got {len(visible)}: '
                                     f'{[i["text"] for i in visible]})')
            check(not leaked, f'no unselected option leaked (leaked: {leaked})')
            check(d['heights']['moreDisplay'] == 'none',
                  f'overflow "···" hidden (display={d["heights"]["moreDisplay"]})')

            hs = d['heights']
            chain = [hs['dd'], hs['ul'], hs['li'], hs['caret']]
            check(len(set(chain)) == 1,
                  f'height chain uniform (dd/ul/li/caret = {chain})')
            check(d['scrollW'] <= w, f'no horizontal overflow (scrollW={d["scrollW"]} vs {w})')

            if w >= 855:
                check(d['gap'] <= 20, f'container anchored, sidebar gap {d["gap"]}px <= 20px')
                check(d['leftSlack'] <= 20, f'left slack {d["leftSlack"]}px <= 20px')
                check(d['rightSlack'] >= d['leftSlack'],
                      f'surplus on trailing side ({d["rightSlack"]} >= {d["leftSlack"]})')

        browser.close()

    print('\n' + ('ALL PASS' if not failures else f'{len(failures)} FAILURE(S)'))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
