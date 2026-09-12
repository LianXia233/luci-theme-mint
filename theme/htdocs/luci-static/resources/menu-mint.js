// mint theme frontend logic
// Copyright (C) 2026 LianXia233
// Licensed to the public under the Apache License 2.0.
//
// Loaded via L.require('menu-mint') from footer.ut. Extends the LuCI
// baseclass and implements:
//   - Sidebar menu rendering from the live LuCI menu tree
//   - Mobile drawer toggle
//   - Light/Dark/System color scheme cycling
//   - Logout link
//   - Menu group folding (+ FOUC-guard release with safety timeout)
//   - Firewall zone color bridge for translucent headers

'use strict';
'require baseclass';
'require ui';

/* Shared wallpaper helper (review TZ-14): window.mzWpUtil is defined by
   header.ut so the login page and admin pages share ONE UA/API
   definition. The local fallback keeps this module working if the
   header script is ever missing. */
const mzWp = (typeof window !== 'undefined' && window.mzWpUtil) ? window.mzWpUtil : {
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

/* Fisher-Yates shuffle; multi-source wallpaper mode tries every
   configured source in random order, falling back to the next on error. */
function shuffle(a) {
	const out = a.slice();
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const t = out[i]; out[i] = out[j]; out[j] = t;
	}
	return out;
}

/* Module handle on the live menu instance. The wallpaper settings page
   (a different LuCI view) needs to force the admin background to reload
   after an apply / upload / delete, and it cannot reach the baseclass
   instance - so init() publishes this handle plus a global helper. */
let mzMenuRef = null;

function mzIsMobileUA() {
	return (mzWp && typeof mzWp.isMobileUA === 'function')
		? mzWp.isMobileUA()
		: /Android|iPhone|iPad|iPod|Mobile|Windows Phone|WebOS|BlackBerry|Opera Mini|IEMobile/i.test(navigator.userAgent || '');
}

/* Bump the cache version and re-resolve the wallpaper from the live
   configuration. Safe to call from any view. */
function mzReinitWallpaper() {
	if (mzWp && typeof mzWp.dropSessionCache === 'function')
		mzWp.dropSessionCache(mzIsMobileUA());
	const root = document.documentElement;
	/* Clear first: a failed reload must fall back to the gradient rather
	   than keep the previous picture painted. */
	root.style.removeProperty('--mz-wallpaper');
	if (mzMenuRef && typeof mzMenuRef.initGlobalWallpaper === 'function')
		mzMenuRef.initGlobalWallpaper();
}

window.mzWallpaperRefresh = mzReinitWallpaper;

return baseclass.extend({
	__init__() {
		/* Publish the handle the global wallpaper refresh helper uses. */
		mzMenuRef = this;

		ui.menu.load().then((tree) => this.render(tree));

		this.initSidebarToggle();
		this.initMobileBar();
		this.initPageTopbar();
		this.initThemeToggle();
		this.initLogout();
		this.initGlobalWallpaper();
		this.initZoneColors();
		/* ensureCbiForm: the cbi-map is in the initial HTML, but the LuCI
		   router may swap the view asynchronously after navigation. Try
		   once now and again after a short delay so the form is in place
		   before the user reaches for the save button. */
		this.ensureCbiForm();
		Promise.resolve().then(() => this.ensureCbiForm());
		window.setTimeout(() => this.ensureCbiForm(), 1500);

		/* OT-02 safety net: the FOUC guard (#mainmenu{display:none!important})
		   is lifted by foldMenu(); if rendering ever failed, force it open
		   so the user is never left without navigation. */
		window.setTimeout(() => {
			const mm = document.getElementById('mainmenu');
			if (mm && mm.children.length > 0)
				mm.classList.add('mz-menu-ready');
		}, 8000);
	},

	/* ----- Global wallpaper (admin pages) ------------------------ */

	isMobileUA() {
		return mzWp.isMobileUA();
	},

	initGlobalWallpaper() {
		if (document.getElementById('mz-login'))
			return;

		/* Dark mode: deep grey glass, no wallpaper.
		   The early return below skips every network path, so a dark page
		   never requests a wallpaper API; the inline --mz-wallpaper*
		   properties are cleared so a stale light-mode URL can never leak
		   through; and cascade.css removes BOTH wallpaper pseudo-elements
		   from the box tree (`content: none`), so nothing is composited.
		   The mz-has-wallpaper class is still applied on purpose - it is
		   the switch that enables the whole glass component layer, and only
		   the wallpaper layers are meant to disappear in dark mode.
		   The user's UCI wallpaper settings are never modified: switching
		   back to light re-runs this method and reloads them. */
		if (document.documentElement.getAttribute('data-theme') === 'dark') {
			document.documentElement.style.removeProperty('--mz-wallpaper');
			document.documentElement.style.removeProperty('--mz-wallpaper-overlay');
			document.documentElement.style.removeProperty('--mz-wallpaper-blur');
			document.body.classList.add('mz-has-wallpaper');
			return;
		}

		const cfg = window.mintWallpaper;
		/* NOTE: ui_random is deliberately NOT tested here any more. It only
		   governs per-navigation remote randomisation; the server-side
		   cached image (cron -> /luci-static/mint/wallpaper-<kind>.img) is
		   a LOCAL file and must stay usable with ui_random off. Testing it
		   here is what produced the "random wallpaper stopped working"
		   report: the shipped default is ui_random=0, so the cached
		   wallpaper was never applied at all. */
		if (!cfg || cfg.enabled === false) {
			/* Wallpaper switched off entirely: still run the global
			   frosted-glass layer. --mz-wallpaper stays "none", so the
			   CSS ::after paints the soft gradient fallback and every
			   admin page gets glass cards + soft shadow regardless
			   (2026-09-09). */
			document.body.classList.add('mz-has-wallpaper');
			return;
		}

		const mobile = this.isMobileUA();
		const grp = mobile ? (cfg.mobile || {}) : (cfg.pc || {});
		/* OT-35: 5-minute wallpaper cache, two layers deep.
		   Layer 1 (server): the random APIs 302-redirect to a different
		   image on EVERY request, so no browser-side trick can pin one
		   picture. A cron job fetches a random image into
		   /luci-static/mint/wallpaper-<kind>.img every 5 minutes; while
		   that local file exists the admin UI points at it and uhttpd
		   answers repeat views with 304 - the browser keeps ONE image for
		   the whole window and it never changes between navigations.
		   Layer 2 (browser sessionStorage): remembers the last URL for 5
		   minutes as before - it covers the window where the cron file
		   changed mid-session and keeps the fallback path identical. */
		const CACHE_KEY = 'mz-wp-url-' + (mobile ? 'mobile' : 'pc');
		const CACHE_TTL = 5 * 60 * 1000;
		let cached = null;
		try { cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { cached = null; }
		const cacheFresh = cached && cached.url && (Date.now() - (cached.ts || 0)) < CACHE_TTL;

		let urls;
		if (grp.mode === 'custom' && grp.url) {
			urls = [grp.url];
		}
		else if (grp.mode === 'custom') {
			return;
		}
		else if (grp.proxy) {
			/* Server-side cached random image: stable URL, real HTTP
			   caching, refreshed by cron every 5 minutes. No per-navigation
			   cache-busting stamp - stamping would defeat the 304 reuse. */
			urls = [grp.proxy];
		}
		else if (cacheFresh) {
			urls = [cached.url];
		}
		else if (cfg.ui_random === false) {
			/* Nothing cached anywhere and the admin has not opted in to
			   per-navigation remote randomisation (OT-09): keep the soft
			   gradient fallback rather than firing an API request on every
			   page view. The glass layer still switches on. */
			document.body.classList.add('mz-has-wallpaper');
			return;
		}
		else {
			/* Random multi-source: shuffle the configured list and try each
			   entry in turn, falling back to the next one on failure. */
			const sources = (grp.sources && grp.sources.length) ? grp.sources : [mzWp.randomUrl(mobile)];
			urls = shuffle(sources).map((u) => u + (u.indexOf('?') >= 0 ? '&' : '?') + '_mzt=' + Date.now());
		}

		/* Carry the client-side cache-busting version on every URL. A
		   changed selection (apply / upload / delete / force refresh)
		   bumps it, so the browser can never answer with the picture it
		   cached under the previous version. See mzWpUtil.stamp(). */
		urls = urls.map((u) => mzWp.stamp(u));

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
				document.documentElement.style.setProperty('--mz-wallpaper', 'url("' + urls[i] + '")');
				if (cfg.overlay != null)
					document.documentElement.style.setProperty('--mz-wallpaper-overlay', String(cfg.overlay));
				if (cfg.blur && parseInt(cfg.blur) > 0)
					document.documentElement.style.setProperty('--mz-wallpaper-blur', parseInt(cfg.blur) + 'px');
				document.body.classList.add('mz-has-wallpaper');
				/* remember the working URL for the 5-minute reuse window;
				   custom URLs are stable and skip the cache on purpose */
				if (grp.mode !== 'custom') {
					try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ url: urls[i], ts: Date.now() })); } catch (e) {}
				}
			};
			img.onerror = () => { img.src = ''; tryNext(i + 1); };
			img.src = urls[i];
		};
		tryNext(0);
	},

	/* Re-run the wallpaper resolution from scratch. Used after the
	   settings page changed something: the old URL is dropped from the
	   session cache, the version stamp makes the new one uncached, and
	   the glass layer is re-applied without a page reload. */
	reinitWallpaper() {
		mzReinitWallpaper();
	},

	/* ----- Sidebar menu ------------------------------------------ */

	render(tree) {
		this.renderMainMenu(tree);
		this.ensureCbiForm();
		/* Tab menu for pages with sub-views */
		let node = tree;
		let url = '';

		if (L.env.dispatchpath.length >= 3) {
			for (let i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.renderTabMenu(node, url);
		}
	},

	renderMainMenu(tree) {
		const ul = document.querySelector('#mainmenu');
		if (!ul)
			return;

		this.renderMenuLevel(ul, tree, '', 0);
		ul.style.display = '';
		this.foldMenu();
	},

	renderMenuLevel(ul, tree, url, level) {
		const children = ui.menu.getChildren(tree);

		if (children.length == 0 || level > 2)
			return;

		children.forEach((child) => {
			const childUrl = url + (url ? '/' : '') + child.name;
			const hasChildren = ui.menu.getChildren(child).length > 0 && level < 2;
			const isActive = L.env.dispatchpath[level] == child.name;

			/* `data-node` is the stable, translation-independent key used
			   by decorateMenuIcons(); the visible title changes with the
			   active locale, the menu node name does not. */
			const a = E('a', {
				'href': hasChildren ? '#' : L.url(childUrl),
				'data-node': child.name
			}, [_(child.title)]);
			if (hasChildren)
				a.appendChild(this.mzCaret());
			const li = E('li', { 'class': isActive ? 'active' : '' }, [
				a,
				hasChildren ? this.renderSubMenu(child, childUrl, level) : E([])
			]);

			ul.appendChild(li);
		});
	},

	renderSubMenu(tree, url, level) {
		const ul = E('ul', { 'class': 'mz-submenu' });
		this.renderMenuLevel(ul, tree, url, level + 1);
		return ul;
	},

	renderTabMenu(tree, url) {
		const container = document.querySelector('#tabmenu');
		const ul = E('ul', { 'class': 'tabs' });
		const children = ui.menu.getChildren(tree);
		let activeNode = null;

		children.forEach((child) => {
			const isActive = (L.env.dispatchpath[3] == child.name);

			ul.appendChild(E('li', { 'class': isActive ? 'active' : '' }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				activeNode = child;
		});

		if (ul.children.length == 0)
			return;

		container.appendChild(ul);
		container.style.display = '';
	},

	/* (Removed 2026-09-07 OT-07: #modemenu is permanently hidden by CSS;
	   the renderer was dead code.) */

	/* ----- Menu folding (moved here from overview.js, OT-12) ---------

	   Runs synchronously right after render (no polling race), then lifts
	   the #mainmenu FOUC guard. Collapsed state persists per menu label. */
	foldMenu() {
		try {
			const topLi = document.querySelector('#mainmenu > li');
			if (topLi) {
				const topUl = topLi.querySelector(':scope > ul');
				if (topUl) {
					while (topUl.firstChild)
						topLi.parentNode.insertBefore(topUl.firstChild, topLi);
				}
				topLi.parentNode.removeChild(topLi);
			}

			document.querySelectorAll('#mainmenu > li').forEach((li) => {
				const sub = li.querySelector(':scope > ul');
				if (!sub)
					return;
				li.classList.add('mz-menu-group');
				const a = li.querySelector(':scope > a');
				if (!a)
					return;
				const label = a.textContent.trim();
				const hasActive = sub.querySelector('.active, li.active > a, a.active') !== null;
				let stored = null;
				try { stored = localStorage.getItem('mz-nav-' + label); } catch (err) {}
				const collapsed = stored !== null ? stored === '1' : !hasActive;
				if (collapsed) {
					li.classList.add('mz-collapsed');
					sub.style.display = 'none';
				}
				a.addEventListener('click', (e) => {
					e.preventDefault();
					const nowCollapsed = li.classList.toggle('mz-collapsed');
					sub.style.display = nowCollapsed ? 'none' : '';
					try { localStorage.setItem('mz-nav-' + label, nowCollapsed ? '1' : '0'); } catch (err) {}
				});
			});
		} catch (err) { /* folding must never break rendering */ }
		/* Icons last: foldMenu() reads a.textContent for the persisted
		   collapse key, so the label must still be plain text until it is
		   done. Wrapping afterwards leaves textContent unchanged. */
		this.decorateMenuIcons();

		const mm = document.getElementById('mainmenu');
		if (mm)
			mm.classList.add('mz-menu-ready');
	},

	/* Decorative menu icons.

	   Purely presentational: the <a> keeps its href, its text node (now
	   wrapped in .mz-menu-label) and every listener attached by
	   foldMenu(), so navigation and folding are untouched. A missing
	   match falls back to a neutral dot - the slot is optional in CSS. */
	mzIcon(paths) {
		const NS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', '18');
		svg.setAttribute('height', '18');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '1.75');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		svg.setAttribute('aria-hidden', 'true');
		svg.setAttribute('class', 'mz-menu-icon');
		paths.forEach((d) => {
			const el = document.createElementNS(NS, 'path');
			el.setAttribute('d', d);
			svg.appendChild(el);
		});
		return svg;
	},

	/* First-level menu icons, keyed by the LuCI NODE NAME (data-node).

	   The node name is emitted by renderMenuLevel() and is the same in
	   every locale, so the icon follows the menu entry rather than a
	   translated string. Title keywords remain as a fallback for menus
	   rendered without the attribute (older cached markup, custom
	   renderers). A node without any match gets the neutral hexagon -
	   the icon slot is optional in CSS, so an unmatched entry simply
	   shows none of the noise of a wrong glyph. */
	MENU_ICONS: {
		status: ['M3 12h4l3 8 4-16 3 8h4'],
		system: ['M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z',
			'M5 13h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z',
			'M8 7.5h.01', 'M8 16.5h.01'],
		network: ['M12 3a9 9 0 0 1 0 18a9 9 0 0 1 0-18z',
			'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3c3 3.5 3 14.5 0 18'],
		services: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
		nas: ['M12 7c4.4 0 8-1.1 8-2.5S16.4 2 12 2 4 3.1 4 4.5 7.6 7 12 7z',
			'M4 4.5v15C4 20.9 7.6 22 12 22s8-1.1 8-2.5v-15',
			'M20 12.5c0 1.4-3.6 2.5-8 2.5s-8-1.1-8-2.5'],
		control: ['M13 2 4 14h7l-1 8 9-12h-7z'],
		vpn: ['M6 11h12v10H6z', 'M9 11V7a3 3 0 0 1 6 0v4'],
		modem: ['M8.5 15.5a5 5 0 0 1 7 0', 'M5 12a10 10 0 0 1 14 0',
			'M2 8.5a15 15 0 0 1 20 0', 'M12 19h.01'],
		uci: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
			'M14 3v5h5', 'M9 13h6', 'M9 17h4']
	},

	/* Fallback keyword table (locale-dependent, checked only when the
	   node name is unknown). Order matters: first match wins. */
	MENU_ICON_FALLBACK: [
		['状态', 'status'], ['实时', 'status'], ['System', 'system'],
		['系统', 'system'], ['管理', 'system'], ['网络', 'network'],
		['接口', 'network'], ['无线', 'network'], ['服务', 'services'],
		['NAS', 'nas'], ['存储', 'nas'], ['管控', 'control'],
		['VPN', 'vpn'], ['移动', 'modem'], ['模组', 'modem']
	],

	MENU_ICON_DEFAULT: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z'],

	mzIconFor(node, label) {
		let key = node;
		if (!key || !this.MENU_ICONS[key]) {
			for (let i = 0; i < this.MENU_ICON_FALLBACK.length; i++) {
				if (label.indexOf(this.MENU_ICON_FALLBACK[i][0]) >= 0) {
					key = this.MENU_ICON_FALLBACK[i][1];
					break;
				}
			}
		}
		return this.MENU_ICONS[key] || this.MENU_ICON_DEFAULT;
	},

	/* Fold caret for collapsible groups. A real inline SVG instead of a
	   CSS border chevron: it is a flex item of the menu link, so it is
	   aligned by the same `align-items: center` as the icon and the
	   label and can never drift off the text baseline. */
	mzCaret() {
		const NS = 'http://www.w3.org/2000/svg';
		const span = document.createElement('span');
		span.setAttribute('class', 'mz-menu-caret');
		span.setAttribute('aria-hidden', 'true');
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('width', '14');
		svg.setAttribute('height', '14');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		const p = document.createElementNS(NS, 'path');
		p.setAttribute('d', 'M6 9l6 6 6-6');
		svg.appendChild(p);
		span.appendChild(svg);
		return span;
	},

	decorateMenuIcons() {
		try {
			document.querySelectorAll('#mainmenu > li > a').forEach((a) => {
				if (a.querySelector('.mz-menu-icon'))
					return;
				const label = (a.textContent || '').trim();
				const node = a.getAttribute('data-node') || '';
				/* The caret belongs AFTER the label at the far edge, so it
				   is kept out of the wrapping span and re-appended last. */
				const caret = a.querySelector('.mz-menu-caret');
				/* Wrap the existing text node so the icon can sit beside it
				   without changing the accessible name of the link. */
				const span = document.createElement('span');
				span.className = 'mz-menu-label';
				Array.from(a.childNodes).forEach((n) => {
					if (n !== caret)
						span.appendChild(n);
				});
				a.appendChild(this.mzIcon(this.mzIconFor(node, label)));
				a.appendChild(span);
				if (caret)
					a.appendChild(caret);
			});
		} catch (err) { /* icons are optional, never break the menu */ }
	},

	/* ----- Firewall zone colors (TZ-04) ----------------------------

	   LuCI paints .ifacebox-head with an inline background-color per
	   zone. The wallpaper CSS repaints heads translucently through
	   --zone-color-rgb, which must be populated from the computed color
	   (it is a custom property, so nothing sets it automatically).
	   Heads are re-rendered on every XHR poll, hence the observer. */
	initZoneColors() {
		const paint = () => {
			document.querySelectorAll('.ifacebox-head').forEach((head) => {
				try {
					const cs = window.getComputedStyle(head).backgroundColor;
					const m = cs && cs.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
					if (!m || (m[4] !== undefined && parseFloat(m[4]) === 0))
						return;
					const v = m[1] + ', ' + m[2] + ', ' + m[3];
					if (head.style.getPropertyValue('--zone-color-rgb') !== v)
						head.style.setProperty('--zone-color-rgb', v);
				} catch (err) {}
			});
		};
		paint();
		let t = null;
		const view = document.getElementById('mz-view');
		if (view && window.MutationObserver) {
			new MutationObserver(() => {
				if (t)
					window.clearTimeout(t);
				t = window.setTimeout(paint, 300);
			}).observe(view, { childList: true, subtree: true });
		}
	},

	/* ----- Sidebar drawer (mobile) ------------------------------- */

	/* Mobile top bar (2026-09-09): the old fixed corner hamburger forced a
	   full-height left padding gutter on #mz-view, leaving a large blank
	   column under the button. The toggle now lives inside a slim sticky
	   bar above the content that also shows the page title, so the view
	   keeps normal symmetric padding on every phone width. Desktop is
	   unaffected - the bar is display:none outside the 854px breakpoint.
	   (Later the same day: the in-page title rows are hidden on phones,
	   so the bar title mirrors the current page heading on every SPA
	   navigation and the dashboard refresh button is re-parented into
	   the bar; it moves back to its header when the viewport leaves the
	   phone range, keeping the desktop header untouched.) */
	initMobileBar() {
		const main = document.querySelector('.mz-main');
		const btn = document.querySelector('#mz-sidebar-toggle');
		if (!main || !btn || document.querySelector('.mz-mobilebar'))
			return;

		const bar = document.createElement('div');
		bar.className = 'mz-mobilebar';
		const title = document.createElement('span');
		title.className = 'mz-mobilebar-title';
		bar.appendChild(btn);
		bar.appendChild(title);
		main.insertBefore(bar, main.firstChild);

		const mq = window.matchMedia('(max-width: 854px)');

		const sync = () => {
			/* Title: mirror the current page heading (prefers the view h2,
			   falls back to the document title segment). Re-evaluated on
			   every navigation so it never goes stale. */
			const h2 = document.querySelector('#mz-view h2, .mz-view h2');
			const t = (h2 && h2.textContent.trim()) ||
				(String(document.title || '').split(' - ')[0] || '');
			if (t && t !== title.textContent)
				title.textContent = t;

			/* Refresh: relocate the dashboard refresh control between the
			   bar (phones) and its overview header (desktop). Drop stale
			   clones left behind by dashboard re-renders. */
			const orig = document.querySelector('.mint-ovd-refresh');
			bar.querySelectorAll('.mint-ovd-refresh').forEach((el) => {
				if (el !== orig)
					el.remove();
			});
			if (mq.matches) {
				if (orig && orig.parentElement !== bar)
					bar.appendChild(orig);
			} else {
				const header = document.querySelector('.mint-ovd-header');
				if (orig && header && orig.parentElement !== header)
					header.appendChild(orig);
			}
		};

		sync();
		if (mq.addEventListener)
			mq.addEventListener('change', sync);
		else
			mq.addListener(sync);

		/* LuCI swaps #mz-view content on every navigation (SPA); observe
		   it so title + refresh placement follow without a reload. */
		if (window.MutationObserver) {
			const target = document.getElementById('mz-view') || main;
			new MutationObserver(sync).observe(target, { childList: true, subtree: true });
		}
	},

	/* ----- Desktop page topbar (page title) ---------------------- */

	/* The server-rendered .mz-topbar carries the current page title and
	   the LuCI #indicators slot. Fill the title from the active view and
	   keep it in sync on SPA navigation; the topbar is hidden by CSS on
	   phones where .mz-mobilebar already shows the title. */
	initPageTopbar() {
		const title = document.getElementById('mz-topbar-title');
		if (!title)
			return;

		const sync = () => {
			const h2 = document.querySelector('#mz-view h2, .mz-view h2');
			const t = (h2 && h2.textContent.trim()) ||
				(String(document.title || '').split(' - ')[0] || '');
			if (t && t !== title.textContent)
				title.textContent = t;
		};

		sync();
		const target = document.getElementById('mz-view') || document.querySelector('.mz-main');
		if (target && window.MutationObserver)
			new MutationObserver(sync).observe(target, { childList: true, subtree: true });
	},

	initSidebarToggle() {
		const btn = document.querySelector('#mz-sidebar-toggle');
		const sidebar = document.querySelector('#mz-sidebar');
		const overlay = document.querySelector('#mz-overlay');

		if (!btn || !sidebar || !overlay)
			return;

		const setOpen = (open) => {
			sidebar.classList.toggle('is-open', open);
			overlay.hidden = !open;

			if (open) {
				requestAnimationFrame(() => overlay.classList.add('is-open'));
			} else {
				overlay.classList.remove('is-open');
			}

			btn.setAttribute('aria-expanded', open ? 'true' : 'false');
		};

		btn.addEventListener('click', () => {
			setOpen(!sidebar.classList.contains('is-open'));
		});

		overlay.addEventListener('click', () => setOpen(false));
	},

	/* ----- Color scheme ------------------------------------------ */

	initThemeToggle() {
		const btn = document.querySelector('#mz-theme-toggle');
		if (!btn)
			return;

		/* Cycle: system -> light -> dark -> system */
		btn.addEventListener('click', () => {
			const current = document.documentElement.getAttribute('data-theme') || 'system';
			const next = (current == 'system') ? 'light'
				: (current == 'light') ? 'dark' : 'system';

			this.applyTheme(next);
		});
	},

	/* Keep glass/wallpaper state in sync whenever the effective color
	   scheme changes (toggle button or OS preference flip in system mode):
	   dark = glass on pure black without a wallpaper, light = glass over
	   the wallpaper (re-initialized from cache). */
	syncWallpaperTheme() {
		if (document.getElementById('mz-login'))
			return;
		if (document.documentElement.getAttribute('data-theme') === 'dark') {
			document.documentElement.style.removeProperty('--mz-wallpaper');
			document.documentElement.style.removeProperty('--mz-wallpaper-overlay');
			document.documentElement.style.removeProperty('--mz-wallpaper-blur');
			document.body.classList.add('mz-has-wallpaper');
			return;
		}
		this.initGlobalWallpaper();
	},

	applyTheme(mode) {
		/* OT-14: attach the OS-theme listener once; it only acts while the
		   effective choice is 'system', so toggling back to system mode
		   follows the OS immediately without a reload. */
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		if (!this._mzThemeListener) {
			this._mzThemeListener = (ev) => {
				let saved = null;
				try { saved = localStorage.getItem('mz-theme'); } catch (e) {}
				if (saved === 'system' || (saved !== 'light' && saved !== 'dark')) {
					document.documentElement.setAttribute('data-theme', ev.matches ? 'dark' : 'light');
					this.syncWallpaperTheme();
				}
			};
			if (mq.addEventListener)
				mq.addEventListener('change', this._mzThemeListener);
			else
				mq.addListener(this._mzThemeListener);
		}
		if (mode == 'system')
			document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
		else
			document.documentElement.setAttribute('data-theme', mode);

		/* Persist the choice per browser (frontend-only override) */
		try {
			localStorage.setItem('mz-theme', mode);
		} catch (e) { /* private browsing */ }

		this.syncWallpaperTheme();
	},

	/* ----- Logout ------------------------------------------------ */

	initLogout() {
		const link = document.querySelector('#mz-logout');
		if (!link)
			return;

		link.addEventListener('click', (ev) => {
			ev.preventDefault();
			const fail = () => ui.addNotification(null, E('p', _('Logout failed, please try again.')), 'error');
			L.ui.sessions ? L.ui.sessions.getLocal().then((s) => {
				/* P3-1 (2026-09-07 review round 2): an empty local session
				   (expired/absent login) used to leave the click silent -
				   fall through to the plain logout POST in that case too. */
				if (s)
					fetch(L.url('admin/logout'), { method: 'POST' }).then((res) => {
						if (res && res.ok)
							window.location.reload();
						else
							fail();
					}).catch(fail);
				else
					window.location.assign(L.url('admin/logout'));
			}) : window.location.assign(L.url('admin/logout'));
		});
	},

	/* CBI form wrapper fallback + save fix. Some LuCI builds (notably the
	   stripped cbi.js shipped by certain OpenWrt/ImmortalWrt snapshots)
	   render the CBI view as a bare <div class="cbi-map"> without a
	   surrounding <form>, so the save button's cbi_submit() returns false
	   and toggles like "ui_random" never reach UCI. Worse, even once the
	   form exists, the CBI map's JS save() only issues `uci set` over ubus
	   and omits the `uci commit`, so the value is changed in memory but
	   never persisted to /etc/config. We fix both here:
	     1. inject a <form> around .cbi-map + the action bar,
	     2. take over the Save/Apply click and perform a full
	        `uci set` + `uci commit` via ubus (L.rpc), so the change sticks.
	   Idempotent: pages whose cbi view is already correctly wrapped (most
	   stock LuCI) are left alone; we only act when no <form> is present. */
	ensureCbiForm() {
		const map = document.querySelector('.cbi-map');
		if (!map) return;
		if (map.closest('form')) return;

		const form = document.createElement('form');
		form.method = 'post';
		form.action = window.location.pathname + window.location.search;
		form.enctype = 'multipart/form-data';
		form.setAttribute('data-mint-injected', '1');

		/* CSRF token: in this LuCI build L.config is not exposed, so the
		   token only lives inside the inline "L = new LuCI({...})" JSON
		   literal. Re-parse the page once (it's a few KB) to recover it.
		   The regex matches the key/value pair across newlines; the
		   token itself is a 32-char lowercase hex string. */
		let tok = '';
		try {
			const m = (document.body.innerHTML || '').match(/"token"\s*:\s*"([a-f0-9]{16,})"/);
			if (m) tok = m[1];
		} catch (e) { tok = ''; }
		const t1 = document.createElement('input');
		t1.type = 'hidden'; t1.name = 'token'; t1.value = tok;
		form.appendChild(t1);

		const t2 = document.createElement('input');
		t2.type = 'hidden'; t2.name = 'cbi.submit'; t2.value = '1';
		form.appendChild(t2);

		/* Wrap: move the .cbi-map and any sibling action bar (the
		   .cbi-page-actions / .cbi-apply / .cbi-map-actions container that
		   holds the Save button) into the new form, in document order. The
		   map's parent (typically #view) keeps its other children (heading,
		   description) above the form. */
		const parent = map.parentNode;
		if (!parent) return;
		const moveNodes = [map];
		Array.from(parent.children).forEach((ch) => {
			if (ch === map) return;
			if (ch.classList && (
				ch.classList.contains('cbi-page-actions') ||
				ch.classList.contains('cbi-apply') ||
				ch.classList.contains('cbi-map-actions') ||
				ch.classList.contains('cbi-map-descr'))) {
				moveNodes.push(ch);
			}
		});
		parent.insertBefore(form, moveNodes[0]);
		moveNodes.forEach((n) => form.appendChild(n));

		/* Snapshot every widget's rendered value. mintSave() later ships
		   ONLY options the user actually changed, so a stale tab (rendered
		   while uci held different values) can no longer silently rewrite
		   old state when someone clicks Save without touching anything -
		   the root cause of the mystery ui_random=0 flips (2026-09-09). */
		this.snapshotCbiValues(form);

		/* Take over Save / Save & Apply so the change is actually committed.
		   The stock CBI button has type="submit" with an (often broken)
		   onclick; we intercept the click, run a full ubus set+commit, then
		   reload so the new state renders. */
		form.querySelectorAll('button.cbi-button-save, input.cbi-button-save, ' +
			'button.cbi-button-apply, input.cbi-button-apply').forEach((btn) => {
			if (btn.getAttribute('data-mint-save-bound')) return;
			btn.setAttribute('data-mint-save-bound', '1');
			btn.addEventListener('click', (ev) => this.mintSave(ev));
		});
	},

	/* Record each CBI control's rendered value as data-mint-init so
	   collectCbiValues() can tell "user changed it" from "page happened
	   to render this way". */
	snapshotCbiValues(root) {
		const snap = (inp) => {
			if (!inp) return;
			const v = (inp.type === 'checkbox' || inp.type === 'radio')
				? (inp.checked ? '1' : '0') : inp.value;
			try { inp.setAttribute('data-mint-init', v); } catch (e) {}
		};
		root.querySelectorAll('[data-widget-id*="cbid."]').forEach((w) => {
			snap((w.matches && w.matches('input, select, textarea'))
				? w : w.querySelector('input, select, textarea'));
		});
		root.querySelectorAll('input[name^="cbid."], select[name^="cbid."], ' +
			'textarea[name^="cbid."]').forEach(snap);
	},

	/* Collect every CBI option from the injected form. Stock LuCI renders
	   each field as a widget whose identity lives in data-widget-id
	   ("widget.cbid.<config>.<section>.<option>"); on this build the raw
	   <input>/<select> elements often carry an EMPTY name attribute, so we
	   must read the value from the widget's inner control. We group options
	   by config+section as [ [option, value], ... ] pairs (the shape the
	   mint rpcd "save" method expects). Password widgets left blank are
	   skipped so we never wipe an existing secret (mirrors stock LuCI).
	   Options whose value equals the render-time snapshot are skipped as
	   well: pressing Save without editing anything must not write ANY
	   option back (a stale tab would otherwise re-write its rendered
	   values over newer uci state). */
	collectCbiValues(form) {
		const groups = {};
		const readWidget = (w) => {
			const id = w.getAttribute('data-widget-id') || '';
			const m = id.match(/cbid\.([^.]+)\.([^.]+)\.(.+)$/);
			if (!m) return;
			const config = m[1], section = m[2], option = m[3];
			/* On this build the data-widget-id sits directly on the control
			   element (an <input>/<select>/<textarea>); fall back to an inner
			   control for wrappers. */
			const inp = (w.matches && w.matches('input, select, textarea'))
				? w : w.querySelector('input, select, textarea');
			if (!inp) return;
			const init = inp.getAttribute('data-mint-init');
			let val;
			if (inp.type === 'checkbox') val = inp.checked ? '1' : '0';
			else if (inp.type === 'radio') {
				val = inp.checked ? '1' : '0';
				/* Unchecked radios are skipped - unless they were the
				   rendered selection (init '1'), in which case they must
				   ship '0' so a changed selection clears the old value. */
				if (!inp.checked && init !== '1') return;
			}
			else if (inp.type === 'password') { if (!inp.value) return; val = inp.value; }
			else val = inp.value;
			if (init != null && init === val) return; /* untouched since render */
			const key = config + '/' + section;
			if (!groups[key]) groups[key] = { config: config, section: section, pairs: [] };
			groups[key].pairs.push([option, val]);
		};
		form.querySelectorAll('[data-widget-id*="cbid."]').forEach(readWidget);
		/* Fallback for builds that do set a proper name attribute. */
		form.querySelectorAll('input[name^="cbid."], select[name^="cbid."], ' +
			'textarea[name^="cbid."]').forEach((el) => {
			const m = el.name.match(/^cbid\.([^.]+)\.([^.]+)\.(.+)$/);
			if (!m) return;
			const config = m[1], section = m[2], option = m[3];
			const init = el.getAttribute('data-mint-init');
			let val;
			if (el.type === 'checkbox') val = el.checked ? '1' : '0';
			else if (el.type === 'radio') {
				val = el.checked ? '1' : '0';
				if (!el.checked && init !== '1') return;
			}
			else if (el.type === 'password') { if (!el.value) return; val = el.value; }
			else val = el.value;
			if (init != null && init === val) return; /* untouched since render */
			const key = config + '/' + section;
			if (!groups[key]) groups[key] = { config: config, section: section, pairs: [] };
			groups[key].pairs.push([option, val]);
		});
		return groups;
	},

	/* Full save: ship the collected cbid values to the mint rpcd "save"
	   method, which runs as root inside the rpcd daemon and performs the
	   uci set + commit that the browser session is not allowed to do on
	   broken CBI builds. We use L.rpc.declare (the correct public API on
	   this LuCI; L.rpc.call has a different low-level signature here) so the
	   real ubus session is attached automatically. Reload afterwards. */
	mintSave(ev) {
		ev.preventDefault();
		const form = ev.currentTarget.closest('form') ||
			document.querySelector('form[data-mint-injected]');
		if (!form) return;
		const groups = this.collectCbiValues(form);
		const keys = Object.keys(groups).filter((k) => groups[k].pairs.length);
		if (!keys.length) { window.location.reload(); return; }

		const rpcSave = (window.L && L.rpc && typeof L.rpc.declare === 'function')
			? L.rpc.declare({ object: 'mint', method: 'save', params: ['config', 'section', 'values'] })
			/* R-09: honour a relocated ubus mount point (luci.main.ubuspath)
			   instead of hardcoding '/ubus/'. */
			: (cfg, sec, vals) => fetch((window.L && L.env && L.env.ubuspath) || '/ubus/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify([{ jsonrpc: '2.0', id: 'mint', method: 'call',
					params: [L.env.sessionid || '', 'mint', 'save', { config: cfg, section: sec, values: vals }] }])
			}).then((r) => r.json());

		let chain = Promise.resolve();
		keys.forEach((k) => {
			const g = groups[k];
			chain = chain.then(() => rpcSave(g.config, g.section, g.pairs));
		});
		chain.then(() => window.location.reload())
			.catch(() => window.location.reload());
	}
});
