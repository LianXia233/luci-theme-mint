/*
 * mint - Overview Dashboard enhancer
 * Copyright (C) 2026 LianXia233
 * Licensed to the public under the Apache License 2.0.
 *
 * Real-time system dashboard for Status > Overview.
 *
 * Design (see task doc):
 *   - DataService  : pulls a single JSON snapshot from the `mint` ubus
 *                    object (`dashboard` method, served by rpcd). The browser
 *                    never reads /proc or /sys directly.
 *   - Compute      : derives CPU% (delta of two /proc/stat samples), memory%,
 *                    temperature selection, traffic rate, uptime formatting.
 *   - Render        : SVG gauges + Canvas charts + info cards, updated in
 *                    place (no innerHTML churn, no full reload).
 *   - Lifecycle     : init/start/stop/refresh/destroy with full timer /
 *                    observer cleanup so repeated Overview visits never leak.
 *
 * All data is real device data. Missing values render as -- / N/A; nothing
 * is faked. No interface name or IP is hard-coded.
 */
(function () {
	'use strict';

	/* ---- i18n (LuCI translator with a small zh fallback) ---- */
	var _t = (typeof _ === 'function') ? _ : null;
	var ZH = {
		'Status': '状态',
		'Refresh': '刷新',
		'CPU Usage': 'CPU 使用率',
		'Memory Usage': '内存使用率',
		'Temperature': '温度',
		'Storage': '存储',
		'Load': '系统负载',
		'Uptime': '运行时间',
		'Connections': '活动连接',
		'Uplink Interface': '上行接口',
		'Upload': '上行',
		'Download': '下行',
		'Address': '地址',
		'Gateway': '网关',
		'Protocol': '协议',
		'Real-time Throughput': '实时吞吐',
		'System Information': '系统信息',
		'Hostname': '主机名',
		'Model': '型号',
		'Architecture': '架构',
		'Target Platform': '目标平台',
		'Firmware Version': '固件版本',
		'Kernel Version': '内核版本',
		'OpenWrt Version': 'OpenWrt 版本',
		'LuCI Version': 'LuCI 版本',
		'No uplink': '无上行',
		'N/A': 'N/A',
		'cores': '核心',
		'CPU / Memory (last ~3 min)': 'CPU / 内存（近 3 分钟）',
		'Network RX / TX (last ~3 min)': '网络 RX / TX（近 3 分钟）',
		'Temperature (last ~3 min)': '温度（近 3 分钟）',
		'Connections': '活动连接'
	};
	function __(s) {
		var t = _t ? _t(s) : s;
		if (t === s && ZH[s]) return ZH[s];
		return t;
	}

	/* ---- config ---- */
	var REFRESH_FAST = 1000;   /* cpu, mem, temp, rx/tx, chart */
	var REFRESH_MED = 3000;    /* conntrack, wan, ip/gw, load */
	var REFRESH_SLOW = 10000;  /* storage, system info */
	var HISTORY_LEN = 180;     /* ~3 min at 1s */
	var TEMP_RING_MAX = 110;   /* °C used only for the gauge fill scale */
	var CIRC = 2 * Math.PI * 52;

	/* ---- RPC accessor (resolved lazily; L.rpc initializes after load) ---- */
	var dashRpc = null;
	function getRpc() {
		if (dashRpc) return dashRpc;
		var api = (window.L && window.L.rpc)
			? window.L.rpc
			: (typeof rpc !== 'undefined' && rpc && rpc.declare ? rpc : null);
		if (api && api.declare) {
			try {
				dashRpc = api.declare({ object: 'mint', method: 'dashboard', params: [] });
			} catch (e) { dashRpc = null; }
		}
		return dashRpc;
	}

	/* ---- state ---- */
	var state = {
		cpu: {}, memory: {}, temperature: {}, storage: {},
		load: {}, uptime: {}, connections: {}, network: {}, system: {},
		history: { cpu: [], memory: [], rx: [], tx: [], temperature: [] },
		prev: { statTotal: null, statIdle: null, rx: null, tx: null, ts: null }
	};
	var uptimeBase = 0, uptimeBaseTs = 0;
	var lastMed = 0, lastSlow = 0, inFlight = false;

	/* ---- lifecycle handles ---- */
	var root = null;
	var view = null;
	var timers = [];
	var observers = [];
	var visHandler = null;
	var started = false;
	var refs = {};

	/* ================================================================
	 * Compute layer
	 * ================================================================ */
	function parseStat(str) {
		if (!str) return null;
		var p = str.trim().split(/\s+/);
		if (p[0] && p[0].toLowerCase() === 'cpu') p = p.slice(1);
		var nums = p.map(Number);
		if (nums.length < 4 || nums.some(isNaN)) return null;
		var total = 0, i;
		for (i = 0; i < nums.length; i++) total += (nums[i] || 0);
		var idle = (nums[3] || 0); /* idle only (iowait excluded per spec) */
		return { total: total, idle: idle };
	}

	function computeCpu(statStr) {
		var cur = parseStat(statStr);
		if (!cur) return null;
		if (state.prev.statTotal == null) {
			state.prev.statTotal = cur.total;
			state.prev.statIdle = cur.idle;
			return null; /* need a second sample */
		}
		var dT = cur.total - state.prev.statTotal;
		var dI = cur.idle - state.prev.statIdle;
		state.prev.statTotal = cur.total;
		state.prev.statIdle = cur.idle;
		if (dT <= 0) return null;
		var usage = (dT - dI) / dT * 100;
		if (!isFinite(usage)) return null;
		return Math.max(0, Math.min(100, usage));
	}

	function pickTemp(zones) {
		if (!zones || !zones.length) return null;
		var re = /cpu|soc|package|mt7981|mt7986|rockchip|temperature|core/i;
		var primary = null, any = null, i, n, v, c;
		for (i = 0; i < zones.length; i++) {
			v = zones[i].temp_mc;
			if (v == null) continue;
			c = v / 1000;
			n = zones[i].name || '';
			if (!any) any = { name: n, c: c };
			if (!primary && re.test(n)) primary = { name: n, c: c };
		}
		return primary || any;
	}

	function computeRate(cur, prev, dt) {
		if (cur == null || prev == null || !(dt > 0)) return null;
		var r = (cur - prev) / dt;
		if (!isFinite(r) || r < 0) return 0;
		return r;
	}

	/* ================================================================
	 * Format helpers
	 * ================================================================ */
	function fmtBytesRate(bps) {
		if (bps == null) return '--';
		var u = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
		var v = bps, i = 0;
		while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
		return (i === 0 ? Math.round(v) : v.toFixed(2)) + ' ' + u[i];
	}
	function fmtBytesFromKb(kb) {
		if (kb == null) return '--';
		var u = ['KB', 'MB', 'GB', 'TB'];
		var v = kb, i = 0;
		while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
		return (i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
	}
	function fmtUptime(sec) {
		sec = Math.floor(sec || 0);
		var d = Math.floor(sec / 86400);
		var h = Math.floor((sec % 86400) / 3600);
		var m = Math.floor((sec % 3600) / 60);
		var s = sec % 60;
		var parts = [];
		if (d) parts.push(d + 'd');
		if (h || d) parts.push(h + 'h');
		if (m || h || d) parts.push(m + 'm');
		parts.push(s + 's');
		return parts.join(' ');
	}
	function na(v) { return (v == null || v === '' || v === false) ? '--' : v; }

	/* ================================================================
	 * DOM build (once)
	 * ================================================================ */
	function gaugeCard(id, labelKey) {
		return '' +
			'<div class="mint-ovd-gauge" data-gauges="' + id + '">' +
			'<div class="mint-ovd-ring-wrap">' +
			'<svg class="mint-ovd-ring" viewBox="0 0 120 120" aria-hidden="true">' +
			'<circle class="mint-ovd-ring-bg" cx="60" cy="60" r="52"></circle>' +
			'<circle class="mint-ovd-ring-fg" cx="60" cy="60" r="52" ' +
			'data-ring="' + id + '" stroke-dasharray="' + CIRC.toFixed(2) + '" ' +
			'stroke-dashoffset="' + CIRC.toFixed(2) + '"></circle>' +
			'</svg>' +
			'<div class="mint-ovd-ring-center">' +
			'<span class="mint-ovd-ring-num" data-num="' + id + '">--</span>' +
			'<span class="mint-ovd-ring-unit" data-unit="' + id + '">%</span>' +
			'</div></div>' +
			'<div class="mint-ovd-gauge-meta">' +
			'<div class="mint-ovd-gauge-label">' + __(labelKey) + '</div>' +
			'<div class="mint-ovd-gauge-sub" data-sub="' + id + '">--</div>' +
			'</div></div>';
	}

	function infoCard(id, labelKey, opts) {
		opts = opts || {};
		return '' +
			'<div class="mint-ovd-stat" data-stat="' + id + '">' +
			'<div class="mint-ovd-stat-label">' + __(labelKey) + '</div>' +
			'<div class="mint-ovd-stat-value" data-val="' + id + '"' +
			(opts.live ? ' aria-live="polite"' : '') + '>--</div>' +
			(opts.sub ? '<div class="mint-ovd-stat-sub" data-sub="' + id + '">--</div>' : '') +
			'</div>';
	}

	function chartCard(id, labelKey) {
		return '' +
			'<div class="mint-ovd-chart" data-chart="' + id + '">' +
			'<div class="mint-ovd-chart-head"><span class="mint-ovd-chart-title">' +
			__(labelKey) + '</span><span class="mint-ovd-chart-now" data-now="' + id + '"></span></div>' +
			'<canvas class="mint-ovd-canvas" data-canvas="' + id + '"></canvas>' +
			'<div class="mint-ovd-chart-sr">' + __(labelKey) + '</div>' +
			'</div>';
	}

	function sysItem(id, labelKey) {
		return '<div class="mint-ovd-sys-item">' +
			'<span class="mint-ovd-sys-label">' + __(labelKey) + '</span>' +
			'<span class="mint-ovd-sys-value" data-sys="' + id + '" title="">--</span></div>';
	}

	function buildDom() {
		root = document.createElement('section');
		root.id = 'mint-overview-dashboard';
		root.className = 'mint-overview-dashboard';
		root.setAttribute('aria-label', __('Status'));

		root.innerHTML = '' +
			'<header class="mint-ovd-header">' +
			'<h2 class="mint-ovd-title">' + __('Status') + '</h2>' +
			'<button type="button" class="mint-ovd-refresh" data-refresh ' +
			'aria-label="' + __('Refresh') + '">' +
			'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
			'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>' +
			'</button></header>' +

			'<section class="mint-ovd-gauges" aria-label="metrics">' +
			gaugeCard('cpu', 'CPU Usage') +
			gaugeCard('memory', 'Memory Usage') +
			gaugeCard('temperature', 'Temperature') +
			gaugeCard('storage', 'Storage') +
			'</section>' +

			'<section class="mint-ovd-stats" aria-label="info">' +
			infoCard('load', 'Load', { live: true }) +
			infoCard('uptime', 'Uptime', { live: true }) +
			infoCard('connections', 'Connections', { live: true }) +
			infoCard('uplink', 'Uplink Interface', { sub: true }) +
			infoCard('address', 'Address') +
			infoCard('throughput', 'Real-time Throughput', { sub: true, live: true }) +
			'</section>' +

			'<section class="mint-ovd-charts" aria-label="charts">' +
			chartCard('cpumem', 'CPU / Memory (last ~3 min)') +
			chartCard('net', 'Network RX / TX (last ~3 min)') +
			chartCard('temp', 'Temperature (last ~3 min)') +
			'</section>' +

			'<section class="mint-ovd-sys" aria-label="system">' +
			'<h3 class="mint-ovd-sys-title">' + __('System Information') + '</h3>' +
			'<div class="mint-ovd-sys-grid">' +
			sysItem('hostname', 'Hostname') +
			sysItem('model', 'Model') +
			sysItem('arch', 'Architecture') +
			sysItem('target', 'Target Platform') +
			sysItem('firmware', 'Firmware Version') +
			sysItem('kernel', 'Kernel Version') +
			sysItem('openwrt', 'OpenWrt Version') +
			sysItem('luci', 'LuCI Version') +
			'</div></section>';

		/* cache refs */
		refs = {};
		root.querySelectorAll('[data-num],[data-unit],[data-sub],[data-val],[data-sys],[data-ring],[data-now],[data-canvas]')
			.forEach(function (el) {
				var k, v;
				['num', 'unit', 'sub', 'val', 'sys', 'ring', 'now', 'canvas'].forEach(function (a) {
					if (el.hasAttribute('data-' + a)) {
						k = a; v = el.getAttribute('data-' + a);
					}
				});
				if (k) (refs[k] = refs[k] || {})[v] = el;
			});
		refs.refresh = root.querySelector('[data-refresh]');
		refs.canvas = {
			cpumem: root.querySelector('[data-canvas="cpumem"]'),
			net: root.querySelector('[data-canvas="net"]'),
			temp: root.querySelector('[data-canvas="temp"]')
		};
	}

	function setText(attr, id, val) {
		var el = refs[attr] && refs[attr][id];
		if (!el) return;
		val = (val == null || val === '') ? '--' : String(val);
		if (el.textContent !== val) el.textContent = val;
	}
	function setRing(id, pct) {
		var el = refs.ring && refs.ring[id];
		if (!el) return;
		pct = Math.max(0, Math.min(100, isFinite(pct) ? pct : 0));
		el.setAttribute('stroke-dashoffset', (CIRC * (1 - pct / 100)).toFixed(2));
	}
	function setNum(id, val, unit) {
		setText('num', id, val);
		if (unit != null && refs.unit && refs.unit[id]) {
			var u = refs.unit[id];
			if (u.textContent !== unit) u.textContent = unit;
		}
	}

	/* ================================================================
	 * Render
	 * ================================================================ */
	function renderFast(d) {
		/* CPU */
		var cpuPct = computeCpu(d.cpu && d.cpu.stat);
		setRing('cpu', cpuPct == null ? 0 : cpuPct);
		setNum('cpu', cpuPct == null ? '--' : Math.round(cpuPct), '%');
		if (refs.sub && refs.sub.cpu) {
			var sub = [];
			if (d.cpu && d.cpu.cores) sub.push(d.cpu.cores + ' ' + __('cores'));
			if (d.cpu && d.cpu.freq_khz) sub.push((d.cpu.freq_khz / 1000).toFixed(2) + ' GHz');
			setText('sub', 'cpu', sub.join(' · '));
		}
		/* Memory */
		var memPct = null, memUsed = null;
		if (d.memory && d.memory.total_kb) {
			memUsed = (d.memory.total_kb - (d.memory.available_kb || 0));
			memPct = memUsed / d.memory.total_kb * 100;
		}
		setRing('memory', memPct == null ? 0 : memPct);
		setNum('memory', memPct == null ? '--' : Math.round(memPct), '%');
		if (refs.sub && refs.sub.memory)
			setText('sub', 'memory', (memUsed == null ? '--' : fmtBytesFromKb(memUsed)) + ' / ' +
				(d.memory && d.memory.total_kb ? fmtBytesFromKb(d.memory.total_kb) : '--'));

		/* Temperature */
		var t = pickTemp(d.temperature);
		var tPct = (t && isFinite(t.c)) ? Math.min(100, t.c / TEMP_RING_MAX * 100) : 0;
		setRing('temperature', tPct);
		setNum('temperature', t ? t.c.toFixed(1) : '--', '°C');
		if (refs.sub && refs.sub.temperature) setText('sub', 'temperature', t ? t.name : __('N/A'));

		/* Throughput (needs previous sample) */
		var now = Date.now();
		var rxRate = null, txRate = null;
		var up = d.network && d.network.uplink;
		if (up) {
			if (state.prev.rx != null && state.prev.ts) {
				rxRate = computeRate(up.rx_bytes, state.prev.rx, (now - state.prev.ts) / 1000);
				txRate = computeRate(up.tx_bytes, state.prev.tx, (now - state.prev.ts) / 1000);
			}
			state.prev.rx = up.rx_bytes;
			state.prev.tx = up.tx_bytes;
			state.prev.ts = now;
		}
		if (refs.val && refs.val.throughput) {
			var tv = (rxRate == null && txRate == null) ? '--'
				: '▼ ' + fmtBytesRate(rxRate) + '  ▲ ' + fmtBytesRate(txRate);
			if (refs.val.throughput.textContent !== tv) refs.val.throughput.textContent = tv;
		}
		if (refs.sub && refs.sub.throughput)
			setText('sub', 'throughput', up ? (up.device || '') : __('No uplink'));

		pushHistory(cpuPct, memPct, rxRate, txRate, t ? t.c : null);
		drawCharts();
	}

	function renderMed(d) {
		/* Load */
		if (d.load) {
			var lv = [d.load.m1, d.load.m5, d.load.m15]
				.map(function (x) { return (x == null ? '--' : parseFloat(x).toFixed(2)); })
				.join(' / ');
			setText('val', 'load', lv);
		}
		/* Uptime (resync base) */
		if (d.uptime != null) {
			uptimeBase = d.uptime; uptimeBaseTs = Date.now();
			setText('val', 'uptime', fmtUptime(d.uptime));
		}
		/* Connections */
		if (d.conntrack) {
			var cv = (d.conntrack.count == null) ? '--'
				: (d.conntrack.count + (d.conntrack.max != null ? ' / ' + d.conntrack.max : ''));
			setText('val', 'connections', cv);
		}
		/* Uplink + address */
		var up = d.network && d.network.uplink;
		if (refs.val && refs.val.uplink) {
			if (!up) {
				if (refs.val.uplink.textContent !== __('No uplink')) refs.val.uplink.textContent = __('No uplink');
			} else {
				var uv = up.name || (up.device || '--');
				if (up.proto) uv += ' · ' + up.proto;
				if (refs.val.uplink.textContent !== uv) refs.val.uplink.textContent = uv;
			}
		}
		/* Uplink sub: internal (LAN-side) address + gateway. The private
		   IPv4 such as 10.x and the gateway belong here, not in Address. */
		if (refs.sub && refs.sub.uplink) {
			if (!up) {
				setText('sub', 'uplink', __('N/A'));
			} else {
				/* Internal IPv4 + gateway only: the IPv6 address is already
				   shown in the Address card and only clutters this line. */
				var uparts = [];
				if (up.ipv4) uparts.push(up.ipv4 + (up.ipv4_mask != null ? '/' + up.ipv4_mask : ''));
				if (up.gateway) uparts.push(__('Gateway') + ' ' + up.gateway);
				setText('sub', 'uplink', uparts.join(' · '));
			}
		}
		/* Address: public (exit) IPv4 from ipv4.im, plus the device IPv6.
		   When offline the backend reports the sentinel "未联网". */
		if (refs.val && refs.val.address) {
			var pub = (d.network && d.network.public_ipv4) ? d.network.public_ipv4 : null;
			if (!up && !pub) {
				setText('val', 'address', __('N/A'));
			} else if (pub === '未联网') {
				setText('val', 'address', '未联网');
			} else {
				var alines = [];
				if (pub) alines.push(pub);
				if (up && up.ipv6) alines.push(up.ipv6);
				if (!alines.length) alines.push(__('N/A'));
				setText('val', 'address', alines.join('  '));
			}
		}
	}

	function renderSlow(d) {
		/* Storage */
		if (d.storage) {
			var sp = (d.storage.use_pct != null) ? d.storage.use_pct
				: (d.storage.total_kb ? Math.round((d.storage.total_kb - (d.storage.avail_kb || 0)) / d.storage.total_kb * 100) : null);
			setRing('storage', sp == null ? 0 : sp);
			setNum('storage', sp == null ? '--' : sp, '%');
			if (refs.sub && refs.sub.storage)
				setText('sub', 'storage', (d.storage.used_kb != null ? fmtBytesFromKb(d.storage.used_kb) : '--') +
					' / ' + (d.storage.total_kb != null ? fmtBytesFromKb(d.storage.total_kb) : '--'));
		} else {
			setRing('storage', 0); setNum('storage', '--', '%');
		}
		/* System info */
		var s = d.system || {};
		setText('sys', 'hostname', na(s.hostname));
		setText('sys', 'model', na(s.model));
		setText('sys', 'arch', na(s.arch));
		setText('sys', 'target', na(s.target));
		setText('sys', 'firmware', na(s.openwrt));
		setText('sys', 'kernel', na(s.kernel));
		setText('sys', 'openwrt', na(s.distribution) + (s.version ? ' ' + s.version : '') + (s.revision ? ' ' + s.revision : ''));
		setText('sys', 'luci', na(s.luci));
	}

	/* ================================================================
	 * History + Canvas charts
	 * ================================================================ */
	function pushHistory(cpu, mem, rx, tx, temp) {
		var h = state.history;
		function push(arr, v) { arr.push(v); if (arr.length > HISTORY_LEN) arr.shift(); }
		push(h.cpu, cpu); push(h.memory, mem); push(h.rx, rx); push(h.tx, tx); push(h.temperature, temp);
	}

	function drawChart(canvas, series, opts) {
		if (!canvas) return;
		var dpr = window.devicePixelRatio || 1;
		var w = canvas.clientWidth, h = canvas.clientHeight;
		if (!w || !h) return;
		var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
		if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
		var ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);

		var padL = 4, padR = 4, padT = 6, padB = 6;
		var gw = w - padL - padR, gh = h - padT - padB;
		var ymin = opts.ymin, ymax = opts.ymax;
		if (ymax <= ymin) ymax = ymin + 1;

		/* grid */
		ctx.strokeStyle = getCss('--mz-color-border') || 'rgba(128,128,128,.18)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (var g = 0; g <= 3; g++) {
			var gy = padT + gh * g / 3;
			ctx.moveTo(padL, gy + .5); ctx.lineTo(padL + gw, gy + .5);
		}
		ctx.stroke();

		var n = HISTORY_LEN;
		function xAt(i) { return padL + gw * (i / (n - 1)); }
		function yAt(v) {
			var t = (v - ymin) / (ymax - ymin);
			t = Math.max(0, Math.min(1, t));
			return padT + gh * (1 - t);
		}

		series.forEach(function (s) {
			var data = s.data;
			if (!data || data.length < 2) return;
			/* align to right edge */
			var off = n - data.length;
			ctx.beginPath();
			for (var i = 0; i < data.length; i++) {
				var v = data[i];
				if (v == null) continue;
				var x = xAt(off + i), y = yAt(v);
				if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
			}
			ctx.strokeStyle = s.color;
			ctx.lineWidth = 1.6;
			ctx.lineJoin = 'round';
			ctx.stroke();
			if (s.fill) {
				ctx.lineTo(xAt(off + data.length - 1), padT + gh);
				ctx.lineTo(xAt(off), padT + gh);
				ctx.closePath();
				ctx.fillStyle = s.fill;
				ctx.fill();
			}
		});
	}

	function getCss(name) {
		try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
		catch (e) { return ''; }
	}

	function drawCharts() {
		var h = state.history;
		var cpuC = getCss('--mz-color-primary') || '#4f6ef7';
		var memC = getCss('--mz-color-success') || '#2f9e6e';
		var netC = getCss('--mz-color-warning') || '#d9861f';
		var tempC = getCss('--mz-color-danger') || '#d9484f';

		/* CPU / Memory 0..100 */
		drawChart(refs.canvas.cpumem, [
			{ data: h.cpu, color: cpuC, fill: hexA(cpuC, .12) },
			{ data: h.memory, color: memC, fill: hexA(memC, .12) }
		], { ymin: 0, ymax: 100 });
		if (refs.now && refs.now.cpumem) {
			var c = h.cpu.length ? h.cpu[h.cpu.length - 1] : null;
			var m = h.memory.length ? h.memory[h.memory.length - 1] : null;
			setText('now', 'cpumem', (c == null ? '--' : Math.round(c) + '%') + ' · ' + (m == null ? '--' : Math.round(m) + '%'));
		}

		/* Network auto-scale */
		var all = h.rx.concat(h.tx).filter(function (v) { return v != null; });
		var nmax = all.length ? Math.max.apply(null, all) : 0;
		var nymax = niceMax(nmax);
		drawChart(refs.canvas.net, [
			{ data: h.rx, color: netC, fill: hexA(netC, .12) },
			{ data: h.tx, color: cpuC, fill: hexA(cpuC, .10) }
		], { ymin: 0, ymax: nymax });
		if (refs.now && refs.now.net) {
			var r = h.rx.length ? h.rx[h.rx.length - 1] : null;
			var t = h.tx.length ? h.tx[h.tx.length - 1] : null;
			setText('now', 'net', '▼ ' + fmtBytesRate(r) + '  ▲ ' + fmtBytesRate(t));
		}

		/* Temperature auto-scale */
		var temps = h.temperature.filter(function (v) { return v != null; });
		var tmax = temps.length ? Math.max.apply(null, temps) : 0;
		var tymax = niceMax(tmax);
		drawChart(refs.canvas.temp, [
			{ data: h.temperature, color: tempC, fill: hexA(tempC, .12) }
		], { ymin: 0, ymax: tymax });
		if (refs.now && refs.now.temp) {
			var last = temps.length ? temps[temps.length - 1] : null;
			setText('now', 'temp', last == null ? '--' : last.toFixed(1) + '°C');
		}
	}

	function niceMax(v) {
		if (!v || v <= 0) return 1;
		var mag = Math.pow(10, Math.floor(Math.log10(v)));
		var n = v / mag;
		var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
		return step * mag;
	}
	function hexA(hex, a) {
		var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
		if (!m) return 'rgba(120,140,200,.12)';
		var n = parseInt(m[1], 16);
		return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
	}

	/* ================================================================
	 * Fetch + tick
	 * ================================================================ */
	function fetchData() {
		var rpc = getRpc();
		if (!rpc) return Promise.reject(new Error('rpc-unavailable'));
		return Promise.resolve(rpc()).then(function (data) {
			if (!data || typeof data !== 'object') throw new Error('bad-payload');
			return data;
		});
	}

	function tick(forceAll) {
		if (inFlight) return;
		inFlight = true;
		var now = Date.now();
		fetchData().then(function (d) {
			renderFast(d);
			if (forceAll || now - lastMed >= REFRESH_MED) { renderMed(d); lastMed = now; }
			if (forceAll || now - lastSlow >= REFRESH_SLOW) { renderSlow(d); lastSlow = now; }
			clearError();
		}).catch(function () {
			showError();
		}).then(function () { inFlight = false; });
	}

	function clearError() {
		if (root) root.classList.remove('mint-ovd-error');
	}
	function showError() {
		if (root) root.classList.add('mint-ovd-error');
	}

	/* ================================================================
	 * Lifecycle
	 * ================================================================ */
	function mount() {
		view = document.getElementById('mz-view');
		if (!view) return false;
		if (document.getElementById('mint-overview-dashboard')) return true;
		buildDom();
		view.insertBefore(root, view.firstChild);
		/* signal the legacy overview.js enhancer to suppress its own
		   core / system / network panels (this dashboard covers them).
		   Set here so the flag is live even before start() wires timers. */
		window.MintOverviewDashboardActive = true;
		/* remove any legacy panels overview.js may have built first */
		['mz-overview-panel', 'mz-sys-panel', 'mz-net-panel'].forEach(function (cls) {
			var el = view.querySelector('.' + cls);
			if (el && el.parentNode) el.parentNode.removeChild(el);
		});
		return true;
	}

	function start() {
		if (started) return;
		if (!mount()) return;
		started = true;
		window.MintOverviewDashboardActive = true;

		/* refresh button */
		if (refs.refresh) {
			refs.refresh.addEventListener('click', onRefresh);
		}
		/* resize observer for canvases */
		if (typeof ResizeObserver !== 'undefined') {
			var ro = new ResizeObserver(function () { if (started) drawCharts(); });
			ro.observe(root);
			observers.push(ro);
		} else {
			var onRz = function () { if (started) drawCharts(); };
			window.addEventListener('resize', onRz);
			observers.push({ disconnect: function () { window.removeEventListener('resize', onRz); } });
		}
		/* navigation watcher: tear down when leaving Overview */
		if (typeof MutationObserver !== 'undefined' && view) {
			var mo = new MutationObserver(function () { watchdog(); });
			mo.observe(view, { childList: true, subtree: false });
			observers.push(mo);
		}
		/* visibility: throttle when hidden */
		visHandler = function () {
			if (document.hidden) {
				stopTimers();
				timers.push(setInterval(function () { tick(true); }, REFRESH_SLOW));
			} else {
				stopTimers();
				startTimers();
				tick(true);
			}
		};
		document.addEventListener('visibilitychange', visHandler);

		startTimers();
		tick(true); /* immediate full paint */
	}

	function startTimers() {
		timers.push(setInterval(function () { tick(false); }, REFRESH_FAST));
	}
	function stopTimers() {
		timers.forEach(function (t) { clearInterval(t); });
		timers = [];
	}

	function watchdog() {
		var onOverview = document.body.getAttribute('data-page') === 'admin-status-overview';
		if (!onOverview) {
			/* left Overview (SPA nav or reload) - tear down fully so we
			   never leak timers/observers and start clean next visit */
			if (root && root.parentNode) destroy();
		} else {
			/* back on Overview and we are not mounted - restart */
			if (!root || !root.parentNode) start();
		}
	}

	function onRefresh() {
		if (!refs.refresh || refs.refresh.disabled) return;
		refs.refresh.disabled = true;
		refs.refresh.classList.add('is-loading');
		tick(true);
		setTimeout(function () {
			if (refs.refresh) { refs.refresh.disabled = false; refs.refresh.classList.remove('is-loading'); }
		}, 500);
	}

	function stop() {
		stopTimers();
		observers.forEach(function (o) { try { o.disconnect(); } catch (e) {} });
		observers = [];
		if (visHandler) { document.removeEventListener('visibilitychange', visHandler); visHandler = null; }
		if (refs.refresh) refs.refresh.removeEventListener('click', onRefresh);
		started = false;
		window.MintOverviewDashboardActive = false;
	}

	function destroy() {
		stop();
		if (root && root.parentNode) root.parentNode.removeChild(root);
		root = null; refs = {};
	}

	/* ================================================================
	 * Boot
	 * ================================================================ */
	function boot() {
		function tryStart() {
			if (document.body.getAttribute('data-page') !== 'admin-status-overview') return false;
			var v = document.getElementById('mz-view');
			if (!v) return false;
			if (v.querySelector('.cbi-section, table.table')) { start(); return true; }
			return false;
		}
		if (tryStart()) return;
		/* wait for overview content */
		var bo = new MutationObserver(function () {
			if (tryStart()) { bo.disconnect(); }
		});
		if (document.getElementById('mz-view')) {
			bo.observe(document.getElementById('mz-view'), { childList: true, subtree: true });
			setTimeout(function () { bo.disconnect(); }, 20000);
		} else {
			document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 50); });
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 50); });
	} else {
		setTimeout(boot, 50);
	}
})();
