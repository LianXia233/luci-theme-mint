#!/usr/bin/env python3
"""mint - on-device regression test for the PAGE GEOMETRY of the container.

Companion to the two action-bar scripts:
  * verify-action-bar.py         - offline fixture, split-button + container edge
  * verify-action-bar-device.py  - the same, against a real router
  * verify-geometry.py (this)    - the CONTAINER and the OVERVIEW dashboard,
                                   swept across six desktop widths.

Why a separate script
---------------------
The container geometry has now been reported broken TWICE, in opposite
directions, and neither report was reproducible from reading the CSS:

  1. "PC 菜单栏和内容之间留白太多" - a leftover
     `#mz-view { max-width: 1280px; margin: 0 auto; padding: 24px 28px }`
     block in compat.css. An ID selector beats the `.mz-view` class, so it
     silently defeated the whole token system (--mz-content-max was clamped
     to 1280px, --mz-container-pad replaced by 24/28). Measured 219px of
     dead space between the menu and the page at 1920px, 539px at 2560px.

  2. "右边空着一大片" - the fix for (1) left-anchored the sheet
     (container.css) and reserved a 260px / 320px character lane on the
     right (background.css). The leading void became a trailing one.

The lesson encoded here: a ONE-SIDED void is the defect, whichever edge it
lands on. The contract is `margin: var(--mz-container-margin) auto` with
`--mz-content-max` as the single width cap, i.e. the leftover is SPLIT.

A third, independent void lived inside the page: the Overview dashboard's
System Information grid held NINE items in FOUR columns (4+4+1), so its last
row carried one item plus three empty tracks - ~958px of blank at 1536px.
9 = 3x3 exactly, so three columns can never produce a ragged row (the only
divisors of 9 are 1, 3 and 9).

Invariants asserted, at every viewport
--------------------------------------
  1. SYMMETRY   |leading - trailing| <= 20px. This is the actual contract.
  2. NO VOID    when --mz-content-max is NOT the binding constraint, each
                gutter must be <= 40px. When the cap DOES bind (e.g. 2560px
                and up) a wide gutter is intentional and only rule 1 applies.
  3. NO OVERFLOW      scrollWidth <= clientWidth.
  4. NO RAGGED ROW    the System Information grid's last row must not leave
                more than 420px of blank inside the content box.

Why "cap binds" is measured, not assumed
----------------------------------------
Hardcoding `w > 1920 + 28` would drift the moment --mz-content-max or
--mz-sidebar-width is edited. Instead the probe reports the resolved
`max-width` and the container's own width; the cap is considered binding
when the sheet is already exactly as wide as the cap.

Usage
-----
    MZ_BASE=http://192.168.88.1 MZ_PASS=<password> \
        python scripts/verify-geometry.py

Optional: MZ_PAGE (default /cgi-bin/luci/admin/status/overview),
          MZ_SHOT_DIR to also write after-<w>.png screenshots.
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MZ_BASE", "http://192.168.88.1")
PASS = os.environ.get("MZ_PASS", "")
USER = os.environ.get("MZ_USER", "root")
PAGE = os.environ.get("MZ_PAGE", "/cgi-bin/luci/admin/status/overview")
SHOT_DIR = os.environ.get("MZ_SHOT_DIR", "")

SYM_TOL = 20      # |leading - trailing| limit, always enforced
GUTTER_MAX = 40   # per-edge limit, only when the cap is not binding
RAGGED_MAX = 420  # max blank inside the content box on the grid's last row

PROBE = r"""
() => {
  const cs = el => getComputedStyle(el);
  const view = document.querySelector('#mz-view, .mz-view');
  if (!view) return {error: 'no .mz-view'};
  const vr = view.getBoundingClientRect();
  const side = document.querySelector('.mz-sidebar, #mainmenu');
  const sr = side ? side.getBoundingClientRect() : null;
  // right edge of the CONTENT COLUMN (container minus its own padding):
  // this is the ruler the dashboard grid is measured against.
  const cr = vr.right - parseFloat(cs(view).paddingRight || '0');

  const sys = document.querySelector('.mint-ovd-sys-grid');
  let sysInfo = null;
  if (sys) {
    const tracks = cs(sys).gridTemplateColumns.split(' ').filter(Boolean);
    const lastTop = Math.max(...Array.from(sys.children)
      .map(k => Math.round(k.getBoundingClientRect().top)));
    const lastRow = Array.from(sys.children)
      .filter(k => Math.round(k.getBoundingClientRect().top) === lastTop);
    const lastRight = Math.max(...lastRow.map(k =>
      k.getBoundingClientRect().right));
    sysInfo = {
      nTracks: tracks.length,
      nItems: sys.children.length,
      lastRowCount: lastRow.length,
      lastRowBlank: Math.round(cr - lastRight),
      cols: cs(sys).gridTemplateColumns,
    };
  }
  return {
    vw: window.innerWidth,
    sidebarR: sr ? Math.round(sr.right) : null,
    containerL: Math.round(vr.left),
    containerR: Math.round(vr.right),
    containerW: Math.round(vr.width),
    leadingGap: sr ? Math.round(vr.left - sr.right) : null,
    trailingGap: Math.round(window.innerWidth - vr.right),
    contentMax: parseFloat(cs(view).maxWidth) || 0,
    sys: sysInfo,
    overflow: document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
  };
}
"""

VIEWPORTS = [(1366, 768), (1536, 900), (1600, 900), (1920, 1080),
             (2560, 1440), (3440, 1440)]


def main():
    if not PASS:
        print("MZ_PASS is required")
        return 2
    if SHOT_DIR:
        os.makedirs(SHOT_DIR, exist_ok=True)

    fail = 0
    with sync_playwright() as p:
        br = p.chromium.launch()
        for w, h in VIEWPORTS:
            ctx = br.new_context(viewport={"width": w, "height": h})
            pg = ctx.new_page()
            pg.goto(BASE + "/cgi-bin/luci/", wait_until="domcontentloaded")
            pg.fill('input[name="luci_username"]', USER)
            pg.fill('input[name="luci_password"]', PASS)
            pg.click('button[type="submit"], input[type="submit"], '
                     '.cbi-button-apply')
            pg.wait_for_load_state("networkidle", timeout=30000)
            pg.goto(BASE + PAGE, wait_until="domcontentloaded")
            pg.wait_for_timeout(1600)
            r = pg.evaluate(PROBE)
            if SHOT_DIR:
                pg.screenshot(path=os.path.join(SHOT_DIR, f"after-{w}.png"))
            ctx.close()

            if r.get("error"):
                print(f"[{w}x{h}] FAIL  {r['error']}")
                fail += 1
                continue

            problems = []
            lead, trail = r["leadingGap"], r["trailingGap"]
            if lead is not None:
                if abs(lead - trail) > SYM_TOL:
                    problems.append(
                        f"asymmetric gutter leading={lead} trailing={trail}")
                cap_binds = (r["contentMax"] > 0 and
                             abs(r["containerW"] - r["contentMax"]) <= 2)
                if not cap_binds:
                    if lead > GUTTER_MAX:
                        problems.append(f"leading void {lead}px")
                    if trail > GUTTER_MAX:
                        problems.append(f"trailing void {trail}px")
            else:
                cap_binds = False
            if r["overflow"] > 0:
                problems.append(f"horizontal overflow {r['overflow']}px")
            s = r["sys"]
            if s and s["lastRowBlank"] > RAGGED_MAX:
                problems.append(
                    f"sys grid ragged: last row {s['lastRowCount']}/"
                    f"{s['nTracks']} tracks, {s['lastRowBlank']}px blank")

            status = "PASS" if not problems else "FAIL"
            if problems:
                fail += 1
            print(f"[{w}x{h}] {status} containerW={r['containerW']} "
                  f"leading={lead} trailing={trail} "
                  f"max={r['contentMax']:.0f}"
                  f"{' (cap binds)' if cap_binds else ''}")
            if s:
                print(f"        sys: {s['nItems']} items / {s['nTracks']} "
                      f"tracks, last row {s['lastRowCount']} item(s), "
                      f"blank {s['lastRowBlank']}px")
            for pb in problems:
                print(f"        - {pb}")
        br.close()

    print("ALL PASS" if not fail else f"{fail} VIEWPORT(S) FAILED")
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
