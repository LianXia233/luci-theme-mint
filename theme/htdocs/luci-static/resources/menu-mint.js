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
		this.initThemeToggle();
		this.initLogout();
		this.initGlobalWallpaper();
		this.initZoneColors();

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
		const cfg = window.mintWallpaper;
		if (!cfg || cfg.enabled === false || cfg.ui_random === false)
			return;
		if (document.getElementById('mz-login'))
			return;

		const mobile = this.isMobileUA();
		const grp = mobile ? (cfg.mobile || {}) : (cfg.pc || {});
		/* OT-35: 5-minute wallpaper cache. The chosen URL is remembered per
		   device type in sessionStorage (survives LuCI's full page loads).
		   Within the TTL page switches reuse the same URL, so the image
		   comes straight from the browser HTTP cache instead of pulling a
		   fresh random picture on every navigation. */
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
		this.renderBreadcrumb(tree);

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

	/* Breadcrumb in the topbar, built from the live dispatch path */
	renderBreadcrumb(tree) {
		const crumb = document.getElementById('modemenu-breadcrumb');
		if (!crumb || !tree)
			return;

		const segs = L.env.dispatchpath || [];
		const titles = [];
		let node = tree;

		/* OT-06: tolerate both tree shapes - a virtual root whose child is
		   'admin', or a root that already IS 'admin'. */
		let start = 0;
		if (segs[0] === 'admin' && node && node.children && node.children['admin']) {
			node = node.children['admin'];
			start = 1;
		} else if (segs[0] === 'admin') {
			start = 1;
		}
		for (let i = start; i < segs.length; i++) {
			if (!node || !node.children)
				break;
			node = node.children[segs[i]];
			if (!node)
				break;
			titles.push(node.title);
		}

		if (titles.length === 0)
			return;

		crumb.innerHTML = '';
		titles.forEach((t, i) => {
			crumb.appendChild(E('li', {}, [ _(t) ]));
			if (i < titles.length - 1)
				crumb.appendChild(E('li', { 'class': 'mz-crumb-sep' }, [ '/' ]));
		});
		crumb.style.display = '';
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

	applyTheme(mode) {
		/* OT-14: attach the OS-theme listener once; it only acts while the
		   effective choice is 'system', so toggling back to system mode
		   follows the OS immediately without a reload. */
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		if (!this._mzThemeListener) {
			this._mzThemeListener = (ev) => {
				let saved = null;
				try { saved = localStorage.getItem('mz-theme'); } catch (e) {}
				if (saved === 'system' || (saved !== 'light' && saved !== 'dark'))
					document.documentElement.setAttribute('data-theme', ev.matches ? 'dark' : 'light');
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
	}
});
