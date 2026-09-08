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

return baseclass.extend({
	__init__() {
		ui.menu.load().then((tree) => this.render(tree));

		this.initSidebarToggle();
		this.initMobileBar();
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

		/* Dark theme (2026-09-09): global glass on PURE BLACK, never a
		   wallpaper. The mz-has-wallpaper class still activates the whole
		   glass token/component layer, but no image is fetched and CSS
		   paints the wallpaper layers black (see the dark ::before/::after
		   overrides in cascade.css). */
		if (document.documentElement.getAttribute('data-theme') === 'dark') {
			document.documentElement.style.removeProperty('--mz-wallpaper');
			document.documentElement.style.removeProperty('--mz-wallpaper-overlay');
			document.documentElement.style.removeProperty('--mz-wallpaper-blur');
			document.body.classList.add('mz-has-wallpaper');
			return;
		}

		const cfg = window.mintWallpaper;
		if (!cfg || cfg.enabled === false || cfg.ui_random === false)
			return;

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
		else {
			/* Random multi-source: shuffle the configured list and try each
			   entry in turn, falling back to the next one on failure. */
			const sources = (grp.sources && grp.sources.length) ? grp.sources : [mzWp.randomUrl(mobile)];
			urls = shuffle(sources).map((u) => u + (u.indexOf('?') >= 0 ? '&' : '?') + '_mzt=' + Date.now());
		}

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

			const li = E('li', { 'class': isActive ? 'active' : '' }, [
				E('a', { 'href': hasChildren ? '#' : L.url(childUrl) }, [
					_(child.title)
				]),
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
		const mm = document.getElementById('mainmenu');
		if (mm)
			mm.classList.add('mz-menu-ready');
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
			: (cfg, sec, vals) => fetch('/ubus/', {
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
