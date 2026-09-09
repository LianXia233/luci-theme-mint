# luci-theme-mint 界面布局审查报告（合并修订版）

- 审查日期：2026-09-10
- 分支：`arena/01a0875f-luci-theme-mint`
- 审查对象：`theme/` 下的 ucode 模板、`cascade.css`、`menu-mint.js`、移动/桌面概览脚本、主题注册与打包脚本
- 参考依据：`CHANGELOG.md`（重点 2026-09-08 / 2026-09-09 各轮回归条目）、LuCI 原生资源（`ui.js`、`interfaces.js`、`29_ports.js`、`30_network.js`、`60_wifi.js`）、对照主题 [eamonxg/luci-theme-aurora](https://github.com/eamonxg/luci-theme-aurora)
- 说明：本报告把 `LAYOUT_REVIEW_2026-09-09.md` 与 `LAYOUT_REVIEW_PORT_NETWORK_2026-09-10.md` 的问题合并成最终清单，并逐项标注本次实际修改。静态审查 + 直接改代码；未做真机 Playwright 像素回归。

---

## 一、结论摘要

按 `CHANGELOG.md` 逐项对照后，当前代码存在四类明确不合理：

1. 桌面端顶部信息层级缺失：CSS 里保留整套顶栏/面包屑/指示器样式，却没有 DOM 生产者，导致桌面表单/状态页没有页面标题，刷新指示器无处安放。
2. 页脚放在 `.mz-main` 之外：桌面被固定侧栏压住，短页面还会出现多余滚动。
3. 全局下拉菜单与“保存并应用”按钮被错误 CSS 破坏：`overflow:hidden` 裁掉浮层，`.cbi-dropdown[open] > ul` 无差别命中真实菜单和预览克隆。
4. 移动端表格与网格策略互相打架：`.mz-data-table` 强制 500px 横向滚动、网格 1 列与 2 列 `!important` 规则并存、port/net/wifi 原生网格又被全局 `span{display:none}` 误伤。

同时，用户新指出的“四个主题变体”也已在代码/打包/文档中彻底移除，只保留单一 `Mint` 变体。

以下所有显式问题都已处理（P2-04 为维护性整理，已做隔离标注，彻底合并仍建议后续执行）。

---

## 二、问题与修复对照

### P1-01 桌面端顶栏/页题/刷新指示器缺失（CSS 死代码）

**原状**：`cascade.css` 保留 `.mz-topbar` / `.mz-breadcrumb` / `.mz-indicators` 一整套样式，但 `header.ut` 与 `menu-mint.js` 均不生成这些节点；而 `#mz-view > h2 { display:none !important }` 会把 LuCI 的页面标题隐藏，所以桌面端很多页面没有标题、刷新指示器也无处显示。

**本次修复**：

- `header.ut`：在 `.mz-main`、`#mz-view` 之前输出真实顶栏：

```html
<header class="mz-topbar">
  <span class="mz-topbar-title" id="mz-topbar-title" aria-live="polite"></span>
  <div id="indicators" class="mz-indicators" aria-live="polite"></div>
</header>
```

- `menu-mint.js`：新增 `initPageTopbar()`，从当前视图 `h2`（隐藏但仍在 DOM）或 `document.title` 同步顶栏标题，并用 `MutationObserver` 跟随 SPA 导航。
- `cascade.css`：
  - 追加 `.mz-topbar-title` 样式（加粗、省略号、flex 占位），并把 `#indicators` 排到最右。
  - `<854px` 时 `.mz-topbar { display:none }`，与移动端 `.mz-mobilebar` 互斥。
  - 删除不再有 DOM 生产者的 `.mz-breadcrumb` 规则（原 `.mz-topbar`/`.mz-indicators` 样式继续复用）。

### P1-02 页脚在 `.mz-main` 外：与侧栏重叠、短页多余滚动

**原状**：`footer.ut` 先闭合 `.mz-main` 再输出 `<footer>`，页脚不继承 `.mz-main` 的侧栏偏移。

**本次修复**：`footer.ut` 将 `<footer class="mz-footer">` 移入 `.mz-main` 内、紧跟 `</main>` 之后、`</div>` 之前。页脚与主体共同参与同一布局容器，不再被左侧栏压住。

### P2-01 移动端表格：自建表格横向滚动，原生表格堆叠

**原状**：`.mz-table-card { overflow-x:auto }` + `.mz-data-table { min-width:500px }`；DHCP/无线客户端表在手机上强制横向滚动，而原生 LuCI 表格被统一转为块级堆叠。

**本次修复**：

- `overview-mobile.js#dataTableHtml`：每个 `<td>` 输出列名作为 `data-label`（`<td data-label="主机名">…</td>`）。
- `cascade.css` 追加 `<640px` 专用块：`.mz-data-table` 去掉 `min-width` 与横向滚动，`thead` 隐藏、每行 `display:block`、每格 `display:flex`；`::before { content: attr(data-label) }` 在左侧显示列名，右侧显示值，与原生表格“手机端堆叠带标签”的体验一致。

### P2-02 移动端 port/net/wifi 网格 1 列死规则与 2 列 `!important` 冲突

**原状**：`≤640px` 曾定义 `.mz-port-grid/.mz-net-grid { grid-template-columns:1fr }`，随后又被全宽度 `repeat(2,1fr)!important` 覆盖，造成“改不动、也说不清”的死规则。

**本次修复**：删除历史 1 列媒体规则；在 `cascade.css` 末尾明确权威定义：

- 桌面（≥1024px）：port/net/wifi 使用 `repeat(auto-fit, minmax(400px, 1fr))!important`。
- 平板/手机（≤1023.98px）：信息卡 2 列、环形固定 3 列；port/net/wifi 由结尾网格块统一处理。
- 旧网格区块加“START grid-override legacy block，请改结尾权威块”注释，防止再叠加 `!important`。

### P2-03 登录页矮屏/认证字段多时被裁切

**原状**：`.mz-login` 是固定全屏 flex 容器，卡片可高过视口但没有滚动。

**本次修复**：`cascade.css` 追加：

```css
.mz-login { overflow-y: auto; }
.mz-login-card { max-height: calc(100dvh - 32px); max-height: calc(100vh - 32px); overflow-y: auto; }
```

### P2-04 网格 `!important` 覆盖层过多（维护性）

**原状**：同一批网格类被连续定义多套策略，最终效果取决于源码顺序，是此前“回合制回归”的主要诱因。

**本次处理**：

- 删除确定失效的早期 1 列规则；在旧网格区块首行明确其为历史只读块，权威规则以文件尾部块为准。
- 由于历史块相互覆盖且当前运行时依赖最后生效块，彻底合并为单一权威段落属于结构性重构，风险较高，本报告标记为**后续建议**，未在本次强行删除全部历史块。

### P2-05 首页端口/网络/无线：原生区块被误隐藏、网格过窄、无容器布局

（来自 `LAYOUT_REVIEW_PORT_NETWORK_2026-09-10.md`）

**原状**：

- `.ifacebox-body > span:not(.cbi-tooltip-container){display:none}` 全局生效，把首页 Network/Wireless 卡片正文（`span` 包裹的 `L.itemlist`）隐藏了。
- LuCI 端口网格内联 `repeat(auto-fit, minmax(70px,1fr))` + 每卡 `max-width:100px`，端口挤成窄条。
- `.network-status-table` 没有布局，上游/无线卡片全宽垂直堆叠。

**本次修复**（均在 `cascade.css`）：

- 把 `.ifacebox-body` 的 `span` 规则收窄到 `#cbi-network-interface / #cbi-network-device`，且用 `font-size:0` 隐藏括号标点而保留子设备 tooltip 图标；首页正文恢复可见。
- 原生端口网格 `#mz-view .cbi-section > div[style*="display:grid"][style*="minmax(70px, 1fr)"]` 覆盖为 `repeat(auto-fit, minmax(150px,1fr))!important`，手机两列；`.ifacebox` 去内联 margin、等高居中。
- `.network-status-table` 桌面 flex 多卡等高、手机纵向；正文 label/value 纵向排布。

### P1-03（本次修复）保存并应用 ComboButton 下拉菜单失效

**原状**：`.cbi-page-actions .cbi-dropdown.cbi-button` 被写成 `overflow:hidden`，LuCI 打开 `ul.dropdown` 时被容器裁剪；同时 `.cbi-dropdown[open] > ul` 把 `.dropdown`（真实菜单）与 `.preview`（按钮标题克隆）同时浮层化。

**本次修复**：`cascade.css` 追加最终覆盖块：

- 相关组件壳 `.cbi-dropdown` / `.cbi-button` / `.cbi-page-actions` / `#modal_overlay` 全部 `overflow:visible!important`。
- 仅 `.cbi-dropdown[open] > ul.dropdown` 成为绝对定位浮层（z-index 120、可滚动、max-width 限制）。
- `ul.preview` 强制 inline/静态，保留按钮文字。
- 补齐 `.open` / `.more` 箭头、`li[selected]` 高亮、组合按钮尺寸，以及 wallpaper/dark 下的可读背景。

### P1-04（本次修复）全局下拉菜单样式不正确

**原状**：旧规则无差别给 `.cbi-dropdown[open] > ul` 加浮层面板，连预览克隆一起渲染；非按钮型 `.cbi-dropdown` 也缺乏“表单输入控件”外观。

**本次修复**：

- 真实菜单只定位 `.dropdown`，`.preview` 不参与浮层。
- 追加 `.cbi-dropdown:not(.btn):not(.cbi-button)`：边框、圆角、surface 背景、focus 高亮；显示值 `li[display]/li[selected]` 加省略号限宽。
- 所有 cbi 下拉（协议、区域、时长等）恢复统一 mint 外观，保存并应用 ComboButton 的正常功能不受影响。

### P2-05 壁纸功能兼容性（2026-09-10 追加）

**原状**：本次新增的桌面 `.mz-topbar` 与表单下拉若仍使用不透明 `--mz-color-surface`，会在全局壁纸/暗色玻璃模式下变成“纯色硬块”，破坏玻璃通透过壁纸；登录页在矮屏加入滚动后，如果壁纸层仍用 `absolute`，滚动查看认证字段会带走背景。

**本次修复**：

- `.cbi-dropdown[open] > ul.dropdown`、非按钮型 `.cbi-dropdown` 在 `body.mz-has-wallpaper` 下改用 `--mz-panel-bg-strong` + `backdrop-filter`，不再硬编码 `#1c2736`；选中项使用 `--mz-color-primary-rgb`，天然兼容浅色/深色。
- `.mz-topbar` 沿用既有 `body.mz-has-wallpaper .mz-topbar` 玻璃规则。
- 登录页 `.mz-login-bg` / `.mz-login-overlay` 改为 `position:fixed`，矮屏滚动时壁纸与遮罩始终覆盖整个视口；`.mz-login-card` 用 `margin:auto` 解决 `align-items:center + overflow` 导致顶部裁切的问题。
- `mz-wallpaper-fetch.sh`、`luci-min.mint` 后端、`admin/system/mintwallpaper` 菜单、`mint wallpaper` UCI 配置与 ACL 均保持原样，未受变体删除影响。

### P3-04 中文翻译源引用清理

**原状**：`theme/po/*` 中所有 `.po/.pot` 摘录仍标着 `htdocs/luci-static/mint/overview.js:...`，而该文件已被删除，容易误导翻译工具链；壁纸设置页、登录页的中文文案本身已在 PO 中。

**本次修复**：`theme/po/zh_Hans/luci-theme-mint.po` 与 `theme/po/templates/theme.pot` 中 20 处 `overview.js` 源引用改为 `overview-mobile.js`（行号为原提取近似值，后续可按真实源码重新生成）。已验证中文 PO 的 `msgid`/`msgstr` 仍一一对应（82/82）。

### P3-01 `overview.js` 与更新日志不符

**本次修复**：确认全仓库无引用后删除 `theme/htdocs/luci-static/mint/overview.js`；`theme/README.md` 目录树改为 `overview-dashboard.js` / `overview-mobile.js`，并删除 `theme.po`/`zh_Hans.po` 中仅属于旧文件的注释行残留？——PO 文件有历史注释保留，可在下次 `po2lmo` 时由源码行号重新生成，不影响功能。

### P3-02 移动端汉堡按钮固定兜底定位

**原状**：`.mz-sidebar-toggle` 基础规则为 `position:fixed; top:12px; left:12px`，`≤854px` 无条件显示；依赖 `initMobileBar` 把它移入 `.mz-mobilebar` 才取消 fixed。

**本次修复**：`≤640px`（以及 `<854px` 移动断点）不再无条件给 `.mz-sidebar-toggle` 显示；只有 `.mz-mobilebar #mz-sidebar-toggle` 才在移动顶栏内显示。若 `initMobileBar` 失败，手机端按钮不会以 fixed 浮层砸在标题上。

---

## 三、移除四个主题变体

`Mintlight` / `MintDark` / `MintzeroLight` / `MintzeroDark` 已清理：

| 位置 | 处理 |
|---|---|
| `theme/root/etc/uci-defaults/30_luci-theme-mint` | 只注册 `luci.themes.mint=/luci-static/mint`；删除四把旧键；旧 `/luci-static/mint-light|mint-dark|mintzero*` mediaurlbase 重写为 `/luci-static/mint` |
| `theme/Makefile` postinst | 删除四把旧键并重写旧 mediaurlbase；只创建 `luci-theme-mint` 的 zh_cn/zh_CN lmo 别名 |
| `theme/Makefile` postrm | 卸载时删除旧键，同时清理旧 mintzero lmo / ACL 残留 |
| `theme/htdocs/luci-static/mint-light`、`mint-dark` | 已 `git rm` |
| `theme/ucode/template/themes/mint-light`、`mint-dark` | 已 `git rm` |
| `theme/ucode/template/themes/mint/header.ut` | 注释明确只发布单一 `Mint`；保留对旧 mediaurlbase 的防御映射 |
| `theme/README.md` / `README.md` | 改为“使用侧栏切换按钮循环 system → light → dark”；说明只注册单一 `Mint` |
| `CHANGELOG.md` | 新增 2026-09-10 条目记录以上清理；历史条目中的旧名称保留为历史记录 |

---

## 四、修改文件清单

- `theme/htdocs/luci-static/mint/cascade.css` — 顶栏标题、页脚相关、登录矮屏滚动、`mz-data-table` 移动堆叠、下拉/Save & Apply 覆盖、端口/网络/接口卡布局、网格旧块注释、删除面包屑死代码。
- `theme/ucode/template/themes/mint/header.ut` — 新增 `.mz-topbar`（标题 + `#indicators`）。
- `theme/ucode/template/themes/mint/footer.ut` — 页脚移入 `.mz-main`。
- `theme/htdocs/luci-static/resources/menu-mint.js` — 新增 `initPageTopbar()`。
- `theme/htdocs/luci-static/mint/overview-mobile.js` — DHCP/无线表 `td` 增加 `data-label`。
- `theme/root/etc/uci-defaults/30_luci-theme-mint` — 单变体注册与旧键清理。
- `theme/Makefile` — postinst/postrm 旧变体清理与旧 lmo 别名收敛。
- `theme/README.md` / `README.md` — 变体与目录说明更新。
- `theme/po/zh_Hans/luci-theme-mint.po`、`theme/po/templates/theme.pot` — 旧 `overview.js` 源引用改指 `overview-mobile.js`；中文文案校验完整。
- `CHANGELOG.md` — 新增 2026-09-10 修复记录。
- 删除：
  - `theme/htdocs/luci-static/mint-light`、`mint-dark`（symlink）
  - `theme/ucode/template/themes/mint-light`、`mint-dark`（symlink）
  - `theme/htdocs/luci-static/mint/overview.js`

---

## 五、验证情况

- `sh -n theme/root/etc/uci-defaults/30_luci-theme-mint` 通过。
- `node --check` 通过：`menu-mint.js`、`mz-ui.js`、`overview-mobile.js`。
- `cascade.css` 花括号/圆括号配平（计数 802/802、1024/1024）。
- 四组 symlink 与 `overview.js` 均已删除；除“清理/防御”语境外没有残留旧变体引用。
- 中文 PO 校验：`zh_Hans` 的 `msgid`/`msgstr` 一一对应（82/82）；全部壁纸/登录/设置文案均有中文；旧 `overview.js` 源码引用已改指 `overview-mobile.js`。
- 壁纸链路保持完整：UCI 配置、`admin/system/mintwallpaper` 菜单、`.acl`、`mz-wallpaper-fetch.sh`、`luci.mint.wallpaper` 后端均未被本次变体清理影响。

---

## 六、后续建议（非阻塞）

1. **真机/Playwright 像素回归**：1440 / 1024 / 768 / 640 / 390 五档宽度，重点看保存并应用下拉、首页端口/网络/无线、网络-接口手机横排卡、DHCP 表堆叠。
2. **彻底合并网格权威段落**：把历史 `grid-override legacy` 块删除，只保留文件尾部权威规则，降低“回合制回归”风险。
3. **DHCP / UPnP 原生表格移动端**：目前仍走 LuCI 原生 `.cbi-section` 表格；若要与自建表格统一，建议下一轮单独处理。
4. **PO 注释重新生成**：`theme.po` / `zh_Hans.po` 中旧 `overview.js` 行号注释是历史残留，不影响翻译功能；下次 `po2lmo` 由源码重新生成即可。
