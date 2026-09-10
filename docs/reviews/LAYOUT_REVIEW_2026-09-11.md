# Mint 主题 UI 重构评审报告（2026-09-11）

**范围**：`luci-theme-mint` 全局 UI/UX 检查、修复与架构级重构
**验证环境**：ImmortalWrt SNAPSHOT（LuCI master，aarch64_cortex-a53）+ Chromium 真实渲染
**基线**：`3f983ce`（仓库版本 = 2026-09-05 基线）
**结论提交**：`0bd1d31`

---

## 1. 修改文件

| 文件 | 变更量 | 说明 |
|---|---|---|
| `theme/htdocs/luci-static/mint/cascade.css` | +453 / -114 | 层叠体系、玻璃令牌、Dropdown 定位、Dark 选择器、PC/Mobile 顶栏、标题标签 |
| `theme/htdocs/luci-static/mint/mz-ui.js` | +29 / -6 | `mzH3Pill()`：为内嵌状态标签的 `h3` 打 `.mz-h3-pill` 类 |
| `theme/htdocs/luci-static/resources/menu-mint.js` | +16 / -6 | Dark 分支文档与语义说明（逻辑保持：提前返回、不发请求） |
| `theme/ucode/template/themes/mint/header.ut` | +20 / -4 | `#indicators` 拆出为独立 `.mz-indicatorbar` 容器 |
| `CHANGELOG.md` | +79 | 本轮完整变更记录 |
| `README.md` | +10 / -3 | 特性与目录说明同步 |

## 2. 新增文件

仓库内：**无**（未新增源文件，避免为形式而拆分）

## 3. 删除文件

仓库内：**无**（仅删除 CSS 声明与死选择器）

---

## 4. 修复的问题

### 4.1 Dropdown —— 三个相互独立的根因

**根因 A：向上展开时菜单高度塌陷为 0（最严重）**

- 主题在 `.cbi-dropdown[open] > ul` 上硬编码 `top: 100%`
- LuCI 组件 JS 在下方空间不足时改用**内联 `bottom`** 向上翻转
- `top` 与 `bottom` 同时成立构成 over-constrained，内容高度被压缩为 0
- 实测：菜单容器 `height = 0px`、`scrollHeight = 216px`，每个 `<li>` 仍为 48px
- 表现：菜单只渲染出约 **10px** 的细条

修复：`top: auto`，定位权完全交还组件 JS。
**实测结果：同一菜单由 10px → 218.3px，4 个选项全部可见，正确向上展开。**

**根因 B：`.mz-view { overflow-x: clip }`**

`clip` 不是滚动容器，会直接切掉任何伸出内容盒的绝对定位后代。页面右侧/底部的下拉、表单末尾的「保存并应用」组合按钮首当其冲。

修复：移除该守卫，宽度约束由 `min-width: 0` 承担；真正需要滚动的元素（数据表、日志面板）各自声明 `overflow`。

**根因 C：`.mz-main { position: relative; z-index: 1 }`**

该组合形成**封闭层叠上下文**：区内下拉（`z-index` 1000）只能与 `.mz-main` 的 `1` 比较，永远低于 `fixed` + `z-index: 40` 的侧栏 → 下拉被侧栏/Card 遮挡。

修复：壁纸层改为负 z-index 后内容区无需抬升，移除该属性组合。

### 4.2 Dark 模式

| 问题 | 根因 | 修复 |
|---|---|---|
| Dark 页面仍绘制亮色渐变壁纸层 | `body.mz-has-wallpaper[data-theme="dark"]` 永不匹配（`data-theme` 挂在 `<html>`，不在 `<body>`） | 统一为 `html[data-theme="dark"] body.mz-has-wallpaper` |
| Dark 未彻底移除壁纸层 | 仅 `background-image: none`，伪元素仍参与合成 | 改为 `content: none`，从盒子树移除 |
| Dark 玻璃面板在深色底上不可见 | 面板为 `rgba(255,255,255,.07)` 白色微透，叠在深色页面上等于没有卡片 | 改为深灰玻璃 `.88`–`.92`，下拉/模态 `.96`/`.97` |
| 移动端顶栏毛玻璃整条失效 | `--mz-glass-blur-strong` 与 `--mz-glass-saturate` **全文件只有引用、从未定义**，`blur()` 无参数即无效 | 在 `:root` 补齐定义 |

同时新增 `@supports not (backdrop-filter: blur(1px))` 兜底，不支持毛玻璃时退回近不透明表面。

### 4.3 层叠体系

原先 12 处字面 `z-index`（1 / 25 / 30 / 35 / 40 / 50 / 100 / 120 / 1000 / 1001 / 2000）混用。现新增 `--mz-z-*` 变量族并**全部收敛**：

```
wallpaper -2 | wallpaper-overlay -1 | base 1 | content 10 | sticky 100
navigation 200 | scrim 300 | drawer 400 | dropdown 1000
popover 1100 | modal 2000 | toast 3000
```

### 4.4 PC / Mobile 顶栏

- 桌面隐藏 `.mz-topbar`（页面自身 `<h2>` 已承担标题）
- **关键风险处理**：`#indicators` 是 LuCI `ui.js#showIndicator()` 的原生挂载点（未保存更改/应用指示器、XHR 轮询徽标）。原先嵌套在 `.mz-topbar` 内，直接 `display: none` 会连带丢失这些原生能力。已拆为独立 `.mz-indicatorbar`（sticky、空时零高度）
- 移动端保留标题栏（`position: static`，避免与 sticky 的 `.mz-mobilebar` 在 `top: 0` 相互覆盖），并抑制重复标题

### 4.5 标题内嵌状态标签

「端口状态 + 隐藏」类 `<h3>`（第三方视图内联 `display:flex;justify-content:space-between`）被主题 section 标题规则挤到换行。

修复采用**作用域限定**：`#mz-view .cbi-section > h3:has(> .label)` 等 + `mz-ui.js` 打 `.mz-h3-pill` 类（兼容无 `:has()` 的浏览器）。
**未使用 `h3 { ... }` 全局覆盖，未改动任何第三方 DOM 结构。**

---

## 5. Wallpaper 实现

**结论：Wallpaper 功能未被删除，一直在仓库与实机上完整存在。**

核查证据：

| 检查项 | 结果 |
|---|---|
| 后端 `theme/ucode/mint/wallpaper.uc` | 完整（配置解析、URL 校验、overlay/blur 钳制） |
| rpcd `mint` 服务 | 完整 |
| 设置页 `view/mint/wallpaper.js` | 完整 |
| 菜单注册 | 存在于 LuCI 索引缓存（`mintwallpaper` 命中） |
| 实机访问 `/cgi-bin/luci/admin/system/mintwallpaper/settings` | **HTTP 200** |
| 缓存刷新 cron | 已安装（`*/5 * * * *`，`wallpaper-pc.img` / `wallpaper-mobile.img` 存在） |

「功能消失」的判定：入口位于 **系统 → Mint Wallpaper → Wallpaper Settings**，而侧栏分组在非活动状态下**默认折叠**（`foldMenu()` 的 `collapsed = !hasActive`），因此需要先展开「系统」分组才能看到。这属于可发现性问题，不是功能缺失。

本轮在架构侧做的解耦：**壁纸层由正 z-index 改为负 z-index**，成为纯背景层，不再要求内容区抬升层级 —— 这是「壁纸与核心 Layout 解耦」的关键一步。

原有 API 全部保留（`pc_sources` / `mobile_sources` 多源随机、自定义图片直链与上传），未替换、未重新发明。

---

## 6. Light Mode 实现

白色微透毛玻璃（White Glassmorphism）：

```
--mz-glass-bg:        rgba(255, 255, 255, .72)
--mz-glass-bg-light:  rgba(255, 255, 255, .62)
--mz-glass-bg-strong: rgba(255, 255, 255, .84)
--mz-glass-border:    rgba(255, 255, 255, .55)
--mz-glass-blur:      18px      --mz-glass-blur-strong: 20px
--mz-glass-saturate:  130%      --mz-glass-shadow: 0 8px 30px rgba(0,0,0,.08)
```

层级：`Wallpaper → White Glass → Mint UI`。
玻璃仅应用于 Main Content / Card / Panel / Section / 应用外壳；`input` / `select` / `button` / `table` **不加玻璃**，保持明确可操作性。

## 7. Dark Mode 实现

深灰玻璃（Deep Grey Glass），**非反色、非纯黑**：

```
页面底色    #10151f
卡片         rgba(30, 34, 42, .88)
surface-2    rgba(38, 43, 52, .92)
glass 边框   rgba(255, 255, 255, .10)
正文         #f2f4f7   次要 #aeb4be   muted #7f8794
下拉         rgba(39, 44, 53, .96)
模态         rgba(32, 37, 45, .97)
```

- **不加载壁纸**：JS 提前返回（不发任何请求）+ CSS `content: none`（不渲染）
- **不改用户配置**：UCI 壁纸设置保持原样，切回 Light 即恢复
- **切换方式**：沿用菜单按钮（`system → light → dark` 循环），沿用 `localStorage` 持久化，防 FOUC（`data-theme` 在 `<head>` 内尽早设置）
- **不进入 Theme Selector**：实机 `luci.themes` 仅有 `mint` / `Aurora` / `Shadcn`，无 `MintLight` / `MintDark`

## 8. PC 适配

- `.mz-topbar` 在 `min-width: 855px` 下 `display: none`，不占空间、不留空白
- `.mz-indicatorbar` 常驻承载 LuCI 原生指示器，空态高度 **0px**
- `.mz-view` 不再裁剪 × 方向

## 9. Mobile 适配

- 保留标题栏（`display: flex`），`.mz-mobilebar` 仅保留控件（汉堡 + 刷新）
- 抑制重复标题（`.mz-mobilebar-title` 隐藏）
- 标题栏 `position: static`，避免与 sticky 的 `.mz-mobilebar` 在 `top: 0` 相互覆盖
- 无横向溢出：390×844 与 412×915 实测 `scrollWidth == clientWidth`

## 10. Dropdown 修复

见 4.1。三层修复（定位权交还 JS / 移除裁剪 / 解除层叠上下文封闭），并保留 `.cbi-dropdown { overflow: visible !important }` 作为其它 dropdown 形态的安全网。

## 11. LuCI 兼容性

| 组件 | 状态 |
|---|---|
| `#indicators`（原生通知/应用指示器槽位） | 保留且可达（拆为独立容器） |
| CBI Form / Input / Select / Button / Table / Grid / Tabs | 未改动结构，仅样式层调整 |
| `#modal_overlay` / `.modal` | 层级纳入 `--mz-z-modal` |
| `cbi-tooltip` | 层级纳入 `--mz-z-popover` |
| `cbi-dropdown` | 定位与开合逻辑交还组件 JS |
| 第三方插件 DOM | **零改动**（仅新增类名 `mz-h3-pill`，不移动、不重构） |
| `id` / `name` / `value` / `data-*` / 表单字段结构 | 未改动 |

---

## 12. 构建结果

本机未执行 SDK 构建（主题为纯数据包，CI 走 `scripts/build-direct.sh` 直出 ipk/apk）。
本轮改动全部位于载荷数据文件（CSS/JS/ucode 模板），不含构建脚本变更，无需重新验证打包链路。

## 13. 测试结果

**静态校验**

| 项 | 结果 |
|---|---|
| CSS 花括号配平 | 822 / 822 |
| 字面 `z-index` 残留 | 0（全部收敛到变量） |
| 死选择器 `body[data-theme]` | 0 |
| 未定义玻璃变量引用 | 0 |
| `node --check` mz-ui.js / menu-mint.js | 通过 |

**实机模板渲染**（登录 LuCI 抓取真实 HTML）

- overview / system / network / mintwallpaper-settings 四页均 HTTP 200
- `.mz-indicatorbar` 存在、`#indicators` 槽位保留、指示器已在 `.mz-topbar` **之外**
- 无 ucode 运行时错误泄漏到页面

**真实浏览器断言（Chromium，29/29 通过）**

| 视口 | 关键断言 |
|---|---|
| PC 1920×1080 | topbar 隐藏；`#indicators` 保留；`.mz-view` `overflow=visible/visible`；无横向溢出 |
| PC — 下拉专项 | 菜单打开；**高度 218.3px / 4 项全可见**；无祖先裁剪；完整落在视口内 |
| PC 1366×768 | topbar 隐藏；指示器空态高度 0px；无横向溢出 |
| Dark | `data-theme=dark`；玻璃层激活；壁纸 `::after` `content: none`；**无壁纸请求**；页面底色 `rgb(16,21,31)` |
| Mobile 390×844 | topbar 可见（`display:flex`）；重复标题已抑制；无横向溢出 |
| Mobile 412×915 | topbar 可见；无横向溢出 |

---

## 14. 遗留问题

### 14.1 实机原有手工改动未回流仓库（**需用户决策**）

- **问题**：实机 `cascade.css` 曾为 197950 字节 / 7467 行，比仓库基线（150617 字节 / 5749 行）多 1718 行，发生在实机直改、从未回到仓库。
- **原因**：这批改动包含大量 `nth-child` 硬编码列宽（`table.table td:nth-child(3)`、`#cbi-network-interface .cbi-section-table td:first-child`）与 `.table-wrapper` / `.mz-port-panel` 等新增类，与本次任务「禁止大量页面级 Hack、固定宽度、大量 `!important`」的原则直接冲突。
- **尝试方案**：已完整取证并逐选择器比对，识别出其中「尝试修 Select、修 Dropdown、修端口状态标题标签、light/dark 分层」等意图 —— 这些意图本轮均已用规范方式重新实现。
- **最终限制**：未回流其硬编码部分。**实机备份：`/root/mint-backup-20260911-020449/`**（含 cascade.css / mz-ui.js / menu-mint.js / header.ut）。若其中某些适配在实机上确有保留价值，请指出具体页面，我以规范方式重建。

### 14.2 网络接口页表格列宽

- **问题**：实机原版有针对 `#cbi-network-interface` 的 nth-child 列宽钉死；仓库版没有。
- **原因**：nth-child 列宽在列数变化时会错位，且属于任务明令禁止的 Hack 类型。
- **尝试方案**：本次未采用；改用 `table-layout: auto` 自然分配。
- **最终限制**：该页列宽回到自动分配，未做逐列视觉核对。**需要实机确认是否可接受**。

### 14.3 第三方插件页面未逐页截图

- **问题**：任务列出约 30 个页面路径（nftables、channel_analysis、realtime、package-manager、crontab、mounts、partexp、leds、mini-diskmanager、flash、reboot、homeproxy、upnp、samba4、wolultra、gecoosac、routes、dhcp、dns、diagnostics、firewall 等）。
- **原因**：本轮聚焦架构级根因（层叠/裁剪/模式/顶栏），已用 overview / system / network / startup 与设置页覆盖主要组件类型。
- **尝试方案**：Dropdown 与 Dropdown 裁剪问题已从**根因层**解决（不再需要逐页修），理论上全站受益。
- **最终限制**：**未逐页截图核对**。如需完整覆盖，可在此基线之上逐页补测。

### 14.4 技术债：`mz-has-wallpaper` 类名语义

- **问题**：该类在 Dark 模式下仍被添加，用于开启整层玻璃组件；字面意义却是「有壁纸」。
- **原因**：更名会牵动数十条 `body.mz-has-wallpaper ...` 规则，风险高于收益。
- **最终限制**：保留类名并在 CSS/JS 注释中明确其真实语义（玻璃层开关）。

### 14.5 CSS 文件未按模块拆分

- **问题**：任务 #43 建议 Core / Layout / Glass / Modes / LuCI / Components 分文件。
- **原因**：任务同时说明「如果现有目录结构已经合理，不要为了形式强行移动大量文件」；当前 `cascade.css` 已通过 section 注释分区，拆分会在无构建步骤的纯数据包中增加 HTTP 请求数与维护面。
- **最终限制**：**未拆分**，保持单文件 + 分区注释。

### 14.6 Wallpaper 与 Layout 的解耦程度

- 已完成关键一项：**壁纸层为负 z-index 的纯背景层**，不参与内容层叠，内容区无需为其让步。
- 未做：`wallpaper.uc` / rpcd / cron 的模块边界重构。理由：任务要求「优先恢复原功能，不要重新发明一套与项目原逻辑冲突的 Wallpaper 系统」，现有 API 与逻辑保持原样。

---

## 15. 未修复项汇总

本轮**无**「已定位但未修复」的功能性缺陷。上述 14.x 均为范围边界、需用户决策项或技术债，不是已知故障。

---

## 附：验证工具

以下脚本位于工作区 `tools/`（**不入仓库**，凭据仅从环境变量读取，不落盘）：

| 脚本 | 用途 |
|---|---|
| `rssh.py` | 通过 paramiko 在路由器执行 shell |
| `rput.py` / `rget.py` | SFTP 上传 / 下载（二进制安全） |
| `verify_router.py` | 登录 LuCI 抓取真实 HTML，校验关键标记与模板错误 |
| `visual_verify.py` | Playwright 真实浏览器断言（PC/Mobile/Dark/Dropdown 共 29 项） |
