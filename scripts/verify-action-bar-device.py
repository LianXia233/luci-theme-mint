#!/usr/bin/env python3
"""mint - on-device regression test for the action bar + container geometry.

This is the AUTHORITATIVE counterpart of scripts/verify-action-bar.py.
  * verify-action-bar.py  -> no router needed. Builds a local fixture that
                             links the real cascade.css and checks the same
                             invariants offline. Use it on every CSS edit.
  * verify-action-bar-device.py (this file) -> logs into a real router over
                             HTTP with a browser and re-checks them against
                             whatever is actually deployed.

Run it after `python scripts/router-deploy.py all` to prove the push landed.

Usage:
    MZ_BASE=http://192.168.88.1 MZ_PASS=<password> \
        python scripts/verify-action-bar-device.py

Optional: MZ_PAGE to point at another page that owns a save & apply bar.

Invariants (all three reported defects are encoded here):
  1. A CLOSED split button exposes exactly ONE option. Upstream ui.js gives a
     non-multiple ComboButton one <li>; the mobile block in compat.css used to
     force `display:flex` on every <li>, leaking the hidden "force apply"
     option. A leak shows up as liVisible > 1.
  2. The "..." affordance (span.more) must NOT be drawn. ui.js calls
     removeAttribute('more') on a non-multiple ComboButton, so the CSS may
     only paint .more for [multiple][more] / [multiple][empty].
  3. dd / ul / li / .open must all share ONE height (36px desktop, 34px
     <=768px). A chain like 38/36/32 means the button wraps to two rows.
  4. Desktop: the gap between the sidebar and the content box stays small
     (<= 24px) and the surplus width falls on the TRAILING side. The legacy
     `#mz-view{max-width:1280px;margin:0 auto}` used to centre the container
     and burn 219px at 1920 / 539px at 2560.
  5. No horizontal overflow at any width.
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MZ_BASE", "http://192.168.88.1")
PASS = os.environ.get("MZ_PASS", "")
PAGE = os.environ.get("MZ_PAGE", "/cgi-bin/luci/admin/network/network")
USER = os.environ.get("MZ_USER", "root")

PROBE = r"""
() => {
  const out = {ok: false};
  const bar = document.querySelector('.cbi-page-actions');
  if (!bar) return out;
  const dd = bar.querySelector('.cbi-dropdown');
  if (dd) {
    const cs = el => el ? getComputedStyle(el) : null;
    const lis = Array.from(dd.querySelectorAll(':scope > ul > li'));
    const vis = lis.filter(li => cs(li).display !== 'none' && cs(li).visibility !== 'hidden');
    const more = dd.querySelector(':scope > .more');
    const open = dd.querySelector(':scope > .open');
    const ul = dd.querySelector(':scope > ul');
    out.ok = true;
    out.liTotal = lis.length;
    out.liVisible = vis.length;
    out.liVisibleText = vis.map(li => (li.getAttribute('display') || li.textContent || '').trim());
    out.moreDisplay = more ? cs(more).display : 'absent';
    out.h = {
      dd: cs(dd).height,
      ul: ul ? cs(ul).height : null,
      li: lis[0] ? cs(lis[0]).height : null,
      open: open ? cs(open).height : null,
    };
    const r = dd.getBoundingClientRect();
    out.ddBox = [Math.round(r.width), Math.round(r.height)];
  }
  const side = document.querySelector('#mainmenu, .mz-sidebar, #mz-menu');
  const view = document.querySelector('#mz-view, .mz-view');
  if (side && view) {
    const a = side.getBoundingClientRect(), b = view.getBoundingClientRect();
    out.gap = Math.round(b.left - a.right);
    out.surplus = Math.round(window.innerWidth - b.right);
    out.viewW = Math.round(b.width);
  }
  out.scrollW = document.documentElement.scrollWidth;
  out.clientW = document.documentElement.clientWidth;
  return out;
}
"""

VIEWPORTS = [(390, 844, "phone"), (768, 1024, "tablet"),
             (1440, 900, "desktop"), (1920, 1080, "wide"),
             (2560, 1440, "ultrawide")]

GAP_MAX = 24


def main():
    if not PASS:
        print("MZ_PASS is required")
        return 2

    fail = 0
    with sync_playwright() as p:
        br = p.chromium.launch()
        for w, h, tag in VIEWPORTS:
            ctx = br.new_context(viewport={"width": w, "height": h},
                                 device_scale_factor=1)
            pg = ctx.new_page()
            pg.goto(BASE + "/cgi-bin/luci/", wait_until="domcontentloaded")
            pg.fill('input[name="luci_username"]', USER)
            pg.fill('input[name="luci_password"]', PASS)
            pg.click('button[type="submit"], input[type="submit"], '
                     '.cbi-button-apply')
            pg.wait_for_load_state("networkidle", timeout=30000)
            pg.goto(BASE + PAGE, wait_until="domcontentloaded")
            pg.wait_for_timeout(1200)
            r = pg.evaluate(PROBE)
            ctx.close()

            problems = []
            if not r.get("ok"):
                problems.append("no .cbi-page-actions action bar found")
            else:
                if r["liVisible"] != 1:
                    problems.append(
                        f"closed button leaks {r['liVisible']} options "
                        f"{r['liVisibleText']}")
                if r["moreDisplay"] not in ("none", "absent"):
                    problems.append(
                        f"stray '...' drawn (display={r['moreDisplay']})")
                hs = [v for v in r["h"].values() if v]
                if len(set(hs)) > 1:
                    problems.append(f"height chain uneven {r['h']}")
            if r.get("scrollW", 0) > r.get("clientW", 0):
                problems.append(
                    f"horizontal overflow {r['scrollW']}>{r['clientW']}")
            if w >= 1440 and "gap" in r and r["gap"] > GAP_MAX:
                problems.append(f"sidebar->content gap {r['gap']}px")

            status = "PASS" if not problems else "FAIL"
            if problems:
                fail += 1
            extra = ""
            if r.get("ok"):
                extra = (f" opts={r['liVisible']} more={r['moreDisplay']} "
                         f"h={r['h']} dd={r['ddBox']}")
            if "gap" in r:
                extra += (f" gap={r['gap']} surplus={r['surplus']} "
                          f"viewW={r['viewW']}")
            print(f"[{tag} {w}x{h}] {status}{extra}")
            for pb in problems:
                print(f"      - {pb}")

        br.close()

    print("ALL PASS" if not fail else f"{fail} VIEWPORT(S) FAILED")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
