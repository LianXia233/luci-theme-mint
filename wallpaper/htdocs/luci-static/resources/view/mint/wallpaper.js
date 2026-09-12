// mint wallpaper settings view — wallpaper management centre
// Copyright (C) 2026 LianXia233
// Licensed to the public under the Apache License 2.0.
//
// Flow: pick file → POST /cgi-bin/cgi-upload (multipart, session-auth) →
// library file on disk → wp_list refresh → thumbnail appears → click to
// select (wp_set) → background updates immediately → UCI persisted.
//
// Upload does NOT go through ubus file.write: on several rpcd builds that
// call either rejects large base64 payloads or writes the base64 text
// itself as file content. cgi-io streams the raw body and checks the
// LuCI session, which is the supported OpenWrt path (same one LuCI's own
// FileUpload widget uses).

'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require ui';
'require fs';
'require request';

var callMintSave = rpc.declare({
	object: 'mint',
	method: 'save',
	params: ['config', 'section', 'values'],
	expect: {}
});

var callMintWpList = rpc.declare({
	object: 'mint',
	method: 'wp_list',
	expect: {}
});

var callMintWpSet = rpc.declare({
	object: 'mint',
	method: 'wp_set',
	params: ['target', 'value'],
	expect: {}
});

var callMintWpDelete = rpc.declare({
	object: 'mint',
	method: 'wp_delete',
	params: ['name'],
	expect: {}
});

var callMintWpRefresh = rpc.declare({
	object: 'mint',
	method: 'wp_refresh',
	params: ['kind'],
	expect: {}
});

var MAX_UPLOAD = 8 * 1024 * 1024; /* 8 MB — matches mz-wallpaper-fetch cap */
var OK_EXT = /\.(jpe?g|png|webp|gif)$/i;

/* Load the mint config, retrying across LuCI's initial anonymous-session
   window. On a fresh page load the first RPC calls (including uci get mint)
   fire before the real ubus session is established and are rejected with
   "Access denied". LuCI's uci module permanently caches that rejected load
   in `loaded['mint']`, so every later uci.load('mint') keeps failing and the
   form renders empty ("No configuration yet"). We clear the poisoned cache
   with uci.unload() and reload until the session is ready. */
function delay(ms) {
	return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
}

function loadMintWithTimeout(timeoutMs) {
	return new Promise(function (resolve, reject) {
		let done = false;
		var timer = window.setTimeout(function () {
			if (done) return;
			done = true;
			reject(new Error('uci.load(mint) timed out'));
		}, timeoutMs);
		uci.load('mint').then(function (r) {
			if (done) return;
			done = true;
			window.clearTimeout(timer);
			resolve(r);
		}, function (e) {
			if (done) return;
			done = true;
			window.clearTimeout(timer);
			reject(e);
		});
	});
}

async function loadMintReady() {
	for (let i = 0; i < 10; i++) {
		try {
			uci.unload('mint');
			await loadMintWithTimeout(3000);
			return true;
		} catch (e) {
			uci.unload('mint');
			await delay(250);
		}
	}
	return false;
}

/* Sanitize an arbitrary filename into a safe library name. Keeps a short
   readable stem (unicode letters/digits), replaces everything else with
   '-', always suffixes a short random token so Chinese names / collisions
   / "same name overwrite" never fight the filesystem. */
function safeUploadName(original, ext) {
	var stem = String(original || 'wallpaper').replace(/\.[^.]+$/, '');
	stem = stem.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
	if (stem.length > 40)
		stem = stem.slice(0, 40);
	if (!stem)
		stem = 'wallpaper';
	var token = Math.random().toString(36).slice(2, 8);
	return 'wp-' + stem + '-' + token + ext;
}

function extOf(name) {
	var m = String(name).match(/\.[^.]+$/);
	return m ? m[0].toLowerCase() : '.jpg';
}

/* Map server "current" state onto what the on-page library knows. */
function activeNames(data) {
	var cur = (data && data.current) || {};
	return {
		pc: cur.pc_wallpaper || '',
		mobile: cur.mobile_wallpaper || '',
		pc_mode: cur.pc_mode || 'random',
		mobile_mode: cur.mobile_mode || 'random',
		enabled: cur.enabled !== '0'
	};
}

/* Push the new selection into the live admin background without a reload.
   Only the edited device group is rewritten; the other device keeps its
   current config so PC / mobile stay independent. */
function applyLiveWallpaper(url, target) {
	var grp = (!url)
		? { mode: 'random', url: '', proxy: '', sources: [] }
		: { mode: 'custom', url: url, proxy: '', sources: [] };

	if (window.mintWallpaper) {
		if (target === 'mobile')
			window.mintWallpaper.mobile = grp;
		else if (target === 'pc')
			window.mintWallpaper.pc = grp;
		else {
			window.mintWallpaper.pc = grp;
			window.mintWallpaper.mobile = grp;
		}
	}

	if (!url) {
		/* Leave the gradient if the OTHER device still has an image. */
		var other = (target === 'mobile')
			? (window.mintWallpaper && window.mintWallpaper.pc)
			: (window.mintWallpaper && window.mintWallpaper.mobile);
		var otherHas = other && (other.url || other.proxy);
		if (!otherHas)
			document.documentElement.style.removeProperty('--mz-wallpaper');
		return;
	}
	document.documentElement.style.setProperty('--mz-wallpaper', 'url("' + url + '")');
	document.body.classList.add('mz-has-wallpaper');
}

return view.extend({
	render() {
		const self = this;
		return loadMintReady().then(function () {
			return callMintWpList().catch(function () {
				return { wallpapers: [], current: {}, proxy: {}, legacy: {} };
			}).then(function (data) {
				return self.renderManager(data);
			});
		});
	},

	renderManager(data) {
		const self = this;
		const cur = activeNames(data);
		const list = (data && data.wallpapers) || [];
		const proxy = (data && data.proxy) || {};
		const legacy = (data && data.legacy) || {};

		const root = E('div', { 'class': 'mz-wp-mgr' }, [
			E('div', { 'class': 'mz-wp-mgr-head' }, [
				E('h2', {}, [_('Wallpaper Library')]),
				E('p', { 'class': 'mz-wp-mgr-sub' },
					[_('Upload images, then click a thumbnail to apply it as the desktop / mobile wallpaper. Selections survive refresh and reboot.')])
			]),

			E('div', { 'class': 'mz-wp-mgr-toolbar' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button cbi-button-positive',
					'id': 'mz-wp-upload-pc',
					'data-target': 'pc',
					'click': function (ev) {
						ev.preventDefault();
						var input = document.getElementById('mz-wp-file-pc');
						if (input) input.click();
					}
				}, [_('Upload desktop wallpaper…')]),
				E('input', {
					'type': 'file',
					'id': 'mz-wp-file-pc',
					'style': 'display:none',
					'accept': 'image/jpeg,image/png,image/webp,image/gif',
					'data-target': 'pc',
					'change': ui.createHandlerFn(self, 'handleUpload', 'pc')
				}),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button cbi-button-positive',
					'id': 'mz-wp-upload-mobile',
					'data-target': 'mobile',
					'click': function (ev) {
						ev.preventDefault();
						var input = document.getElementById('mz-wp-file-mobile');
						if (input) input.click();
					}
				}, [_('Upload mobile wallpaper…')]),
				E('input', {
					'type': 'file',
					'id': 'mz-wp-file-mobile',
					'style': 'display:none',
					'accept': 'image/jpeg,image/png,image/webp,image/gif',
					'data-target': 'mobile',
					'change': ui.createHandlerFn(self, 'handleUpload', 'mobile')
				}),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					'id': 'mz-wp-refresh-cache',
					'click': ui.createHandlerFn(self, 'handleRefreshCache')
				}, [_('Force refresh current device cache')]),
				E('span', { 'class': 'mz-wp-mgr-status', 'id': 'mz-wp-status' }, [''])
			]),

			E('div', { 'class': 'mz-wp-target-row' }, [
				E('span', { 'class': 'mz-wp-target-label' }, [_('Click to apply to:')]),
				E('label', { 'class': 'mz-wp-target' }, [
					E('input', { 'type': 'radio', 'name': 'mz-wp-target', 'value': 'pc', 'checked': true, 'change': function () { self.reloadGrid(); } }),
					' ', _('Desktop')
				]),
				E('label', { 'class': 'mz-wp-target' }, [
					E('input', { 'type': 'radio', 'name': 'mz-wp-target', 'value': 'mobile', 'change': function () { self.reloadGrid(); } }),
					' ', _('Mobile')
				]),
				E('span', { 'class': 'mz-wp-target-hint', 'id': 'mz-wp-target-hint' }, [''])
			]),

			E('div', { 'class': 'mz-wp-grid', 'id': 'mz-wp-grid' },
				this.buildGridNodes(list, proxy, legacy, cur))
		]);

		/* Advanced settings map (sources, overlay, blur, enabled…) stays a
		   normal LuCI form so every existing option keeps working. */
		const m = new form.Map('mint', _('Advanced settings'),
			_('Random sources, overlay and blur. Library wallpapers above override these when selected.'));

		const s = m.section(form.NamedSection, 'wallpaper', 'mint', _('Settings'));
		s.addremove = false;
		s.anonymous = false;

		s.option(form.Flag, 'enabled', _('Enabled'),
			_('When disabled, the login page uses the built-in gradient fallback.'));

		const uiRandom = s.option(form.Flag, 'ui_random', _('Random wallpaper on admin pages'),
			_('When enabled, every login page load and every admin page refresh automatically picks a fresh random image for the current device type.'));
		uiRandom.default = '0';

		const pcMode = s.option(form.ListValue, 'pc_mode', _('Desktop source'));
		pcMode.value('random', _('Random (multi-source)'));
		pcMode.value('custom', _('Custom image'));
		pcMode.default = 'random';

		const pcUrl = s.option(form.Value, 'pc_url', _('Desktop custom image URL'),
			_('Direct http(s) link to an image. Used when no desktop library wallpaper is selected.'));
		pcUrl.rmempty = true;
		pcUrl.depends('pc_mode', 'custom');

		const pcSources = s.option(form.DynamicList, 'pc_sources', _('Desktop random sources'),
			_('One URL per entry. Sources are picked at random and the next one is tried when a source fails. Leave empty to use the built-in defaults.'));
		pcSources.rmempty = true;
		pcSources.depends('pc_mode', 'random');

		const mMode = s.option(form.ListValue, 'mobile_mode', _('Mobile source'));
		mMode.value('random', _('Random ACG (multi-source)'));
		mMode.value('custom', _('Custom image'));
		mMode.default = 'random';

		const mUrl = s.option(form.Value, 'mobile_url', _('Mobile custom image URL'),
			_('Direct http(s) link to an image. Used when no mobile library wallpaper is selected.'));
		mUrl.rmempty = true;
		mUrl.depends('mobile_mode', 'custom');

		const mSources = s.option(form.DynamicList, 'mobile_sources', _('Mobile random sources'),
			_('One URL per entry. Sources are picked at random and the next one is tried when a source fails. Leave empty to use the built-in defaults.'));
		mSources.rmempty = true;
		mSources.depends('mobile_mode', 'random');

		const overlay = s.option(form.Value, 'overlay', _('Overlay opacity'),
			_('Dark overlay strength over the wallpaper (0.0 - 1.0).'));
		overlay.datatype = 'ufloat';
		overlay.default = '0.45';
		overlay.validate = function(sid, v) {
			const n = parseFloat(v);
			return (isNaN(n) || n < 0 || n > 1) ? _('Must be a number between 0.0 and 1.0.') : true;
		};

		const blur = s.option(form.Value, 'blur', _('Blur (px)'),
			_('Background blur in pixels; 0 disables.'));
		blur.datatype = 'uinteger';
		blur.default = '0';
		blur.validate = function(sid, v) {
			const n = parseInt(v, 10);
			return (isNaN(n) || n < 0 || n > 40) ? _('Must be an integer between 0 and 40.') : true;
		};

		return m.render().then((formNodes) => {
			const wrap = E('div', {}, [
				root,
				E('div', { 'class': 'mz-wp-adv' }, [
					E('h3', {}, [_('Advanced settings')])
				]),
				formNodes
			]);
			return wrap;
		});
	},

	/* Built-in entries (random cache / gradient) + every library file. */
	buildGridNodes(list, proxy, legacy, cur) {
		const self = this;
		const nodes = [];

		const targetOf = () => {
			const el = document.querySelector('input[name="mz-wp-target"]:checked');
			return (el && el.value) || 'pc';
		};
		const isPcActive = () => targetOf() === 'pc';
		const activeName = () => (isPcActive() ? cur.pc : cur.mobile);
		const activeMode = () => (isPcActive() ? cur.pc_mode : cur.mobile_mode);

		/* Random entry */
		const randomThumb = (isPcActive() && proxy.pc) || proxy.mobile || '';
		const randomActive = () => {
			if (!cur.enabled)
				return false;
			const t = targetOf();
			const name = t === 'pc' ? cur.pc : cur.mobile;
			const mode = t === 'pc' ? cur.pc_mode : cur.mobile_mode;
			return !name && mode === 'random';
		};
		const randomCard = E('div', {
			'class': 'mz-wp-card' + (randomActive() ? ' is-active' : ''),
			'data-kind': 'random',
			'click': function () { self.handleSelect('random'); }
		}, [
			E('div', {
				'class': 'mz-wp-thumb mz-wp-thumb-random',
				'style': randomThumb ? 'background-image:url("' + randomThumb + '")' : ''
			}, []),
			E('div', { 'class': 'mz-wp-meta' }, [
				E('span', { 'class': 'mz-wp-name' }, [_('Random wallpaper')]),
				E('span', { 'class': 'mz-wp-badge' }, [_('server cache')])
			])
		]);
		nodes.push(randomCard);

		/* Gradient / none entry — active whenever the feature is disabled */
		const noneActive = () => !cur.enabled;
		nodes.push(E('div', {
			'class': 'mz-wp-card' + (noneActive() ? ' is-active' : ''),
			'data-kind': 'none',
			'click': function () { self.handleSelect('none'); }
		}, [
			E('div', { 'class': 'mz-wp-thumb mz-wp-thumb-none' }, []),
			E('div', { 'class': 'mz-wp-meta' }, [
				E('span', { 'class': 'mz-wp-name' }, [_('Default gradient')]),
				E('span', { 'class': 'mz-wp-badge' }, [_('no image')])
			])
		]));

		/* Library files */
		for (let i = 0; i < list.length; i++) {
			const w = list[i];
			const isActive = cur.enabled && ((cur.pc === w.name) || (cur.mobile === w.name));
			const side = (cur.pc === w.name ? 'pc' : '') + (cur.mobile === w.name ? (cur.pc === w.name ? '+' : '') + 'mobile' : '');
			nodes.push(E('div', {
				'class': 'mz-wp-card' + (isActive ? ' is-active' : ''),
				'data-kind': 'file',
				'data-name': w.name,
				'click': function () { self.handleSelect(w.name); }
			}, [
				E('div', {
					'class': 'mz-wp-thumb',
					'style': 'background-image:url("' + w.url + '")'
				}, []),
				E('div', { 'class': 'mz-wp-meta' }, [
					E('span', { 'class': 'mz-wp-name', 'title': w.name }, [w.name]),
					E('span', { 'class': 'mz-wp-badge' }, [side || _('library')])
				]),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button mz-wp-del',
					'click': function (ev) {
						ev.stopPropagation();
						ev.preventDefault();
						self.handleDelete(w.name);
					}
				}, [_('Delete')])
			]));
		}

		if (!list.length) {
			nodes.push(E('div', { 'class': 'mz-wp-empty' },
				[_('No local wallpapers yet. Use the desktop / mobile upload buttons above to add one.')]));
		}

		return nodes;
	},

	setStatus(msg, kind) {
		const el = document.getElementById('mz-wp-status');
		if (!el) return;
		el.textContent = msg || '';
		el.className = 'mz-wp-mgr-status' + (kind ? ' is-' + kind : '');
	},

	/* Re-fetch the library and re-render the grid in place. */
	reloadGrid() {
		const self = this;
		return callMintWpList().then(function (data) {
			const grid = document.getElementById('mz-wp-grid');
			if (!grid) return data;
			const nodes = self.buildGridNodes(
				(data && data.wallpapers) || [],
				(data && data.proxy) || {},
				(data && data.legacy) || {},
				activeNames(data)
			);
			while (grid.firstChild)
				grid.removeChild(grid.firstChild);
			for (let i = 0; i < nodes.length; i++)
				grid.appendChild(nodes[i]);
			return data;
		});
	},

	handleSelect(value, forceTarget) {
		const self = this;
		const target = forceTarget
			|| (document.querySelector('input[name="mz-wp-target"]:checked') || {}).value
			|| 'pc';

		return new Promise(function (resolve) {
			if (value === 'none') {
				/* Gradient fallback: turn the wallpaper feature off (global).
				   Library selections are left in place so re-enabling later
				   restores the previous choice. */
				return callMintSave({
					config: 'mint',
					section: 'wallpaper',
					values: [['enabled', '0']]
				}).then(function () {
					uci.unload('mint');
					return uci.load('mint');
				}).then(resolve, resolve);
			}
			if (value === 'random') {
				return callMintWpSet({ target: target, value: 'random' }).then(function () {
					/* Re-enable in case a previous “none” turned it off. */
					return callMintSave({
						config: 'mint',
						section: 'wallpaper',
						values: [['enabled', '1']]
					});
				}).then(resolve, resolve);
			}
			return callMintWpSet({ target: target, value: value }).then(function () {
				return callMintSave({
					config: 'mint',
					section: 'wallpaper',
					values: [['enabled', '1']]
				});
			}).then(resolve, resolve);
		}).then(function () {
			uci.unload('mint');
			return uci.load('mint').catch(function () {});
		}).then(function () {
			return self.reloadGrid();
		}).then(function (data) {
			/* Live-apply the chosen background for the edited target. */
			const cur = activeNames(data);
			const list = (data && data.wallpapers) || [];
			const proxy = (data && data.proxy) || {};

			if (value === 'none') {
				applyLiveWallpaper(null, target);
				self.setStatus(_('Default gradient applied.'), 'ok');
				return;
			}
			if (value === 'random') {
				const thumb = (target === 'pc' ? proxy.pc : proxy.mobile) || proxy.pc || proxy.mobile || '';
				applyLiveWallpaper(thumb || null, target);
				self.setStatus(_('Random wallpaper selected.'), 'ok');
				return;
			}
			let url = '';
			for (let i = 0; i < list.length; i++) {
				if (list[i].name === value) {
					url = list[i].url;
					break;
				}
			}
			applyLiveWallpaper(url, target);
			self.setStatus(_('Wallpaper applied: %s (%s)').format(value, target === 'mobile' ? _('Mobile') : _('Desktop')), 'ok');
		}).catch(function (e) {
			self.setStatus(_('Failed to apply wallpaper: %s').format(e && e.message || e), 'error');
		});
	},

	handleDelete(name) {
		const self = this;
		if (!window.confirm(_('Delete wallpaper “%s”? This cannot be undone.').format(name)))
			return Promise.resolve();

		return callMintWpDelete({ name: name }).then(function () {
			uci.unload('mint');
			return uci.load('mint').catch(function () {});
		}).then(function () {
			return self.reloadGrid();
		}).then(function (data) {
			const cur = activeNames(data);
			/* Clear live background for devices that no longer select this file. */
			if (cur.pc !== name)
				applyLiveWallpaper(null, 'pc');
			if (cur.mobile !== name)
				applyLiveWallpaper(null, 'mobile');
			self.setStatus(_('Wallpaper deleted: %s').format(name), 'ok');
		}).catch(function (e) {
			self.setStatus(_('Delete failed: %s').format(e && e.message || e), 'error');
		});
	},

	handleRefreshCache() {
		const self = this;
		/* Refresh ONLY the currently selected device class. PC cache and
		   mobile cache are independent files (wallpaper-pc.img vs
		   wallpaper-mobile.img); a manual refresh must never rewrite both. */
		const kind = (document.querySelector('input[name="mz-wp-target"]:checked') || {}).value || 'pc';
		const label = kind === 'mobile' ? _('Mobile') : _('Desktop');
		this.setStatus(_('Refreshing random wallpaper cache (%s)…').format(label), 'busy');
		return callMintWpRefresh({ kind: kind }).then(function (res) {
			return self.reloadGrid().then(function () {
				const url = res && res.url;
				if (url)
					applyLiveWallpaper(url, kind);
				self.setStatus(_('Wallpaper cache refreshed (%s).').format(label), 'ok');
			});
		}).catch(function (e) {
			self.setStatus(_('Cache refresh failed: %s').format(e && e.message || e), 'error');
		});
	},

	/* Upload via LuCI cgi-io: multipart POST with the live session id.
	   `target` is 'pc' | 'mobile' from the dedicated upload buttons. */
	handleUpload(target, ev) {
		const self = this;
		const input = ev.target;
		const file = input.files[0];
		const btn = document.getElementById('mz-wp-upload-' + target);
		const done = function () {
			input.disabled = false;
			input.value = '';
			if (btn) btn.disabled = false;
		};

		if (!file)
			return Promise.resolve();

		if (!OK_EXT.test(file.name)) {
			ui.addNotification(null, E('p', _('Unsupported file type. Use JPG, PNG, WEBP or GIF.')), 'error');
			done();
			return Promise.resolve();
		}
		if (file.size > MAX_UPLOAD) {
			ui.addNotification(null, E('p', _('Image is too large (max %d MB).').format(MAX_UPLOAD / (1024 * 1024))), 'error');
			done();
			return Promise.resolve();
		}

		input.disabled = true;
		if (btn) btn.disabled = true;
		self.setStatus(
			target === 'mobile'
				? _('Uploading mobile wallpaper…')
				: _('Uploading desktop wallpaper…'),
			'busy');

		/* Keep the radio in sync so the grid highlights the right device. */
		var radio = document.querySelector('input[name="mz-wp-target"][value="' + target + '"]');
		if (radio) radio.checked = true;

		const safeName = safeUploadName(file.name, extOf(file.name));
		const remotePath = '/www/luci-static/mint/wallpapers/' + safeName;

		const form = new FormData();
		form.append('sessionid', rpc.getSessionID());
		form.append('filename', remotePath);
		form.append('filedata', file);

		return request.post(L.env.cgi_base + '/cgi-upload', form, { timeout: 0 }).then(function (res) {
			let reply = res;
			if (res && typeof res.json === 'function')
				reply = res.json();
			else if (typeof res === 'string') {
				try { reply = JSON.parse(res); } catch (e) { reply = {}; }
			}
			if (reply && reply.failure)
				throw new Error((reply.failure[1] || 'upload failed') + ' (' + reply.failure[0] + ')');
			if (reply && typeof reply.result === 'number' && reply.result !== 0)
				throw new Error('upload failed (' + reply.result + ')');
			/* File is on disk — immediately apply it to this device. */
			return self.handleSelect(safeName, target).then(function () {
				ui.addNotification(null, E('p',
					_('Wallpaper uploaded and applied: %s').format(safeName)), 'notice');
				self.setStatus(_('Uploaded: %s').format(safeName), 'ok');
			});
		}).catch(function (e) {
			ui.addNotification(null, E('p', _('Upload failed: %s').format(e && e.message || e)), 'error');
			self.setStatus(_('Upload failed.'), 'error');
		}).then(done, done);
	}
});
