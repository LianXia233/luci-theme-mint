#!/usr/bin/env python3
"""mint - on-device regression test for the Save & Apply chain + login row.

Authoritative counterpart of the offline fixture tests. Logs into a real
router over HTTP with a browser and re-checks the invariants fixed on
2026-09-13 against whatever is actually deployed:

  1. The action-bar split button OPENS: ui.js must own the click, so the
     floating <ul> receives its `dropdown` class and every option is
     visible. mz-ui.js used to install a second handler set on top of the
     native widget (it probed CBI.Dropdown, which does not exist on modern
     builds) and swallowed both the open and the submit.
  2. Clicking the main face issues the apply. By default the test
     INTERCEPTS the write POST (route.fulfill) so nothing is changed on
     the router; pass --real to let it through. The intercepted request
     still proves the submit happened; with --real the apply_rollback
     endpoint is additionally required.
  3. Selecting "Apply unchecked" switches the pill to its negative class.
  4. Plain (non-button) dropdowns on the same page still open.
  5. Phone (390px): the open menu is NOT squashed - the three mobile
     blocks in compat.css must keep :not(.dropdown) on every height pin,
     otherwise ul.dropdown collapses to the pill height and options 2+
     hide behind overflow-y.
  6. Login page: the "remember me" checkbox row is LEFT-aligned with the
     username field (delta <= 4px), on desktop and phone.

Usage:
    MZ_BASE=http://192.168.88.1 MZ_PASS=<password> \
        python scripts/verify-save-apply-device.py [--real] [--shot DIR]

MZ_PAGE overrides the page under test (default admin/system/system).
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("MZ_BASE", "http://192.168.88.1")
PASS = os.environ.get("MZ_PASS", "")
PAGE = os.environ.get("MZ_PAGE", "/cgi-bin/luci/admin/system/system")
USER = os.environ.get("MZ_USER", "root")

RESULTS = []


def chk(name, ok, detail=""):
    RESULTS.append((bool(ok), name, detail))
    print("[%s] %s %s" % ("PASS" if ok else "FAIL", name, detail))


def login(pg):
    pg.goto(BASE + "/cgi-bin/luci/", wait_until="networkidle")
    pg.fill("input[name='luci_username']", USER)
    pg.fill("input[name='luci_password']", PASS)
    pg.click("button[type='submit']")
    pg.wait_for_load_state("networkidle")


OPEN_CARET = """() => {
    var dd = document.querySelector('.cbi-page-actions .cbi-dropdown');
    if (!dd) return 'no dd';
    dd.querySelector(':scope > .open').dispatchEvent(
        new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
    return 'ok';
}"""

MENU_STATE = """() => {
    var dd = document.querySelector('.cbi-page-actions .cbi-dropdown');
    var ul = dd.querySelector('ul.dropdown');
    if (!ul) return {open: dd.hasAttribute('open'), hasUl: false};
    var ur = ul.getBoundingClientRect(), de = document.documentElement;
    var liVis = [...ul.querySelectorAll('li')].filter(function (li) {
        var lr = li.getBoundingClientRect();
        return getComputedStyle(li).display !== 'none' && lr.height > 5;
    }).length;
    return { open: dd.hasAttribute('open'), hasUl: true,
             vis: getComputedStyle(ul).display !== 'none' && ur.height > 10,
             w: Math.round(ur.width), h: Math.round(ur.height),
             overRight: Math.round(ur.right - de.clientWidth),
             overBottom: Math.round(ur.bottom - de.clientHeight),
             liVis: liVis, liTotal: ul.querySelectorAll('li').length,
             clientH: ul.clientHeight, scrollH: ul.scrollHeight };
}"""

SUBMIT_PROBE = """() => {
    var dd = document.querySelector('.cbi-page-actions .cbi-dropdown');
    dd.dispatchEvent(new MouseEvent('click',
        {bubbles: true, cancelable: true, view: window}));
}"""


def remember_check(pg, tag):
    m = pg.evaluate("""() => {
        var lab = document.querySelector('.mz-remember');
        var cb = document.querySelector('#mz-remember');
        var inp = document.querySelector('#luci_username');
        if (!lab || !cb || !inp) return null;
        return { j: getComputedStyle(lab).justifyContent,
                 d: Math.round(cb.getBoundingClientRect().left -
                               inp.getBoundingClientRect().left) };
    }""")
    chk("[%s] remember row present" % tag, m is not None, str(m))
    if m:
        chk("[%s] remember row left-aligned" % tag,
            m["j"] in ("flex-start", "normal") and abs(m["d"]) <= 4,
            "justify=%s delta=%s" % (m["j"], m["d"]))


def main():
    real = "--real" in sys.argv
    shot = None
    if "--shot" in sys.argv:
        shot = sys.argv[sys.argv.index("--shot") + 1]

    if not PASS:
        print("MZ_PASS is required", file=sys.stderr)
        return 2

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)

        # ---- login page: remember-me alignment (desktop + phone) ----
        for tag, vp in (("pc", {"width": 1440, "height": 900}),
                        ("mob", {"width": 390, "height": 844})):
            ctx = b.new_context(viewport=vp)
            pg = ctx.new_page()
            pg.goto(BASE + "/cgi-bin/luci/", wait_until="networkidle")
            pg.wait_for_timeout(600)
            remember_check(pg, tag)
            if shot:
                pg.screenshot(path=os.path.join(shot, "saveapply_login_%s.png" % tag))
            ctx.close()

        # ---- action bar ----
        ctx = b.new_context(viewport={"width": 390, "height": 844})
        pg = ctx.new_page()
        posts = []
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:160]))

        login(pg)

        if real:
            def rec(route):
                if route.request.method == "POST":
                    posts.append(route.request.url)
                route.continue_()
            pg.route("**/**", rec)
        else:
            # Default: intercept page-form writes only (LuCI CGI) - prove the
            # submit, change nothing. /ubus/ RPC must pass through or the
            # page never renders its form at all.
            def intercept(route):
                req = route.request
                if req.method == "POST" and "/cgi-bin/luci/" in req.url:
                    posts.append(req.url)
                    route.fulfill(status=200, content_type="text/html",
                                  body="<html><body>intercepted</body></html>")
                else:
                    route.continue_()
            pg.route("**/**", intercept)

        pg.goto(BASE + PAGE, wait_until="networkidle")
        pg.wait_for_timeout(1500)
        pg.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        pg.wait_for_timeout(500)

        rev = pg.evaluate(
            "() => { var m = document.querySelector('meta[name=mz-asset-rev]');"
            "        return m ? m.content : null; }")
        chk("asset rev present", bool(rev), str(rev))

        pg.evaluate(OPEN_CARET)
        pg.wait_for_timeout(500)
        st = pg.evaluate(MENU_STATE)
        chk("menu opens (ul.dropdown + visible)",
            bool(st.get("open") and st.get("hasUl") and st.get("vis")), str(st))
        chk("every option visible", st.get("liVis", 0) >= st.get("liTotal", 99)
            and st.get("liVis", 0) >= 2,
            "%s/%s" % (st.get("liVis"), st.get("liTotal")))
        chk("menu not squashed (h == scrollH)", st.get("clientH") == st.get("scrollH"),
            "client=%s scroll=%s" % (st.get("clientH"), st.get("scrollH")))
        chk("menu inside viewport", st.get("overRight", 0) <= 0
            and st.get("overBottom", 0) <= 0,
            "overR=%s overB=%s" % (st.get("overRight"), st.get("overBottom")))
        if shot:
            pg.screenshot(path=os.path.join(shot, "saveapply_menu_open.png"))

        pg.evaluate(OPEN_CARET)
        pg.wait_for_timeout(400)
        chk("menu closes again", pg.evaluate(
            "() => !document.querySelector('.cbi-page-actions .cbi-dropdown')"
            ".hasAttribute('open')"))

        posts.clear()
        pg.evaluate(SUBMIT_PROBE)
        pg.wait_for_timeout(4000)
        chk("main face triggers submit", len(posts) >= 1,
            "posts=%d" % len(posts))
        if real:
            chk("apply chain ran (apply_rollback)",
                any("apply_rollback" in u for u in posts), str(posts[-2:]))

        # force-apply selection flips the pill, then the face submits
        posts.clear()
        pg.goto(BASE + PAGE, wait_until="networkidle")
        pg.wait_for_timeout(1200)
        pg.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
        pg.evaluate(OPEN_CARET)
        pg.wait_for_timeout(500)
        val = pg.evaluate("""() => {
            var dd = document.querySelector('.cbi-page-actions .cbi-dropdown');
            var li = dd.querySelector('ul.dropdown > li:nth-child(2)');
            if (!li) return 'no li';
            li.dispatchEvent(new MouseEvent('click',
                {bubbles: true, cancelable: true, view: window}));
            return dd.querySelector('input[type=hidden]').value;
        }""")
        pg.wait_for_timeout(600)
        after = pg.evaluate("""() => {
            var dd = document.querySelector('.cbi-page-actions .cbi-dropdown');
            var sel = dd.querySelector('ul > li[selected]');
            return { cls: dd.className, cap: sel ? sel.textContent.trim() : '',
                     hidden: dd.querySelector('input[type=hidden]').value };
        }""")
        chk("force-apply stored in hidden", val == "1", "value=%r" % val)
        chk("pill flips to negative",
            "negative" in after.get("cls", "")
            and "强制应用" in after.get("cap", ""), str(after))

        # plain dropdowns unaffected
        pg.goto(BASE + PAGE, wait_until="networkidle")
        pg.wait_for_timeout(1200)
        pg.evaluate("""() => {
            var dd = document.querySelector('#mz-view .cbi-dropdown:not(.cbi-button)');
            if (dd) dd.querySelector(':scope > .open').dispatchEvent(
                new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
        }""")
        pg.wait_for_timeout(500)
        norm = pg.evaluate("""() => {
            var dd = document.querySelector('#mz-view .cbi-dropdown:not(.cbi-button)');
            if (!dd) return 'none';
            var ul = dd.querySelector('ul.dropdown');
            return ul && dd.hasAttribute('open')
                && getComputedStyle(ul).display !== 'none';
        }""")
        chk("plain dropdowns still open", bool(norm), str(norm))

        chk("no horizontal overflow", pg.evaluate(
            "() => document.documentElement.scrollWidth"
            " <= document.documentElement.clientWidth + 1"))
        chk("no uncaught JS errors", len(errs) == 0, str(errs[:2]))
        ctx.close()
        b.close()

    bad = [r for r in RESULTS if not r[0]]
    print("\n===== %d/%d PASS =====" % (len(RESULTS) - len(bad), len(RESULTS)))
    for r in bad:
        print("  FAIL:", r[1], r[2])
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
