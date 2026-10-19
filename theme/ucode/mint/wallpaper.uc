// mint wallpaper backend
// Copyright (C) 2026 LianXia233
// Licensed to the public under the GNU General Public License v3.0.
//
// Resolves the wallpaper per device class: the settings page stores
// independent sources for desktop (pc) and mobile visitors. Each may be:
//   - a library wallpaper (user-uploaded file under wallpapers/)
//   - a legacy custom upload (custom-pc.jpg / custom-mobile.jpg)
//   - a direct http(s) link
//   - the server-side random cache (wallpaper-*.img, refreshed by cron)
// Device detection happens in the frontend (sysauth.js / menu-mint.js);
// this module only resolves configuration to concrete image URLs.
//
// Security:
//  - Custom URLs are validated: http(s) only, no metacharacters.
//  - Uploaded images live under /www (served statically, no auth — the
//    login page is pre-authentication).
//  - Every local image URL carries ?v=<mtime> so a re-upload or cron
//    refresh busts the browser cache without disabling caching elsewhere.

'use strict';

import { stat, lsdir } from 'fs';
import { cursor } from 'uci';

// Legacy single-slot uploads (pre wallpaper-library). Still honoured so
// upgrades keep working; new uploads go to WALLPAPER_DIR.
const CUSTOM_PC = '/www/luci-static/mint/custom-pc.jpg';
const CUSTOM_MOBILE = '/www/luci-static/mint/custom-mobile.jpg';

// User wallpaper library. Persisted on the overlay; survives theme upgrades
// because the theme package does not own files inside this directory.
const WALLPAPER_DIR = '/www/luci-static/mint/wallpapers';
const WALLPAPER_URL_PREFIX = '/luci-static/mint/wallpapers/';

/* OT-35: server-side random wallpaper cache. The random APIs 302-redirect
   to a different image on every request, so no browser caching strategy
   can pin one picture. The cron job (/usr/bin/mz-wallpaper-fetch.sh, every
   5 minutes) resolves the randomness router-side; the frontends reference
   these stable local files instead and get real HTTP caching (304 reuse)
   until the next refresh. */
const PROXY_PC = '/www/luci-static/mint/wallpaper-pc.img';
const PROXY_MOBILE = '/www/luci-static/mint/wallpaper-mobile.img';
const PROXY_PC_URL = '/luci-static/mint/wallpaper-pc.img';
const PROXY_MOBILE_URL = '/luci-static/mint/wallpaper-mobile.img';

const DEFAULTS = {
	enabled: '1',
	pc_mode: 'random',
	mobile_mode: 'random',
	/* Random sources per device class; the frontend shuffles this list,
	   tries entries in random order and falls back to the next source on
	   failure. Empty UCI list -> built-in defaults. */
	pc_sources: [
		'https://api.paugram.com/wallpaper/',
		'https://t.alcy.cc/bd'
	],
	mobile_sources: [
		'https://api.seaya.link/wap',
		'https://t.alcy.cc/mp'
	]
};

// NOTE: ucode (libucode 20230711 era) does NOT hoist function declarations,
// so helpers must be defined before the functions that call them.

/* Workaround for a ucode string-lifetime bug observed on libucode
   20230711: the =~ regex operator corrupts the string being matched,
   and returning a bare string literal or transient UCI string from a
   helper can also yield garbage (e.g. 2^64-1) when later consumed by
   sprintf('%J'). We validate overlay without regex and copy all helper
   return values via concatenation to obtain stable strings. (TZ-20) */
function copyStr(v) { return '' + v; }

// A custom URL is embedded into login-page markup/CSS, so restrict it to
// a safe http(s) absolute URL with no shell/HTML metacharacters.
function validCustomUrl(u) {
	if (type(u) != 'string' || length(u) == 0)
		return null;

	if (substr(u, 0, 8) != 'https://' && substr(u, 0, 7) != 'http://')
		return null;

	const bad = ['"', "'", ' ', '\\', '<', '>', '`', '\n', '\r'];
	let i;

	for (i = 0; i < length(bad); i++) {
		if (index(u, bad[i]) > -1)
			return null;
	}

	return copyStr(u);
}

/* Library wallpaper file name: basename only, no path separators, must
   look like an image we would have accepted on upload. Rejects "..",
   absolute paths and any extension we never store. */
function validWallpaperName(name) {
	if (type(name) != 'string' || length(name) == 0 || length(name) > 128)
		return null;

	if (index(name, '/') > -1 || index(name, '\\') > -1)
		return null;
	if (substr(name, 0, 1) == '.')
		return null;

	const lower = lc(name);
	const exts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
	let i, ext;
	for (i = 0; i < length(exts); i++) {
		ext = exts[i];
		if (length(lower) > length(ext) && substr(lower, length(lower) - length(ext)) == ext)
			return copyStr(name);
	}
	return null;
}

function sourceMode(v, dflt) {
	return (v == 'custom') ? copyStr('custom') : copyStr(dflt);
}

function hasVal(arr, v) {
	let i;
	for (i = 0; i < length(arr); i++)
		if (arr[i] == v)
			return true;
	return false;
}

/* Random source list: accepts a uci list (array) or a single string;
   validates every URL, de-duplicates, and falls back to the built-in
   defaults when nothing valid is configured. */
function sourceList(v, dflt) {
	let out = [];
	let arr = (type(v) == 'array') ? v : (type(v) == 'string' && length(v) ? [v] : []);
	let i, u;

	for (i = 0; i < length(arr); i++) {
		u = validCustomUrl(arr[i]);
		if (u && !hasVal(out, u))
			push(out, u);
	}

	if (length(out) == 0)
		for (i = 0; i < length(dflt); i++)
			push(out, dflt[i]);

	return out;
}

/* Manual overlay format check: 0 | 1 | 0.x | 1.0*
   Avoids the ucode =~ string-corruption bug. */
function validOverlay(v) {
	if (length(v) == 0)
		return false;
	if (v == '0' || v == '1')
		return true;
	if (substr(v, 0, 2) == '0.') {
		for (let i = 2; i < length(v); i++)
			if (index('0123456789', substr(v, i, 1)) < 0)
				return false;
		return true;
	}
	if (substr(v, 0, 2) == '1.') {
		for (let i = 2; i < length(v); i++)
			if (substr(v, i, 1) != '0')
				return false;
		return true;
	}
	return false;
}

function clampOverlay(v) {
	if (type(v) == 'string' && validOverlay(v))
		return copyStr(v);
	return copyStr('0.32');
}

function clampBlur(v) {
	let n = int(v ?? '0');
	if (!(n >= 0))
		n = 0;
	if (n > 40)
		n = 40;
	return sprintf('%d', n);
}

/* Append ?v=<mtime> to a local URL so browsers revalidate after an
   overwrite or cron refresh. Remote http(s) URLs are returned unchanged
   (the remote host controls its own caching). */
function withVersion(url, path) {
	if (type(url) != 'string' || length(url) == 0)
		return url;
	if (substr(url, 0, 7) == 'http://' || substr(url, 0, 8) == 'https://')
		return url;

	const st = stat(path);
	if (st && st.type == 'file' && st.mtime)
		return copyStr(url + '?v=' + sprintf('%d', st.mtime));

	return copyStr(url);
}

/* TZ-16: overlay/blur are clamped here so hand-edited UCI values can
   neither break the CSS nor produce invalid style output. */
function loadConfig() {
	const wp = cursor().get_all('mint', 'wallpaper') ?? {};
	return {
		enabled: wp.enabled ?? DEFAULTS.enabled,
		/* OT-09 / R-02: admin-page random wallpaper defaults to OFF. Every
		   source of truth agrees now: shipped /etc/config/mint ('0'),
		   uci-defaults seed (0), the settings form default ('0') and this
		   runtime fallback. A deleted option must NEVER silently flip the
		   admin pages back to fetching remote images. */
		ui_random: wp.ui_random ?? '0',
		pc_mode: sourceMode(wp.pc_mode, DEFAULTS.pc_mode),
		pc_url: validCustomUrl(wp.pc_url ?? ''),
		pc_sources: sourceList(wp.pc_sources, DEFAULTS.pc_sources),
		pc_wallpaper: validWallpaperName(wp.pc_wallpaper ?? ''),
		mobile_mode: sourceMode(wp.mobile_mode, DEFAULTS.mobile_mode),
		mobile_url: validCustomUrl(wp.mobile_url ?? ''),
		mobile_sources: sourceList(wp.mobile_sources, DEFAULTS.mobile_sources),
		mobile_wallpaper: validWallpaperName(wp.mobile_wallpaper ?? ''),
		overlay: clampOverlay(wp.overlay),
		blur: clampBlur(wp.blur)
	};
}

/* Resolve one local file to a versioned URL, or null when missing. */
function localUrl(path, urlPrefix) {
	const st = stat(path);
	if (!(st && st.type == 'file' && st.size))
		return null;
	const base = urlPrefix + substr(path, rindex(path, '/') + 1);
	return withVersion(base, path);
}

/* Custom wallpaper resolution priority:
     1. library wallpaper (pc_wallpaper / mobile_wallpaper)
     2. legacy custom-*.jpg upload
     3. remote direct link
   Returns { url, kind } or null. */
function resolveCustom(cfg, kind) {
	const libName = (kind == 'mobile') ? cfg.mobile_wallpaper : cfg.pc_wallpaper;
	const legacyPath = (kind == 'mobile') ? CUSTOM_MOBILE : CUSTOM_PC;
	const remote = (kind == 'mobile') ? cfg.mobile_url : cfg.pc_url;

	if (libName) {
		const path = WALLPAPER_DIR + '/' + libName;
		const u = localUrl(path, WALLPAPER_URL_PREFIX);
		if (u)
			return { url: u, kind: 'library' };
	}

	const legacy = localUrl(legacyPath, '/luci-static/mint/');
	if (legacy)
		return { url: legacy, kind: 'legacy' };

	if (remote)
		return { url: remote, kind: 'url' };

	return null;
}

function deviceGroup(cfg, kind) {
	const isCustom = (kind == 'mobile') ? (cfg.mobile_mode == 'custom') : (cfg.pc_mode == 'custom');
	const proxyPath = (kind == 'mobile') ? PROXY_MOBILE : PROXY_PC;
	const proxyUrl = (kind == 'mobile') ? PROXY_MOBILE_URL : PROXY_PC_URL;

	/* Library / legacy / remote custom image wins whenever one exists,
	   even if mode is still 'random' — the settings page sets mode
	   together with the selection, but a half-migrated config must not
	   drop the user's image. */
	const custom = resolveCustom(cfg, kind);

	const st = stat(proxyPath);
	const proxy = (!custom && st && st.type == 'file' && st.size)
		? withVersion(copyStr(proxyUrl), proxyPath)
		: null;

	return {
		mode: custom ? copyStr('custom') : copyStr('random'),
		url: custom ? custom.url : null,
		url_kind: custom ? custom.kind : null,
		proxy: proxy,
		sources: (kind == 'mobile') ? cfg.mobile_sources : cfg.pc_sources
	};
}

/* Public API. Declared as plain functions + a single `export { ... }`
   statement at the bottom of this file on purpose: do NOT convert these
   back to `export function` declarations. ucode before the 2026-02-11
   fix (commit 552ca3cf55, "allow export function declarations without
   trailing semicolon") demands a semicolon after every `export
   function` declaration, so a module using that form fails to compile
   with "Unexpected token / Expecting ';'" on the affected builds -
   including the ucode shipped with ImmortalWrt 25.12 - and the theme
   then falls back to the default one (issue #17). The `export { ... }`
   list form is accepted by every ucode version that supports modules
   at all. */
function getWallpapers() {
	const cfg = loadConfig();

	if (cfg.enabled == '0') {
		return {
			enabled: false,
			ui_random: cfg.ui_random,
			pc: null,
			mobile: null
		};
	}

	return {
		enabled: true,
		ui_random: cfg.ui_random,
		overlay: cfg.overlay,
		blur: cfg.blur,
		pc: deviceGroup(cfg, 'pc'),
		mobile: deviceGroup(cfg, 'mobile')
	};
}

/* Exposed for the settings page / tests: validate a library file name
   the same way the resolver does. */
function isValidWallpaperName(name) {
	return validWallpaperName(name) != null;
}

function wallpaperDir() {
	return copyStr(WALLPAPER_DIR);
}

/* ----- Dynamic asset revision (2026-10-19 external feedback, problem 1) --
   The theme used to stamp every static resource with a hand-bumped
   ?v= constant (MINT_ASSET_REV). A package upgrade replaced the files
   under /www/luci-static/ but the ?v= of an already-cached page stayed
   the same, so browsers kept running the previous JS/CSS until the
   constant in the templates moved - "upgraded, menu gone, hard refresh
   does not help".

   assetRev() derives the revision from the filesystem instead: it walks
   the theme's static tree (and the theme's class modules under
   resources/) and returns the newest mtime found. Installing a new
   package rewrites those files, the mtimes move, and every ?v= built
   from the return value changes with them. Between upgrades the value
   is stable, so normal HTTP caching (and the uhttpd 304 path) keeps
   working. Falls back to a static stamp when the walk fails so the
   templates keep rendering on exotic webroot layouts.

   `media` is the dispatcher's media URL base ('/luci-static/mint');
   uhttpd serves it from ASSET_WEBROOT. */
const ASSET_WEBROOT = '/www';
const ASSET_FALLBACK_REV = '20261019c';

/* Runtime files must NOT feed the revision: the cron job rewrites
   wallpaper-pc.img / wallpaper-mobile.img every five minutes and users
   re-upload custom-*.jpg / wallpapers/* at will. Counting them would
   change every ?v= on the site with every cron tick and annihilate the
   browser cache. They carry their OWN cache handling instead (the
   resolver stamps library/custom images with ?v=<mtime>, see
   withVersion(); the proxy imgs are stable URLs served with real 304
   revalidation). */
const ASSET_SKIP_FILES = [
	'wallpaper-pc.img', 'wallpaper-mobile.img',
	'custom-pc.jpg', 'custom-mobile.jpg'
];
const ASSET_SKIP_DIRS = [ 'wallpapers' ];

function assetTreeMtime(dir, depth) {
	let m = 0;
	let entries;

	try { entries = lsdir(dir); } catch (e) { return 0; }

	if (type(entries) != 'array')
		return 0;

	for (let i = 0; i < length(entries); i++) {
		if (index(ASSET_SKIP_FILES, entries[i]) > -1)
			continue;
		if (index(ASSET_SKIP_DIRS, entries[i]) > -1)
			continue;

		const p = dir + '/' + entries[i];
		let st = null;

		try { st = stat(p); } catch (e) { st = null; }

		if (!st)
			continue;

		if (st.type == 'dir' && depth > 0) {
			const sub = assetTreeMtime(p, depth - 1);
			if (sub > m)
				m = sub;
		}
		else if (st.mtime > m) {
			m = st.mtime;
		}
	}

	return m;
}

function assetFileMtime(path) {
	try { return stat(path)?.mtime ?? 0; } catch (e) { return 0; }
}

function assetRev(media) {
	let m = assetTreeMtime(ASSET_WEBROOT + media, 2);

	/* The theme's class modules live OUTSIDE the media directory (they
	   are required through LuCI's loader and versioned via
	   L.env.resource_version, which header/footer stamp with this same
	   value), so their mtimes must feed the revision too. */
	const extra = [
		'/luci-static/resources/menu-mint.js',
		'/luci-static/resources/view/mint/sysauth.js',
		'/luci-static/resources/view/mint/wallpaper.js'
	];

	for (let i = 0; i < length(extra); i++) {
		const mt = assetFileMtime(ASSET_WEBROOT + extra[i]);
		if (mt > m)
			m = mt;
	}

	return (m > 0) ? sprintf('%d', m) : ASSET_FALLBACK_REV;
}

export { getWallpapers, isValidWallpaperName, wallpaperDir, assetRev };
