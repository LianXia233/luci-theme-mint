"""Dump the DOM of a page section matched by a keyword (for UI bug triage)."""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get('MZ_BASE', '')


def main():
    url = sys.argv[1] if len(sys.argv) > 1 else \
        '/cgi-bin/luci/admin/status/overview'
    kw = sys.argv[2] if len(sys.argv) > 2 else '\u9690\u85cf'

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
        pg.wait_for_timeout(2200)

        hits = pg.evaluate(
            """(kw) => {
                const out = [];
                document.querySelectorAll('*').forEach((el) => {
                    if (el.children.length) return;
                    if ((el.textContent || '').trim() !== kw) return;
                    let host = el;
                    for (let i = 0; i < 4 && host.parentElement; i++)
                        host = host.parentElement;
                    out.push({
                        chain: (function() {
                            const c = [];
                            let n = el;
                            while (n && n.tagName !== 'BODY') {
                                c.push(n.tagName.toLowerCase() +
                                    (n.className ? '.' +
                                        String(n.className).slice(0, 40) : ''));
                                n = n.parentElement;
                            }
                            return c.slice(0, 5);
                        })(),
                        html: host.outerHTML.slice(0, 900)
                    });
                });
                return out;
            }""", kw)
        for h in hits[:4]:
            print('--- chain:', ' < '.join(h['chain']))
            print(h['html'])
            print()
        if not hits:
            print('no element with text', kw)
        br.close()


if __name__ == '__main__':
    main()
