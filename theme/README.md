# mint

A modern, lightweight, responsive LuCI theme for current OpenWrt/LuCI master
(ucode-based, ucode template engine).

Design direction: modern status overview, card UI, high information density
with generous whitespace, Apple/Linear-like restraint. Not a CSS reskin of
another theme; templates and menu rendering are implemented against the
current LuCI master theme interface.

## Features

- Modern design system built on CSS variables (design tokens): color, spacing,
  radius, shadow, typography
- Light / Dark / System color schemes (System is the default, honors
  `prefers-color-scheme`; per-browser override via sidebar toggle)
- Fullscreen random-wallpaper login page with gradient fallback; custom
  wallpapers supported (upload an image or paste a direct image link)
- Sidebar navigation rendered from the live LuCI menu tree (no hardcoded menus)
- Mobile drawer navigation with overlay
- Responsive from 480px to 1280px+; tables reflow to cards on mobile
- Status overview enhancement (loaded on Status > Overview only): port status,
  system information, DHCP/Wireless/UPnP sections rendered as cards;
  unsupported values show N/A, never fake numbers
- Accessible: skip link, focus-visible outlines, aria labels, keyboard
  operable login
- No CDN, no web fonts, no icon fonts, no frontend frameworks, no jQuery
- i18n ready (English + Simplified Chinese, po compiled to lmo at build time)

## Installation

### From source (in OpenWrt buildroot)

Clone this repository into your buildroot `package/` directory (or add it as a
feed), then:

```sh
./scripts/feeds update -a
./scripts/feeds install luci-theme-mint
make menuconfig   # LuCI -> 4. Themes -> luci-theme-mint
make package/luci-theme-mint/compile V=s
```

Install the resulting `luci-theme-mint_*.apk`/`.ipk` on the device, or use
`opkg install` / `apk add` with the built artifact.

### Selecting the theme

After installation the theme is registered automatically via uci-defaults:

```sh
uci set luci.main.mediaurlbase=/luci-static/mint
uci commit luci
/etc/init.d/rpcd reload
```

## Random Wallpaper

The login page can display a random wallpaper picked per device type.

### How it works

```
Third-party random image APIs (fetched directly by the browser,
never proxied through the router)
  desktop: api.paugram.com/wallpaper/
  mobile (UA detected): api.seaya.link/wap
        |
  custom image wins when set (uploaded custom-pc.jpg /
  custom-mobile.jpg, or an http(s) direct link)
        |
  login/admin page JS (preloads via new Image(), fade-in,
  referrer suppressed, failure fallback)
        v
built-in CSS gradient fallback (always available)
```

- A fresh random image is picked on every login page visit and every admin
  page refresh (timestamp-busted URLs, no server-side cache - so there is no
  "refresh cache" button).
- The image source label is shown in the bottom-right corner of the login
  page (local custom / Seaya / Paugram) and is never removed.

### Offline behavior

If the APIs are unreachable (no internet, DNS failure, timeout), the login
page still renders instantly:

1. custom image (when uploaded or configured) -> 2. built-in CSS gradient
fallback.

Wallpaper loading is never allowed to block or break the login page.

## Theme Settings

A settings page is provided under `System` > `Mint Wallpaper` >
`Wallpaper Settings`
(`/cgi-bin/luci/admin/system/mintwallpaper/settings`), backed by
`/etc/config/mint`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| enabled | boolean | 1 | wallpaper feature on/off |
| ui_random | boolean | 1 | random wallpaper on admin pages too |
| pc_mode | enum | random | desktop source (random / custom) |
| pc_url | direct link | empty | desktop custom image http(s) link |
| mobile_mode | enum | random | mobile source (random / custom) |
| mobile_url | direct link | empty | mobile custom image http(s) link |
| overlay | float | 0.45 | dark overlay opacity (0.0 - 1.0) |
| blur | px | 0 | background blur (0 disables, max 40) |

Uploaded images are written to `/www/luci-static/mint/custom-pc.jpg` and
`custom-mobile.jpg` (max 3 MB each) and are removed when the theme is
uninstalled.

## Development

Directory layout (follows current LuCI master conventions):

```
luci-theme-mint/
├── Makefile                  # luci.mk based package
├── htdocs/luci-static/mint/
│   ├── cascade.css           # design system + layout + components
│   ├── overview.js           # status overview enhancement (overview only)
│   ├── overview-banner.png   # topbar brand image
│   ├── login-logo.png        # login page logo
│   └── favicon/              # favicon.svg (vector) / -48.png / -180.png
├── htdocs/luci-static/resources/
│   ├── menu-mint.js      # sidebar/menu renderer (LuCI JS API)
│   └── view/mint/
│       ├── sysauth.js        # login page frontend
│       └── wallpaper.js      # wallpaper settings form
├── ucode/template/themes/mint/
│   ├── header.ut             # shell, sidebar, topbar
│   ├── footer.ut             # footer, L.require('menu-mint')
│   └── sysauth.ut            # login page (native form kept intact)
├── ucode/mint/
│   └── wallpaper.uc          # UCI config loader + server-side clamping
│                             # (no external requests, no cache)
├── root/
│   ├── etc/config/mint           # UCI config
│   ├── etc/uci-defaults/30_luci-theme-mint
│   ├── usr/libexec/rpcd/mint     # ubus compatibility stub
│   ├── usr/share/luci/menu.d/luci-theme-mint.json
│   ├── usr/share/luci/acl.d/luci-theme-mint.json
│   └── usr/share/rpcd/acl.d/luci-theme-mint.json
└── po/ (templates + zh_Hans)
```

## Build

Requires a current OpenWrt buildroot with the LuCI feed. The package uses the
standard `luci.mk` build; CSS/JS minification is applied by the standard LuCI
build options (`LUCI_MINIFY_CSS`, `LUCI_MINIFY_JS`). ucode template
precompilation is disabled (`LUCI_MINIFY_UT=0`) because `header.ut` imports
the theme's own backend module `luci.mint.wallpaper`, which cannot be
resolved by the build host's ucode compiler.

```sh
make package/luci-theme-mint/compile V=s
```

## Compatibility

- Target: current OpenWrt main / LuCI master (ucode template engine, `.ut`)
- Browsers: Chrome/Chromium, Firefox, Safari, Android WebView
  (CSS custom properties, flexbox, grid; `backdrop-filter` is progressive
  enhancement only)
- Login page and admin UI work without JavaScript (wallpaper, menu rendering
  and dynamic effects need JS), without CDN access, and on small screens

## Troubleshooting

- Theme not selectable: run the uci-defaults script manually
  (`sh /etc/uci-defaults/30_luci-theme-mint`), then reload rpcd.
- Wallpaper never appears: random images are fetched directly by the browser
  from third-party APIs; the gradient fallback is expected behavior when
  offline or when the APIs are unreachable. Upload a custom image for a fully
  offline setup.
- Want to force a fixed scheme: pick `mint-light` or `mint-dark` in
  System > System > Language and Style, or use the sidebar toggle.

## License

Apache-2.0. See [LICENSE](./LICENSE).
