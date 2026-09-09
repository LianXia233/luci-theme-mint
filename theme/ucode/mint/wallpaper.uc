// mint wallpaper backend
// Copyright (C) 2026 LianXia233
// Licensed to the public under the Apache License 2.0.
//
// Resolves the login-page wallpaper per device class: the settings page
// stores independent sources for desktop (pc) and mobile visitors, each
// either a random third-party API or a custom image (uploaded file or
// direct http(s) link). Device detection happens in the frontend
// (sysauth.js, via user agent); this module only resolves configuration
// to concrete image URLs and embeds them into the rendered page.
//
// Security:
//  - Custom URLs are validated: http(s) only, no metacharacters.
//  - Uploaded images live under /www (served statically, no auth -
//    the login page is pre-authentication).

'use strict';

import { stat } from 'fs';
import { cursor } from 'uci';

// Uploaded custom images, served statically by uhttpd (no auth needed:
// the login page is pre-authentication).
const CUSTOM_PC = '/www/luci-static/mint/custom-pc.jpg';
const CUSTOM_MOBILE = '/www/luci-static/mint/custom-mobile.jpg';

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
	return copyStr('0.45');
}

function clampBlur(v) {
	let n = int(v ?? '0');
	if (!(n >= 0))
		n = 0;
	if (n > 40)
		n = 40;
	return sprintf('%d', n);
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
		mobile_mode: sourceMode(wp.mobile_mode, DEFAULTS.mobile_mode),
		mobile_url: validCustomUrl(wp.mobile_url ?? ''),
		mobile_sources: sourceList(wp.mobile_sources, DEFAULTS.mobile_sources),
		overlay: clampOverlay(wp.overlay),
		blur: clampBlur(wp.blur)
	};
}

// Custom wallpaper resolution: local uploaded file wins over a remote
// direct link.
function resolveCustom(path, url) {
	const st = stat(path);
	if (st && st.type == 'file' && st.size)
		return '/luci-static/mint/' + substr(path, rindex(path, '/') + 1);

	return validCustomUrl(url);
}

function deviceGroup(cfg, kind) {
	const isCustom = (kind == 'mobile') ? (cfg.mobile_mode == 'custom') : (cfg.pc_mode == 'custom');
	const customPath = (kind == 'mobile') ? CUSTOM_MOBILE : CUSTOM_PC;
	const customUrl = (kind == 'mobile') ? cfg.mobile_url : cfg.pc_url;
	const proxyPath = (kind == 'mobile') ? PROXY_MOBILE : PROXY_PC;
	const proxyUrl = (kind == 'mobile') ? PROXY_MOBILE_URL : PROXY_PC_URL;

	/* The local proxy file only backs the "random" mode (it IS the cached
	   random image); custom mode uses the uploaded file / direct link. */
	const st = stat(proxyPath);
	const proxy = (!isCustom && st && st.type == 'file' && st.size) ? copyStr(proxyUrl) : null;

	return {
		mode: isCustom ? copyStr('custom') : copyStr('random'),
		url: resolveCustom(customPath, customUrl),
		proxy: proxy,
		sources: (kind == 'mobile') ? cfg.mobile_sources : cfg.pc_sources
	};
}

export function getWallpapers() {
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
