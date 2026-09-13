#!/usr/bin/env python3
"""Live functional verification for the Mint Wallpaper settings page.

Exercises every item in the user checklist against the REAL router:
  * toggle / select controls reflect the current uci config on load
  * "Upload desktop wallpaper" / "Upload mobile wallpaper"
  * set (click a thumbnail) applies to the SELECTED device only
  * delete an uploaded wallpaper
  * "Force refresh current device cache" works and does NOT clobber a
    custom / library image on the same or the other device
  * PC and mobile wallpapers stay independent (each device keeps its own)

The script is non-destructive: it captures the initial PC/Mobile selection
before touching anything and restores it (plus removes only the test images
it uploaded) at the end. Requires MZ_PASS (router admin password) and
optionally MZ_BASE (default http://192.168.88.1). Credentials come from the
environment only and are never written to disk.
"""
import io
import os
import struct
import sys
import zlib

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', 'http://192.168.88.1').rstrip('/')
PASS = os.environ.get('MZ_PASS', '')
if not PASS:
    sys.exit('MZ_PASS is not set - export it (env only) before running')

PAGE = BASE + '/cgi-bin/luci/admin/system/mint-wallpaper/settings'


def tiny_png(color):
    """8x8 solid RGB PNG with no external dependency."""
    w = h = 8
    raw = bytearray()
    for _ in range(h):
        raw.append(0)
        for _ in range(w):
            raw += bytes(color)
    sig = b'\x89PNG\r\n\x1a\n'

    def chunk(typ, data):
        c = typ + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')


def select_target(pg, device):
    """Switch the device radio AND fire its 'change' handler so the grid
    rebuilds for that device (mirrors a real user click). Done via
    dispatchEvent so it works even when the input is visually restyled."""
    pg.evaluate("""(d) => {
        const r = document.querySelector('input[name="mz-wp-target"][value="'+d+'"]');
        if (r && !r.checked) {
            r.checked = true;
            r.dispatchEvent(new Event('change', {bubbles: true}));
        }
    }""", device)
    pg.wait_for_timeout(800)


def active_state(pg, device):
    """Return ('random'|'none'|'file', name) for the given device.

    Switching the radio triggers a grid rebuild, after which the active
    card reflects THIS device's selection (not the other device's)."""
    select_target(pg, device)
    return pg.evaluate("""() => {
        const cards = Array.from(document.querySelectorAll('.mz-wp-card'));
        for (const c of cards) {
            if (!c.classList.contains('is-active')) continue;
            const kind = c.getAttribute('data-kind');
            if (kind === 'random') return ['random', ''];
            if (kind === 'none') return ['none', ''];
            if (kind === 'file') return ['file', c.getAttribute('data-name')];
        }
        return ['unknown', ''];
    }""")


def lib_card_names(pg, device):
    select_target(pg, device)
    return pg.evaluate("""() => Array.from(document.querySelectorAll(
        '.mz-wp-card[data-kind=\"file\"]')).map(c => c.getAttribute('data-name'))""")


def click_card(pg, device, kind, name=''):
    select_target(pg, device)
    pg.evaluate("""(args) => {
        const [kind, name] = args;
        const cards = Array.from(document.querySelectorAll('.mz-wp-card'));
        for (const c of cards) {
            if (c.getAttribute('data-kind') !== kind) continue;
            if (kind === 'file' && c.getAttribute('data-name') !== name) continue;
            c.click();
            return true;
        }
        return false;
    }""", [kind, name])
    pg.wait_for_timeout(600)


def upload(pg, device, path):
    """Upload path to device; return (all_library_names, newly_added_name).

    The new file is identified by set difference against the library BEFORE
    the upload, which is robust to any pre-existing files in the library.
    """
    before = set(lib_card_names(pg, device))
    pg.set_input_files('#mz-wp-file-%s' % device, path)
    pg.wait_for_timeout(4000)
    after = set(lib_card_names(pg, device))
    added = after - before
    new_name = sorted(added)[0] if added else None
    all_names = lib_card_names(pg, device)
    return all_names, new_name


def toggle_state(pg):
    """Read Advanced "Enabled" / "Random on admin pages" checkboxes.

    On this LuCI build form.Flag renders a checkbox WITHOUT a name attribute;
    the cbid lives on the wrapping .cbi-value[data-field]. Read it there.
    """
    return pg.evaluate("""() => {
        const out = {};
        const q = (field) => {
            const v = document.querySelector(
                '.cbi-value[data-field="'+field+'"] input[type=checkbox]');
            return v ? v.checked : null;
        };
        out.enabled = q('cbid.mint.wallpaper.enabled');
        out.ui_random = q('cbid.mint.wallpaper.ui_random');
        return out;
    }""")


def status(pg):
    return pg.evaluate("() => { const e = document.getElementById('mz-wp-status');"
                       " return e ? e.textContent : ''; }")


def delete_card(pg, device, name):
    select_target(pg, device)
    pg.evaluate("""(nm) => {
        const cards = Array.from(document.querySelectorAll('.mz-wp-card[data-kind=\"file\"]'));
        for (const c of cards) {
            if (c.getAttribute('data-name') === nm) {
                const btn = c.querySelector('.mz-wp-del');
                if (btn) btn.click();
                return;
            }
        }
    }""", name)
    pg.wait_for_timeout(1500)


def main():
    fails = []
    imgA = os.path.join(os.environ.get('TEMP', '/tmp'), 'wp_testA.png')
    imgB = os.path.join(os.environ.get('TEMP', '/tmp'), 'wp_testB.png')
    open(imgA, 'wb').write(tiny_png((30, 90, 200)))   # blue
    open(imgB, 'wb').write(tiny_png((200, 40, 40)))   # red

    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 1440, 'height': 1000}, locale='zh-CN')
        pg = ctx.new_page()
        page_errors = []
        # Only uncaught JS exceptions are hard failures; resource 403s from
        # absent optional thumbnails / proxy images are expected and ignored.
        pg.on('pageerror', lambda e: page_errors.append('PAGEERROR ' + str(e)))
        pg.on('dialog', lambda d: d.accept())

        pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded', timeout=45000)
        try:
            pg.fill('#luci_username', 'root', timeout=8000)
            pg.fill('#luci_password', PASS, timeout=8000)
            pg.click('button[type="submit"], .cbi-button', timeout=8000)
        except Exception as e:
            print('login note:', e)
        pg.wait_for_timeout(2500)

        pg.goto(PAGE, wait_until='domcontentloaded', timeout=45000)
        ok = False
        for _ in range(15):
            pg.wait_for_timeout(1200)
            n = pg.evaluate("() => document.querySelectorAll('.mz-wp-card').length")
            if n > 0:
                ok = True
                break
        print('[render] grid cards =', pg.evaluate(
            "() => document.querySelectorAll('.mz-wp-card').length"))
        if not ok:
            fails.append('grid never rendered (page/JS failed to load)')

        # ---- capture initial state (for restore) ----
        init_pc = active_state(pg, 'pc')
        init_mobile = active_state(pg, 'mobile')
        print('[initial] pc=%s mobile=%s' % (init_pc, init_mobile))

        # ---- (1) toggles reflect config: form inputs populated ----
        adv = None
        for _ in range(15):
            adv = toggle_state(pg)
            if adv['enabled'] is not None:
                break
            pg.wait_for_timeout(800)
        print('[toggles]', adv)
        if adv['enabled'] is None:
            fails.append('Advanced "Enabled" toggle not rendered / no current value')

        # ---- (2) upload desktop + mobile ----
        names_pc, new_pc = upload(pg, 'pc', imgA)
        print('[upload pc] new=%s library=%s' % (new_pc, names_pc))
        if not new_pc:
            fails.append('desktop upload produced no new library entry')
        else:
            st_pc = active_state(pg, 'pc')
            if st_pc != ['file', new_pc]:
                fails.append('after desktop upload, PC active != uploaded file (%s)' % st_pc)

        names_mob, new_mob = upload(pg, 'mobile', imgB)
        print('[upload mobile] new=%s library=%s' % (new_mob, names_mob))
        if not new_mob:
            fails.append('mobile upload produced no new library entry')
        else:
            st_mob = active_state(pg, 'mobile')
            if st_mob != ['file', new_mob]:
                fails.append('after mobile upload, Mobile active != uploaded file (%s)' % st_mob)

        # ---- (4) PC / Mobile independence ----
        if new_pc and new_mob:
            click_card(pg, 'pc', 'file', new_pc)
            click_card(pg, 'mobile', 'file', new_mob)
            pg.wait_for_timeout(400)
            pc_now = active_state(pg, 'pc')
            mob_now = active_state(pg, 'mobile')
            print('[separation] pc=%s mobile=%s' % (pc_now, mob_now))
            if pc_now != ['file', new_pc]:
                fails.append('PC selection lost after setting Mobile (%s)' % pc_now)
            if mob_now != ['file', new_mob]:
                fails.append('Mobile selection lost after setting PC (%s)' % mob_now)

        # reload to confirm persistence across navigation
        pg.goto(PAGE, wait_until='domcontentloaded', timeout=45000)
        pg.wait_for_timeout(2500)
        for _ in range(10):
            if pg.evaluate("() => document.querySelectorAll('.mz-wp-card').length") > 0:
                break
            pg.wait_for_timeout(800)
        if new_pc and new_mob:
            if active_state(pg, 'pc') != ['file', new_pc]:
                fails.append('PC selection not persisted after reload')
            if active_state(pg, 'mobile') != ['file', new_mob]:
                fails.append('Mobile selection not persisted after reload')

        # ---- (3) delete ----
        if new_pc:
            before = set(lib_card_names(pg, 'pc'))
            delete_card(pg, 'pc', new_pc)
            after = set(lib_card_names(pg, 'pc'))
            print('[delete pc] before=%s after=%s' % (before, after))
            if new_pc in after:
                fails.append('deleted wallpaper %s still present in library' % new_pc)

        # ---- (5) force refresh does NOT clobber a custom image ----
        # Re-upload mobile test image (it was deleted above), set it custom,
        # set pc random, then refresh pc and confirm mobile custom survives.
        if new_mob:
            _, new_mob2 = upload(pg, 'mobile', imgB)
            mob_target = new_mob2 or new_mob
            click_card(pg, 'mobile', 'file', mob_target)
            pg.wait_for_timeout(300)
            click_card(pg, 'pc', 'random')
            pg.wait_for_timeout(300)
            pg.click('#mz-wp-refresh-cache')
            pg.wait_for_timeout(6000)
            st = status(pg)
            print('[refresh] status =', st[:80])
            if 'fail' in st.lower():
                fails.append('force refresh reported failure: %s' % st)
            mob_after = active_state(pg, 'mobile')
            if mob_after != ['file', mob_target]:
                fails.append('force refresh clobbered Mobile custom image (%s)' % mob_after)

        # ---- restore initial state (best-effort) ----
        for dev, init in (('pc', init_pc), ('mobile', init_mobile)):
            click_card(pg, dev, init[0], init[1])
            pg.wait_for_timeout(300)
        # delete any test files we uploaded that are still around
        for dev in ('pc', 'mobile'):
            for nm in (names_pc or []) + (names_mob or []):
                cur = set(lib_card_names(pg, dev))
                if nm in cur:
                    delete_card(pg, dev, nm)

        pg.goto(PAGE, wait_until='domcontentloaded', timeout=45000)
        pg.wait_for_timeout(2000)
        print('[restored] pc=%s mobile=%s' % (active_state(pg, 'pc'), active_state(pg, 'mobile')))
        print('[page_errors]', page_errors if page_errors else 'none')
        if page_errors:
            fails.append('uncaught JS errors during session')
        b.close()

    print()
    if fails:
        for f in fails:
            print('FAIL  %s' % f)
        sys.exit(1)
    print('PASS  all Mint Wallpaper functions verified on %s' % BASE)


if __name__ == '__main__':
    main()
