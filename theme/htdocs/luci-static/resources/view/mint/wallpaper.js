// mint wallpaper settings view
// Copyright (C) 2026 LianXia233
// Licensed to the public under the Apache License 2.0.

'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require ui';

var callFileWrite = rpc.declare({
	object: 'file',
	method: 'write',
	params: [ 'path', 'data' ],
	expect: { code: 0 }
});

var PC_CUSTOM = '/www/luci-static/mint/custom-pc.jpg';
var MOBILE_CUSTOM = '/www/luci-static/mint/custom-mobile.jpg';

return view.extend({
	render() {
		const self = this;
		const m = new form.Map('mint', _('Mint Wallpaper'),
			_('Login page background image. Configure separate sources for desktop and mobile visitors.'));

		const s = m.section(form.TypedSection, 'wallpaper', null, _('Settings'));
		s.addremove = false;
		s.anonymous = true;

		s.option(form.Flag, 'enabled', _('Enabled'),
			_('When disabled, the login page uses the built-in gradient fallback.'));

		const uiRandom = s.option(form.Flag, 'ui_random', _('Random wallpaper on admin pages'),
			_('When enabled, every login page load and every admin page refresh automatically picks a fresh random image for the current device type.'));
		uiRandom.default = '1'; /* OT-09: match the header.ut default (on when unset) */

		/* ---- PC source ---- */
		const pcMode = s.option(form.ListValue, 'pc_mode', _('Desktop source'));
		pcMode.value('random', _('Random (multi-source)'));
		pcMode.value('custom', _('Custom image'));
		pcMode.default = 'random';

		const pcUrl = s.option(form.Value, 'pc_url', _('Desktop custom image URL'),
			_('Direct http(s) link to an image. Used when no desktop image has been uploaded.'));
		pcUrl.rmempty = true;
		pcUrl.depends('pc_mode', 'custom');

		const pcSources = s.option(form.DynamicList, 'pc_sources', _('Desktop random sources'),
			_('One URL per entry. Sources are picked at random and the next one is tried when a source fails. Leave empty to use the built-in defaults.'));
		pcSources.rmempty = true;
		pcSources.depends('pc_mode', 'random');

		/* ---- Mobile source ---- */
		const mMode = s.option(form.ListValue, 'mobile_mode', _('Mobile source'));
		mMode.value('random', _('Random ACG (multi-source)'));
		mMode.value('custom', _('Custom image'));
		mMode.default = 'random';

		const mUrl = s.option(form.Value, 'mobile_url', _('Mobile custom image URL'),
			_('Direct http(s) link to an image. Used when no mobile image has been uploaded.'));
		mUrl.rmempty = true;
		mUrl.depends('mobile_mode', 'custom');

		const mSources = s.option(form.DynamicList, 'mobile_sources', _('Mobile random sources'),
			_('One URL per entry. Sources are picked at random and the next one is tried when a source fails. Leave empty to use the built-in defaults.'));
		mSources.rmempty = true;
		mSources.depends('mobile_mode', 'random');

		/* ---- Global ---- */
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

		return m.render().then((nodes) => {
			/* NOTE (TZ-17, 2026-09-07): the "Refresh wallpaper cache" button
			   was removed - random images come straight from remote APIs and
			   custom images are local files, so no server-side cache exists. */
			const btnRow = E('div', { 'class': 'cbi-page-actions mz-wp-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					'click': function(ev) {
						ev.preventDefault();
						ev.stopPropagation();
						document.getElementById('mz-wp-file-pc').click();
					}
				}, [ _('Upload desktop image…') ]),
				E('input', {
					'type': 'file',
					'id': 'mz-wp-file-pc',
					'style': 'display:none',
					'accept': 'image/jpeg,image/png,image/webp',
					'change': ui.createHandlerFn(self, 'handleUpload', 'pc')
				}),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					'click': function(ev) {
						ev.preventDefault();
						ev.stopPropagation();
						document.getElementById('mz-wp-file-mobile').click();
					}
				}, [ _('Upload mobile image…') ]),
				E('input', {
					'type': 'file',
					'id': 'mz-wp-file-mobile',
					'style': 'display:none',
					'accept': 'image/jpeg,image/png,image/webp',
					'change': ui.createHandlerFn(self, 'handleUpload', 'mobile')
				})
			]);

			const bar = nodes.querySelector('.cbi-page-actions');
			if (bar)
				bar.insertBefore(btnRow, bar.firstChild);
			else
				nodes.insertBefore(btnRow, nodes.firstChild);

			return nodes;
		});
	},

	handleUpload(kind, ev) {
		const input = ev.target;
		const file = input.files[0];
		if (!file)
			return;

		if (file.size > 3 * 1024 * 1024) {
			ui.addNotification(null, E('p', _('Image is too large (max 3 MB).')), 'error');
			return;
		}

		/* OT-17: busy guard - the input stays disabled until the write
		   finishes, so double clicks cannot interleave two uploads. */
		if (input.disabled)
			return;
		input.disabled = true;

		const target = (kind === 'mobile') ? MOBILE_CUSTOM : PC_CUSTOM;
		const done = () => { input.disabled = false; input.value = ''; };

		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(reader.error || new Error('read failed'));
			reader.readAsDataURL(file);
		}).then((dataUrl) => {
			const b64 = String(dataUrl).split(',', 2)[1] || '';
			if (!b64)
				throw new Error('empty image');
			return callFileWrite(target, b64);
		}).then(() => {
			done();
			ui.addNotification(null, E('p', _('Image uploaded. Set the matching source to "Custom image" to use it.')), 'info');
		}).catch((e) => {
			done();
			ui.addNotification(null, E('p', _('Upload failed: %s').format(e.message)), 'error');
		});
	}
});
