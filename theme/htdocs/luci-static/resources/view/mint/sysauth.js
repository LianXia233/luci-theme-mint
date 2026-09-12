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
		randomUrl(mobile, sources) {
			const list = (sources && sources.length) ? sources
				: (mobile
					? ['https://api.seaya.link/wap', 'https://t.alcy.cc/mp']
					: ['https://api.paugram.com/wallpaper/', 'https://t.alcy.cc/bd']);
			const api = list[Math.floor(Math.random() * list.length)];
			return api + (api.indexOf('?') >= 0 ? '&' : '?') + '_mzt=' + Date.now();
		}
	};
}

/* Fisher-Yates shuffle; multi-source mode tries every configured source
   in random order and falls back to the next one on failure. */
function shuffle(a) {
	const out = a.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const t = out[i]; out[i] = out[j]; out[j] = t;
	}
	return out;
}

function stampUrl(u) {
	return u + (u.indexOf('?') >= 0 ? '&' : '?') + '_mzt=' + Date.now();
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

			const showWallpaper = (urls, labelFn) => {
				/* Carry the client-side cache version so a re-selected or
				   cron-rewritten image is never served from cache. */
				urls = urls.map((u) => (wp.stamp ? wp.stamp(u) : u));
				let imgRef = null;
				const timer = window.setTimeout(() => { if (imgRef) imgRef.src = ''; }, 16000);

				const tryNext = (i) => {
					if (i >= urls.length) {
						window.clearTimeout(timer); /* all sources failed -> gradient stays */
						return;
					}
					const img = new Image();
					imgRef = img;
					img.referrerPolicy = 'no-referrer'; /* TZ-13: don't leak the router URL */
					img.onload = () => {
						window.clearTimeout(timer);
						document.documentElement.style.setProperty('--mz-wallpaper', `url("${urls[i]}")`);
						bg.classList.add('is-loaded');
						/* OT-16: the copyright corner used to stay empty forever. */
						if (copyright) {
							const label = labelFn ? labelFn(urls[i]) : '';
							if (label)
								copyright.textContent = label;
						}
					};
					img.onerror = () => { img.src = ''; tryNext(i + 1); };
					img.src = urls[i];
				};
				tryNext(0);
			};

			/* Per-device source: desktop and mobile visitors get independent
			   configurations (random multi-source API list or custom image).
			   Random mode prefers the server-side cached image
			   (wallpaper-pc.img / wallpaper-mobile.img, refreshed by cron
			   every 5 minutes): the random APIs 302 to a different image on
			   every request, so the local proxy file is the only way the
			   login page keeps one picture for the whole cache window. When
			   the file is missing the flow falls back to shuffling the
			   configured remote sources; the CSS gradient stays as the
			   final fallback. */
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
				showWallpaper([group.url], () => label);
			} else if (group.proxy) {
				showWallpaper([group.proxy], () => _('Cached random wallpaper'));
			} else {
				const sources = (group.sources && group.sources.length) ? group.sources : [wp.randomUrl(mobile)];
				showWallpaper(shuffle(sources).map(stampUrl), (u) => {
					try { return _('Random wallpaper · %s').format(new URL(u).hostname); }
					catch (e) { return _('Random wallpaper'); }
				});
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
