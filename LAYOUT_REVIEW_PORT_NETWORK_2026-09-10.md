# 首页端口状态 / 下方卡片 + 网络-接口 排版审查与修订

- 日期：2026-09-10
- 分支：`arena/01a0875f-luci-theme-mint`
- 审查对象：
  - 首页（`/admin/status/overview`）的 **端口状态** 及下方 **Network / DHCP / Wireless / UPnP** 卡片
  - `网络 → 接口`（`/admin/network/network`）的 `.ifacebox` 卡片布局
- 参考主题：[eamonxg/luci-theme-aurora](https://github.com/eamonxg/luci-theme-aurora)（其 `_card.css` / `_table.css` 对原生 `.ifacebox`、`.network-status-table`、内联 `display:grid` 的处理）
- 说明：本次是静态审查 + 直接改 CSS；未在真机/Playwright 上做像素回归。

---

## 一、审查结论先给结论

**最严重的问题不是“卡片不好看”，而是首页原生区块的标签/文字被主题 CSS 误隐藏了。**

当前主题在 `cascade.css:4323`（旧版）写了全局规则：

```css
.ifacebox-body > span:not(.cbi-tooltip-container) { display: none; }
```

它本意是处理 **网络-接口页** 的“ ( ”分隔符，但它是**全站全局生效**。LuCI 原生首页的：

1. `29_ports.js`：端口卡片
2. `30_network.js`：网络上游卡片（用 `L.itemlist(E('span'), …)`）
3. `60_wifi.js`：无线卡片（同样用 `L.itemlist(E('span'), …)`）

这些卡片的正文，第一个子元素恰恰是**不带 tooltip 类的 `<span>`**，于是：
- 网络卡片 `Protocol / Address / Gateway / DNS / Expires …` 整段文字被隐藏
- 无线卡片的 SSID / 设备信息也被隐藏
- 只留下嵌套的 `div` 徽章，因此首页看起来“卡片是空的 / 只有图标”

此外：
- 首页“端口状态”由 LuCI 原生 `div[style*="display:grid"]` 渲染，**默认每列 `70–100px`**，主题没有覆盖，因此端口挤成一排窄条。
- 首页“网络 / 无线”使用原生 `.network-status-table`，**该容器没有任何布局规则**，所以上游/无线卡片默认垂直堆叠全宽，观感像“一列大卡”。

这些都能在 aurora 里找到对应处理，且与用户看到的现象高度吻合。

---

## 二、首页“端口状态”

### 原生结构（luci-mod-status `29_ports.js`）
```js
E('div', { 'style': 'display:grid;grid-template-columns:repeat(auto-fit, minmax(70px, 1fr));margin-bottom:1em' }, [
  E('div', { 'class': 'ifacebox', 'style': 'margin:.25em;min-width:70px;max-width:100px' }, …)
])
```

### 现状问题
| 问题 | 说明 |
|---|---|
| 卡片过窄 | 内联 `min-width:70px; max-width:100px`，端口名/速度/流量被压扁。 |
| 网格过密 | `repeat(auto-fit, minmax(70px,1fr))`，一个 1280px 页面能塞十几个端口。 |
| 无主题化 | 主题只在移动端 `overview-mobile.js` 生成自己的 `mz-port-grid`；桌面端仍走原生网格。 |
| 等高等距 | 内联 `margin:.25em` 造成相邻端口间距只有 4px，卡片看起来连在一起。 |

### 参考 aurora 的处理
aurora `_card.css`：
```css
& div[style*="display:grid"] { @apply max-md:grid-cols-2! max-md:gap-3; }
```
它至少保证移动端两列 + 统一间距。

### 本次修改
在 `cascade.css` 追加“端口网格”规则，用属性 `[style*="minmax(70px, 1fr)"]` 限定到原生端口网格：

```css
#mz-view .cbi-section > div[style*="display:grid"][style*="minmax(70px, 1fr)"] {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) !important;
  gap: var(--mz-spacing-sm) !important;
  align-items: stretch;
}

#mz-view .cbi-section > div[style*="display:grid"][style*="minmax(70px, 1fr)"] > .ifacebox {
  margin: 0 !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
}

@media (max-width: 640px) {
  #mz-view .cbi-section > div[style*="display:grid"][style*="minmax(70px, 1fr)"] {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
  }
}
```

效果：桌面端口卡最小 150px、自动填充且等高；手机固定两列。

---

## 三、首页“下方卡片”（Network / Wireless）与 `.network-status-table`

### 原生结构（`30_network.js` / `60_wifi.js`）
```js
const netstatus = E('div', { 'class': 'network-status-table' });
… netstatus.appendChild(renderbox(wan_net, …)); // renderbox => div.ifacebox
```

### 现状问题
| 问题 | 说明 |
|---|---|
| 无容器布局 | 主题没有任何 `.network-status-table` 规则；该容器是纯 `div`，默认块级。 |
| 卡片全宽堆叠 | 多个接口/无线 radio 一个接一个垂直排列，长内容行占用整个宽度。 |
| 正文 span 被误隐藏 | 上文说过的全局 `display:none` 规则，把 `L.itemlist` 的内容隐藏。 |
| 大小不均 | 无 `flex`、无 `gap`，各 ifacebox 高度由内容决定，视觉乱。 |

### 参考 aurora 的处理
aurora `_card.css`：
```css
& .network-status-table {
  @apply mb-3 flex flex-nowrap justify-around gap-4 max-md:flex-col;
}
… .network-status-table .ifacebox-body {
  @apply flex h-full flex-1 flex-col items-center justify-around gap-2;
  & .ifacebadge { @apply min-w-55 flex-1; }
}
```

### 本次修改
```css
#mz-view .network-status-table {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: var(--mz-spacing-md);
  margin-bottom: var(--mz-spacing-md);
}

#mz-view .network-status-table > .ifacebox {
  flex: 1 1 300px;
  min-width: 0;
  height: 100%;
  overflow: visible;
}

/* label/value 行与设备徽章纵向堆叠，读起来更像卡片 */
#mz-view .network-status-table .ifacebox-body {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
}
#mz-view .network-status-table .ifacebox-body > span,
#mz-view .network-status-table .ifacebox-body > div { width: 100%; }

@media (max-width: 767px) {
  #mz-view .network-status-table { flex-direction: column; }
  #mz-view .network-status-table > .ifacebox { flex-basis: auto; width: 100%; }
}
```

效果：网络/无线卡片在桌面横向等多高排列；手机纵向堆叠卡片；正文文字重新可见。

---

## 四、网络-接口页（admin/network/network）

### 原生结构（`interfaces.js`）
每个接口在 CBI 表格中的第一个单元格是：
```js
E('div', { 'class': 'ifacebox' }, [
  E('div', { 'class': 'ifacebox-head', 'style': firewall.getZoneColorStyle(zone) }, …),
  E('div', { 'class': 'ifacebox-body', 'id': '<iface>-ifc-devices' }, [ …图标/子接口… ])
])
```
第二个单元格是 `_ifacestat` 描述面板。

### 现状问题
| 问题 | 说明 |
|---|---|
| 全局误伤 | `.ifacebox-body > span… display:none` 同时会隐藏接口卡里的子设备小图标（此时外层 span 是 “ ( ” 容器）。 |
| 卡片不等高 | `.ifacebox` 默认块级，不填充所在单元格，第一列与右侧描述列高度不一致。 |
| 手机端占用过高 | 卡片切到 `≤854px` 后整列块级，接口卡在窄屏占满第一格，后面描述也要单独一行，页面拉得很长。 |
| 区域色被“色条”化 | 已有 `border-left:3px solid` 主题风格，与 aurora 的“整块头背景”风格不同，但这是 mint 自己的设计，一般保留。 |

### 参考 aurora 的处理
aurora `_card.css`：
```css
.ifacebox {
  @apply … relative inline-flex min-w-28 flex-col items-stretch overflow-visible rounded-2xl border … ;
  #cbi-network-interface & { @apply max-md:flex-row md:min-w-38; }
  & .ifacebox-head { @apply … max-md:flex max-md:w-auto max-md:shrink-0 … max-md:rounded-l-3xl max-md:rounded-tr-none …; }
  & .ifacebox-body { @apply … max-md:flex-row … max-md:rounded-r-3xl …; }
}
```
它把手机端的接口卡做成“头部在左、正文在右”的水平卡片，避免占满整行。

### 本次修改
1. **把“隐藏分隔符”规则改为只作用于接口页，且不要隐藏子设备图标**：
```css
/* 只隐藏 “(” / “)” 标点，保留子设备 tooltip 图标 */
#cbi-network-interface .ifacebox-body > span:not(.cbi-tooltip-container),
#cbi-network-device .ifacebox-body > span:not(.cbi-tooltip-container) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0;
  line-height: 0;
}
… 子工具提示恢复字号 …
```
2. **接口卡纵向填充 + 手机横向卡片**：
```css
#cbi-network-interface .ifacebox,
#cbi-network-device .ifacebox {
  display:flex; flex-direction:column; align-items:stretch; height:100%; overflow:visible;
}

@media (max-width:768px) {
  … 取消第一单元格 min-width …
  #cbi-network-interface .ifacebox { flex-direction: row; min-height: 72px; }
  … head 左列、body 右列，圆角左右切换 …
}
```

---

## 五、为什么去参考 aurora

aurora 与 LuCI 原生 DOM 的贴合度很高，以下几项正是 mint 目前缺失的：

| aurora 做法 | 对我们最有用之处 |
|---|---|
| 内联 `div[style*="display:grid"]` 覆盖 | 处理 LuCI 首页原生端口网格，避免 UI 组件被动留下“9px 间距”。 |
| `.network-status-table` 设 flex | 一次性解决网络、无线两个上游卡片的横向/纵向布局。 |
| `#cbi-network-interface` 手机横排卡 | 网络接口页在手机上不再“一列大卡 + 一列描述”。 |
| `.ifacebox-body` 纵向、徽章 `flex-1` | 正文与徽章层级清晰，视觉更接近“卡片”。 |

我们保留了 mint 自己的 token（`--mz-color-*`、`--mz-radius-*`、`--mz-spacing-*`），只借鉴布局思路。

---

## 六、已修改文件与范围

- `theme/htdocs/luci-static/mint/cascade.css`
  - 修复首页 Network / Wireless 正文被误隐藏（把全局 `span→display:none` 收窄到接口页，并改为隐藏标点、保留子设备）。
  - 首页原生端口网格放大到 `minmax(150px,1fr)`，手机两列。
  - `.network-status-table` 桌面横向多卡、手机纵向堆叠、卡片正文纵向布局。
  - `#cbi-network-interface` / `#cbi-network-device` 接口卡等高、移动端头左/正文右横排卡。

未修改：
- `overview-mobile.js`（移动端自定义 `mz-port-grid` 等不动）。
- `overview-dashboard.js`（桌面仍未接管“端口 / DHCP / 无线 / UPnP”面板，仍由 LuCI 原生区块呈现；本次只改原生区块样式）。
- `header.ut` / `footer.ut`。

---

## 七、剩余待办 / 建议

1. **真机验证**：在 1440 / 1024 / 768 / 390 四档宽度看首页端口、网络、无线、DHCP、UPnP，以及网络-接口列表。重点检查：
   - 端口卡数量很多时，`150px` 最小宽是否仍偏小（可再降为 `130px`）。
   - `.network-status-table` 的 `ifacebadge` 在无线卡里是否换行过多（aurora 还给了 `min-width`，后续可按需补）。
   - 接口卡在“无子设备 / 多子设备”两种情况下是否仍对齐。
2. **桌面端口面板 JS 化**：如果希望桌面首页也走移动端那套 `mz-port-grid` 卡片（流量/区域/更多信息），可把 `overview-mobile.js` 的端口面板提取到共享模块，或在 `overview-dashboard.js` 中补一个 port 面板。本次未做。
3. **DHCP / UPnP 表格移动端**：这两块仍以原生 `.cbi-section` 表格呈现；移动端与 `mz-data-table` 风格不统一的问题，建议下一轮单独处理。
