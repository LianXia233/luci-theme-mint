#!/usr/bin/env python3
"""mint - offline regression test for the DROPDOWN popup (colour + padding).

Reported symptom: "所有的下拉菜单颜色和排版异常" - every dropdown menu had a
wrong colour AND wrong spacing.

Two independent root causes, both reproduced before the fix:

  1. COLOUR. compat.css hard-coded `background: #1c2736` on
     `body.mz-has-wallpaper .cbi-dropdown[open] > ul`.
     The `mz-has-wallpaper` class is set by menu-mint.js on EVERY admin page,
     light theme included, so a light-themed page was handed a dark navy
     popup. Critically, on the stripped LuCI builds this repo targets
     (cbi.js ships WITHOUT CBI.Dropdown) the floating <ul> never receives the
     `.dropdown` class, so the later token rule keyed on `ul.dropdown` - the
     one that resolves the panel token - could never override it. The navy
     therefore won on every page. Measured popup bg was exactly rgb(28,39,54).

  2. PADDING. `#mz-view ul, #mz-view ol { padding-left: 20px }` is an ID rule
     intended for prose lists. It also caught every dropdown <ul> and, being
     an ID, out-ranked every class-based popup rule. The open menu computed
     `padding: 4px 4px 4px 20px` - the option text shoved 20px right while the
     right edge stayed flush, i.e. visibly misaligned.

Invariants asserted here, in LIGHT theme with body.mz-has-wallpaper:

  1. LIGHT POPUP     the open menu's computed background is a LIGHT colour
                     (relative luminance >= 0.75) for BOTH markup shapes:
                     `<ul class="dropdown">` (full LuCI) and a bare `<ul>`
                     (stripped build). This is what the colour bug broke.
  2. SYMMETRIC PAD   padding-left == padding-right on the open menu. This is
                     what the padding bug broke.
  3. FULL LIST       the modern markup renders every <li>.

The fixture loads the REAL cascade.css, so the @import layering and
specificity that produced the bug are all genuine. Point it at a live router
with --css to run the identical assertions against deployed CSS:

    python scripts/verify-dropdown.py
    python scripts/verify-dropdown.py --css http://192.168.88.1/luci-static/mint/cascade.css
"""
import argparse
import functools
import http.server
import json
import os
import pathlib
import sys
import threading

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent  # theme repo root, so /theme/htdocs/... resolves
REL = "theme/htdocs/luci-static/mint/cascade.css"

FIXTURE = """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><link rel="stylesheet" href="__CSS__"></head>
<body class="mz-has-wallpaper">
<div id="mz-view">
  <div class="cbi-dropdown" id="dd-modern" open>
    <ul class="dropdown">
      <li selected="">DHCP</li><li>DHCPv6</li><li>none</li><li>PPP</li>
      <li>PPPoE</li><li>relay</li><li>static</li>
    </ul>
    <ul class="preview"><li selected="">DHCP</li></ul>
  </div>
  <div class="cbi-dropdown" id="dd-legacy" open>
    <ul>
      <li selected="">DHCP</li><li>DHCPv6</li><li>none</li><li>PPP</li>
      <li>PPPoE</li><li>relay</li><li>static</li>
    </ul>
  </div>
</div>
</body>
</html>
"""

READ = r"""
() => {
  const probe = (id) => {
    const dd = document.getElementById(id);
    const ul = dd.querySelector('ul');
    const lis = Array.from(ul.querySelectorAll(':scope > li'));
    const s = getComputedStyle(ul);
    return {
      bg: s.backgroundColor,
      padLeft: parseFloat(s.paddingLeft),
      padRight: parseFloat(s.paddingRight),
      liTotal: lis.length,
      liShown: lis.filter(l => getComputedStyle(l).display !== 'none').length
    };
  };
  return { theme: document.documentElement.getAttribute('data-theme'),
           bodyClass: document.body.className,
           modern: probe('dd-modern'), legacy: probe('dd-legacy') };
}
"""


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def luminance(css_rgb):
    """Relative luminance of an 'rgb(a)' / 'rgba(a)' string; alpha is ignored
    because the popup sits over an opaque page, so the perceived result is the
    alpha-blend of the colour onto a light sheet. For the assertion we only
    need to distinguish 'light glass' from 'dark navy', and every candidate
    colour is comfortably on one side."""
    nums = [float(n) for n in css_rgb.replace("rgba(", "").replace("rgb(", "")
            .replace(")", "").split(",")]
    r, g, b = nums[0] / 255.0, nums[1] / 255.0, nums[2] / 255.0
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def start_server():
    handler = functools.partial(_Quiet, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.socket.getsockname()[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--css", default=None,
                    help="absolute URL of cascade.css to test (default: the "
                         "local working tree, served over loopback)")
    args = ap.parse_args()

    os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH",
                          os.path.expanduser("~/AppData/Local/ms-playwright").replace("\\", "/"))
    from playwright.sync_api import sync_playwright

    httpd = None
    if args.css:
        css_url = args.css
    else:
        httpd, port = start_server()
        css_url = "http://127.0.0.1:%d/%s" % (port, REL)

    html = FIXTURE.replace("__CSS__", css_url)
    base = ("http://127.0.0.1:%d/" % httpd.socket.getsockname()[1]) if httpd else "about:blank"
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1000, "height": 900})
        pg.goto(base)
        pg.set_content(html, wait_until="networkidle")
        pg.wait_for_timeout(250)
        data = pg.evaluate(READ)
        br.close()
    if httpd:
        httpd.shutdown()

    print("css source : %s" % css_url)
    print("theme      : data-theme=%r  body=%r" % (data["theme"], data["bodyClass"]))
    failures = []

    for name, key in (("modern (ul.dropdown)", "modern"), ("legacy (bare ul)", "legacy")):
        d = data[key]
        lum = luminance(d["bg"])
        ok_colour = lum >= 0.75
        ok_pad = abs(d["padLeft"] - d["padRight"]) < 0.5
        print("  %-20s bg=%-24s lum=%.3f  pad=%s/%s  li=%d/%d"
              % (name, d["bg"], lum, d["padLeft"], d["padRight"], d["liShown"], d["liTotal"]))
        if not ok_colour:
            failures.append("%s: popup is DARK (bg=%s, luminance %.3f < 0.75) in LIGHT theme"
                            % (name, d["bg"], lum))
        if not ok_pad:
            failures.append("%s: asymmetric padding %s/%s" % (name, d["padLeft"], d["padRight"]))

    m = data["modern"]
    if m["liShown"] != m["liTotal"]:
        failures.append("modern: only %d/%d options visible in the open menu"
                        % (m["liShown"], m["liTotal"]))

    print()
    if failures:
        for f in failures:
            print("FAIL  %s" % f)
        sys.exit(1)
    print("PASS  dropdown popup is light and symmetrically padded in both markup shapes")


if __name__ == "__main__":
    main()
