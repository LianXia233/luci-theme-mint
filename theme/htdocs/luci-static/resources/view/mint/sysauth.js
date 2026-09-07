// mint login view
// Copyright (C) 2026 LianXia233
// Licensed to the public under the Apache License 2.0.
//
// Frontend for the mint login page. The login card rendered by
// sysauth.ut contains the single native LuCI login form, so authentication
// is a plain POST of luci_username / luci_password - no JS in the loop.
// This module only adds remember-username and the wallpaper background.
//
// Wallpaper strategy (never blocks login):
//   1. Page renders instantly with CSS gradient fallback
//   2. Wallpaper metadata is embedded server-side by header.ut
//   3. Selected image is preloaded via new Image(), then cross-fades in
//   4. Any failure keeps the gradient - no white screen possible

'use strict';
'require view';
'require ui';

const REMEMBER_KEY = 'mz-username';

/* Shared helper (review TZ-14): header.ut defines window.mzWpUtil so the
   login page and admin pages share ONE UA/API definition. */
function mzWp() {
	if (typeof window !== 'undefined' && window.mzWpUtil)
		return window.mzWpUtil;
	return {
		isMobileUA() {
			return /Android|iPhone|iPad|iPod|Mobile|Windows Phone|WebOS|BlackBerry|Opera Mini|IEMobile/i.test(navigator.userAgent || '');
		},
		randomUrl(mobile) {
			const api = mobile
				? 'https://api.seaya.link/wap'
				: 'https://api.paugram.com/wallpaper/';
			return api + (api.indexOf('?') >= 0 ? '&' : '?') + '_mzt=' + Date.now();
		}
	};
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

		/* Wallpaper: data embedded server-side; local UI first, image later */
		const wp = mzWp();
		const mobile = wp.isMobileUA();

		const cfg = window.mintWallpaper ?? {};
		if (cfg.enabled !== false && bg) {
			applyWallpaperSettings(cfg);

			const showWallpaper = (url, label) => {
				const img = new Image();
				img.referrerPolicy = 'no-referrer'; /* TZ-13: don't leak the router URL */
				const timer = window.setTimeout(() => { img.src = ''; }, 12000);

				img.onload = () => {
					window.clearTimeout(timer);
					document.documentElement.style.setProperty('--mz-wallpaper', `url("${url}")`);
					bg.classList.add('is-loaded');
					/* OT-16: the copyright corner used to stay empty forever. */
					if (copyright && label)
						copyright.textContent = label;
				};

				img.onerror = () => window.clearTimeout(timer);
				img.src = url;
			};

			/* Per-device source: desktop and mobile visitors get independent
			   configurations (random API or custom image). No fallback to
			   other sources - the CSS gradient stays as the only fallback. */
			const group = mobile ? (cfg.mobile || {}) : (cfg.pc || {});

			if (group.mode === 'custom' && group.url) {
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
			} else {
				showWallpaper(wp.randomUrl(mobile),
					mobile ? _('Random wallpaper · Seaya') : _('Random wallpaper · Paugram'));
			}
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
