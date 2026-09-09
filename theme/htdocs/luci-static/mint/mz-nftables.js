/*
 * mint theme - nftables status page enhancement
 *
 * The upstream LuCI view (resources/view/status/nftables.js) renders every
 * chain as a bare <div class="nft-chain"> holding a flat <table class="nft-rules">.
 * On real routers that is 30+ chains, 100+ rules and 300+ "ifacebadge"
 * spans, all stacked with no card chrome and no visual grouping - the
 * page reads as one long column of mixed text and is painful to scan.
 *
 * This script is loaded only on /admin/status/nftables. It is a pure
 * theme-side enhancement (no upstream patches needed) that:
 *   1. Groups chains into buckets by family (basic / nat / zone / helper
 *      / third-party table) and inserts a sub-heading for each group.
 *   2. Adds a click-to-collapse header for every chain and a "rules:
 *      N, traffic: X" summary on the header.
 *   3. Auto-collapses chains whose rules are all zero-traffic by default;
 *      a single toolbar at the top lets the user expand all / collapse all
 *      and search-filter chains and rules.
 *   4. Hides rule rows whose only counter is "0 B" by default (toggle
 *      available from the toolbar) so the page shrinks to the rules that
 *      have actually fired.
 *
 * The script is fully idempotent (guards with a dataset flag) and
 * re-runs on SPA navigation via a MutationObserver on #mz-view.
 */

(function () {
	'use strict';

	/* Bail out on every page that is not the nftables view. */
	var pageKey = (document.body && document.body.getAttribute('data-page')) || '';
	if (pageKey.indexOf('admin-status-nftables') < 0)
		return;

	var GROUPS = [
		{ key: 'basic',    label: '基本链（input / forward / output / prerouting / postrouting）' },
		{ key: 'nat',      label: 'NAT 链' },
		{ key: 'mangle',   label: '路由 / Mangle 链' },
		{ key: 'zone',     label: '区域与转发链（LAN / WAN / Upnp）' },
		{ key: 'helper',   label: '辅助链（syn_flood / handle_reject / accept_*）' },
		{ key: 'third',    label: '其他第三方表链' }
	];

	function ready(fn) {
		if (document.readyState === 'loading')
			document.addEventListener('DOMContentLoaded', fn);
		else
			fn();
	}

	/* ------------------------------------------------------------------ */
	/* Utilities                                                          */
	/* ------------------------------------------------------------------ */

	function classifyChain(h4) {
		/* h4 looks like 流量过滤链 "input"  /  NAT 动作链 "dstnat"  /
		   规则容器链 "input_lan"  /  路由动作链 "mangle_output"  etc. */
		var text = (h4 && h4.textContent || '').trim();
		var id   = (h4 && h4.id) || '';
		var isNftable = /^(fw4|dnsmasq|sing-box|)\b/.test(id);
		/* Bucket by the descriptor word before the chain name. */
		if (/^流量过滤链$/.test(text) || text.indexOf('流量过滤链') === 0)
			return { group: 'basic', name: extractName(h4), hook: true };
		if (/^NAT 动作链$/.test(text) || text.indexOf('NAT 动作链') === 0)
			return { group: 'nat', name: extractName(h4), hook: true };
		if (/^(路由动作链|流量过滤链) "mangle_/.test(text) || /^路由动作链 "mangle_/.test(text) || /路由动作链/.test(text))
			return { group: 'mangle', name: extractName(h4), hook: true };
		if (/^规则容器链$/.test(text) || text.indexOf('规则容器链') === 0) {
			var n = extractName(h4);
			if (/(^|_)(lan|wan)(\b|$)/.test(n) || /^(accept_|reject_|drop_|upnp_)/.test(n))
				return { group: 'zone', name: n, hook: false };
			return { group: 'helper', name: n, hook: false };
		}
		/* Anything we cannot bucket (sing-box, dnsmasq custom tables etc) */
		return { group: 'third', name: extractName(h4) || '(unnamed)', hook: false };
	}

	function extractName(h4) {
		/* Pull the name out of  ... "input_lan"  or fall back to h4 id. */
		var m = /"([^"]+)"/.exec(h4.textContent || '');
		return m ? m[1] : (h4.id || '').replace(/^[^.]+\./, '');
	}

	function ruleRows(chainEl) {
		/* The upstream view does not wrap rule rows in <tbody>, so query
		   the table directly and filter out the synthetic title row. */
		var rows = chainEl.querySelectorAll('table.nft-rules tr');
		var n = 0;
		for (var i = 0; i < rows.length; i++)
			if (!rows[i].classList.contains('table-titles')) n++;
		return n;
	}

	function chainStats(chainEl) {
		var rows = chainEl.querySelectorAll('table.nft-rules tr');
		var ruleRows = 0, nonZero = 0, totalBytes = 0, hasSet = false;
		for (var i = 0; i < rows.length; i++) {
			var r = rows[i];
			if (r.classList.contains('table-titles')) continue;
			ruleRows++;
			var counter = r.querySelector('.nft-counter > var');
			if (counter) {
				var bytes = parseBytes(counter.textContent || '');
				totalBytes += bytes;
				if (bytes > 0) nonZero++;
			}
		}
		var sets = chainEl.querySelectorAll('.nft-set').length;
		hasSet = sets > 0;
		return { ruleRows: ruleRows, nonZero: nonZero, totalBytes: totalBytes, sets: sets };
	}

	function parseBytes(s) {
		/* nft prints 0 B / 6.2 KB / 1.5 MB / 1.2 GB / 0 / 29 Packets, 6.2 KBytes.
		   We only need the byte count, ignore the Packets prefix. */
		var m = /(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|KiB|MiB|GiB|KByte|MByte|GByte)\b/i.exec(s);
		if (!m) return 0;
		var v = parseFloat(m[1]);
		var unit = m[2].toUpperCase();
		var mul = 1;
		if (unit === 'KB' || unit === 'KIB' || unit === 'KBYTE') mul = 1024;
		else if (unit === 'MB' || unit === 'MIB' || unit === 'MBYTE') mul = 1024 * 1024;
		else if (unit === 'GB' || unit === 'GIB' || unit === 'GBYTE') mul = 1024 * 1024 * 1024;
		return v * mul;
	}

	function fmtBytes(n) {
		if (n <= 0) return '0 B';
		if (n < 1024) return n.toFixed(0) + ' B';
		if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
		if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
		return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
	}

	function el(tag, cls, text) {
		var e = document.createElement(tag);
		if (cls) e.className = cls;
		if (text != null) e.textContent = text;
		return e;
	}

	/* ------------------------------------------------------------------ */
	/* Enhancement pipeline                                               */
	/* ------------------------------------------------------------------ */

	function enhance() {
		var view = document.getElementById('mz-view');
		if (!view) return;
		/* Only re-run if the view was actually re-rendered (SPA nav or
		   the upstream 5s poll replaced it). */
		var sig = viewSig(view);
		if (view.dataset.mzNftSig === sig) return;
		view.dataset.mzNftSig = sig;
		view.dataset.mzNftReady = '1';

		/* Clear any old toolbar / group headers we previously inserted. */
		view.querySelectorAll('.mz-nft-toolbar, .mz-nft-grouptitle').forEach(function (n) { n.remove(); });
		view.querySelectorAll('.mz-nft-table-summary').forEach(function (n) { n.remove(); });
		view.querySelectorAll('.mz-nft-chain-summary, .mz-nft-chain-toggle').forEach(function (n) { n.remove(); });
		view.querySelectorAll('.nft-table').forEach(function (t) {
			t.classList.remove('mz-nft-tabled'); delete t.dataset.mzNftBucketed;
		});
		view.querySelectorAll('.nft-chain').forEach(function (c) {
			c.classList.remove('mz-collapsed');
			delete c.dataset.mzNftBucket;
		});

		/* 1. enhance per-table: add summary + group chains + collapse headers */
		var tables = Array.prototype.slice.call(view.querySelectorAll('.nft-table'));
		if (!tables.length) return;

		/* 2. build global toolbar at the very top of the view */
		buildToolbar(view, tables);

		/* 3. process every table */
		tables.forEach(enhanceTable);
	}

	function viewSig(view) {
		var n = view.querySelectorAll('.nft-table').length;
		var c = view.querySelectorAll('.nft-chain').length;
		var r = view.querySelectorAll('table.nft-rules tbody tr').length;
		return n + '|' + c + '|' + r;
	}

	function buildToolbar(view, tables) {
		var totalChains = view.querySelectorAll('.nft-chain').length;
		var totalRules = 0, nonZero = 0, totalBytes = 0;
		view.querySelectorAll('table.nft-rules tr').forEach(function (r) {
			if (r.classList.contains('table-titles')) return;
			totalRules++;
			var c = r.querySelector('.nft-counter > var');
			if (c) {
				var b = parseBytes(c.textContent || '');
				if (b > 0) nonZero++;
				totalBytes += b;
			}
		});

		var bar = el('div', 'mz-nft-toolbar');
		bar.appendChild(el('div', 'mz-nft-tb-stats',
			'共 ' + tables.length + ' 张表 · ' + totalChains + ' 条链 · ' + totalRules + ' 条规则 · ' + nonZero + ' 条有流量（' + fmtBytes(totalBytes) + '）'));

		var controls = el('div', 'mz-nft-tb-controls');
		var btnAll = el('button', 'mz-nft-btn', '全部展开');
		btnAll.type = 'button';
		btnAll.dataset.action = 'expand-all';
		controls.appendChild(btnAll);

		var btnNone = el('button', 'mz-nft-btn', '全部折叠');
		btnNone.type = 'button';
		btnNone.dataset.action = 'collapse-all';
		controls.appendChild(btnNone);

		var lblZero = el('label', 'mz-nft-toggle');
		var cbZero = el('input');
		cbZero.type = 'checkbox';
		cbZero.dataset.action = 'hide-zero';
		cbZero.checked = true;
		lblZero.appendChild(cbZero);
		lblZero.appendChild(document.createTextNode('隐藏零计数规则'));
		controls.appendChild(lblZero);

		var search = el('input', 'mz-nft-search');
		search.type = 'search';
		search.placeholder = '搜索规则（链名、匹配、动作）';
		search.dataset.action = 'search';
		controls.appendChild(search);

		bar.appendChild(controls);
		view.insertBefore(bar, view.firstChild);
	}

	function enhanceTable(tbl) {
		tbl.classList.add('mz-nft-tabled');

		/* 1. summary line on top of the table */
		var h3 = tbl.querySelector(':scope > h3');
		var chains = tbl.querySelectorAll(':scope > .nft-chains > .nft-chain');
		var sum = el('div', 'mz-nft-table-summary',
			chains.length + ' 条链 · ' + countRules(tbl) + ' 条规则');
		if (h3 && h3.nextSibling)
			tbl.insertBefore(sum, h3.nextSibling);
		else
			tbl.appendChild(sum);

		/* 2. group buckets */
		var container = tbl.querySelector(':scope > .nft-chains');
		if (!container) return;

		/* detect which groups are present in this table */
		var present = {};
		Array.prototype.forEach.call(chains, function (c) {
			var h4 = c.querySelector(':scope > h4');
			var cls = classifyChain(h4);
			c.dataset.mzNftBucket = cls.group;
			present[cls.group] = true;
		});

		/* 3. insert group headers + collapse each chain header */
		Array.prototype.forEach.call(chains, function (c) {
			var h4 = c.querySelector(':scope > h4');
			if (!h4) return;
			enhanceChain(c, h4);
		});

		/* 4. order: walk through the GROUPS list and re-arrange children
		   so the table reads in the order basic > nat > mangle > zone >
		   helper > third. Within each group we keep the original order
		   (which is upstream's intentional layout). */
		var groupsEl = el('div', 'mz-nft-groups');
		var anyGrouped = false;
		GROUPS.forEach(function (g) {
			if (!present[g.key]) return;
			anyGrouped = true;
			var members = container.querySelectorAll('.nft-chain[data-mz-nft-bucket="' + g.key + '"]');
			if (members.length === 0) return;
			var head = el('div', 'mz-nft-grouptitle');
			head.dataset.bucket = g.key;
			head.appendChild(el('span', null, g.label));
			head.appendChild(el('span', 'mz-nft-grouptitle-count', members.length + ' 条'));
			groupsEl.appendChild(head);
			Array.prototype.forEach.call(members, function (m) { groupsEl.appendChild(m); });
		});
		if (anyGrouped) {
			container.appendChild(groupsEl);
		}

		/* 5. auto-collapse chains that have zero traffic rules (so the
		   page collapses to the rules that actually fired). */
		applyAutoCollapse();
	}

	function countRules(tbl) {
		var rows = tbl.querySelectorAll('table.nft-rules tr');
		var n = 0;
		for (var i = 0; i < rows.length; i++)
			if (!rows[i].classList.contains('table-titles')) n++;
		return n;
	}

	function enhanceChain(chainEl, h4) {
		/* 0. wrap the chain name in quotes ("input", "dstnat", "input_lan")
		   with a <code> so the CSS rule (monospace tag) styles it. The
		   upstream view ships the name as plain text. */
		Array.prototype.forEach.call(h4.childNodes, function (n) {
			if (n.nodeType !== 3) return;
			var html = n.nodeValue.replace(/"([^"]+)"/g, '<code>$1</code>');
			if (html !== n.nodeValue) {
				var span = document.createElement('span');
				span.innerHTML = html;
				h4.replaceChild(span, n);
			}
		});

		/* 1. add toggle + summary to the chain header. The h4 is the
		   natural click target so we wrap the click on the h4. */
		var stats = chainStats(chainEl);
		var summary = el('span', 'mz-nft-chain-summary',
			stats.ruleRows + ' 条规则');
		if (stats.nonZero > 0)
			summary.appendChild(el('span', 'mz-nft-chain-nonzero',
				' · ' + stats.nonZero + ' 条有流量 ' + fmtBytes(stats.totalBytes)));
		else
			summary.appendChild(el('span', 'mz-nft-chain-zero', ' · 0 流量'));

		var toggle = el('span', 'mz-nft-chain-toggle');
		toggle.textContent = '▾';
		h4.appendChild(toggle);
		h4.appendChild(summary);

		h4.addEventListener('click', function (ev) {
			/* ignore clicks on inner anchor links */
			if (ev.target.tagName === 'A') return;
			chainEl.classList.toggle('mz-collapsed');
		});

		/* 2. mark every rule row that has only zero counters so the
		   "hide zero" toggle can target them. Also stamp data-mz-col on
		   each cell so the mobile <768px breakpoint (which turns the
		   table into stacked blocks) can label every cell with its
		   column name. */
		chainEl.querySelectorAll('table.nft-rules').forEach(function (tbl) {
			/* The header row uses the same <tr class="tr table-titles">
			   pattern as the upstream view: read the column labels
			   from it once and stamp every body cell. */
			var headerRow = tbl.querySelector('tr.table-titles');
			var cols = headerRow ? Array.prototype.map.call(headerRow.querySelectorAll('th,td'),
				function (c) { return (c.textContent || '').trim(); }) : [];
			Array.prototype.forEach.call(tbl.querySelectorAll('tr'), function (tr) {
				if (tr.classList.contains('table-titles')) return;
				Array.prototype.forEach.call(tr.children, function (td, i) {
					if (cols[i] && !td.getAttribute('data-mz-col'))
						td.setAttribute('data-mz-col', cols[i]);
				});
				var c = tr.querySelector('.nft-counter > var');
				if (!c) { tr.dataset.mzNftZero = '0'; return; }
				var b = parseBytes(c.textContent || '');
				tr.dataset.mzNftZero = b > 0 ? '0' : '1';
			});
		});
	}

	/* ------------------------------------------------------------------ */
	/* Toolbar actions                                                    */
	/* ------------------------------------------------------------------ */

	function applyAutoCollapse() {
		var view = document.getElementById('mz-view');
		if (!view) return;
		var hideZero = view.querySelector('input[data-action="hide-zero"]');
		var hideZeroOn = hideZero && hideZero.checked;
		view.querySelectorAll('table.nft-rules tr').forEach(function (tr) {
			if (tr.classList.contains('table-titles')) return;
			if (tr.dataset.mzNftZero === '1')
				tr.classList.toggle('mz-nft-hide-zero', !!hideZeroOn);
		});
		/* Auto-collapse policy: zone / helper / third-party groups
		   start collapsed (they are mostly internal glue), basic / nat
		   / mangle chains start expanded so the core firewall state is
		   visible without a click. Any chain that has zero traffic at
		   all is collapsed regardless of group. */
		view.querySelectorAll('.nft-chain').forEach(function (c) {
			var anyNonZero = c.querySelector('tr[data-mz-nft-zero="0"]');
			if (!anyNonZero) {
				c.classList.add('mz-collapsed');
				return;
			}
			var bucket = c.dataset.mzNftBucket;
			if (bucket === 'zone' || bucket === 'helper' || bucket === 'third')
				c.classList.add('mz-collapsed');
			else
				c.classList.remove('mz-collapsed');
		});
	}

	function applySearch(view, q) {
		q = (q || '').toLowerCase().trim();
		view.querySelectorAll('.nft-chain').forEach(function (c) {
			if (!q) { c.classList.remove('mz-nft-search-hide'); return; }
			var text = c.textContent.toLowerCase();
			c.classList.toggle('mz-nft-search-hide', text.indexOf(q) < 0);
		});
	}

	/* Event delegation on the view, re-bound each time we re-render. */
	function bindToolbar(view) {
		if (view.dataset.mzNftBound === '1') return;
		view.dataset.mzNftBound = '1';
		view.addEventListener('click', function (ev) {
			var t = ev.target.closest('[data-action]');
			if (!t) return;
			var act = t.dataset.action;
			if (act === 'expand-all') {
				view.querySelectorAll('.nft-chain.mz-collapsed').forEach(function (c) { c.classList.remove('mz-collapsed'); });
			} else if (act === 'collapse-all') {
				view.querySelectorAll('.nft-chain').forEach(function (c) { c.classList.add('mz-collapsed'); });
			} else if (act === 'hide-zero') {
				applyAutoCollapse();
			}
		});
		view.addEventListener('input', function (ev) {
			var t = ev.target.closest('[data-action]');
			if (!t) return;
			if (t.dataset.action === 'search') applySearch(view, t.value);
			if (t.dataset.action === 'hide-zero') applyAutoCollapse();
		});
	}

	/* ------------------------------------------------------------------ */
	/* Boot                                                               */
	/* ------------------------------------------------------------------ */

	ready(function () {
		var view = document.getElementById('mz-view');
		if (!view) return;
		bindToolbar(view);
		enhance();

		/* SPA navigation: the upstream 5s poll or click-router may swap
		   the view contents. A child/subtree observer is enough since the
		   #mz-view node itself is reused. */
		var scheduled = false;
		var mo = new MutationObserver(function () {
			if (scheduled) return;
			scheduled = true;
			(requestAnimationFrame || setTimeout)(function () {
				scheduled = false;
				enhance();
			}, 50);
		});
		mo.observe(view, { childList: true, subtree: true });
	});
})();
