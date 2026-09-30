// mint login view
// Copyright (C) 2026 LianXia233
// Licensed to the public under the GNU General Public License v3.0.
//
// Frontend for the mint login page. The login card rendered by
// sysauth.ut contains the single native LuCI login form, so authentication
// is a plain POST of luci_username / luci_password - no JS in the loop.
// This module only adds remember-username and the wallpaper background.
//
// Wallpaper strategy (never blocks login):
//   1. Page renders instantly with the reference-palette CSS gradient
//   2. Wallpaper metadata is embedded server-side by header.ut
//   3. An EXPLICITLY selected image is preloaded via new Image(), then
//      cross-fades in
//   4. Any failure keeps the gradient - no white screen possible
//
// Login default: NO wallpaper, but a BUILT-IN backdrop. sysauth.ut
// emits its own .mint-background.mz-login-char carrying one artwork
// (Plana, both colour modes) - see css/login.css. The random sources and
// the cron-cached proxy are an admin-page opt-in (mint.wallpaper.ui_random)
// and are never consulted on this page, so a default installation
// requests no remote image at all on the way to the form.
//
// The only image this page ever fetches is an EXPLICITLY selected one
// (library upload, legacy upload or a direct link). When that decodes,
// body gets mz-wp-custom and login.css removes the built-in artwork -
// the same precedence the admin pages use. The admin four-state layer is
// a different element in a different file (header.ut, blank_page guard),
// so the two can never bleed into each other.

'use strict';
'require view';
'require ui';

const REMEMBER_KEY = 'mz-username';

/* Shared helper: header.ut defines window.mzWpUtil on every page - the
   login page includes header.ut too - so this view resolves it directly
   instead of carrying a second UA/API implementation. */
function mzWp() {
	return (typeof window !== 'undefined' && window.mzWpUtil) ? window.mzWpUtil : {};
}

function applyWallpaperSettings(wp) {
	if (!wp)
		return;

	if (wp.overlay != null)
		document.documentElement.style.setProperty('--mz-wallpaper-overlay', String(wp.overlay));

	if (wp.blur && parseInt(wp.blur) > 0)
		document.documentElement.style.setProperty('--mz-wallpaper-blur', parseInt(wp.blur) + 'px');
}

function setupRemember() {
	const user = document.querySelector('#luci_username');
	const remember = document.querySelector('#mz-remember');
	if (!user || !remember)
		return false;

	try {
		const saved = localStorage.getItem(REMEMBER_KEY);
		if (saved)
			user.value = saved;

		remember.checked = !!saved;
		return !!saved;
	} catch (e) { /* storage unavailable */ }
	return false;
}

return view.extend({
	render() {
		const bg = document.getElementById('mz-login-bg');
		const copyright = document.getElementById('mz-login-copyright');
		const form = document.getElementById('mz-login-form');

		const remembered = setupRemember();

		/* Persist the remembered username when the native form is submitted.
		   The form posts by itself; JS must not interfere with the flow. */
		if (form) {
			form.addEventListener('submit', () => {
				const user = document.querySelector('#luci_username');
				const remember = document.querySelector('#mz-remember');

				if (user && remember) {
					try {
						if (remember.checked)
							localStorage.setItem(REMEMBER_KEY, user.value);
						else
							localStorage.removeItem(REMEMBER_KEY);
					} catch (e) { /* storage unavailable */ }
				}
			});
		}

		/* Wallpaper: data embedded server-side; local UI first, image later.
		   Login default is the BUILT-IN Plana backdrop (sysauth.ut +
		   login.css), so the image path only runs when the administrator
		   explicitly selected a wallpaper. Everything else - the random
		   source list, the cron-cached proxy file - belongs to the
		   admin-page opt-in and is not consulted here. When this block is
		   skipped, the layer from sysauth.ut is the backdrop. */
		const wp = mzWp();
		const mobile = (typeof wp.isMobileUA === 'function') ? wp.isMobileUA() : false;

		/* Drop the 5-minute RANDOM-wallpaper session slot on the way in.
		   This page never paints a random image, and leaving the slot
		   behind means an admin page opened later in the same tab can
		   still pick up a stale random URL from it. Clearing it here is
		   what keeps the login page and the random-wallpaper cache from
		   disagreeing about what the backdrop is. */
		if (typeof wp.dropSessionCache === 'function')
			wp.dropSessionCache(mobile);

		const cfg = window.mintWallpaper ?? {};
		const group = mobile ? (cfg.mobile || {}) : (cfg.pc || {});

		if (cfg.enabled !== false && bg && group.mode === 'custom' && group.url) {
			applyWallpaperSettings(cfg);

			const showWallpaper = (rawUrl, label) => {
				/* Carry the client-side cache version so a re-selected or
				   cron-rewritten image is never served from cache. */
				const url = wp.stamp ? wp.stamp(rawUrl) : rawUrl;
				const img = new Image();
				const timer = window.setTimeout(() => { img.src = ''; }, 16000);

				img.referrerPolicy = 'no-referrer'; /* TZ-13: don't leak the router URL */
				img.onload = () => {
					window.clearTimeout(timer);
					document.documentElement.style.setProperty('--mz-wallpaper', `url("${url}")`);
					bg.classList.add('is-loaded');
					/* The photo now covers the viewport, so the built-in
					   Plana layer is removed (login.css). Same class name
					   and same precedence as the admin pages. */
					document.body.classList.add('mz-wp-custom');
					/* OT-16: the copyright corner used to stay empty forever. */
					if (copyright && label)
						copyright.textContent = label;
				};
				img.onerror = () => {
					/* Never leave a dead URL painted: the gradient and the
					   built-in artwork both stay. */
					window.clearTimeout(timer);
					img.src = '';
				};
				img.src = url;
			};

			let label;
			if (group.url.charAt(0) === '/') {
				label = _('Local custom image');
			} else {
				try {
					label = _('Image source: %s').format(new URL(group.url).hostname);
				} catch (e) {
					label = _('Custom image');
				}
			}
			showWallpaper(group.url, label);
		}

		/* OT-32: focus password only when the username is already known,
		   otherwise focus the username field. */
		if (remembered)
			document.querySelector('#luci_password')?.focus();
		else
			document.querySelector('#luci_username')?.focus();

		return E([]);
	},

	addFooter() {}
});
