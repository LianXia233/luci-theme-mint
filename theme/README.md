# luci-theme-mint — Mint

A modern LuCI theme for current **OpenWrt main / LuCI master** (ucode template
engine). The package is pure data (`htdocs` + `root` + ucode templates + `po`,
no `src/`), so it is architecture independent (`LUCI_PKGARCH:=all`).

Design direction: modern status overview, card UI, high information density
with generous whitespace, Apple/Linear-like restraint. Not a CSS reskin of
another theme — templates, menu rendering, the overview dashboard, the login
page and the settings view are all implemented against the current LuCI master
theme interface.

**A single theme variant is registered** (`luci.themes.mint` →
`/luci-static/mint`). Light/dark is a per-browser frontend switch
(`localStorage['mz-theme']`, default: follow `prefers-color-scheme`), not
separate `mint-light` / `mint-dark` registrations.

The repository root [`README.md`](../README.md) documents CI, the release
pipeline and the local verification scripts; this file documents the package
itself.

## Features (each item exists in the shipped code)

- Design-token CSS system in `cascade.css` (~5.6k lines): color, radius,
  shadow, spacing, typography, layout; light values on `:root`, dark values on
  `html[data-theme="dark"]` (dark is never pure black, `color-scheme: dark`)
- Sidebar navigation rendered from the live `ui.menu` tree (max 3 levels),
  collapsible groups whose state persists in `localStorage['mz-nav-<label>']`
- Mobile drawer + overlay + sticky glass top bar (`≤854px`) that hosts the page
  title; responsive at ≤480/640/767/854px and ≥1024/1400/1600px; mobile tables
  reflow to cards
- Login page: 100% stock LuCI authentication form (plain POST), plus
  remember-username, wallpaper background, `auth_fields` / `auth_html` /
  `auth_assets` passthrough for 2FA plugins, and a Passkey button that is only a
  contract slot (hidden + disabled; an auth plugin enables it — the theme ships
  no WebAuthn logic)
- Wallpapers: per-device-class sources; priority custom upload → custom direct
  link → server-side 5-minute cache file → shuffled remote sources → built-in
  CSS gradient. Never blocks or breaks the login page
- Status overview enhancement (Overview only): live dashboard on desktop,
  compact panel re-layout on mobile; unsupported values render as `--`/`N/A`,
  nothing is faked
- `Status > nftables` enhancement: chain grouping by family/purpose, per-chain
  collapse, rule/traffic summaries, search filter, zero-traffic row folding
- Form reliability fallback: injects a missing `<form>` around `.cbi-map` and
  takes over Save / Save & Apply so the change is really `uci commit`-ted (see
  “Save fallback”)
- `mz-ui.js` (all admin pages): success notification for `uci-applied` /
  `uci-reverted` (replayed once after the reload), explicit edit/delete buttons
  for every `cbi-dynlist` item
- Fully themed LuCI chrome: `#modal_overlay` dialogs, `ul.cbi-tabmenu`,
  `cbi-dropdown` (including `[open]` and the `ul.preview` distinction), the
  Save-&-Apply split button, progress bars, alerts, ifaceboxes/tooltips
- Third-party app token bridge (`--brand`, `--surface`, `--text`, `--hairline`,
  …) and a contrast fix for `h5000m_netmode` cards
- Accessibility: skip link, `:focus-visible`, `aria-label` on icon buttons,
  `aria-live` top bar, sr-only chart captions, ring values as real text,
  `prefers-reduced-motion` fallback, `<meta name="darkreader-lock">`
- No CDN, no web fonts, no icon fonts, no frontend framework, no jQuery
- i18n: English source strings + Simplified Chinese catalog, compiled by
  `luci.mk` into the **separate** package `luci-i18n-mint-zh-cn`

## Layout

```
luci-theme-mint/                 # this directory == feeds/luci/themes/luci-theme-mint/
├── Makefile                     # luci.mk package: deps, conffiles, postinst/postrm
├── htdocs/luci-static/mint/     # → /www/luci-static/mint
│   ├── cascade.css              # design tokens + layout + component overrides
│   ├── overview-dashboard.css   # dashboard styles (.mint-overview-dashboard namespace)
│   ├── mz-ui.js                 # shared admin-page helpers (all pages)
│   ├── overview-dashboard.js    # desktop live dashboard (Overview only)
│   ├── overview-mobile.js       # mobile Overview panel re-layout
│   ├── mz-nftables.js           # Status > nftables enhancer
│   ├── overview-banner.png, login-logo.png, favicon/*
├── htdocs/luci-static/resources/ # → /www/luci-static/resources
│   ├── menu-mint.js             # sidebar/drawer, color scheme, wallpaper, save fallback
│   └── view/mint/{sysauth,wallpaper}.js
├── ucode/template/themes/mint/  # → /usr/share/ucode/luci/template/themes/mint
│   ├── header.ut                # shell, sidebar, top bar, inline window.mintWallpaper
│   ├── footer.ut                # footer, L.require('menu-mint'), per-path script injection
│   └── sysauth.ut               # login page
├── ucode/mint/wallpaper.uc      # → /usr/share/ucode/luci/mint/wallpaper.uc
├── root/etc/config/mint         # UCI defaults (also declared a conffile)
├── root/etc/uci-defaults/30_luci-theme-mint
├── root/lib/upgrade/keep.d/luci-theme-mint
├── root/usr/libexec/rpcd/mint   # ubus object: refresh (stub) / dashboard / save
├── root/usr/bin/mz-wallpaper-fetch.sh  # cron wallpaper refresher (0755 is mandatory)
├── root/usr/share/luci/menu.d/luci-theme-mint.json
├── root/usr/share/rpcd/acl.d/luci-theme-mint.json   # NOT /usr/share/luci/acl.d
└── po/{templates/theme.pot,zh_Hans/luci-theme-mint.po}
```

ACLs live in `/usr/share/rpcd/acl.d/` (upstream LuCI has not read
`/usr/share/luci/acl.d` for years); `postinst` and the uci-defaults script only
delete leftovers from that legacy path.

## Installation

Install the theme **together with** the translation package (a theme-only
install shows English, by design):

```sh
apk add --allow-untrusted ./luci-theme-mint-*.apk ./luci-i18n-mint-zh-cn-*.apk   # 25.12+
opkg install ./luci-theme-mint-*.ipk ./luci-i18n-mint-zh-cn-*.ipk                # 24.10 / 23.05
```

From source: put this directory into `feeds/luci/themes/luci-theme-mint/`, then

```sh
./scripts/feeds update -a
./scripts/feeds install luci-theme-mint
make menuconfig      # LuCI ▸ 4. Themes ▸ luci-theme-mint (and luci-i18n-mint-zh-cn)
make package/luci-theme-mint/compile V=s
```

`CONFIG_PACKAGE_luci-i18n-mint-zh-cn=m` must be set explicitly: the generated
translation package is `HIDDEN` in menuconfig and defaults to `n`. The build
needs `luci-base/host` (`po2lmo`, `jsmin`); `csstidy` is intentionally off.
`LUCI_MINIFY_UT:=0` keeps `.ut` files as source because `header.ut` imports the
theme's own module `luci.mint.wallpaper`, which the build host cannot resolve.

## Enabling / disabling

`uci-defaults` registers `luci.themes.mint` and activates the theme **on fresh
installs only** (upgrades never touch `luci.main.mediaurlbase`). Manually:

```sh
uci set luci.main.mediaurlbase=/luci-static/mint
uci commit luci
/etc/init.d/rpcd reload      # reload, never restart: restart drops all ubus sessions
```

## Configuration: `/etc/config/mint`

Single section `config mint 'wallpaper'`; the shipped defaults, the
uci-defaults seed, the form defaults and the runtime fallback in
`wallpaper.uc` all agree.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | bool | `1` | master switch; `0` disables every wallpaper request (gradient only) |
| `ui_random` | bool | **`0`** | also use a random wallpaper on admin pages (login page is unaffected); off by default so a fresh install never talks to third-party APIs in the background |
| `pc_mode` | `random`/`custom` | `random` | desktop source |
| `pc_url` | http(s) URL | – | desktop custom link (an uploaded `custom-pc.jpg` wins) |
| `pc_sources` | list | `api.paugram.com/wallpaper/`, `t.alcy.cc/bd` | desktop random sources; empty → built-in defaults |
| `mobile_mode` | `random`/`custom` | `random` | mobile source |
| `mobile_url` | http(s) URL | – | mobile custom link (uploaded `custom-mobile.jpg` wins) |
| `mobile_sources` | list | `api.seaya.link/wap`, `t.alcy.cc/mp` | mobile random sources |
| `overlay` | float | `0.45` | dim overlay opacity; accepted as `0`/`1`/`0.x`/`1.0*`, anything else falls back to `0.45` |
| `blur` | px | `0` | background blur, clamped to `0..40` |

`overlay`/`blur` are clamped server-side in `wallpaper.uc`, so a hand-edited
UCI value can neither break the CSS nor emit invalid style output. Custom URLs
must be absolute `http(s)` and contain no quotes/spaces/backticks/angle
brackets/newlines before they are ever embedded into the page.

## Wallpaper pipeline

```
/etc/config/mint → ucode/mint/wallpaper.uc (config only, no network, no cache)
        → header.ut inlines window.mintWallpaper (no extra request)
        → sysauth.js (login) / menu-mint.js (admin)
        custom file → custom URL → proxy file → shuffled remote sources → CSS gradient
```

- Random APIs answer every request with a **302 to a different image**, so no
  browser-side trick can pin one picture. `root/usr/bin/mz-wallpaper-fetch.sh`
  resolves the randomness router-side (installed by uci-defaults as
  `*/5 * * * * … #mz-wallpaper`), writing
  `/www/luci-static/mint/wallpaper-{pc,mobile}.img`. uhttpd then serves them
  with `Last-Modified`, so repeat views hit 304 and the page keeps **one**
  image per 5-minute window. If the file is missing, the frontend falls back to
  shuffling the configured sources; admin pages additionally remember the last
  working URL in `sessionStorage['mz-wp-url-<kind>']` for 5 minutes.
- Fetch script hardening: `http(s)` only (before and after redirects), 8 MiB
  `--max-filesize`, ≥3 KB plus a real JPEG/PNG/GIF/WEBP magic check (read with
  `od`, since PNG's header contains NUL bytes), temp file + atomic `mv`,
  `flock -n` single instance, `--` end-of-options, and the seaya HTML page is
  scraped for a direct `img.seaya.link` URL which is then re-validated.
- Dark mode never fetches a wallpaper for admin pages: `menu-mint.js` strips
  `--mz-wallpaper*` and keeps the glass layer (pure-black glass).
- Preloaded via `new Image()` with `referrerPolicy: 'no-referrer'`, 16 s
  timeout per source, fade-in on success; the source label in the bottom-right
  corner of the login page (local custom / cached random / hostname) is never
  removed.
- `ubus call mint refresh` is a compatibility stub only (returns
  `{"spawned":false,"mode":"random"}`); to force a new image run
  `/usr/bin/mz-wallpaper-fetch.sh` once.

## Settings page

`System ▸ Mint Wallpaper ▸ Wallpaper Settings`
(`/cgi-bin/luci/admin/system/mintwallpaper/settings`), a `form.Map('mint')` on
the named section `wallpaper`. Uploading writes through the stock `file` ubus
object to `/www/luci-static/mint/custom-{pc,mobile}.jpg` (≤3 MiB,
`image/jpeg,image/png,image/webp`); the input is disabled during the transfer,
and the source mode is *not* switched automatically (upload only stores the
file — set the matching mode to “Custom image”).

The view first waits for a usable ubus session: `uci.load('mint')` can be
rejected during LuCI's anonymous-session window and that rejection gets cached,
so each attempt is bounded by a 3 s timeout, `uci.unload()`-ed and retried up
to 10 times; if it still fails, the form renders empty instead of hanging on
“Loading view…”.

The menu is hidden unless the `luci-theme-mint` ACL group exists and
`/etc/config/mint` is present (`depends.acl` / `depends.uci`).

## Overview dashboard

`ubus call mint dashboard` (implemented in `root/usr/libexec/rpcd/mint`) is a
stateless collector: `/proc/stat`, `/proc/meminfo`, `/proc/loadavg`,
`/proc/uptime`, conntrack, `df -k /`, thermal zones + hwmon,
`ubus call network.interface dump` (uplink picked by default route — no
hard-coded `wan`, and IPv6 is looked up on the sibling interface sharing the
`l3_device`), `ubus call system board`, and the public IPv4 via `ipv4.im`
(cached 5 min in `/tmp`, 2 × 2 s retries, then backoff until a `ping` probe to
a public host succeeds; on failure it reports `未联网`). All strings are
JSON-escaped. Percentages, rates and CPU deltas are computed in the browser.

`overview-dashboard.js` renders 4 SVG rings (CPU / memory / temperature /
storage), 6 stat cards, 3 canvas charts (180 samples ≈ 3 min) and 9 system-info
rows. Polling: 1 s fast, 3 s medium, 10 s slow; 10 s while the tab is hidden;
everything (timers, `ResizeObserver`, `MutationObserver`) is torn down when
leaving Overview so repeated visits never leak. `footer.ut` hides the stock
System / Memory / Storage sections so each figure appears exactly once.
`overview-mobile.js` re-reads the stock Overview DOM into cards (ports, DHCP
leases, wireless, UPnP) and patches values in place instead of rebuilding.

## Save fallback

Some LuCI builds ship a stripped `cbi.js` whose `save()` issues `uci set`
without `uci commit`, and the session-level `uci commit` RPC is denied by ACL —
so toggles silently never reach disk. `menu-mint.js` therefore:

1. wraps `.cbi-map` + the action bar in a `<form>` **only when no form exists**;
2. snapshots every widget's rendered value into `data-mint-init` and later
   submits **only changed** options (empty password fields and unselected radios
   are skipped), so saving a stale tab cannot rewrite newer state;
3. calls `ubus call mint save` (root inside rpcd) which performs
   `uci set` + `uci commit`, logs the option names via `logger`, and sanitises
   `config`/`section`/option names to `[A-Za-z0-9_]`.

## i18n

`po/zh_Hans/luci-theme-mint.po` is complete (109 strings); `luci.mk` compiles it
into the separate package `luci-i18n-mint-zh-cn`
(`/usr/lib/lua/luci/i18n/luci-theme-mint.zh-cn.lmo`). `postinst` also creates
`zh_cn` / `zh_CN` symlinks for firmwares that spell `luci.main.lang`
differently; `postrm` removes them. Plain scripts (not LuCI classes) have no
scoped `_`, so `mz-ui.js` and `overview-mobile.js` fall back to a
server-compatible SuperFastHash lookup into `window.TR` — the hash must match
the lmo builder's variant (unsigned `>>>` shifts, `rem==2` xors the C string's
NUL), otherwise some msgids silently miss.

## Runtime dependencies

`LUCI_DEPENDS:=+luci-base +curl`

| Dependency | Why |
|---|---|
| `luci-base` | ucode template runtime, `luci.core`, ACL bridge, `cbi.js`, `file` ubus object, translation endpoint |
| `curl` | the only downloader used by `mz-wallpaper-fetch.sh`; stock images ship `uclient-fetch` only, so without it the cron can never succeed |
| `luci-i18n-mint-zh-cn` | Simplified Chinese UI (install as a pair with the theme) |
| `luci-i18n-base-zh-cn` | Simplified Chinese for stock LuCI strings (recommended) |

## Compatibility

- OpenWrt 23.05+ / main / snapshot (ucode templates, `.ut`). ImmortalWrt
  follows from using nothing but the upstream LuCI theme API; CI builds only
  against official OpenWrt SDKs, so no ImmortalWrt-specific artifact is
  published. Not supported on LEDE / OpenWrt ≤ 19.07 (no ucode templates, no
  `/usr/share/rpcd/acl.d`).
- Browsers: Chrome/Chromium, Firefox, Safari, Edge, Android WebView/Chrome,
  iOS Safari (recent). CSS custom properties, flexbox and grid are required;
  `backdrop-filter` and `MutationObserver` are progressive enhancement only.
- Without JavaScript the login form and the pages still render and
  authenticate; menu rendering, wallpapers and the dashboards do not.
- Upgrade semantics: `/etc/config/mint` is a conffile (an upgrade must not
  reset the admin's sources/overlay/blur), `postinst` only **reloads** rpcd, and
  `postrm` exits immediately on `upgrade|deconfigure`.
- `sysupgrade` keeps the uploaded `custom-*.jpg` via
  `/lib/upgrade/keep.d/luci-theme-mint`; the `wallpaper-*.img` cache files are
  deliberately not kept (cron regenerates them within one period).

## Troubleshooting

- Theme not selectable: `sh /etc/uci-defaults/30_luci-theme-mint`, then
  `/etc/init.d/rpcd reload`; clear `rm -f /tmp/luci-indexcache*` if the menu is
  stale.
- 404 CSS/JS: `luci.main.mediaurlbase` must be exactly `/luci-static/mint`
  (the removed `mint-light` / `mint-dark` / `mintzero*` paths are rewritten by
  the uci-defaults script).
- Settings page missing: the menu depends on the rpcd ACL group and on
  `/etc/config/mint` existing; a stale `/usr/share/luci/acl.d/luci-theme-mint.json`
  overrides the grants and is removed by `postinst`.
- English UI: install `luci-i18n-mint-zh-cn` and check `luci.main.lang`.
- No wallpaper: expected when offline or when the third-party APIs are down —
  upload a custom image for a fully offline setup.
- Same wallpaper every reload: that is the 5-minute cache (server file +
  `sessionStorage`); check `logread -e mz-wallpaper` for refused sources.
- Color scheme: sidebar button cycles system → light → dark.

## License

Apache-2.0. See [LICENSE](./LICENSE).
