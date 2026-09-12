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

	/* ==== Section headings that embed a status pill ====
	   Some third-party views inline `display:flex;justify-content:space-between`
	   on an <h3> and drop a <span class="label"> pill inside (e.g. the port
	   status panel). The theme's own section-heading rules can reflow the
	   pill onto its own line, which reads as a broken heading.

	   cascade.css already matches those headings with :has(); tagging them
	   here as well makes the fix work in browsers without :has() support and
	   keeps the intent explicit. Nothing is moved or restructured - only a
	   class is added, so no third-party markup is modified. */
	function mzH3Pill(root) {
		(root || document).querySelectorAll(
			'#mz-view .cbi-section > h3, #mz-view .cbi-section-node > h3, ' +
			'.mz-sys-panel > h3, .mz-port-panel > h3, .mz-net-card-header > h3'
		).forEach(function (h) {
			if (h.querySelector(':scope > .label, :scope > .badge'))
				h.classList.add('mz-h3-pill');
		});
	}

	function mzDropdownFallback(root) {
		/* On full LuCI builds the CBI.Dropdown widget wires up .cbi-dropdown
		   interactivity (open/close, item select, apply/force submit). Some
		   ImmortalWrt/OpenWrt snapshot builds ship a stripped cbi.js that leaves
		   a bare .cbi-dropdown in the DOM with NO widget JS, so the menu is
		   completely inert - clicking the caret does nothing and the <ul> just
		   renders its items inline. That is exactly the "mobile Save&Apply split
		   dropdown shows abnormally / does not function" symptom.
		   Provide a minimal, dependency-free fallback that activates ONLY when the
		   native widget is missing, so full builds keep their own handler and we
		   never double-toggle (which would cancel the open/close). */
		if (typeof CBI !== 'undefined' && CBI && CBI.Dropdown)
			return;
	
		function submitAction(dd) {
			var form = dd.closest('form');
			if (form) {
				try { if (form.requestSubmit) form.requestSubmit(); else form.submit(); }
				catch (e) { try { form.submit(); } catch (e2) {} }
				return;
			}
			var btn = document.querySelector('.cbi-button-apply, button.cbi-button-apply, input.cbi-button-apply');
			if (btn) btn.click();
		}
	
		(root || document).querySelectorAll('.cbi-dropdown').forEach(function (dd) {
			if (dd.getAttribute('data-mint-dd'))
				return;
			dd.setAttribute('data-mint-dd', '1');
	
			var isAction = /\bcbi-button-(apply|save|important)\b/.test(dd.className);
			var ul = dd.querySelector(':scope > ul');
			if (!ul)
				return;
			var items = Array.prototype.slice.call(ul.querySelectorAll(':scope > li'));
			var hidden = dd.querySelector(':scope > div > input[type=hidden]');
	
			function close() { dd.removeAttribute('open'); }
	
			function select(li) {
				items.forEach(function (o) { o.removeAttribute('selected'); });
				li.setAttribute('selected', '');
				var v = li.getAttribute('data-value');
				if (v === null) v = (li.textContent || '').trim();
				if (hidden) hidden.value = v;
				close();
				try { dd.dispatchEvent(new Event('cbi-dropdown-change', { bubbles: true })); } catch (e) {}
			}
	
			dd.querySelectorAll(':scope > .open, :scope > .more').forEach(function (c) {
				c.addEventListener('click', function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
					if (dd.hasAttribute('open')) close();
					else dd.setAttribute('open', '');
				});
			});
	
			dd.addEventListener('click', function (ev) {
				var t = ev.target;
				if (t && t.closest && t.closest('li'))
					return;
				if (dd.querySelector(':scope > .open, :scope > .more') &&
					t && t.closest && t.closest('.open, .more'))
					return;
				ev.preventDefault();
				if (dd.hasAttribute('open')) { close(); return; }
				if (isAction) submitAction(dd);
				else dd.setAttribute('open', '');
			});
	
			items.forEach(function (li) {
				li.addEventListener('click', function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
					select(li);
					if (isAction) submitAction(dd);
				});
			});
		});
	
		/* Close any open dropdown when clicking elsewhere (install once). */
		if (!document.getElementById('mz-dd-outside')) {
			document.addEventListener('click', function (ev) {
				var t = ev.target;
				if (!(t && t.closest && t.closest('.cbi-dropdown')))
					document.querySelectorAll('.cbi-dropdown[open]').forEach(function (d) {
						d.removeAttribute('open');
					});
			});
			var tag = document.createElement('div');
			tag.id = 'mz-dd-outside';
			tag.hidden = true;
			document.body.appendChild(tag);
		}
	}
	
	function mzEnhanceAll() {
	mzDlEnhance(document);
	mzH3Pill(document);
	mzDropdownFallback(document);
	}

	var mzDlObserver = new MutationObserver(function () {
		mzEnhanceAll();
	});
	document.addEventListener('DOMContentLoaded', function () {
		mzEnhanceAll();
		mzDlObserver.observe(document.body, { childList: true, subtree: true });
	});
})();
