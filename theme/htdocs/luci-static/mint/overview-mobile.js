/*
 * mint - status overview enhancer
 * Copyright (C) 2026 LianXia233
 * Licensed to the public under the Apache License 2.0.
 *
 * Builds mint overview panels once, then patches live values in place
 * so LuCI XHR polls do not force a full DOM tear-down every few seconds.
 */
(function () {
	'use strict';

	/* OT-05 (fixed 2026-09-09): plain scripts never get LuCI's scoped `_`,
	   so the echo fallback left every panel title in English ("UPnP port
	   mappings", "Port status", ...). LuCI's client catalog is exposed as
	   window.TR = { "<sfh-hex>": "translation" }.
	   Second catch (same day): LuCI's global `_` hashes with the luci.js
	   JS SuperFastHash whose rem==2 case ("hash += hash >>> 17") does NOT
	   match the sfh used by the firmware's lmo builder / server-side
	   core.so ("xor C-string NUL" == xor 0) - so every len%4==2 msgid
	   ("UPnP port mappings", "Log in", ...) silently misses in the client
	   catalog. Strategy: try LuCI's `_` first (authoritative when both
	   sides agree), then fall back to our own server-compatible sfh
	   lookup before giving up and echoing. */
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

	var CIRC = 2 * Math.PI * 52;
	var REFRESH_MS = 5000;
	var started = false;
	var hideObserver = null;

	/* OT-DASH: when the new Overview Dashboard is active it renders the
	   core (CPU/Mem/Storage rings), System info and Network/WAN widgets
	   itself, so this legacy enhancer suppresses its own copies of those
	   three panels and keeps Port / DHCP / Wireless / UPnP intact.
	   We key off the dashboard DOM element (not a boolean flag) so the
	   decision can never desync on SPA navigation / reload. */
	function mintOvdActive() {
		return !!(document.getElementById('mint-overview-dashboard'));
	}

	/* OT-11: prefixes grouped by panel category - a native section is only
	   hidden when its replacement panel actually rendered. (The orphan
	   'DSL' entry was dropped: no DSL panel exists, so hiding it only
	   deleted information.) */
	var CAT_PREFIXES = {
		core: ['内存', '存储', 'Memory', 'Storage'],
		ports: ['端口状态', 'Ports', 'Switch'],
		net: ['网络', 'Network'],
		sys: ['系统', 'System'],
		dhcp: ['DHCP'],
		wifi: ['无线', 'Wireless'],
		upnp: ['UPnP', '端口映射', 'Active Connections']
	};
	var renderedCats = {};

	function esc(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
	}

	function titleStarts(h, prefixes) {
		if (!h) return false;
		var t = h.textContent.trim();
		for (var i = 0; i < prefixes.length; i++) {
			if (t.indexOf(prefixes[i]) === 0) return true;
		}
		return false;
	}

	function titleHas(h, prefixes) {
		if (!h) return false;
		var t = h.textContent.trim();
		for (var i = 0; i < prefixes.length; i++) {
			if (t.indexOf(prefixes[i]) >= 0) return true;
		}
		return false;
	}

	function findSection(prefixes, opts) {
		opts = opts || {};
		var found = null;
		document.querySelectorAll('#mz-view .cbi-section').forEach(function (sec) {
			if (found) return;
			var h = sec.querySelector('h2, h3, .cbi-section-title');
			if (!h) return;
			var ok = opts.contains ? titleHas(h, prefixes) : titleStarts(h, prefixes);
			if (!ok) return;
			var st = h.textContent.trim();
			if (opts.exclude && st.indexOf(opts.exclude) >= 0) return;
			found = sec;
		});
		return found;
	}

	function tableMap(tbl) {
		var map = {};
		tbl.querySelectorAll('tr').forEach(function (row) {
			var cells = row.querySelectorAll('td, th');
			if (cells.length < 2) return;
			var label = cells[0].textContent.trim();
			if (!label || (label in map)) return;
			var bar = cells[1].querySelector('.cbi-progressbar[title]');
			var val;
			if (bar) {
				val = bar.getAttribute('title');
			} else {
				var parts = [];
				for (var ci = 1; ci < cells.length; ci++)
					parts.push(cells[ci].textContent.trim());
				val = parts.join(' ');
			}
			map[label] = val.replace(/\s+/g, ' ').trim();
		});
		return map;
	}

	function pick(map) {
		for (var i = 1; i < arguments.length; i++) {
			if (map[arguments[i]]) return map[arguments[i]];
		}
		return '';
	}

	function parseBar(table) {
		var bars = table.querySelectorAll('.cbi-progressbar[title]');
		if (!bars.length) return null;
		var m = bars[0].getAttribute('title').match(
			/([\d.]+)\s*([A-Za-z]+)\s*\/\s*([\d.]+)\s*([A-Za-z]+)\s*\((\d+)%\)/
		);
		if (!m) return null;
		return {
			used: m[1],
			usedUnit: m[2],
			total: m[3],
			totalUnit: m[4],
			pct: parseInt(m[5], 10)
		};
	}

	/* OT-10: locate the system/memory/storage tables by content markers
	   instead of blind position, and keep the last good readings when a
	   poll cannot be parsed (never flash 0% on a transient failure). */
	var lastCore = null;

	function scoreTable(tbl, marks) {
		var text = tbl.textContent || '';
		var score = 0;
		for (var i = 0; i < marks.length; i++)
			if (text.indexOf(marks[i]) >= 0) score++;
		return score;
	}

	function findCoreTables(tables) {
		var arr = Array.prototype.slice.call(tables);
		var sysMarks = ['主机名', 'Hostname', '运行时间', 'Uptime', '平均负载', 'Load Average', 'Load'];
		var best = arr[0], bestScore = 0, i;
		for (i = 0; i < arr.length; i++) {
			var sc = scoreTable(arr[i], sysMarks);
			if (sc > bestScore) { bestScore = sc; best = arr[i]; }
		}
		var bars = arr.filter(function (t) {
			return t.querySelector('.cbi-progressbar[title]');
		});
		return {
			sys: (bestScore >= 2) ? best : arr[0],
			mem: bars[0] || arr[1],
			storage: bars[1] || arr[2]
		};
	}

	function mergeCore(core) {
		if (!lastCore) { lastCore = core; return core; }
		var prev = lastCore;
		['hostname', 'uptime', 'load', 'model'].forEach(function (k) {
			if (!core[k] && prev[k]) core[k] = prev[k];
		});
		if (core.cpu === '0' && prev.cpu !== '0') core.cpu = prev.cpu;
		if (!core.temp && prev.temp) core.temp = prev.temp;
		if (!core.tempInfo && prev.tempInfo) core.tempInfo = prev.tempInfo;
		['mem', 'storage'].forEach(function (k) {
			if (core[k].pct === 0 && prev[k].pct !== 0) core[k] = prev[k];
		});
		lastCore = core;
		return core;
	}

	function ringHtml(pct, cls, id) {
		pct = Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
		var offset = CIRC * (1 - pct / 100);
		return '<svg class="mz-ring" viewBox="0 0 120 120" aria-hidden="true" data-mz-ring="' + esc(id) + '">' +
			'<circle class="mz-ring-bg" cx="60" cy="60" r="52"></circle>' +
			'<circle class="mz-ring-fg ' + esc(cls) + '" cx="60" cy="60" r="52" ' +
			'stroke-dasharray="' + CIRC + '" stroke-dashoffset="' + offset + '"></circle>' +
			'<text class="mz-ring-text" x="60" y="67" text-anchor="middle">' + pct + '%</text>' +
			'</svg>';
	}

	function setRing(root, id, pct) {
		var svg = root.querySelector('[data-mz-ring="' + id + '"]');
		if (!svg) return;
		pct = Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
		var fg = svg.querySelector('.mz-ring-fg');
		var text = svg.querySelector('.mz-ring-text');
		if (fg) fg.setAttribute('stroke-dashoffset', String(CIRC * (1 - pct / 100)));
		if (text) text.textContent = pct + '%';
	}

	function setText(root, id, value) {
		var el = root.querySelector('[data-mz-id="' + id + '"]');
		if (!el) return;
		var next = value == null ? '' : String(value);
		if (el.textContent !== next) el.textContent = next;
	}

	function collectCore(tables) {
		var info = tableMap(tables[0]);
		var cpuRaw = pick(info, 'CPU 使用率（%）', 'CPU 使用率', 'CPU usage');
		var cpuM = cpuRaw.match(/(\d+)/);
		var tempRaw = pick(info, '温度', 'Temperature');
		var tempM = tempRaw.match(/CPU:\s*([\d.]+)/);

		var mem = parseBar(tables[1]) || {
			used: '0', usedUnit: 'MiB', total: '0', totalUnit: 'MiB', pct: 0
		};
		var storage = parseBar(tables[2]) || {
			used: '0', usedUnit: 'MiB', total: '0', totalUnit: 'MiB', pct: 0
		};

		var memDetails = [];
		tables[1].querySelectorAll('tr').forEach(function (row) {
			var cells = row.querySelectorAll('td');
			if (cells.length < 2) return;
			var label = cells[0].textContent.trim();
			var bar = cells[1].querySelector('.cbi-progressbar[title]');
			var val = '';
			if (bar) {
				var m = bar.getAttribute('title').match(/([\d.]+\s*[A-Za-z]+)/);
				if (m) val = m[1];
			} else {
				val = cells[1].textContent.trim();
			}
			if (label && val) memDetails.push({ label: label, value: val });
		});

		var tempInfo = '';
		tables[2].querySelectorAll('tr').forEach(function (row) {
			if (row.textContent.indexOf('临时') >= 0) {
				var bar = row.querySelector('.cbi-progressbar[title]');
				if (bar) tempInfo = bar.getAttribute('title').replace(/\s*\(.*\)/, '');
			}
		});

		return {
			cpu: cpuM ? cpuM[1] : '0',
			temp: tempM ? tempM[1] : '',
			hostname: pick(info, '主机名', 'Hostname'),
			uptime: pick(info, '运行时间', 'Uptime'),
			load: pick(info, '平均负载', 'Load Average', 'Load'),
			model: pick(info, '型号', 'Model'),
			mem: mem,
			storage: storage,
			memDetails: memDetails,
			tempInfo: tempInfo
		};
	}

	function collectPorts(section) {
		var cards = [];
		if (!section) return cards;
		section.querySelectorAll('.ifacebox').forEach(function (box) {
			var heads = box.querySelectorAll('.ifacebox-head');
			var bodies = box.querySelectorAll('.ifacebox-body');
			var name = heads[0] ? heads[0].textContent.trim() : '';
			var statusText = bodies[0] ? bodies[0].textContent.trim() : '';
			var statusLower = statusText.toLowerCase();
			var isDown = !statusText ||
				statusText.indexOf('未连接') >= 0 ||
				statusText.indexOf('Nicht verbunden') >= 0 ||
				statusText.indexOf('Keine Verbindung') >= 0 ||
				statusText.indexOf('Sin conex') >= 0 ||
				statusText.indexOf('Non connect') >= 0 ||
				statusText.indexOf('sem conex') >= 0 ||
				statusLower.indexOf('no link') >= 0 ||
				statusLower.indexOf('not connected') >= 0 ||
				statusLower.indexOf('disconnected') >= 0 ||
				statusLower === 'down' ||
				statusLower.indexOf(' link down') >= 0;
			var isUp = !isDown;
			var speed = statusText || __('no link');
			var tx = '', rx = '';
			if (bodies[1]) {
				/* textContent works on display:none nodes; innerText does not */
				var t = bodies[1].textContent;
				var txm = t.match(/\u25b2\s*([\d.]+\s*[A-Za-z]+)/);
				var rxm = t.match(/\u25bc\s*([\d.]+\s*[A-Za-z]+)/);
				if (!txm) txm = t.match(/TX[:\s]*([\d.]+\s*[A-Za-z\/]+)/i);
				if (!rxm) rxm = t.match(/RX[:\s]*([\d.]+\s*[A-Za-z\/]+)/i);
				if (txm) tx = txm[1].trim();
				if (rxm) rx = rxm[1].trim();
			}
			var zones = [];
			box.querySelectorAll('.ifacebadge').forEach(function (b) {
				var zt = b.textContent.trim().replace(/\s+/g, ' ');
				if (zt) {
					zt = zt.replace(/:\s*$/, '').trim();
					if (zt && zones.indexOf(zt) < 0) zones.push(zt);
				}
			});
			cards.push({ name: name, speed: speed, isUp: isUp, tx: tx, rx: rx, zones: zones });
		});
		return cards;
	}

	var NET_KEEP = {
		'协议': true, '协议:': true, 'Protocol': true,
		'地址': true, '地址:': true, 'Address': true, 'IPv6-地址': true,
		'网关': true, '网关:': true, 'Gateway': true,
		'DNS': true, 'DNS:': true,
		'已连接': true, '已连接:': true, 'Connected': true,
		'剩余有效期': true, '剩余有效期:': true, 'Expires': true,
		'分发前缀': true, '分发前缀:': true, 'Prefix': true
	};

	function collectNet(section) {
		var cards = [];
		if (!section) return cards;
		section.querySelectorAll('.ifacebox').forEach(function (box) {
			var head = box.querySelector('.ifacebox-head');
			var title = head ? head.textContent.trim() : '';
			var body = box.querySelector('.ifacebox-body');
			var items = [];
			var seenDns = false;
			if (body) {
				body.querySelectorAll(':scope > .nowrap, :scope > * > .nowrap').forEach(function (nw) {
					var strong = nw.querySelector(':scope > strong');
					var label = strong ? strong.textContent.trim() : '';
					var value = nw.textContent.replace(label, '').trim();
					if (!label || !value) return;
					var key = label.replace(/[:：]\s*$/, '').trim();
					if (key.indexOf('DHCPv6') === 0) return;
					if (key === 'DNS' || key.indexOf('DNS') === 0) {
						if (seenDns) return;
						seenDns = true;
						key = 'DNS';
					} else if (key === '分发前缀') {
						key = '前缀';
					} else if (key === '剩余有效期') {
						key = '有效期';
					}
					if (NET_KEEP[key]) {
						if (value.length > 48) value = value.substring(0, 46) + '…';
						items.push({ label: key, value: value });
					}
				});
			}
			cards.push({ title: title, items: items });
		});
		return cards;
	}

	function collectSys(section) {
		var items = [];
		if (!section) return items;
		section.querySelectorAll('table tr').forEach(function (row) {
			var cells = row.querySelectorAll('td');
			if (cells.length < 2) return;
			var label = cells[0].textContent.trim();
			var value = cells[1].textContent.trim();
			if (label && value && label !== '?') items.push({ label: label, value: value });
		});
		return items;
	}

	function collectDhcp(section) {
		var tables = [];
		if (!section) return tables;
		section.querySelectorAll('table').forEach(function (t, ti) {
			var rows = t.querySelectorAll('tr');
			if (rows.length <= 1) {
				tables.push({ empty: ti === 0 ? __('No IPv4 leases yet') : __('No IPv6 leases yet') });
				return;
			}
			var headers = [];
			rows[0].querySelectorAll('th').forEach(function (th, ci) {
				if (ci < 5) headers.push(th.textContent.trim());
			});
			var body = [];
			for (var ri = 1; ri < rows.length; ri++) {
				var cells = rows[ri].querySelectorAll('td');
				if (cells.length < 2) continue;
				var row = [];
				for (var ci = 0; ci < Math.min(cells.length, 5); ci++)
					row.push(cells[ci].textContent.trim());
				body.push(row);
			}
			tables.push({ headers: headers, rows: body });
		});
		return tables;
	}

	function collectWifi(section) {
		var radios = [];
		var stations = null;
		if (!section) return { radios: radios, stations: stations };

		section.querySelectorAll('.ifacebox').forEach(function (box) {
			var name = box.querySelector('.ifacebox-head')
				? box.querySelector('.ifacebox-head').textContent.trim() : '';
			var body = box.querySelector('.ifacebox-body');
			var info = {};
			if (body) {
				body.querySelectorAll('.nowrap').forEach(function (nw) {
					var strong = nw.querySelector('strong');
					var label = strong ? strong.textContent.trim().replace(/:$/, '') : '';
					var value = nw.textContent.replace(strong ? strong.textContent : '', '').trim();
					if (label) info[label] = value;
				});
			}
			radios.push({ name: name, info: info });
		});

		var wifiTable = section.querySelector('table');
		if (wifiTable) {
			var rows = wifiTable.querySelectorAll('tr');
			if (rows.length > 1) {
				var headers = [];
				var body = [];
				var ths = rows[0].querySelectorAll('th');
				for (var hi = 0; hi < Math.min(ths.length, 5); hi++)
					headers.push(ths[hi].textContent.trim().substring(0, 12));
				for (var ri = 1; ri < rows.length; ri++) {
					var cells = rows[ri].querySelectorAll('td');
					if (cells.length < 2) continue;
					var row = [];
					for (var ci = 0; ci < Math.min(cells.length, 5); ci++)
						row.push(cells[ci].textContent.trim().substring(0, 25));
					body.push(row);
				}
				stations = { headers: headers, rows: body };
			}
		}
		return { radios: radios, stations: stations };
	}

	function collectUpnp(section) {
		if (!section) return { empty: true };
		var table = section.querySelector('table');
		if (!table) return { empty: true };
		var rows = table.querySelectorAll('tr');
		if (rows.length <= 1 || (rows.length === 2 && rows[1].textContent.indexOf('没有') >= 0))
			return { empty: true };
		var headers = [];
		rows[0].querySelectorAll('th').forEach(function (th, ci) {
			if (ci < 6) headers.push(th.textContent.trim().substring(0, 10));
		});
		var body = [];
		for (var ri = 1; ri < rows.length; ri++) {
			var cells = rows[ri].querySelectorAll('td');
			if (cells.length < 2) continue;
			var row = [];
			for (var ci = 0; ci < Math.min(cells.length, 6); ci++)
				row.push(cells[ci].textContent.trim());
			body.push(row);
		}
		return { headers: headers, rows: body };
	}

	function dataTableHtml(headers, rows) {
		var html = '<div class="mz-table-card"><table class="mz-data-table"><thead><tr>';
		headers.forEach(function (h) { html += '<th>' + esc(h) + '</th>'; });
		html += '</tr></thead><tbody>';
		rows.forEach(function (row) {
			html += '<tr>';
			row.forEach(function (c, i) {
				html += '<td data-label="' + esc(headers[i]) + '">' + esc(c) + '</td>';
			});
			html += '</tr>';
		});
		html += '</tbody></table></div>';
		return html;
	}

	function portsHtml(cards) {
		return '<h3 class="mz-section-title">' + __('Port status') + '</h3><div class="mz-port-grid">' +
			cards.map(function (p) {
				return '<div class="mz-port-card' + (p.isUp ? ' up' : ' down') + '">' +
					'<div class="mz-port-name">' + esc(p.name) + '</div>' +
					'<div class="mz-port-status">' +
					(p.isUp
						? '<span class="mz-port-dot up"></span> '
						: '<span class="mz-port-dot down"></span> ') +
					esc(p.speed) + '</div>' +
					(p.zones.length
						? '<div class="mz-port-zones">' + esc(p.zones.join(', ')) + '</div>'
						: '') +
					((p.tx || p.rx)
						? '<div class="mz-port-traffic">' +
							(p.tx ? '<span class="mz-tx">▲ ' + esc(p.tx) + '</span>' : '') +
							(p.rx ? '<span class="mz-rx">▼ ' + esc(p.rx) + '</span>' : '') +
							'</div>'
						: '') +
					'</div>';
			}).join('') + '</div>';
	}

	function netHtml(cards) {
		return '<h3 class="mz-section-title">' + __('Network') + '</h3><div class="mz-net-grid">' +
			cards.map(function (n) {
				return '<div class="mz-net-card">' +
					'<div class="mz-net-header">' + esc(n.title) + '</div>' +
					'<div class="mz-net-body">' +
					n.items.map(function (it) {
						return '<div class="mz-net-row"><span class="mz-net-label">' +
							esc(it.label) + '</span><span class="mz-net-value" title="' +
							esc(it.value) + '">' + esc(it.value) + '</span></div>';
					}).join('') +
					'</div></div>';
			}).join('') + '</div>';
	}

	function sysHtml(items) {
		return '<h3 class="mz-section-title">' + __('System information') + '</h3><div class="mz-sys-grid">' +
			items.map(function (it) {
				return '<div class="mz-sys-item"><span class="mz-sys-label">' +
					esc(it.label) + '</span><span class="mz-sys-value">' +
					esc(it.value) + '</span></div>';
			}).join('') + '</div>';
	}

	function dhcpHtml(tables) {
		var html = '<h3 class="mz-section-title">' + __('DHCP leases') + '</h3>';
		tables.forEach(function (t) {
			if (t.empty) {
				html += '<div class="mz-empty-state">' + esc(t.empty) + '</div>';
			} else {
				html += dataTableHtml(t.headers, t.rows);
			}
		});
		return html;
	}

	function wifiHtml(data) {
		var html = '<h3 class="mz-section-title">' + __('Wireless') + '</h3><div class="mz-wifi-radios">';
		data.radios.forEach(function (r) {
			var info = r.info;
			var encRaw = info['加密'] || info['Encryption'] || '';
			var enc = encRaw ? String(encRaw).substring(0, 15) : '-';
			html += '<div class="mz-wifi-card">' +
				'<div class="mz-wifi-name">' + esc(info['SSID'] || r.name) + '</div>' +
				'<div class="mz-wifi-sub">' + esc(r.name) + ' · ' +
				esc(info['信道'] || info['Channel'] || '') + ' · ' +
				esc(info['速率'] || info['Bitrate'] || info['Rate'] || '') + '</div>' +
				'<div class="mz-wifi-stats">' +
				'<span><strong>' + esc(info['关联数'] || info['Associations'] || '0') + '</strong> ' + __('associated') + '</span>' +
				'<span><strong>' + esc(enc) + '</strong></span>' +
				'</div></div>';
		});
		html += '</div>';
		if (data.stations) {
			html += '<h4 class="mz-subtitle">' + __('Associated stations') + '</h4>' +
				dataTableHtml(data.stations.headers, data.stations.rows);
		}
		return html;
	}

	function upnpHtml(data) {
		var html = '<h3 class="mz-section-title">' + __('UPnP port mappings') + '</h3>';
		if (data.empty)
			return html + '<div class="mz-empty-state">' + __('No active port mappings') + '</div>';
		return html + dataTableHtml(data.headers, data.rows);
	}

	function ensurePanel(view, cls, afterEl) {
		var el = view.querySelector('.' + cls);
		if (el) return el;
		el = document.createElement('div');
		el.className = cls;
		if (afterEl && afterEl.parentNode === view)
			view.insertBefore(el, afterEl.nextSibling);
		else
			view.appendChild(el);
		return el;
	}

	function removePanel(view, cls) {
		var el = view.querySelector('.' + cls);
		if (el) el.parentNode.removeChild(el);
	}

	function patchPanel(el, html) {
		if (!el) return;
		if (el.getAttribute('data-mz-html') === html) return;
		el.innerHTML = html;
		el.setAttribute('data-mz-html', html);
	}

	function buildCoreHtml(core) {
		/* R-08: the labels WE render are translatable; the Chinese lookup
		   keys used when PARSING the stock overview DOM (pick(...),
		   CAT_PREFIXES, scoreTable marks) intentionally stay literal,
		   like the bilingual fallbacks next to them. */
		return '<div class="mz-info-cards">' +
			'<div class="mz-info-card"><div class="mz-info-label">' + __('Device') + '</div>' +
			'<div class="mz-info-value" data-mz-id="hostname">' + esc(core.hostname) + '</div></div>' +
			'<div class="mz-info-card"><div class="mz-info-label">' + __('Uptime') + '</div>' +
			'<div class="mz-info-value" data-mz-id="uptime">' + esc(core.uptime) + '</div></div>' +
			'<div class="mz-info-card"><div class="mz-info-label">' + __('Load average') + '</div>' +
			'<div class="mz-info-value" data-mz-id="load">' + esc(core.load) + '</div></div>' +
			'<div class="mz-info-card"><div class="mz-info-label">' + __('Model') + '</div>' +
			'<div class="mz-info-value" data-mz-id="model">' + esc(core.model) + '</div></div>' +
			'</div>' +
			'<div class="mz-rings">' +
			'<div class="mz-ring-card">' + ringHtml(core.cpu, 'mz-ring-cpu', 'cpu') +
			'<div class="mz-ring-meta"><div class="mz-ring-label">CPU</div>' +
			'<div class="mz-ring-sub" data-mz-id="temp"' + (core.temp ? '' : ' hidden') + '>' +
			(core.temp ? (__('Temperature') + ' ' + esc(core.temp) + '°C') : '') + '</div></div></div>' +
			'<div class="mz-ring-card">' + ringHtml(core.mem.pct, 'mz-ring-mem', 'mem') +
			'<div class="mz-ring-meta"><div class="mz-ring-label">' + __('Memory') + '</div>' +
			'<div class="mz-ring-pct" data-mz-id="mem-pct">' +
			esc(core.mem.used) + ' / ' + esc(core.mem.total) + ' ' + esc(core.mem.totalUnit) +
			'</div>' +
			'</div></div>' +
			'<div class="mz-ring-card">' + ringHtml(core.storage.pct, 'mz-ring-storage', 'storage') +
			'<div class="mz-ring-meta"><div class="mz-ring-label">' + __('Storage') + '</div>' +
			'<div class="mz-ring-pct" data-mz-id="storage-pct">' +
			esc(core.storage.used) + ' / ' + esc(core.storage.total) + ' ' + esc(core.storage.totalUnit) +
			'</div>' +
			'<div class="mz-ring-sub" data-mz-id="temp-info"' + (core.tempInfo ? '' : ' hidden') + '>' +
			(core.tempInfo ? (__('Temp') + ' ' + esc(core.tempInfo)) : '') + '</div></div></div>' +
			'</div>';
	}

	function patchCore(panel, core) {
		setText(panel, 'hostname', core.hostname);
		setText(panel, 'uptime', core.uptime);
		setText(panel, 'load', core.load);
		setText(panel, 'model', core.model);
		setRing(panel, 'cpu', core.cpu);
		setRing(panel, 'mem', core.mem.pct);
		setRing(panel, 'storage', core.storage.pct);
		setText(panel, 'mem-pct',
			core.mem.used + ' / ' + core.mem.total + ' ' + core.mem.totalUnit);
		setText(panel, 'storage-pct',
			core.storage.used + ' / ' + core.storage.total + ' ' + core.storage.totalUnit);

		var tempEl = panel.querySelector('[data-mz-id="temp"]');
		if (tempEl) {
			if (core.temp) {
				tempEl.hidden = false;
				tempEl.textContent = __('Temperature') + ' ' + core.temp + '°C';
			} else {
				tempEl.hidden = true;
				tempEl.textContent = '';
			}
		}

		var tempInfoEl = panel.querySelector('[data-mz-id="temp-info"]');
		if (tempInfoEl) {
			if (core.tempInfo) {
				tempInfoEl.hidden = false;
				tempInfoEl.textContent = __('Temp') + ' ' + core.tempInfo;
			} else {
				tempInfoEl.hidden = true;
				tempInfoEl.textContent = '';
			}
		}

	}

	function hideOriginalSections(cats) {
		cats = cats || renderedCats;
		var prefixes = [];
		Object.keys(cats).forEach(function (c) {
			if (cats[c] && CAT_PREFIXES[c])
				prefixes = prefixes.concat(CAT_PREFIXES[c]);
		});
		if (!prefixes.length) return;
		document.querySelectorAll('#mz-view .cbi-section').forEach(function (sec) {
			if (sec.classList.contains('mz-hidden-section')) return;
			var h = sec.querySelector('h2, h3, .cbi-section-title');
			if (!h) return;
			var txt = h.textContent.trim();
			for (var i = 0; i < prefixes.length; i++) {
				var p = prefixes[i];
				if (txt.indexOf(p) === 0 || (p.length > 3 && txt.indexOf(p) >= 0 &&
					(p === 'UPnP' || p === '端口映射' || p === 'Active Connections'))) {
					if ((p === '系统' || p === 'System') &&
						(txt.indexOf('端口') >= 0 || txt.indexOf('Ports') >= 0))
						continue;
					sec.classList.add('mz-hidden-section');
					return;
				}
			}
		});
	}

	function refreshOverview() {
		if (document.body.getAttribute('data-page') !== 'admin-status-overview')
			return false;

		var view = document.getElementById('mz-view');
		if (!view) return false;

		var tables = view.querySelectorAll('table.table');
		if (tables.length < 3) return false;

		var picked = findCoreTables(tables);
		var core = mergeCore(collectCore([picked.sys, picked.mem, picked.storage]));
		var panel = null;
		if (!mintOvdActive()) {
			panel = view.querySelector('.mz-overview-panel');
			if (!panel) {
				panel = document.createElement('div');
				panel.className = 'mz-overview-panel';
				panel.innerHTML = buildCoreHtml(core);
				view.insertBefore(panel, view.firstChild);
			} else {
				patchCore(panel, core);
			}
		} else {
			removePanel(view, 'mz-overview-panel');
		}

		var cursor = panel;
		var cats = { core: true };
		var ports = collectPorts(findSection(['端口状态', 'Ports', 'Switch']));
		if (ports.length) {
			cats.ports = true;
			var portPanel = ensurePanel(view, 'mz-port-panel', cursor);
			patchPanel(portPanel, portsHtml(ports));
			cursor = portPanel;
		} else {
			removePanel(view, 'mz-port-panel');
		}

		var nets = mintOvdActive() ? [] : collectNet(findSection(['网络', 'Network']));
		if (nets.length) {
			cats.net = true;
			var netPanel = ensurePanel(view, 'mz-net-panel', cursor);
			patchPanel(netPanel, netHtml(nets));
			cursor = netPanel;
		} else {
			removePanel(view, 'mz-net-panel');
			if (mintOvdActive()) cats.net = true; /* keep original Network section hidden */
		}

		var sysSec = null;
		document.querySelectorAll('#mz-view .cbi-section').forEach(function (sec) {
			var h = sec.querySelector('h2, h3');
			var st = h ? h.textContent.trim() : '';
			if (h && titleStarts(h, ['系统', 'System']) &&
				st.indexOf('端口') < 0 && st.indexOf('Ports') < 0)
				sysSec = sec;
		});
		var sysItems = mintOvdActive() ? [] : collectSys(sysSec);
		if (sysItems.length) {
			cats.sys = true;
			var sysPanel = ensurePanel(view, 'mz-sys-panel', cursor);
			patchPanel(sysPanel, sysHtml(sysItems));
			cursor = sysPanel;
		} else {
			removePanel(view, 'mz-sys-panel');
			if (mintOvdActive()) cats.sys = true; /* keep original System section hidden */
		}

		var dhcp = collectDhcp(findSection(['DHCP']));
		if (dhcp.length) {
			cats.dhcp = true;
			var dhcpPanel = ensurePanel(view, 'mz-dhcp-panel', cursor);
			patchPanel(dhcpPanel, dhcpHtml(dhcp));
			cursor = dhcpPanel;
		} else {
			removePanel(view, 'mz-dhcp-panel');
		}

		var wifi = collectWifi(findSection(['无线', 'Wireless']));
		if (wifi.radios.length || wifi.stations) {
			cats.wifi = true;
			var wifiPanel = ensurePanel(view, 'mz-wifi-panel', cursor);
			patchPanel(wifiPanel, wifiHtml(wifi));
			cursor = wifiPanel;
		} else {
			removePanel(view, 'mz-wifi-panel');
		}

		var upnpSec = findSection(['UPnP', '端口映射', 'Active Connections'], { contains: true });
		if (upnpSec) {
			cats.upnp = true;
			var upnpPanel = ensurePanel(view, 'mz-upnp-panel', cursor);
			patchPanel(upnpPanel, upnpHtml(collectUpnp(upnpSec)));
		} else {
			removePanel(view, 'mz-upnp-panel');
		}

		renderedCats = cats;
		hideOriginalSections(cats);
		return true;
	}

	function watchHiddenSections() {
		var view = document.getElementById('mz-view');
		if (!view || hideObserver) return;
		hideObserver = new MutationObserver(function () {
			hideOriginalSections();
		});
		hideObserver.observe(view, { childList: true, subtree: true });
	}

	function boot() {
		/* Menu folding moved to menu-mint.js (OT-12); this script only
		   owns the overview panels (and only loads there, see footer.ut). */
		var ready = false;

		function tick() {
			if (document.body.getAttribute('data-page') !== 'admin-status-overview')
				return true;
			if (refreshOverview()) {
				if (!ready) {
					ready = true;
					watchHiddenSections();
					if (!started) {
						started = true;
						setInterval(function () {
							try { refreshOverview(); } catch (err) {}
						}, REFRESH_MS);
					}
				}
				return true;
			}
			return false;
		}

		if (tick()) return;

		var view = document.getElementById('mz-view');
		if (!view) return;
		var observer = new MutationObserver(function () {
			if (tick()) observer.disconnect();
		});
		observer.observe(view, { childList: true, subtree: true });
		setTimeout(function () { observer.disconnect(); }, 20000);
	}

	if (document.readyState === 'loading')
		document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 800); });
	else
		setTimeout(boot, 800);

})();
