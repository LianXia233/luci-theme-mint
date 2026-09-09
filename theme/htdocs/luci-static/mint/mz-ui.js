/*
 * mint - shared UI helpers (device-agnostic)
 * Copyright (C) 2026 LianXia233
 * Licensed to the public under the Apache License 2.0.
 *
 * Loaded on every admin page. Owns apply/revert notifications and
 * cbi-dynlist edit/delete affordances. The overview renderers
 * (overview-dashboard.js / overview-mobile.js) are separate files.
 */
(function () {
	'use strict';

	var __ = function (s) {
		if (!s || typeof s !== 'string')
			return s;
		try {
			if (typeof _ === 'function') {
				var t = _(s);
				if (t && t !== s)
					return t;
			}
			if (window.TR) {
				var v = window.TR[mzSfh(s).toString(16).padStart(8, '0')];
				if (v)
					return v;
			}
		} catch (e) { /* fall through to echo */ }
		return s;
	};

	function mzSfh(data) {
		/* NOTE: JS bitwise ops are 32-bit signed, and "& 0xffffffff" does
		   NOT yield an unsigned value (0xffffffff == -1). All right shifts
		   must therefore be the UNSIGNED ">>>" or negative hashes diverge
		   from the C/Python reference after the first mix step. */
		function get16(d, i) { return d.charCodeAt(i) | (d.charCodeAt(i + 1) << 8); }
		function get8(d, i) { return d.charCodeAt(i) & 0xff; }
		var len = data.length;
		if (len <= 0)
			return 0;
		var hash = len, tmp = 0, rem = len & 3, size = len >> 2, pos = 0;
		while (size > 0) {
			hash = (hash + get16(data, pos)) & 0xffffffff;
			tmp = ((get16(data, pos + 2) << 11) ^ hash) & 0xffffffff;
			hash = ((hash << 16) ^ tmp) & 0xffffffff;
			pos += 4;
			hash = (hash + (hash >>> 11)) & 0xffffffff;
			size--;
		}
		switch (rem) {
			case 3:
				hash = (hash + get16(data, pos)) & 0xffffffff;
				hash = (hash ^ ((hash << 16) & 0xffffffff)) & 0xffffffff;
				hash = (hash ^ (get8(data, pos + 2) << 18)) & 0xffffffff;
				hash = (hash + (hash >>> 11)) & 0xffffffff;
				break;
			case 2:
				hash = (hash + get16(data, pos)) & 0xffffffff;
				hash = (hash ^ ((hash << 11) & 0xffffffff)) & 0xffffffff;
				/* C reads data[len] which is the string NUL terminator */
				hash = (hash ^ 0) & 0xffffffff;
				break;
			case 1:
				hash = (hash + ((data.charCodeAt(pos) << 24) >> 24)) & 0xffffffff;
				hash = (hash ^ ((hash << 10) & 0xffffffff)) & 0xffffffff;
				hash = (hash + (hash >>> 1)) & 0xffffffff;
				break;
		}
		hash = (hash ^ ((hash << 3) & 0xffffffff)) & 0xffffffff;
		hash = (hash + (hash >>> 5)) & 0xffffffff;
		hash = (hash ^ ((hash << 4) & 0xffffffff)) & 0xffffffff;
		hash = (hash + (hash >>> 17)) & 0xffffffff;
		hash = (hash ^ ((hash << 25) & 0xffffffff)) & 0xffffffff;
		hash = (hash + (hash >>> 6)) & 0xffffffff;
		return hash >>> 0;
	}

	/* ==== Apply feedback: success / revert notifications ====
	   LuCSI closes the apply modal without any success message; listen
	   for the uci-applied / uci-reverted events and surface one. */
	function mzNotify(msg, cls) {
		try {
			var box = document.createElement('div');
			box.className = 'alert-message mz-apply-success ' + (cls || 'success');
			box.setAttribute('role', 'alert');
			var p = document.createElement('p');
			p.style.margin = '0';
			p.textContent = msg;
			box.appendChild(p);
			var main = document.getElementById('maincontent') || document.body;
			main.insertBefore(box, main.firstChild);
			box.classList.add('fade-in');
			setTimeout(function () {
				box.style.transition = 'opacity .4s';
				box.style.opacity = '0';
				setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 450);
			}, 6000);
		} catch (err) {}
	}

	document.addEventListener('uci-applied', function () {
		try { sessionStorage.setItem('mz-apply-ok', String(Date.now())); } catch (err) {}
		mzNotify(__('Configuration applied successfully.'), 'success');
	});

	document.addEventListener('uci-reverted', function () {
		mzNotify(__('Reverted to the last saved configuration.'), 'notice');
	});

	/* LuCSI reloads the page right after a successful apply, which would
	   swallow the notification - replay it once on the fresh page. */
	try {
		var ts = parseInt(sessionStorage.getItem('mz-apply-ok'), 10);
		if (ts && (Date.now() - ts) < 30000) {
			sessionStorage.removeItem('mz-apply-ok');
			setTimeout(function () { mzNotify(__('Configuration applied successfully.'), 'success'); }, 600);
		}
	} catch (err) {}

	/* ==== cbi-dynlist edit/delete affordances ====
	   LuCSI dynlists have no visible edit or delete controls: delete is
	   bound to an invisible ::after hotspot and in-place editing does
	   not exist. Inject explicit edit/delete buttons per item. */
	function mzDlFireChange(dl) {
		dl.dispatchEvent(new CustomEvent('cbi-dynlist-change', {
			bubbles: true,
			detail: { value: '', add: true }
		}));
	}

	function mzDlStartEdit(item) {
		if (item.querySelector('.mz-dl-edit-input'))
			return;
		var hidden = item.querySelector('input[type="hidden"]');
		var span = item.querySelector('span');
		if (!hidden || !span)
			return;
		var old = hidden.value;
		var input = document.createElement('input');
		input.type = 'text';
		input.className = 'cbi-input-text mz-dl-edit-input';
		input.value = old;
		span.style.display = 'none';
		item.insertBefore(input, span);

		var commit = function () {
			var v = input.value.trim();
			input.parentNode.removeChild(input);
			span.style.display = '';
			if (!v || v === old)
				return;
			var dl = item.closest('.cbi-dynlist');
			var inst = null;
			try { inst = L.dom.findClassInstance(dl); } catch (err) {}
			if (inst && typeof inst.removeItem === 'function' && typeof inst.addItem === 'function') {
				inst.removeItem(dl, item);
				inst.addItem(dl, v, null, true);
			} else {
				span.textContent = v;
				hidden.value = v;
				if (dl)
					mzDlFireChange(dl);
			}
		};

		input.addEventListener('keydown', function (ev) {
			if (ev.key === 'Enter') {
				ev.preventDefault();
				commit();
			} else if (ev.key === 'Escape') {
				input.parentNode.removeChild(input);
				span.style.display = '';
			}
		});
		input.addEventListener('blur', commit);
		input.focus();
		input.select();
	}

	function mzDlAttach(item) {
		if (item.querySelector('.mz-dl-actions'))
			return;
		var actions = document.createElement('div');
		actions.className = 'mz-dl-actions';

		var edit = document.createElement('button');
		edit.type = 'button';
		edit.className = 'mz-dl-btn mz-dl-edit';
		edit.textContent = '✎';
		edit.setAttribute('aria-label', __('Edit'));
		edit.addEventListener('click', function (ev) {
			ev.preventDefault();
			ev.stopPropagation();
			mzDlStartEdit(item);
		});

		var del = document.createElement('button');
		del.type = 'button';
		del.className = 'mz-dl-btn mz-dl-del';
		del.textContent = '✕';
		del.setAttribute('aria-label', __('Delete'));
		del.addEventListener('click', function (ev) {
			ev.preventDefault();
			ev.stopPropagation();
			var dl = item.closest('.cbi-dynlist');
			var inst = null;
			try { inst = L.dom.findClassInstance(dl); } catch (err) {}
			if (inst && typeof inst.removeItem === 'function') {
				inst.removeItem(dl, item);
			} else {
				item.parentNode.removeChild(item);
				if (dl)
					mzDlFireChange(dl);
			}
		});

		actions.appendChild(edit);
		actions.appendChild(del);
		item.appendChild(actions);
	}

	function mzDlEnhance(root) {
		(root || document).querySelectorAll('.cbi-dynlist').forEach(function (dl) {
			dl.querySelectorAll(':scope > .item').forEach(mzDlAttach);
		});
	}

	var mzDlObserver = new MutationObserver(function () {
		mzDlEnhance(document);
	});
	document.addEventListener('DOMContentLoaded', function () {
		mzDlEnhance(document);
		mzDlObserver.observe(document.body, { childList: true, subtree: true });
	});
})();
