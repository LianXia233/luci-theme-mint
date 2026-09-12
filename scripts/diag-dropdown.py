"""Diagnostics: why is the popup still tall, and what overflows 16px?"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')
TARGET = sys.argv[1] if len(sys.argv) > 1 else '/cgi-bin/luci/admin/services/homeproxy/client'

with sync_playwright() as p:
    b = p.chromium.launch(args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, locale='zh-CN')
    pg = ctx.new_page()
    pg.goto(BASE + '/cgi-bin/luci/', wait_until='domcontentloaded', timeout=45000)
    try:
        pg.fill('#luci_username', 'root', timeout=8000)
        pg.fill('#luci_password', PASSWORD, timeout=8000)
        pg.click('button[type="submit"], .cbi-button', timeout=8000)
    except Exception as e:
        print('skip', e)
    pg.wait_for_timeout(2500)
    pg.goto(BASE + TARGET, wait_until='domcontentloaded', timeout=45000)
    pg.wait_for_timeout(2500)

    print('=== overflow offenders (1440) ===')
    off = pg.evaluate("""() => {
        const vw = document.documentElement.clientWidth;
        const out = [];
        document.querySelectorAll('*').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width === 0) return;
            if (r.right > vw + 1 || r.left < -1) {
                out.push({
                    tag: el.tagName.toLowerCase(),
                    cls: (el.className || '').toString().slice(0, 60),
                    id: el.id || '',
                    left: Math.round(r.left), right: Math.round(r.right),
                    w: Math.round(r.width)
                });
            }
        });
        return out.slice(0, 25);
    }""")
    for o in off:
        print('  %-6s %-40s #%-14s left=%d right=%d w=%d'
              % (o['tag'], o['cls'], o['id'], o['left'], o['right'], o['w']))
    print('  scrollW/clientW:',
          pg.evaluate("() => [document.documentElement.scrollWidth,"
                      " document.documentElement.clientWidth]"))

    print()
    print('=== dropdown popup computed style ===')
    pg.evaluate("""() => {
        const d = document.querySelectorAll('.cbi-dropdown')[0];
        if (d) { d.scrollIntoView({block:'center'}); d.click(); }
    }""")
    pg.wait_for_timeout(600)
    info = pg.evaluate("""() => {
        const dd = document.querySelectorAll('.cbi-dropdown')[0];
        if (!dd) return null;
        const res = [];
        dd.querySelectorAll(':scope > ul').forEach((u, i) => {
            const cs = getComputedStyle(u);
            const r = u.getBoundingClientRect();
            res.push({
                idx: i,
                cls: u.className || '(none)',
                display: cs.display,
                position: cs.position,
                maxHeight: cs.maxHeight,
                height: cs.height,
                overflowY: cs.overflowY,
                inlineStyle: u.getAttribute('style') || '',
                rect: [Math.round(r.width), Math.round(r.height)]
            });
        });
        return {open: dd.classList.contains('open') ||
                      dd.hasAttribute('open'), uls: res};
    }""")
    print(json.dumps(info, indent=1, ensure_ascii=False))
    b.close()
