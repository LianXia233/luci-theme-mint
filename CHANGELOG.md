# 更新日志

本文档记录 **luci-theme-mint** 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

---

## [1.3.0] - 2026-09-13

### Added（四态角色背景系统：PC / Mobile × Light / Dark）

**默认背景换了。** 过去每页的底色是一张 CSS 渐变；现在是一套**四态独立**的角色背景层，视觉语言取自参考站（对角 wedge + 三角网格 + 角色立绘，内容压在单层毛玻璃之上）。

- 新增 `css/background.css`（第 13 层，紧随 `wallpaper.css`）与独立背景层 `.mint-background`：`position:fixed; inset:0; z-index:-2; pointer-events:none; overflow:clip`。负 z-index + 固定定位 + 不接收指针事件，因此**不参与文档流、不能被光标的命中测试选中**，任何页面、表格、表单、下拉都不会因它位移或错乱；`overflow:clip` 保证超尺寸立绘永远到不了文档盒，这是移动端横向滚动条为 0 的根因保障
- 四态各自一张图，**没有一态是另一态的滤镜副本**：
  | 设备 \ 模式 | Light | Dark |
  | --- | --- | --- |
  | PC | `character-pc-light.webp`（Arona，1000×1000） | `character-pc-dark.webp`（Plana，1000×1000） |
  | Mobile | `character-mobile-light.webp`（Arona 竖版 840×1120） | `character-mobile-dark.webp`（Plana 竖版 840×1120） |
- Mobile 是**独立的 3:4 竖版构图**（角色底部锚定、重新取景放大），不是把 PC 方图缩放；规则整段写在 `@media (max-width:854px)` 内，**手机只下载两张移动图、桌面只下载两张 PC 图**，规则不匹配的图片浏览器根本不会请求
- 明暗选择是**纯 CSS**：设备由 media query 决定，模式由 `<html data-theme>` 决定，JS 完全不参与——首帧即正确。切换沿用侧栏既有按钮，只翻转 `data-theme`，两个立绘图层（`.mint-bg-character-light/-dark`）以 `opacity` 交叉淡入（同规则集引用两张图 → 均已解码，切换**零请求、零解码、不闪白**）
- 配套两张三角网格底纹（`triangle-grid-light/dark.webp`，1440×810 平铺）；暗色网格是**离线预 invert + 0.3 不透明度**的成品图，运行时不再使用任何 `filter`
- 参考站配色移植：亮色 `#f6fbfd` 底 + `linear-gradient(150deg,#e4f5fa,#f1faff,#e0f4fc)` wedge；暗色 `#102433` 底 + `#15394c→#123247→#194054` wedge。侧向/纵向 scrim 由图层自身 `::after` 绘制（伪元素层级高于子元素），文字对比度亮暗两态均 ≥ 7:1
- **登录页角色背景（Plana）**：登录页是单屏单一身份，不套用后台四态，而是由 `sysauth.ut` 自己注入 `.mint-background.mz-login-char`，内含**一个**立绘节点（Plana），亮暗两态同一角色；桌面右锚 `contain`，手机（≤854px）底部锚定 `cover` 全幅。复用后台的 wedge / 三角网格 / 手机重新取景，差异只在 `login.css`：立绘、配色与 veil
- 登录页基线由图层**自己**绘制（`background-image` = 参考站渐变），因此图层完全不透明——下方任何东西都透不过来（这是"随机壁纸缓存透出"的根治手段之一）
- 新增 `data-wp-random` 状态：`header.ut` 把 `mint.wallpaper.ui_random` 的答案写在 `<html data-wp-random="0|1">` 上，让**样式表**（随 `MINT_ASSET_REV` 走）对"能不能画随机照片"有最终裁定权，见下方 Fixed
- 新增 `scripts/verify-cache-conflict.py`：回归测试"缓存里的旧构建不能把随机壁纸带上登录页"，含旧构建行为模拟
- 宽屏（≥1700px / ≥2100px）给容器让出右侧 260/320px 角色通道，容器左锚，形成参考站的「内容在左、立绘在右」构图；只改宽度，不动 `--mz-container-pad`、圆角与全出血动作条契约
- 角色背景激活时 `.mz-view`（唯一页面容器）从 0.78/0.84 降到 **0.70/0.74**，让立绘可见而正文仍清晰；只改 `--mz-container-background`，侧栏/顶栏/下拉继续用 `--mz-panel-bg*`，导航与菜单可读性完全不变
- 新增 `scripts/verify-background.py`：Playwright 四态矩阵（PC 1366/1920/2560 + Mobile 360/390/412，× 明暗两态）校验解析到的图片名、横向溢出、图层几何、明暗图层 opacity 互换，再做 9 个后台页面扫描与 6 个资源可用性断言；登录页检查在**独立的未登录上下文**中执行（在已登录页面上访问 `/cgi-bin/luci/` 只会被重定向到概览页，那是上一版脚本误报"登录页发射角色层"的原因）

### Changed

- **登录页壁纸默认关闭**：`sysauth.js` 删除随机源打乱与时间戳逻辑，只有 `mode==='custom'`（用户显式配置的图片或直链）才绘制壁纸，未配置时由登录页自己的角色背景层（Plana，见 Added）顶替。登录页是 `blank_page`，`header.ut` 那套后台四态层不会被注入，登录页用的是 `sysauth.ut` 独立注入的单角色层，因此**不会继承后台的四态立绘**
- **旧后台随机壁纸默认关闭**：`menu-mint.js` 的随机壁纸分支改为 `if (cfg.ui_random !== true) return;`（此前为默认开），每页重新拉取远程随机图的行为不再发生；服务端 `wallpaper-<kind>.img` 本地缓存不受影响
- **自定义壁纸优先于角色背景**：用户配了壁纸就加 `body.mz-wp-custom`，角色层 `display:none` 直接不合成（图片已被壁纸盖住，没必要留一层合成开销），容器透明度也恢复原值（照片亮度未知，不做减免）。上传 / 切换 / 删除 / 强制刷新链路完全保留
- `menu-mint.js` 新增共享的 `applyPhotoWallpaper(urls, cacheKey)`（预加载 → 解码 → 绘制 → `mz-wp-custom` 切换，含 5 分钟 sessionStorage 复用）；`syncWallpaperTheme()` 改为直接重跑 `initGlobalWallpaper()`；暗色态清空 `--mz-wallpaper*` 并摘掉 `mz-wp-custom`，回到角色背景
- **`mz-char-bg` 与角色层共用现有唯一开关**：`header.ut` 只在 `!blank_page && wp.enabled != '0' && wallpaper.enabled != false` 时注入，不新增任何选择器、不动明暗入口、主题名仍是 Mint
- 缓存戳 `MINT_ASSET_REV` `20260913b` → `20260913e`（header.ut / footer.ut / cascade.css 全部 `@import` 同步）；`<meta name="mz-asset-rev">` 成为 JS 侧唯一真源
- 移除 `body::after` 在角色背景下的渐变回退（`background-image: var(--mz-wallpaper, none)`），否则该渐变会整片盖住立绘；无图页面的渐变态由角色层自己提供

### Fixed

- **主题自身 JS 一直没有主题级缓存戳（根因）**：`menu-mint.js` 与 `resources/view/mint/sysauth.js` 经 LuCI 的 `L.require()` 加载，而 LuCI 用**它自己的构建串**（`luci.js` 标签上的 `?v=26.246.30574~…`）给这些模块打版本——主题升级时这个 key 根本不变，于是浏览器可以继续跑上一版主题的 JS。这正是"手机端登录页 Plana 与随机壁纸缓存冲突"的成因：旧版 `sysauth.js` 仍会把 cron 缓存的随机图（`/luci-static/mint/wallpaper-mobile.img`）画到登录页，而新的角色层基线是透明的，随机照片就顺着 wedge / 网格 / 立绘的透明区域透出来，形成双重背景。修复分三层：
  1. **标记层**：`header.ut` 输出 `<meta name="mz-asset-rev" content="<MINT_ASSET_REV>">`，成为 JS 侧的唯一真源
  2. **加载层**：`footer.ut` 与 `sysauth.ut` 在首个主题 require 之前把该值写进 `L.env.resource_version`（LuCI 的 `require()` 读的正是 `L.env` 这个对象），此后加载的每个主题模块都带 `?v=<MINT_ASSET_REV>`。登录页是 `blank_page`，`footer.ut` 的版本脚本不输出，所以 `sysauth.ut` 里同样补了一份
  3. **样式表兜底**：`wallpaper.css` 用 `html[data-wp-random="0"] body.mz-has-wallpaper:not(.mz-wp-custom)::after/::before { content: none }` 把随机照片的伪元素直接移出盒树——即使浏览器仍在跑旧 JS，样式表（带主题缓存戳）也有最终裁定权。`:not(.mz-wp-custom)` 保证用户**显式**选择的壁纸不受影响
- **登录页照片层默认移出盒树**：`.mz-login-bg` 在无 `mz-wp-custom` 时 `display: none`。登录页只有"角色背景"与"显式壁纸"两种状态，不再存在"随机缓存照片"这第三种
- **登录页清理随机壁纸的会话缓存**：`sysauth.js` 进入时调用 `mzWpUtil.dropSessionCache()`，把 5 分钟随机 URL 槽位清掉，避免同一标签页里后续打开的后台页面复用它
- 暗色模式下壁纸层被 `content:none` 整体关掉、页面只剩纯色底的问题：角色背景在暗色下有独立立绘与配色，不再是「深色什么都看不见」
- 登录页此前会按设备类型拉取远程随机图（含 UA 检测与多源轮询），现默认不再发生

### Fixed（同日晚些：手机操作栏 + 桌面留白）

- **手机端「保存并应用」拆分按钮漏出第二个选项**：`compat.css` 中 `@media (max-width: 768px)` 内的一条 `.cbi-page-actions .cbi-dropdown.cbi-button > ul > li { display: flex }` 与关闭态所有者 `.cbi-dropdown:not([open]) > ul > li:not([selected])` **特异性完全相同（0,3,2）**，而它位于文件更靠后约 300 行、且包在只有手机命中的媒体查询里 —— 源序取胜，于是「强制应用」被一起画进了关闭态按钮，形成「保存并应用 强制应用 ⋯ ▾」的怪样子。桌面端因为媒体查询不命中而一直正常，这正是缺陷表现为「只有手机异常」的原因。修法：删除那条 `display: flex`（它原本想管的 height / line-height 早已被后面带 `!important` 的块覆盖，是纯冗余），显示权归关闭态规则独占
- **`⋯` 溢出指示器无条件绘制**：`#mz-view .cbi-dropdown.cbi-button > .more { display: inline-flex }`（以及通用版 `.cbi-dropdown > .more`）让它永远可见，但 `ui.js UIDropdown.bind()` 只在 `ndisplay < 0` 时才写 `more` 属性；ComboButton 永远非 multiple，实际结果恒为 `removeAttribute('more')` —— 属性没有、`⋯` 却常驻，还白占 26px 按钮宽度。现与 upstream bootstrap 同构：默认 `display: none`，只有 `.cbi-dropdown[multiple][more] > .more` 与 `[multiple][empty] > .more` 才显示
- **拆分按钮高度链「四个盒子四个高度」**：wrapper 38px、caption `<ul>` 36px、caption `<li>` 32px、`▾` 36px，文字因此在自己的胶囊里偏 1~3px，手机上更明显（38px 胶囊套 32px 文字盒）。新增 compat.css 末尾的 "Combo buttons: ONE height for the whole chain" 块，用 (1,3,1) + `!important` 且置于文件最末的统一权威接管整链：桌面 36px、≤768px 34px；`> ul` 一律带 `:not(.dropdown)`，避免把打开后的浮层菜单也钉死。实测手机按钮宽 256→126px、操作栏高 109→59px（由两行收为一行）
- **桌面「菜单栏与内容之间留白太多」的根因：一条残留 ID 规则压掉了整个令牌系统**。`compat.css` 的旧块 `#mz-view { max-width: 1280px; margin: 0 auto; padding: 24px 28px }` 是 **ID 选择器**，击败 `.mz-view`（类），于是 `--mz-content-max`（1680px）被钳到 1280px、`--mz-container-pad`（22px）被换成 24/28px，且 `margin: 0 auto` 强制居中。实测 1920px 宽屏下侧栏与内容之间左右各 219px 空洞（2560px 下 539px），而且改 tokens 毫无反应 —— 与「tokens 单一真源」的架构直接矛盾。已删除该块，几何归还 layout.css / container.css；新增 container.css「1b. Desktop: anchor the container, never centre it」：≥855px 改为左锚（`margin-left: var(--mz-container-margin); margin-right: auto`），富余宽度全部留给右侧角色通道，不再劈成左右两个空洞。实测 1920/2560px 的留白由 219/539px 降到 13px
- 缓存戳 `MINT_ASSET_REV` `20260913e` → `20260913f`（header.ut / footer.ut / cascade.css 13 个 `@import` 同步）

---

## [1.2.0] - 2026-09-13

### Changed（单层视觉容器架构 + 导航 SVG 重绘 + 移动端导航优化）

**一、单层视觉容器（One Page / One Container）**

- `.mz-view` 成为每页**唯一**视觉容器：全站只有它允许绘制 background / border / radius / shadow，容器几何与外观全部由 `--mz-container-*` 令牌族定义（radius `14px 4px 22px 4px`、border、shadow、pad 22px、margin 18px、gap 22px、divider）
- 内部元素全量透明扁平化：`.cbi-map` / `.cbi-section` / `.cbi-section-node` / 表格 / fieldset / ifacebox / 旧 `.mz-*` 卡片等 30 余类选择器统一 `background:transparent; border:0; radius:0; shadow:none; backdrop-filter:none`，只保留布局、间距与排版职责——**禁止 Card 套 Card、多重边框/圆角/阴影/背景**
- `cards.css` 经 `git mv` 重命名为 `container.css` 并全量重写（容器 / 内部透明 / 节奏 / 标题 / 动作条 / 网格 / 指标块 / 空状态 / ifacebox）
- 壁纸模式的扁平化在 `wallpaper.css` 以 `body.mz-has-wallpaper .mz-view X`（特异性 0,3,1）权威重申，压过 compat.css 的 `body.mz-has-wallpaper .cbi-section`（0,2,1）旧规则
- 壁纸层级栈重排：壁纸（z -2）→ 遮罩+单次模糊（z -1，遮罩 0.55）→ 侧栏/移动条毛玻璃 → `.mz-view` 半透明填充（浅色 0.78 / 深色 0.88）。**容器自身禁用 backdrop-filter**：不创建层叠上下文（cbi-dropdown 浮层 z 1000 不再被侧栏 z 400 压住），且全页模糊只做一次（路由器性能预算）
- **Action Bar 独立功能层**：`.cbi-page-actions` 底部 sticky、以 `--mz-container-pad` 负 margin 全出血（对"禁止负 margin"的原则性豁免：全出血而非补偿 hack）、不做成完整卡片；移动端 640px 以下改单行排列（保存并应用 / 保存 / 重置同一行右对齐）
- 总览仪表盘（overview-dashboard.css）同步扁平化：gauge / stat / chart / sys 卡片透明化，删掉逐卡片玻璃叠加
- 侧栏收窄至 200px，内容区上限放宽至 1680px + 18px 外边距，桌面端合理铺满可用空间
- 断点瘦身：responsive.css 只允许改容器令牌，删除重复的 padding/背景声明；移动端表格改 hairline 分隔
- 新增 `scripts/container-check.py`（容器嵌套/层叠上下文/溢出静态检测）并全站 98 页跑通

**二、导航 SVG 重绘（一级菜单图标与折叠箭头）**

- 一级菜单图标 lucide 风格线性 SVG（stroke 1.75），按 LuCI 节点名映射（status/system/network/services/nas/control/vpn/modem/uci）+ 中文关键词兜底 + 六边形默认
- 折叠箭头改用内联 SVG（`M6 9l6 6 6-6`，14px）：`.mz-menu-caret` inline-flex 对齐、`margin-left:auto` 右贴齐、折叠态 rotate(-90deg)；实测 8/8 分组右对齐 12px、垂直居中、无旧三角残留
- `decorateMenuIcons` 重写为 [图标][标签][箭头] 三段结构，保留 caret 不被卷入 label span

**三、移动端导航与资源缓存**

- 854px 以下 Tab 条改横向滑动条：`nowrap + overflow-x auto + 触摸惯性滚动 + scroll-snap`，隐藏滚动条，44px 触摸目标，选中项 inset 高亮
- **静态资源缓存戳**：`MINT_ASSET_REV = '20260913'`（header.ut 常量，footer.ut 独立模板自带同步副本）；cascade.css 全部 12 个 @import、cascade/mz-ui/overview-dashboard css+js/mz-nftables 的引用 URL 均带 `?v=`，修复路由器长缓存头导致升级后浏览器残留旧样式的问题
- 新增 `scripts/audit-all.py` 全站巡检（逐页 HTTP/JS 错误/横向溢出/Tab 点击/cbi-dropdown 弹层矩形/sticky 动作条，浅色+深色+390px 三轮）

### Fixed

- PC 端一级菜单折叠箭头错位/双箭头（CSS 三角与 SVG 并存）：删除 compat 的 `::after` 三角（`content: none` 中和）
- 概览页 `<h2>状态</h2>` 标题恢复显示
- HomeProxy 等页面 16px 横向溢出消除
- 壁纸模式下容器透明度被 compat 旧规则压过导致的"隔层毛玻璃叠加"

---

## [1.1.0] - 2026-09-13

### Changed (2026-09-13 — UI 架构级重构：Glass & Layered 设计系统 + CSS 分层 + 壁纸缓存版本戳)

**一、CSS 分层架构（cascade.css 拆分）**

- `cascade.css`（6817 行单文件）整体迁移为 `css/compat.css`，作为 LuCI 原生兼容与第三方视图的兼容底座，**原有规则一条不删**，功能零回退
- 新 `cascade.css` 只声明 `@import` 加载顺序，新增 11 个职责单一的层：
  `tokens`（设计令牌）→ `base`（文档默认/排版/滚动条）→ `layout`（应用骨架）→ `navigation`（菜单/页签）→ `cards`（统一卡片）→ `components`（按钮/表单/表格/弹窗/徽章/提示）→ `wallpaper`（层级栈）→ `dark`（深色结构差异）→ `animations`（关键帧）→ `responsive`（断点）→ `login`（登录页）
- 令牌层后置加载：同一自定义属性由新层胜出，旧引用全部继续解析（compat 依赖的 70 个变量在 tokens 层全量定义，含 5 个历史缺口兜底）

**二、Glass & Layered 视觉语言（参考站设计语言移植）**

- 卡片统一不对称圆角 `14px 4px 22px 4px`、品牌色偏移阴影 `4px 5px`（hover 增强）、标题 2px 下边线 + 青色强调条
- 侧栏 / 移动条毛玻璃 `backdrop-filter: blur(18px) saturate(1.35)`，壁纸自下而上透出：壁纸(z -2) → 遮罩/模糊(z -1) → 玻璃 UI → 内容
- 动效统一为 `cubic-bezier(.22,.8,.25,1)` 一条曲线、页面入场 `mz-page-in`、卡片 `mz-reveal`，并支持 `prefers-reduced-motion`
- 菜单注入 lucide 风格线性图标（`decorateMenuIcons()`，纯装饰：不触碰 href、事件与折叠状态，失配时回退中性圆点）
- PC 端彻底移除 `.mz-topbar`（`display:none`），原生 `#indicators` 槽位保留在独立 `.mz-indicatorbar` 中不受影响；页面标题由视图自身 `<h2>` 承担（实机复核 Overview `<h2>状态</h2>` 正常渲染）

**三、壁纸客户端缓存版本戳（修复切换/上传/删除后旧图残留）**

- `mzWpUtil` 新增 `version / bumpVersion / stamp / dropSessionCache / apply`：设置页每次应用、上传、删除、强制刷新都递增 `localStorage mz-wp-ver`，全部壁纸 URL 追加 `_mzv` 参数——同 URL 换图、cron 重写缓存图、重复选择同一条目三种场景都不会再命中浏览器旧缓存
- 新图先 `new Image()` 预加载解码再写入 CSS 变量（`apply()`），绘制期间加 `mz-wp-swapping` 淡入，切换无闪烁；加载失败回退渐变背景而不是留下死 URL
- `menu-mint.js` 暴露全局 `window.mzWallpaperRefresh()`，壁纸设置页变更后无需刷新页面即可重解析后台壁纸；`handleDelete` 双设备清除合并为一次刷新
- 后端 `?v=<mtime>` 机制不变，正常 HTTP 缓存与 304 复用不受影响

**四、汉化补全**

- `footer.ut` 的 "Powered by" 改走 `_()` i18n，`theme.pot` 与 `zh_Hans` po 补充条目（译为「基于」）
- 壁纸设置页全部文案已确认走 `_()`；实机部署时同步上传编译后的 `luci-i18n-*-zh-cn.lmo` 后页面全中文（壁纸库/上传/强制刷新/高级设置等）

**五、实机验证（ImmortalWrt SNAPSHOT / H5000M）**

- 12 个页面渲染冒烟：11 个 HTTP 200 且无模板错误（`admin/system/opkg` 404 为该固件未安装 luci-app-opkg，与主题无关）
- 计算样式断言：主色 `#0fb5a5`、卡片圆角 `14px/22px`、偏移阴影、侧栏 blur(18px)、菜单图标 9/9、`--mz-wallpaper` 正确注入均生效
- 视口 375 / 390 / 412px 无横向滚动（scrollWidth == clientWidth）
- 壁纸交互实测：应用库壁纸 → 版本戳递增且立即生效 → 强制刷新缓存 → 跨导航保持，全程无 JS pageerror
- 新增脚本：`normalize-lf.py`（全仓 LF 强制 + CSS 括号平衡检查）、`router-deploy.py` / `verify-render.py` / `visual-check.py` / `wp-interactive-test.py`（实机部署与验证工具链）

---

## [1.0.2] - 2026-09-11

### Fixed (2026-09-11 — 保存并应用泄漏未选中项、diagnostics 行布局、手机卡片对齐)

**一、「保存并应用」关闭态泄漏「强制应用」**
- 根因：上一轮的 combo 内框规则给按钮 caption 的**每一个** li 都写了
  `display: flex`，其 ID 特异性压过了关闭态的
  `.cbi-dropdown:not([open]) > ul > li:not([selected]) { display: none }`，
  于是未选中的「强制应用」也被渲染出来
- 修复：该规则不再声明 display（可见性完全交还既有显隐规则）

**二、diagnostics 三个工具行排版混乱（手机端最明显）**
- 根因：LuCI 把 `.diag-action` 留成裸 `display: inline` 容器 —— 桌面宽屏只是
  松散，390px 手机上三个工具的输入框/按钮组流式挤成一团
  （实测三行 x=40/40/227、宽 177/219/105）
- 修复：`.diag-action` 改为 flex 换行布局（gap 8px）；输入框独占一行、
  按钮组（模式选择 + ··· + ▾）下一行右齐。实测三行均为 x=40 / w=310 / h=38

**三、手机端概览卡片未对齐**
- 根因：section 标题的「贴边出血」设计（左右负 margin 粘住卡片边缘）假设
  section padding 等于 --mz-spacing-lg；手机端 padding 不同，导致标题栏比
  section 宽 ~26px、内容又缩进 9px —— 同屏三种左边缘
  （实测修复前 title x=15/w=360、sec x=28/w=334、内容 x=37/w=316）
- 修复：≤854px 时取消负 margin，标题恢复为普通圆角条
  （实测 title 与内容均为 x=37 / w=316，完全对齐）
### Changed (2026-09-11 — 手机端概览与 PC 统一为完整仪表盘)

- 根因：概览页此前是双渲染器 —— 手机加载 overview-mobile.js（紧凑面板），
  该渲染器从未包含 PC 仪表盘的环形仪表 / 图表 / 上行接口 / 地址 / 实时吞吐
  卡片，即「手机页面这些卡片未显示」的报告
- 修复：footer.ut 统一加载 overview-dashboard.js；其 CSS 本就带
  1199px / 767px / 420px 三档断点（2 列与 1 列网格），布局按视口自动重排
- 手机排版优化：图表标题独占一行、实时值右对齐到下一行（消除「钟）」孤字
  换行）；仪表网格间距收紧；图表容器 min-width: 0
- overview-mobile.js 保留在包内但不再被启动

**验证（实证）**：Playwright 手机视口 390×844 实测 —— 4 个环形仪表 +
负载 / 运行时间 / 连接 / 上行接口 / 地址 / 实时吞吐 + 3 个图表全部渲染，
无横向溢出（scrollWidth == clientWidth == 390）
### Fixed (2026-09-11 — 组合按钮菜单异常 + 浏览器图标替换 + 移除轮询指示器)

**一、组合按钮下拉异常（保存并应用 / diagnostics 工具选择器）**
- 根因 1：combo wrapper 是 `box-sizing: content-box`，内部 ul/li/.open 各自带
  min-height 34px + padding，叠加成 50px 高的按钮；`···` 指示只有 13px 高，
  与 34px 的 `▾` 并排 —— 即截图里两个破碎小方块的样子。且旧修复只作用于
  `.cbi-page-actions` 作用域，diagnostics 的下拉（在 .diag-action 里）没被覆盖
- 根因 2：`.cbi-dropdown.btn > ul` 规则同时命中了**展开态的 ul.dropdown**，
  把菜单也压成 36px —— 现已全部用 `:not(.dropdown)` 豁免
- 根因 3：combo 位于底部 sticky 操作栏内，下方空间恒为 ~40px，而 luci-base
  仍向下展开并写入 inline top/bottom，菜单落进/落到 sticky 栏之后不可点。
  用 `!important` 强制 combo 菜单**总是向上展开**（合法覆盖 inline 样式）
- 实测：firewall 选择 `0 -> 2`、diagnostics 选择 `ping -> ping6`，菜单均完整
  落在视口内

**二、浏览器标签页图标替换为像素猫娘 logo**
- 由 192x192 原图生成 favicon-48.png（LANCZOS 缩放）、favicon-180.png
  （apple-touch）与 favicon.svg（内嵌原图 base64，现代浏览器优先采用）

**三、移除轮询指示器**
- 隐藏 luci-base 挂载在 #indicators 里的
  `<span data-indicator="poll-status">`（此前显示为一个孤立的「刷新」文本块）。
  仅隐藏标签，XHR 轮询本身不受影响

### Fixed (2026-09-11 — 手机顶部空白、全站下拉无法选择、输入框边框不可见、按钮与裸表格排版)

**一、手机端顶部大片空白（手机专属）**
- 根因：上一轮把页面标题从 `.mz-mobilebar` 移到了 `.mz-mobilebar` 之外的
  `.mz-topbar`，于是手机同时存在两条头部 —— mobilebar 65px + topbar 57px =
  122px，其中一条几乎全空，正是截图里的空白带
- 实测：`#mz-view` 起始位置由 **149px 降到 92px**
- 修复：手机端移除 `.mz-mobilebar` 之外的 `.mz-topbar`，标题回归 mobilebar
  （它同时拥有 sticky 槽位与汉堡按钮）

**二、全站下拉"无法选择"（PC + 手机）—— 两个独立根因**

1. **`.cbi-section-node { overflow-x: auto }`**：这一条把每个 section 节点变成
   滚动容器，而 luci-base **按滚动容器**计算 dropdown 的可用空间，于是每个下拉
   打开时都被写成 inline `max-height: 0px`，菜单被压成 10px 细条，根本点不到。
   - 实测（修复前）：`max-height: 0px; height: 0px` 而 `scrollHeight: 200`
     （选项高度正常 48 / 58 / 78）→ 内容在，只是被压没了
   - 修复后：`max-height: 580px`、菜单高度 202px、点击 `2 -> 1` 生效
   - 窄屏表格滚动由既有的 `@media (max-width: 768px)` 规则承担，去掉它没有副作用

2. **毛玻璃的层叠副作用**：玻璃层给每张卡片加了 `backdrop-filter`，该属性会让
   **每张卡片各自成为层叠上下文**。于是靠前卡片内的下拉菜单（自身 z-index 1000）
   依然绘制在**靠后卡片**与 sticky 操作栏之下，点击落到邻居卡片的标题上
   - 修复：用 `:has()` 提升"当前承载已展开下拉的卡片"的层级

**三、下拉文本重复、按钮过高（PC + 手机）**
- LuCI 把每个选项拆成短标签 `.hide-open` 与长描述 `.hide-close`；主题只在
  **展开时**隐藏短标签，**从未在关闭时隐藏长描述** → 关闭态按钮渲染出完整描述
  （51px 高、选项文本重复）
- 另外 `.cbi-dropdown[open] > ul > li ...` 这类选择器会**同时命中菜单与按钮预览**，
  把按钮里的标题也一起清空了 —— 共 **11 条**规则已限定到 `ul.dropdown`
- 修复后：关闭态 43px 单行、标题为单个"硬件流量卸载"、展开时按钮仍保留标题

**四、所有文本输入框不明显（PC + 手机）**
- 根因：玻璃作用域把 `--mz-color-border` 覆盖成 `rgba(255,255,255,.55)`（近白），
  而 input / select / textarea / 表单下拉都用它做边框 → 浅色页面上边框不可见
- 修复：新增控件专用令牌 `--mz-input-bg / -input-border / -input-border-hover /
  -input-placeholder`（light 与 dark 各一套），与卡片边框彻底解耦

**五、按钮排版**
- 「保存并应用」组合按钮是 `box-sizing: content-box`，比旁边的 Save 高 2px
- 修复：操作栏内所有按钮统一 36px / border-box / 同一圆角；实测 apply 与 save
  均为 `36px / border-box`

**六、status/processes 与 status/channel_analysis 排版混乱**
- 这两页的表格**没有 `.cbi-section` 包裹**，因此从未获得卡片样式，是贴着背景的裸表格
- 修复：按 `body[data-page]` 为这些表格补卡片样式（圆角 14px / 1px 边框 / 表头 /
  行悬停），并限制进程命令列宽度避免其独占约 70% 的行宽

**验证（实证，非推断）**：Playwright **14/14** 通过（手机 390×844 + PC 1440×900），
断言覆盖上述每一项的具体数值（元素高度、max-height、边框色、box-sizing、表格圆角）


### Changed (2026-09-11 — 概览卡片视觉重构 + 菜单归位「系统」+ 独立壁纸翻译包 + 登录页汉化)

**一、概览页卡片视觉重构（纯 CSS，未改动任何插件 DOM）**

端口状态卡片：LuCI 为每个端口输出四个兄弟节点（端口名 / 图标+速率 / 3px 区域色条 /
流量读数）。主题用 `grid` + `order` 把它们重排为「静默标签 → 图标+速率主标题 →
流量页脚 → 底部 4px 强调色带」。
- 原先那根「粗灰色横条」其实是区域色条被 LuCI 的 `padding: 8px 10px` 与
  `rgba(--zone-color-rgb, .78)` 底色包成了 20px 高的块；现两处一并复位，
  颜色以卡片底部 4px 色带保留
- 端口名由居中的浅紫实底块改为左对齐的小号大写标签
- 图标放大到 26px、速率升至 1.02rem/650 作为卡片主标题
- 流量行加发丝分隔线，字号与行距收紧
- 卡片改用 `--mz-radius-lg` 圆角 + 玻璃底，hover 轻微上浮

网络/上游卡片：
- 标题栏由整块 `rgba(--zone-color-rgb, .78)` 灰底改为透明 + 左侧 4px 区域色胶囊
  （语义保留，观感与毛玻璃区块一致）
- 字段「标签: 值」行距与字号收敛，`<strong>` 标签降为次要色，让数值读起来是内容

**二、壁纸设置菜单归位「系统」分组**
- `admin/mint-wallpaper` → `admin/system/mint-wallpaper`，侧栏显示「Mint 壁纸」

**三、新增独立翻译包 `luci-i18n-mint-wallpaper-zh-cn`**
- `wallpaper/po/zh_Hans/luci-app-mint-wallpaper.po`（35 条），依赖
  `luci-app-mint-wallpaper`；发布产物由 6 个增至 8 个
- 只装壁纸包（不装主题翻译包）也能得到中文设置页

**四、修复：主题从未随包发布中文，登录页与后台全英文**
- 根因：实机 `/usr/lib/lua/luci/i18n/` 里没有任何 mint 的 lmo（主题为源码部署，
  `luci-i18n-mint-zh-cn` 包从未安装），所有 `_()` 回退到英文原文
- 现提供主题 lmo 与 `zh_cn` / `zh_CN` 别名符号链接（固件把 `luci.main.lang`
  写成下划线形式时同样命中）

**验证（实证，非推断）**
- 本地实跑 `build-direct.sh`：8 个包 + 8 份 buildinfo；`verify-package.sh` 与
  `install-test.sh` 全部通过
- 实机 7/7 断言通过：登录页显示中文（用户名 / 密码 / 登录 / 记住我）且无英文残留；
  菜单位于 `admin/system/mint-wallpaper` 且标题为「Mint 壁纸」；
  壁纸设置页全中文（壁纸 / 设置 / 启用 / 桌面端来源 / 移动端来源 / 遮罩不透明度）
- 检测口径说明：LuCI 会把菜单 JSON（含原始 msgid）内嵌在 `<script>` 中，
  因此本地化断言必须基于 `innerText` 而非原始 HTML，否则会误报未翻译

### Changed (2026-09-11 — 壁纸设置拆分为独立包 luci-app-mint-wallpaper)

按「主题只负责 UI」的方向，把壁纸设置从主题包中拆出为可独立安装的
`luci-app-mint-wallpaper`，并把入口从「系统」分组提升为侧栏独立顶级菜单。

- **新增包 `luci-app-mint-wallpaper`**（仓库 `wallpaper/` 目录）：壁纸设置页
  （`view/mint/wallpaper.js`）、rpcd 后端（`usr/libexec/rpcd/mint`）、服务端缓存
  刷新脚本与 cron、UCI 配置 `/etc/config/mint`（本包 conffile）、菜单与 ACL、
  `/lib/upgrade/keep.d` 上传图片保护
- **主题包精简为纯 UI**：`Depends` 由 `luci-base +curl` 收敛为 `luci-base`，
  且不再声明 `/etc/config/mint` 为 conffile（两个包不能拥有同一路径）
- **`ucode/mint/wallpaper.uc` 有意保留在主题包内**：header.ut 以**静态 import**
  引用该模块，把它拆走会让未安装壁纸包时的登录页模板直接加载失败。该模块只
  **读** UCI 并在渲染期解析壁纸地址；所有**写**的部分（设置页、rpcd save、
  默认值、cron）都在新包里
- **独立顶级菜单入口**：`admin/system/mintwallpaper` → `admin/mint-wallpaper`。
  侧栏直接可见，不再折叠在「系统」分组内；同时 settings 由第 4 层移到第 3 层，
  菜单渲染器（三层上限）现在能够正常列出该项
- **升级路径清理**：主题的 postinst（版本升级时唯一会执行的那个，postrm 在
  upgrade 分支提前返回）与 postrm 都会删除旧的
  `usr/share/luci/menu.d/luci-theme-mint.json` 与
  `usr/share/rpcd/acl.d/luci-theme-mint.json`，否则升级后会出现两个
  「Mint Wallpaper」入口
- **主题 postrm 不再删除用户数据**：`custom-*.jpg`（上传壁纸）、
  `wallpaper-*.img`（缓存图）与 cron 助手已归壁纸包所有，卸载主题不再触碰它们
- **CI 单次产出 6 个包**：新增 `luci-app-mint-wallpaper` 的 ipk/apk。
  `scripts/build-direct.sh` 参数化装配两套载荷并分别设置可执行位；
  `scripts/verify-package.sh` 按包名分派校验规则（主题禁止再依赖 curl、
  壁纸包必须有 curl 与 conffiles）
- **版本口径统一**：两个包都取仓库 HEAD 的提交时间与短哈希，避免同一 commit
  下两个包报出不同版本号
- **验证（实证，非推断）**：本地实跑 `build-direct.sh` 产出 6 个包 + 6 份
  buildinfo，`verify-package.sh` 全部通过（含可执行位、conffile、依赖断言）；
  实机部署后侧栏出现 `/cgi-bin/luci/admin/mint-wallpaper/settings` 独立入口、
  旧入口消失、设置页返回 HTTP 200，6/6 断言通过


### Fixed (2026-09-11 — 端口状态卡片排版、卡片玻璃统一、随机壁纸失效)

实机截图定位（ImmortalWrt SNAPSHOT 192.168.88.1，Chromium 实测取值）：

- **端口状态卡片挤成窄条、右侧大片空白**：网格轨道为
  `repeat(auto-fill, minmax(160px, 210px))`，且卡片被
  `max-width: 210px !important` 钉死。`auto-fill` 会按容器宽度创建
  **全部空轨道**（1182px 下为 5 个），路由器只有 2 个端口时后 3 个轨道
  留空，右侧因此出现约 560px 死区。改为
  `repeat(auto-fit, minmax(200px, 1fr))`（空轨道折叠 + 剩余轨道铺满）
  并移除卡片宽度上限。实测同一网格由 `210px 210px 210px 210px 210px`
  （仅前 2 列有内容）变为 `584px 584px`，两卡等宽铺满整行
- **状态卡片未使用全局毛玻璃**：端口卡片在 `--mz-color-surface-2`（浅色 +
  壁纸下解析为 0.84 白）上绘制，而同一屏的 section 为 0.72，视觉上读作
  实色方块而非毛玻璃。新增统一规则
  `body.mz-has-wallpaper #mz-view .ifacebox`（id + 2 class，特异性高于
  端口网格规则），卡片背景统一走 `--mz-panel-bg`，模糊/饱和改用
  `--mz-glass-*` 令牌。实测卡片与 section 均为
  `rgba(255,255,255,.72)` + `blur(18px) saturate(1.3)`
- **随机壁纸失效**：`initGlobalWallpaper()` 把 `ui_random` 与 `enabled`
  并列作为前置返回条件，而 `ui_random` 出厂默认 `0`。结果即使 cron 已经
  抓好服务端缓存图（`/luci-static/mint/wallpaper-pc.img` —— 本地文件、
  零外部请求、可 304 复用），也永远不会被应用，后台只剩渐变兜底。
  现改为：`ui_random` 只约束「每次导航是否重新随机拉取远程图」，
  服务端缓存图始终优先使用；既无缓存又未开启随机时才退回渐变。
  实测 `--mz-wallpaper` 已解析为本地缓存图，页面仅请求该本地文件，
  无任何外部壁纸 API 请求

### Fixed (2026-09-11 — 架构级重构：层叠体系、Dropdown 裁剪与遮挡、Dark 模式壁纸层、PC 顶栏)

本轮以「从架构层面解决，不堆页面级 Hack」为原则，先做全量代码审查（cascade.css
5955 行 + 模板/JS/ucode 后端全链路），定位并修复以下根因。全部改动在实机
ImmortalWrt SNAPSHOT 192.168.88.1 上以真实浏览器（Chromium）验证，非推断。

**Dropdown（下拉菜单）—— 三个独立根因，逐一修复**

- **向上展开时菜单高度塌陷为 0**：主题 CSS 在 `.cbi-dropdown[open] > ul` 上硬编码
  `top: 100%`，而 LuCI 的 dropdown JS 在下空间不足时会改用内联 `bottom` 向上展开。
  两个偏移同时成立造成 over-constrained，菜单内容高度被压成 0，而每个 `<li>` 仍
  实测 48px —— 菜单只渲染为约 10px 的细条。修复：定位权完全交还组件 JS
  （`top: auto`），不预设方向。实测同一菜单由 **10px → 218px**，4 个选项全部可见
- **`.mz-view { overflow-x: clip }` 裁剪一切越界弹出层**：`clip` 不是滚动容器，
  会直接切掉任何伸出内容盒的绝对定位后代 —— 页面右侧/底部的下拉、表单末尾的
  保存并应用组合按钮首当其冲。已移除该守卫，宽度约束改由 `min-width: 0` 承担，
  真正需要滚动的元素（数据表、日志面板）各自声明 overflow
- **`.mz-main { position: relative; z-index: 1 }` 形成层叠上下文**：该组合把内容区
  变成一个封闭层叠上下文，区内的下拉（`z-index` 1000）只能与 `.mz-main` 的 1
  比较，永远低于 `.mz-sidebar`（fixed + z-index 40），表现为「下拉被侧栏/Card
  遮挡」。壁纸层改为负 z-index 后内容区无需抬升，已移除该属性组合

**Light / Dark 模式**

- **两处 Dark 选择器永不匹配**：`body.mz-has-wallpaper[data-theme="dark"]` 把
  `data-theme` 写在 `<body>` 上，而该属性实际挂在 `<html>`（header.ut 的
  `document.documentElement`）。结果 Dark 页面一直绘制亮色渐变壁纸层，
  Dark 玻璃面板也从未生效。已统一为 `html[data-theme="dark"] body.mz-has-wallpaper`
- **Dark 模式彻底不渲染壁纸层**：两个壁纸伪元素改用 `content: none` 从盒子树中
  移除（此前只是 `background-image: none`，仍参与合成）。JS 侧 Dark 分支同样
  提前返回，不发任何壁纸 API 请求，且不改动用户 UCI 壁纸配置
- **Dark 玻璃面板在深色底上不可见**：原 Dark 表面为 `rgba(255,255,255,.07)`
  的白色微透，叠在深色页面上等于没有卡片。改为深灰玻璃
  （`rgba(30,34,42,.88)` / `rgba(38,43,52,.92)`），并让下拉与模态比普通卡片更实
  （`.96` / `.97`）。Light 侧统一为白色微透玻璃（0.62–0.84，blur 18–20px）
- **补齐从未定义的玻璃变量**：`--mz-glass-blur-strong` 与 `--mz-glass-saturate`
  全文件只有引用没有定义，导致移动端顶栏的 `backdrop-filter` 整条声明失效
  （`blur()` 无参数即无效）。已在 `:root` 补齐，移动端顶栏毛玻璃恢复
- 新增 `@supports not (backdrop-filter: blur(1px))` 兜底：不支持毛玻璃的浏览器
  退回近不透明表面，避免半透明面板压在照片上丢失可读性

**层叠体系（Layer System）**

- 新增 `--mz-z-*` 变量族（wallpaper/-2、base/1、content/10、sticky/100、
  navigation/200、scrim/300、drawer/400、dropdown/1000、popover/1100、
  modal/2000、toast/3000），**全文件 12 处字面 z-index 已全部收敛到变量**，
  消除 100/1000/1001/2000 混用与"谁的数大谁赢"式维护

**PC / Mobile 顶栏**

- **桌面隐藏页面标题栏**（`.mz-topbar`，`min-width: 855px`）：页面自身的 `<h2>`
  已经承担标题，标题栏只是重复
- **LuCI 原生 `#indicators` 槽位拆出为独立 `.mz-indicatorbar`**：该槽位由
  `ui.js#showIndicator()` 挂载，承载未保存更改/应用指示器与 XHR 轮询徽标。
  若继续留在被隐藏的顶栏内，桌面端会连带丢失这些原生能力。新容器 sticky、
  空时零高度（只留横向内边距），不使用不占位
- 移动端保留标题栏（`.mz-topbar` 显示，`position: static` 避免与 sticky 的
  `.mz-mobilebar` 在 `top: 0` 相互覆盖），同时抑制 `.mz-mobilebar-title` 的
  重复标题

**标题内嵌状态标签**

- 「端口状态 + 隐藏」这类 `<h3>`（第三方视图内联
  `display:flex;justify-content:space-between`，内含 `<span class="label">`）
  被主题自身的 section 标题规则挤到换行。修复采用**作用域限定**：
  `#mz-view .cbi-section > h3:has(> .label)` 等，并配套 `mz-ui.js` 打
  `.mz-h3-pill` 类（兼容不支持 `:has()` 的浏览器）。未使用 `h3 { ... }` 全局覆盖，
  未改动任何第三方 DOM 结构

**其它**

- 移除 `.cbi-page-actions .cbi-dropdown.cbi-button` 的 `overflow: hidden`
  （保存并应用组合按钮展开菜单被裁剪的直接来源之一），改由后续
  `overflow: visible !important` 安全网兜底
- 验证结论（实机 + Chromium 真实渲染，非推断）：桌面 1920×1080 / 1366×768 与
  移动 390×844 / 412×915 四档视口下，`#indicators` 槽位存在、`.mz-view` 不再裁剪、
  下拉展开不被任何祖先裁剪且完整落在视口内、Dark 模式无壁纸请求且壁纸层
  `content: none`、移动端无横向溢出，共 29 项断言全部通过

### Fixed (2026-09-10 — 实机：总览端口状态卡片塌缩 + 接口页设备 tooltip 常显叠层）

在 ImmortalWrt SNAPSHOT（LuCI Master）192.168.88.1 上截图定位并修复：

- **总览「端口状态」端口挤成 100px 窄条、大片空白**：当前 LuCI 端口网格内联样式为
  `minmax(100px, 1fr)`（旧版为 `minmax(70px, 1fr)`），且网格父级是裸 `div` 而非
  `.cbi-section`；旧选择器两项都匹配不到，端口卡仍被内联 `width:100px` 钉死。
  现同时匹配两种 minmax 写法、不再强制 `.cbi-section` 父级，并用
  `width:auto !important` 覆盖内联宽度。实测 eth0/eth1 由 102px 展开为约 549px
  等宽卡片，后续网络/DHCP/无线/UPnP 区块排版恢复正常
- **接口页设备详情面板常显、叠层导致排版混乱**：LuCI 设备弹层节点是
  `span.cbi-tooltip.ifacebadge.large`。`#mz-view .ifacebadge`（ID 选择器，
  特异性 1,1,0）把 `display:inline-flex` 顶掉了
  `.cbi-tooltip-container .cbi-tooltip { display:none }`（0,2,0），每个
  eth/wifi 图标下方的类型/MAC/流量面板全部永久展开并压住说明列。
  修复：`#mz-view .ifacebadge:not(.cbi-tooltip)` 只样式真正的角标；
  tooltip 隐藏规则加 `!important`，仅 hover/focus-within 时 `display:flex`。
  实测接口卡、设备表、操作按钮列恢复整洁，悬停才弹出详情
- 桌面 1440 与接口页窄屏均已用无头浏览器截图复验

### Changed (2026-09-10 — 云编译直出：去掉 OpenWrt SDK，单流水线产出 IPK+APK)

- **删除 SDK 全量编译路径**：主题是纯数据包（无 `src/`），旧 CI 仍下载约 300MB 官方 SDK 并编译 luci-base 依赖链（rpcd、ucode、lucihttp、curl…），单次 10–20 分钟。现改为 `scripts/build-direct.sh` 按 `luci.mk` 安装布局装配载荷，再直接写出与官方后端一致的容器：
  - ipk = `gzip(tar(debian-binary, data.tar.gz, control.tar.gz))`（OpenWrt `scripts/ipkg-build`）
  - apk = apk-tools v3 ADB 容器（`ADBd` + raw deflate，与 `apk mkpkg` 一致）
- **合并双流水线为单工作流**：删除 `build-apk.yml` / `build-ipk.yml`，新增 `build.yml`。一次跑完全部四个包并各自校验：
  - `luci-theme-mint-<release>-all.ipk` / `.apk`
  - `luci-i18n-mint-zh-cn-<release>-all.ipk` / `.apk`
  - 架构仍为无关包：ipk 记 `all`，apk 记 `noarch`；一份产物可装任意目标
- **release.yml 适配单工作流**：不再等待 APK/IPK 两条流水线汇合，改为汇总 `Build packages` 的单一 artifact 后发布 nightly / 正式版
- **产物命名去掉系列/目标后缀**：旧名含 `23.05-x86_64` / `snapshot-x86_64` 等易误导字段（包本身与目标无关）；现统一为 `luci-theme-mint-<release>-all.ipk`、`luci-theme-mint-<release>.apk`
- **`mkadbpkg.py` 跨平台加固**：
  - 新增 `--exec <相对路径>`：对指定载荷强制写入 0755。Windows/NTFS 无法向 `os.lstat` 表达 Unix 执行位，仅靠 chmod 会让 APK 丢失脚本执行位（`verify-package.sh` 会拒绝）
  - `scan_dirs` 路径统一为 POSIX `/`，修复 Windows 上 `os.walk`/`relpath` 反斜杠导致 `--exec` 匹配失败
- **CI 调用方式**：workflow 一律 `bash scripts/...`，避免新建脚本未带可执行位时 runner 报 `Permission denied`（exit 126）
- **清理无效 Release**：删除旧 `nightly`（混入 ImmortalWrt 杂项包、多系列重复资产、命名混乱）；新流水线已重新发布干净 nightly（4 包 + buildinfo + 发布说明）
- **文档**：README 云编译章节、RELEASE.md 工作流与产物说明同步为「单工作流直出、无 SDK」

### Fixed (2026-09-10 — 云编译修复与优化：ipk/apk 云构建全线转绿的前置缺陷 + 简中翻译入包 + 构建提速)

依据 `docs/reviews/CODE_REVIEW_2026-09-10.md`（对照 openwrt/luci master 与 openwrt main 的 `luci.mk`、`package-pack.mk` 官方实现复审）：

- **CI 阻塞缺陷①（verify 误判全部真包）**：`verify-package.sh` / `install-test.sh` 按 `usr/share/ucode/...` 断言 ucode 载荷，而官方 luci.mk 实际安装到 **`usr/share/ucode/luci/...`**（`UCODE_LIBRARYDIR`，官方 template runtime 也从该路径加载模板与模块）——导致「Build APK / Build IPK packages」两个工作流的 Verify 步骤对**每一个**真包都失败，release 流水线长期拿不到产物。已改为官方安装路径
- **CI 阻塞缺陷②（apk 架构字段）**：OpenWrt apk 后端把 `PKGARCH=all` 记成 `.PKGINFO` 的 `arch:noarch`（`package-pack.mk` 的 `--info "arch:noarch"` 映射），而 verify 死等 `arch=all`。现按后端分别接受：ipk `all` / apk `noarch`，其余架构值一律失败（防混入目标相关产物）
- **简中翻译从未入 Release**：官方 LuCI 规范把 `po/` 编成独立包 `luci-i18n-mint-zh-cn`（`luci.mk LuciTranslation`，HIDDEN 且默认不选中）；旧流水线既不选中、不收集也不校验它，README 却宣称「lmo 随包安装」——实际 Release 里**只有英文主题**。现：`configure_sdk` 显式 `CONFIG_PACKAGE_luci-i18n-mint-zh-cn=m`；defconfig 后校验选中状态；收集两个包并各自产出 `.buildinfo.txt`；verify / install-test / release-notes 全部支持翻译包（依赖方向：翻译包依赖主题包）；Makefile 新增 `PKG_PO_VERSION ?=` 注入点，翻译包与主题同版本发布
- **install-test apk 分支不可用**：空 root 里 `apk add` 会因缺 `luci-base` / `curl` 依赖直接失败（该分支从未真正跑通过）。现先生成最小 unsigned 依赖 stub 包（纯 `.PKGINFO` 流，走真实 apk 解析器装依赖再装主题）；顺带修复 JSON 断言的 `A && B || C` 优先级 bug（翻译包无 JSON 文件时误报失败）
- **云编译提速**：
  - 主题是纯数据包（无 `src/`，包与目标平台无关）：两条工作流矩阵由 `2 版本 × 2 目标` 收敛为 `2 版本 × 1 目标`（x86/64），CI 时间近似减半
  - ipk 工作流改为直接请求**原生 ipk 系列**（24.10 + 23.05）：旧逻辑请求 25.12/snapshot 后下载 ~300MB SDK、解包、才发现 apk-only 而回退，每次白烧 4 个候选的下载+解包；`--allow-legacy` 保留作安全网
  - SDK tarball 按官方 sha256 进 GitHub Actions cache（`get-openwrt-sdk.sh --print` 新增 `tarball_sha256` 输出）：重试/复核秒级复用；复用仍按官方 `sha256sums` 重新校验，污染条目会被丢弃并自动重下（自愈）
- **删除遗留 `build.yml`**：其 softprops 直接发布 `nightly`/标签 Release，与 `release.yml` 竞争同一 Release 标签，是现有 nightly Release 混入 `luci-theme-mint-0-*`（版本号为 0 的坏包）与 ImmortalWrt 杂项产物的来源；其 OpenWrt 快照构建与 build-apk.yml 完全重复。OpenWrt 官方 SDK 双流水线成为唯一发布来源（IWW 兼容性由「遵循官方 LuCI 主题 API」这一设计前提保证，见审查报告）
- **本地验证工具**（无需 OpenWrt 网络）：`scripts/ci-simulate.sh` 用真实主题载荷构造结构等价的 apk/ipk 四件套跑 verify + install-test（含「改名包 / 目标架构 / 丢执行位」负例）；`scripts/ci-mirror-test.sh` 起本地 mock 镜像验证 SDK 解析器（系列回退、sha256 发现与输出、下载校验、baked `USE_APK` 后端探测、缓存复用与自愈）
- **文档**：README / RELEASE.md 同步双包发布、单目标矩阵、`noarch` 架构说明与成对安装命令

### Fixed (2026-09-10 — 全量代码审查修复 R-01…R-12：cron 脚本权限 / ui_random 默认值 / ACL 收敛 / SDK 校验等)

依据 `docs/reviews/CODE_REVIEW_2026-09-09.md`（以 openwrt/luci master 的 luci.mk、luci-base dispatcher/runtime、官方主题为基准的全量审查），逐项修复：

- **R-01（高危）cron 壁纸刷新器无执行权限**：`root/usr/bin/mz-wallpaper-fetch.sh` 与 `root/etc/uci-defaults/30_luci-theme-mint` 此前以 0644 入库，luci.mk `cp -pR` 会原样带进包内——cron 每 5 分钟直接 `exec` 脚本必得 EACCES，OT-35 服务端壁纸缓存（`wallpaper-*.img`）永远不会生成，前端静默降级为远程 API 直取。已置为 0755；`verify-package.sh` / `install-test.sh` 新增可执行位断言与缺失文件条目（`usr/bin/mz-wallpaper-fetch.sh`），该类回归从此在 CI 硬失败
- **R-02 `ui_random` 默认值四源矛盾**：对齐为 **默认关闭**（OT-09 原旨）——`/etc/config/mint` 改 `'0'`、`wallpaper.uc` 运行时回退 `?? '1'`→`?? '0'`、`header.ut` 同步并改写理由注释；uci-defaults 播种值与表单 `.default` 本已为 0。新装默认不再向第三方随机图 API 发后台请求（既有安装以 conffile 语义保留各自现状）
- **R-03 rpcd ACL 收敛**：组名 `wallpaper` 重命名为 `luci-theme-mint`（与文件/包名一致，避免通用名撞车）；有副作用的 `save` 只保留在 write scope；write scope 补上 `uci: ["mint"]`（严格 ACL 固件上 stock `form.Map` 保存路径不再必然被拒）；`uci` 项采用官方扁平写法；`menu.d` 的 `depends.acl` 同步更新
- **R-04 CI 供应链完整性**：`get-openwrt-sdk.sh` 新增 `verify_sdk_sha256()`——下载/复用缓存后一律对照目标目录官方 `sha256sums` 校验（不匹配即 `die`，无 sums 的本地测试镜像仅告警）；`build.yml` 直连下载路径同步加校验
- **R-05 rpcd `dashboard` JSON 注入面**：新增 `json_escape()`（sed 转义 `\` `"` + tr 剥离 C0 控制字符），thermal/storage/uplink/system/public_ipv4 全部字符串字段改经其输出；`network` 块改在 heredoc 外组装（`$network_json`），消除 heredoc 转义歧义。含引号/反斜杠的 hostname 等不再破坏仪表盘 JSON
- **R-06 模板注释注入面**：`header.ut` 的 `wallpaper_error` 调试注释改为 `entityencode(...)`，不再可能被 `-->` 提前闭合
- **R-07 nftables innerHTML**：`mz-nftables.js` 链名 `<code>` 包裹改为纯 DOM 构造（textNode + `<code>`，零 innerHTML）
- **R-08 i18n 一致性**：`mz-nftables.js` 的组标题/工具栏/摘要、`overview-mobile.js` 的 `buildCoreHtml` 标签全部改走 `_()`；仪表盘公网 IP 离线哨兵 `未联网` 保留线缆契约、显示侧改 `__('Offline')`（ZH 字典同步补齐 `Offline/Refresh/Status`）；po/pot 新增 28 条 msgid。stock LuCI 视图 DOM 的**解析键**（`pick()`、`CAT_PREFIXES`、`classifyChain` 的正则）刻意保持字面并加注释说明，避免把匹配逻辑译坏
- **R-09 ubus 挂载点**：`menu-mint.js` 保存回退路径由硬编码 `/ubus/` 改读 `L.env.ubuspath`
- **R-10 仪表盘失败路径耗时**：`mint_public_ip` 重试由 3×(3s) 收敛为 2×(2s)，WAN 不可达时单次 dashboard RPC 最坏耗时 ~11s→~5s
- **R-11 版本溯源**：Makefile 新增 `PKG_VERSION ?=` 注入点；`build-package.sh` 与 `build.yml` 在拷贝进 feed 后按主题仓库自身 revision 写入 `PKG_VERSION`（luci.mk findrev 同款 `yy.ddd.sssss~hash` 格式），产物元数据不再随 LuCI feed HEAD 漂移；feed 内普通构建（无匹配行）行为不变
- **R-12 仓库整洁**：根目录 3 份 LAYOUT_REVIEW 与本次 CODE_REVIEW 统一归档至 `docs/reviews/`

### Fixed (2026-09-10 — 保存并应用下拉 / 全局下拉菜单 / 首页与接口布局 / 单一 Mint 变体)

- **保存并应用（ComboButton）下拉菜单失效**：`cbi-page-actions .cbi-dropdown.cbi-button` 被主题写成 `overflow:hidden`，LuCI 打开下拉时把绝对定位的 `ul.dropdown` 一起裁掉，桌面端根本无法展开；同时旧规则无差别给打开的 `ul` 加浮层面板样式，导致 `ul.preview`（LuCI 为保持按钮文字而克隆的 caption）也变成第二个浮层
  - 修复：追加最终覆盖块——`.cbi-dropdown` 类控件不再裁剪溢出；`ul.dropdown` 作为真正的浮层菜单，`ul.preview` 保持按钮内联 caption；区分 `.open` / `.more` 箭头；`li[display]` / `li[selected]` 关闭态显示、打开态菜单项可点；wallpaper/dark 下菜单实色底保证可读
- **全局表单下拉样式不正确**：`.cbi-dropdown[open] > ul` 同时命中 `.dropdown` 和 `.preview` 两个子节点。现改为 `.cbi-dropdown[open] > ul.dropdown` 才浮层化，`ul.preview` 仅作按钮标题，所有 cbi 下拉（协议、区域、时长等）恢复单选/多选正常外观
- **首页端口状态 + 网络/无线原生卡片布局**：LuCI 原生端口网格是 `minmax(70px,1fr)` 且每卡 70–100px，端口挤成窄条；`.network-status-table` 无布局，上/无线卡全宽垂直堆叠。参考 luci-theme-aurora，补充原生端口网格为 `>150px` 卡片、手机两列；`.network-status-table` 桌面 flex 多卡、手机纵向；并修复主题全局 `ifacebox-body > span:not(.cbi-tooltip-container){display:none}` 误吞首页网络/无线正文文字的问题（收窄为接口页、且隐藏括号标点而保留子设备图标）
- **网络-接口页布局**：`#cbi-network-interface` / `#cbi-network-device` 接口卡改为等高、正文居中；手机端接口卡改为“头部在左、正文在右”的横向卡，避免占满整行
- **页脚位置**：`<footer>` 从 `.mz-main` 外移入 `.mz-main` 内，消除桌面端页脚被固定侧栏压住、短页面额外滚动的问题
- **登录页矮屏**：`.mz-login` 允许纵向滚动，`.mz-login-card` 限高，WebAuthn/2FA/横屏等场景不再裁切
- **移除 MintLight / MintDark / MintzeroLight / MintzeroDark 变体**：uci-defaults 只注册单一 `Mint`（`themes.mint=/luci-static/mint`），并在安装/卸载时删除旧变体键；删除 `mint-light` / `mint-dark` 静态与模板 symlink；残留 `mediaurlbase=/luci-static/mint-light|mint-dark|mintzero*` 一律重写为 `/luci-static/mint`
- **清理**：删除已被 `footer.ut` 取代、全仓库无引用的旧 `overview.js`；清理被后续 `!important` 完全覆盖的移动端 1 列 port/net 规则；移动端汉堡按钮不再在 `.mz-mobilebar` 之外以 `position:fixed` 兜底显示
- **壁纸功能兼容性**：全局壁纸/登录页壁纸在本次布局调整后保持可用——桌面端新增 `.mz-topbar` 沿用 `body.mz-has-wallpaper` 玻璃层；下拉菜单在壁纸/暗色下改用 `--mz-panel-bg-strong` 玻璃背景（不再硬编码纯黑）；登录页允许矮屏滚动时，`.mz-login-bg` / `.mz-login-overlay` 改为 `position:fixed`，滚动查看认证字段不会把壁纸卷走
- **中文翻译**：`theme.po` / `theme.pot` 中旧 `overview.js` 源码引用改指 `overview-mobile.js`，避免翻译工具链以为源码文件已删除；壁纸设置、登录页等中文文案保持完整

### Fixed (2026-09-09 第十轮 — PC 概览 `<h2>状态</h2>` 标题再度消失（回合制回归）)

- **PC 端 Status > Overview 的 `<h2>状态</h2>` 标题再次消失**：第七轮已修复过一次，但 `8410db6`（第九轮前的 nftables 重构）重排 `footer.ut` 时把第七轮的两处改动一并回退——`overview-dashboard.js` / `overview-mobile.js` / `overview-dashboard.css` 的注入被删、`overview.js`（旧版）加载行被恢复。旧 `overview.js` 不渲染新版仪表盘 DOM（含 `<h2>状态</h2>` 的 header），标题随 DOM 一起缺失；根因是脚本未加载，非 CSS 选择器（`#mz-view > h2` 为直接子代选择器，仪表盘标题嵌套在 `#mint-overview-dashboard > header`，本就不命中）
  - 修复：`footer.ut` 恢复第七轮形态——无条件加载 `mz-ui.js`；`admin-status-overview` 路径注入设备识别引导脚本（UA + `max-width:854px`），桌面端加载 `overview-dashboard.js` + `overview-dashboard.css`（完整 PC 总览仪表盘，含端口/DHCP/无线/UPnP 面板，标题随 DOM 挂载）、移动端加载 `overview-mobile.js`；移除对旧 `overview.js` 的引用
  - 实测（192.168.88.1，Playwright）：桌面 1440px 出现可见 `h2.mint-ovd-title`（文本"状态"，无重复、无隐藏残留），完整仪表盘正常渲染（3 个 gauge canvas + 54 个面板区块）；手机 390px 顶栏 sticky 玻璃底、菜单按钮与标题"状态"并排无重叠，主标题不重复（桌面标题未注入）

### Fixed (2026-09-09 第九轮 — 移动端顶栏样式回归丢失 全局透明度/标题位置异常)

- **移动端顶栏样式整体丢失（回归失败）**：`8410db6` nftables 重构重排 `cascade.css` 时，把第六轮新增的 `.mz-mobilebar` 样式块整体丢掉了，只剩 `menu-mint.js` 仍会创建该顶栏。结果：手机端菜单按钮退化为 `position:fixed; top:12px; left:12px` 浮在标题上方遮挡文字（标题无样式、位置异常）；桌面端因缺少 `.mz-mobilebar { display:none }` 基础规则，顶栏在桌面视口也渲染出来（电脑上位置异常）；wallpaper 模式下顶栏失去 `--mz-panel-bg-strong` 玻璃底，变成全透明（全局透明度不正常）
  - 修复：完整补回 `.mz-mobilebar` 样式块——窄屏 `display:flex; position:sticky` 玻璃顶栏、`.mz-mobilebar-title`（`flex:1 1 auto; min-width:0` 弹性占位保证不被按钮/刷新按钮遮挡）、`.mz-mobilebar #mz-sidebar-toggle`（取消 fixed、进栏铺排）、`.mz-mobilebar .mint-ovd-refresh`（`margin-left:auto` 靠右）、`#mz-view > h2, .mint-ovd-header` 窄屏隐藏（标题只在栏内呈现）、桌面 `display:none` 整体隐藏，以及 `body.mz-has-wallpaper .mz-mobilebar` 玻璃背景
  - 联动清理：`.mz-topbar` 在 854px 断点残留的 `padding-left:64px`（为旧 fixed hamburger 让位）改为常规 `var(--mz-spacing-lg)`，消除手机上顶栏多余的左空隙
  - 实测：手机视口（390x844）顶栏玻璃底正常、标题显示在按钮右侧无遮挡、无重复大标题；桌面视口（1440x900）顶栏 `display:none` 无残留

### Fixed (2026-09-09 第八轮 — nftables 链名高亮失效 / wallpaper 视图偶发卡死)

- **nftables 状态页链名未按设计蓝色高亮**：`mz-nftables.js` 把链名包成 `h4 > span > code`，而 `cascade.css` 原选择器写的是直接子选择器 `#mz-view .nft-chain > h4 > code`（中间少了 `span`）导致匹配不到，链名显示为深灰，只有左侧竖线是蓝色
  - 修复：将选择器放宽为后代选择器 `#mz-view .nft-chain > h4 code`（对 `strong` 同理），对 `span` 包裹结构免疫；实测 39/39 个链名均命中蓝色高亮（`color: rgb(61,90,232)`）
- **mintwallpaper 页面偶发卡在"正在载入视图…"**：`loadMintReady()` 内 `uci.load('mint')` 在大部分环境下正常（实测 49ms resolve），但个别场景（首次整页加载经过 LuCI 匿名 session 窗口）底层 RPC promise 既不解成功也不 reject，永久挂起，视图永远不渲染
  - 修复：为每次 `uci.load('mint')` 增加硬超时保护（3s，超时视为本次失败并 `uci.unload` 后重试，最多 10 次）；即使最终仍未拿到配置，也降级渲染为"空配置"表单而非卡死。实测整页加载与 SPA 跳转均为 ~0.03s 就绪、渲染正常
- **主题翻译补部署**：设备此前运行旧版主题且缺少编译后的 `luci-theme-mint.zh-cn.lmo`，`/admin/system/mintwallpaper` 全英文；已本地用 `scripts/po2lmo.py` 编译 `zh_Hans` 目录并部署到设备 i18n 目录，页面 31 处文案全部汉化（含"壁纸设置 / Mint 壁纸 / 上传桌面端图片… 等"），汉化不再依赖服务器在线编译

### Fixed (2026-09-09 第七轮 — PC 总览 `<h2>状态</h2>` 标题消失)

- **PC 端 Status > Overview 的 `<h2>状态</h2>` 标题不显示**：仪表盘 DOM（含 `<h2>状态</h2>`）从未挂载，因为 `overview-dashboard.js` 从未被任何模板加载——`footer.ut` 只加载了旧的 `overview.js`
  - 根因确认：`cascade.css` 中 `#mz-view > h2 { display:none }`（约 2388 行）使用的是**直接子代选择器**，只匹配 `#mz-view` 直接下的 `<h2>`，而仪表盘标题位于 `#mz-view > #mint-overview-dashboard > header > h2`，是嵌套结构、不在命中范围；真正原因是脚本未加载、DOM 未构建
  - 修复：`footer.ut` 在 `admin-status-overview` 路径下注入设备识别引导脚本，桌面端加载 `overview-dashboard.js`、移动端加载 `overview-mobile.js`；并将 `overview-dashboard.js` 从「仅核心/系统/网络仪表」升级为**完整 PC 总览视图**（含端口/DHCP/无线/UPnP 面板 + 原生 `.cbi-section` 隐藏 + PC 专属 `boot()` 闸门），从而标题随 DOM 一并挂载

### Changed (2026-09-09 第七轮 — 移动端/PC 前端彻底解耦)

- **前端 UI 按设备拆分为两套独立代码，共用同一后端/API**：入口处按 User-Agent + 屏幕宽度（`max-width: 854px`）自动识别，桌面加载 PC 视图、移动加载移动视图，两端互不耦合、可各自独立开发维护
  - `overview-dashboard.js`：桌面端专属完整总览仪表盘（核心/系统/网络 Gauge + 图表 + 端口/DHCP/无线/UPnP 面板 + 原生区块隐藏 + 仅 PC 启动闸门 `isMobile()`）
  - `overview-mobile.js`：移动端专属总览增强（从旧 `overview.js` 1–909 行原样提取的面板 + 原生区块抑制 + 自启动）
  - `mz-ui.js`：设备无关的通用辅助（apply/revert 通知、cbi-dynlist 编辑/删除按钮），由 `footer.ut` 在**所有后台页面**无条件加载
  - `footer.ut`：移除旧的 `overview.js` 条件标签，改为先无条件加载 `mz-ui.js`，再于 `admin-status-overview` 注入设备识别引导脚本选择 PC/移动视图；`overview.js` 已删除
  - `theme/po/*` 源引用从 `overview.js` 重指向 `overview-mobile.js`（行号一致，因其为原样提取）

### Fixed (2026-09-09 第六轮 — 移动端菜单栏标题被按钮遮挡)

- **移动端左侧菜单按钮挡住文字**：`menu-mint.js` 在窄屏会把 `#mz-sidebar-toggle` 移入新创建的 `.mz-mobilebar`，但 `cascade.css` 没有给 mobilebar 写任何样式，按钮继续沿用 `position: fixed; top:12px; left:12px`，导致它浮在标题文字上方
  - 新增 `.mz-mobilebar` 样式：窄屏下 `display:flex` + `position:sticky` + 玻璃背景，按钮与标题排成一行
  - 当按钮位于 `.mz-mobilebar` 内时覆盖为 `position:relative`，取消固定定位，不再遮挡
  - `.mz-mobilebar-title` 居中显示、`overflow:hidden` + `text-overflow:ellipsis`、避免长标题换行
  - 实测 390px 视口：按钮 x=0, 标题 x=44 居中，两者无重叠

### Fixed (2026-09-09 第五轮 — 暗色模式 + 统一毛玻璃 + 轻微阴影)

- **暗色模式切换无效**：菜单顶栏 `#mz-theme-toggle` 能正常切换并持久化 `data-theme`，但壁纸页/概览页视觉上几乎没变
  - 根因：`data-theme` 属性由 `header.ut` 和 `menu-mint.js` 始终设置在 `<html>`（`document.documentElement`）上，而 `cascade.css` 的玻璃规则全部写成 `body.mz-has-wallpaper[data-theme="dark"]` / `:not([data-theme="dark"])`。`<body>` 上永远没有该属性，导致暗色分支全部失效、亮色分支恒真
  - 修复：将所有壁纸玻璃规则改为 `html[data-theme="dark"] body.mz-has-wallpaper` 与 `html:not([data-theme="dark"]) body.mz-has-wallpaper`
  - 统一毛玻璃：把 `body.mz-has-wallpaper::before` 壁纸蒙层也纳入同一模型——背景与卡片使用同一 `--mz-glass` + `--mz-glass-blur`，不再区分“蒙层玻璃 vs 卡片玻璃”。亮色使用 `rgba(255,255,255,0.5)`，暗色使用 `rgba(15,23,42, var(--mz-wallpaper-overlay,0.45))`
  - 亮色卡片加轻微阴影：在统一玻璃基础上增加 `box-shadow: 0 4px 24px rgba(15,23,42,0.12), inset 0 1px 0 rgba(255,255,255,0.6)`，让卡片从壁纸中浮起
  - 修复壁纸模糊设置被覆盖：`body::before` 不再直接写死 `backdrop-filter`，而是把用户设置的 `--mz-wallpaper-blur` 叠加到玻璃模糊上（`calc(blur + 16px)`），避免“模糊(px)”拉满也无效
  - 实测：亮色壁纸页卡片 bg=`rgba(255,255,255,0.5)`、暗色切换后卡片/蒙层统一变 navy、文字自动切换为浅色；主题切换按钮点击后立即生效

### Added (2026-09-09 第四轮 — nftables 状态页改版)

- **nftables 状态页改版**：`/admin/status/nftables` 在裸版视图下 39 条链 138 条规则 390+ 个 badge 一字排开（页面 11102px），现在通过主题级增强完成视觉重塑
  - 新增 `theme/htdocs/luci-static/mint/mz-nftables.js`：仅在该页加载，将链按「基本链 / NAT 链 / 路由 mangle / 区域与转发 / 辅助 / 第三方」分桶，每条链头部自动加 ▾ 折叠按钮 + 「X 条规则 · Y 条有流量 Z KB」摘要徽章，零计数规则默认隐藏，顶部提供「全部展开 / 全部折叠 / 隐藏零计数 / 搜索」工具条
  - `cascade.css` 追加 `mz-nft-*` 样式段：每张 nft-table 卡片化、每条链独立卡片（hover 提亮）、`nft-chain-hook` 两条粘连的 `<li>` 改为 chip 化布局解决「优先级：0策略：drop」文字粘连、ifacebadge 统一（注释蓝、流量黄、set 容器虚线）、表格统一为斑马纹 + hover 态、移动端 <768px 将表格转块级堆叠并在每个 cell 前补 `data-mz-col` 列名
  - `footer.ut` 仿照 `overview.js` 模式条件加载 `mz-nftables.js`，仅在 `admin/status/nftables` 路径触发；幂等（`mzNftSig` 签名 + MutationObserver 监听视图轮询）保证每 5s nftables 视图轮询不会重复注入
  - 实测：默认状态下 19 链展开 / 20 链折叠 / 32 条零计数规则隐藏，页面高度从 11102px 收敛到 3424px；桌面 1440、平板 800、移动 390 三种宽度均整洁可读；搜索「singtun0」保留 6 链隐藏 33 链，全部展开时高度回升到 11303px（与改版前相当），全部折叠时仅 3424px

### Fixed (2026-09-09 — 白色毛玻璃回归)

- **壁纸模式下 light 主题仍被强制深色玻璃**：9-08 那次「reference style: dark glass home page」把 `body.mz-has-wallpaper` 块统一为深色玻璃（`--mz-color-background: #16202f` + `--mz-color-text: #eef2f8`），且对所有主题生效——light 主题下整页也是深色玻璃 + 浅色文字
  - `cascade.css` 把该块按 `data-theme` 拆成两套：
    - `body.mz-has-wallpaper:not([data-theme="dark"])`：白色 70% 玻璃 + 深色文字 `#1a2233` + 浅蓝白底 `#eef1f6` + 浅色光晕
    - `body.mz-has-wallpaper[data-theme="dark"]`：保留原 dark glass 7% 白色洗 + 浅色文字 + 深蓝底
  - 同步把 `body.mz-has-wallpaper::before` 蒙层按主题区分：light 用 `rgba(255,255,255, var(--overlay,0.35))` 提亮壁纸，dark 保留 `rgba(15,23,42, 0.45)` 压暗
  - 实测 light 主题下卡片 computed style：bg=`rgba(255,255,255,0.7)`、text=`#1a2233`、backdrop-filter=`blur(12px) saturate(1.15)`、overlay=`rgba(255,255,255,0.45)`，人物壁纸透出自然

### Fixed (2026-09-08 第三轮 — 安全/打包/兼容性)

- **壁纸脚本本地文件包含（C-2）**：`mz-wallpaper-fetch.sh` 仅放行 `http(s)` 源，curl 加 `--proto '=http,https' --proto-redir '=http,https' --max-filesize 8M --` 防护；图片签名校验由 `$(dd ...)` 命令替换改为 `od -An -tx1` hex 比对，修复 PNG 魔数紧跟 NUL 被 `$(...)` 截断导致校验失效的问题
- **全仓库 CRLF 导致脚本在设备上无法运行**：新增 `.gitattributes`（`eol=lf`）并将所有文本文件归一化为 LF，避免 Windows 检出时 BusyBox ash 解析 Shell 脚本报错（壁纸抓取 cron、uci-defaults、rpcd 后端）
- **升级覆盖管理员壁纸配置**：`Makefile` 新增 `/etc/config/mint` 为 conffile；新增 `/lib/upgrade/keep.d/luci-theme-mint` 保留上传的自定义壁纸图片
- **安装/卸载导致 LuCI 会话登出**：`postinst`/`postrm` 由 `restart` 改为 `reload`（SIGHUP 重读 ACL，不丢弃 ubus 会话）
- **uci-defaults 每次安装重写 /etc/config/luci**：改为仅写入缺失的主题键，避免噪声提交并保留管理员的主题选择
- **遗留 ACL 路径**：删除已废弃的 `/usr/share/luci/acl.d/luci-theme-mint.json`（主线早已不读取此目录）
- **强制刷新破坏缓存**：移除 `header.ut`/`footer.ut` 中 `?v=` 版本号 query string，使浏览器缓存机制正常工作

### Fixed (2026-09-08 第二轮)

**cbi-dropdown 全站不可用（严重，主题自发布以来的隐藏 bug）**
- 根因：LuCI 的 cbi-dropdown 组件切换的是 `open` **属性**（`[open]`），主题 CSS 全部写成 `.open` **类**选择器，展开面板规则从未命中；再叠加 LuCI 核心自带 `!important` 隐藏规则 `.cbi-dropdown:not(.open) > ul > li:not([selected]):not(.hidden)`（特异性 0,4,2），下拉点开后选项全部 display:none——表现为"所有下拉无法选择/无法折叠"
- 修复：全部选择器改为 `[open]` 属性形式，并以永不匹配的 `:not()` 垫高特异性至 (0,5,2) 反杀核心 `!important` 规则；`.hidden`（搜索过滤）项保持隐藏
- 实测：接口页编辑弹窗设备下拉——点开 28 个选项全部可见、点选 eth0 后隐藏域值与选中态同步、面板自动收起

**接口页（admin/network/network 接口标签）排版重构**
- 设备行图标叠字根因：主题把 `.cbi-tooltip`（本应悬停显示）样式化为常驻内联卡片，设备类型/MAC/流量全部平铺挤在图标后面；恢复 LuCI 标准悬停语义（默认隐藏、悬停弹出实色面板），`.ifacebox` 改 `overflow: visible` 防裁切
- 区域头降饱和：lan/wan 的原生亮绿/亮红改为区域色 16% 透明色条 + 3px 实色描边，保留区域辨识度且融入主题
- 接口详情（协议/链路状态/MAC/IPv4/IPv6）从裸文本改为玻璃卡片
- 选项卡（接口/设备/全局网络选项）改为胶囊式分段选择器

**全站滚动条样式**
- 此前无任何滚动条样式，侧栏/长列表显示为白色系统大滚动条；统一为 8px 半透明细滚动条（webkit + Firefox scrollbar-width），并补 `color-scheme` 让原生控件跟随深色模式

**h5000m_netmode（网络出口）页对比度**
- 应用样式回退白底卡片（`--background-color-high` 未定义）配主题近白文字，对比度仅 1.1；改为主题玻璃面板 + 明确文字色，提示条/协议芯片同步重制
- 页面描述文字在亮色壁纸上补文字阴影与全强度颜色

### Changed (2026-09-08 第二轮)

- 顶栏页题只显示当前二级菜单名（去掉"状态 /"等一级前缀），样式升级为 1.08rem/700 的页面标题；侧栏一级菜单加大加粗（1.02rem/700），与二级菜单层级一目了然
- 顶栏布局：刷新指示器从面包屑旁改到顶栏最右侧，垂直居中对齐（补齐未定义的 `.pull-right`）
- 总览页网格：≥1024px 的固定像素列（参差右边缘根因）全部改为 `auto-fit` + `1fr`，任意宽度下卡片行左右边缘对齐

### Fixed (2026-09-08)

**壁纸缓存真正生效：路由器侧代理缓存（PC / 移动 / 登录页独立）**
- 根因（第二层）：此前的 sessionStorage URL 缓存确实命中（跨页 URL 一致），但随机壁纸 API（paugram / alcy / seaya）对**每次请求都 302 重定向到不同图片**（实测 alcy `/bd` 两次请求分别落到 `233.WEBP` / `230.WEBP`），浏览器 HTTP 缓存对重定向无效——URL 一样、图却每页都换
- 修复：新增 `/usr/bin/mz-wallpaper-fetch.sh`（ash 脚本，cron 每 5 分钟），从配置源拉图校验签名（JPEG/PNG/WEBP/GIF + ≥3KB）后**原子替换**到 `/www/luci-static/mint/wallpaper-pc.img` / `wallpaper-mobile.img`；`wallpaper.uc` 在 random 模式且本地文件存在时向前端注入 `proxy` 字段；管理页（`menu-mint.js`）与登录页（`sysauth.js`）优先使用本地代理文件，文件缺失自动回退原随机 API 流程
- 效果：uhttpd 静态服务带 Last-Modified/ETag，浏览器跨页 304 复用——5 分钟窗口内**切页零下载、图片不换**；cron 刷新后下次加载自然拿到新图。实测 PC / 移动 / 登录页三份独立文件各自生效（移动 UA → `wallpaper-mobile.img`，PC UA → `wallpaper-pc.img`，登录页与管理页独立键控）
- uci-defaults 幂等安装 cron 行（`#mz-wallpaper` 标记，保留用户既有条目）；postrm 卸载时清理 cron 行、脚本与缓存文件
- 环境坑记录：脚本上传路由器必须 LF 行尾（CRLF 会让 BusyBox ash 报 `not found`），已修正仓库文件并 `core.autocrlf=false`

**网络管理页（admin/network/network）排版与视觉统一**
- 操作栏透明度与卡片不一致：sticky 保存栏用 `--mz-panel-bg-strong`(0.13)，比所有卡片(0.07)重一档，观感像"更实的板子"；统一为 `--mz-panel-bg`(0.07) 同族
- 接口/设备表格信息密度过高：单元格 padding 10px→12px 16px、字号 .88rem→.92rem、行内按钮缩小到 .82rem 并均分间距，信息层级清晰
- 下拉面板无立体感：cbi-dropdown 打开列表与 dropdown-menu 补 elevation 阴影；壁纸/暗色模式下选项面板改用实色 `#1c2736`（带投影），不再与背后玻璃卡糊在一起；原生 `<select>` 的 option 弹出层同步深色配色

**顶栏"刷新"指示器样式（poll-status）**
- 状态页顶栏的自动刷新指示器原是透明裸文本，壁纸下几乎不可见；改为与 `.label` 同族的胶囊按钮（surface-2 底 + 边框，active 态 primary-soft 高亮），悬停态补齐

**全局字体可读性**
- 根因：rem 级联后正文实际 ~14px（.88rem）且 system-ui 渲染偏细，壁纸玻璃底上文字存在感弱
- 修复：基础字号 16px→16.5px（全部 rem 尺寸等比放大，网格布局不受影响）、行高 1.5→1.55、启用 `text-rendering: optimizeLegibility`；表头与信息标签字重提到 600

### Fixed (2026-09-07)

**壁纸遮罩值被 ucode 字符串生命周期 bug 污染**
- 修复 `wallpaper.uc` 中 `clampOverlay`/`validCustomUrl`/`sourceMode`/`deviceGroup` 直接返回裸字符串时，在某些 libucode 构建（20230711 时代）下被格式化为 `18446744073709551615`（2^64-1）垃圾值的问题
- 通过 `copyStr()` 做一次字符串拼接复制，确保返回的字符串稳定，渲染后 `overlay` 恢复为合法的 `0.45` 等值，壁纸暗化蒙层正常生效、文字可读性恢复

**壁纸设置页空白（CBI TypedSection 类型不匹配）—— 核心根因**
- 设置页一直显示「尚无任何配置」、`uci/get` 偶发 `-32002 Access denied`，但经 `ubus call session login` + 浏览器会话抓包（`capture_session.py` / `capture_rpc.py`）三重验证，rpcd ACL 本身**完全正确**（root 会话含 `wallpaper` 组 + `allow-full-uci-access`，真实会话调 `uci get network` / `file read` 均成功）。ACL 不是根因
- 真正的根因在 CBI 表单：`wallpaper.js` 旧代码用 `form.TypedSection('wallpaper', ...)` 按**类型** `'wallpaper'` 查找段，但实机 `/etc/config/mint` 是 `config mint 'wallpaper'`（段**类型**为 `mint`、段**名**为 `wallpaper`），类型不匹配 → `uci.sections('mint','wallpaper')` 返回 0 段 → 表单判定「无配置」
- 后端 `wallpaper.uc` 用 `get_all('mint','wallpaper')` 按**段名**读取（类型无所谓），所以随机壁纸一直能工作，但设置页因类型错位始终空白——这正是「随机壁纸正常、设置页空白」并存的矛盾点
- 修复：`wallpaper.js` 改用 `form.NamedSection('wallpaper', 'mint', _('Settings'))` + `s.anonymous=false` 直接编辑既有具名段；`uci-defaults/30_luci-theme-mint` 建段类型由 `wallpaper` 改为 `mint`，与新装/升级段类型对齐，避免类型错位复发

**匿名会话 uci 缓存污染（导致偶发 Access denied）**
- 首屏加载时第一批 RPC（含 `uci get mint`）在真实 ubus 会话建立前发出，使用匿名会话 ID `00000000000000000000000000000000` 被 `-32002` 拒绝
- LuCI 的 `uci.js` 在 `callLoad` 带 `reject:true`，会把这次被拒的 load **永久缓存**进 `loaded['mint']`，之后所有 `uci.load('mint')` 都复用这个失败 promise，设置页因此持续空白
- 修复：`wallpaper.js` 新增 `loadMintReady()`，用 `uci.unload('mint')` 清除被污染的缓存后重试 `uci.load('mint')`（最多 12 次 × 200ms），等真实会话就绪再渲染表单
- 注：首屏匿名会话残存的 `Access denied` console 日志无害（重试后真实会话正常工作），不影响功能与保存

**ACL 加固（非根因，但保留为有效改进）**
- 在 `Makefile` 中新增 `postinst` 安装后自动重启 `rpcd` + `uhttpd`，`postrm` 同步重启，确保 ACL 变更立即生效
- 旧构建遗留的 `/usr/share/luci/acl.d/luci-theme-mint.json`（格式为 `uci: [["mint","wallpaper"]]`）会覆盖 `/usr/share/rpcd/acl.d/` 中的新 ACL；`postinst` 与 `uci-defaults` 现在会清理该遗留文件，避免潜在权限遮蔽

**界面排版与壁纸透显**
- 修复因遮罩值无效导致的壁纸过曝、卡片文字显示不清的问题
- 壁纸、卡片、侧栏、顶栏、底部等层级与毛玻璃效果在 1600/1280/768/390 等常见分辨率下均正常工作

### Fixed (2026-09-08)

**壁纸 5 分钟缓存：切换页面不再重新加载随机壁纸**
- 根因：`menu-mint.js` 的 `initGlobalWallpaper` 每次整页导航都重新生成带 `_mzt=Date.now()` 防缓存参数的随机 URL，LuCI 每次跳页都会拉一张新图
- 修复：选中 URL 按**设备类型**（pc/mobile）存入 `sessionStorage`（跨 LuCI 整页加载存活），TTL 5 分钟；窗口期内切页直接复用同一 URL，图片由浏览器 HTTP 缓存秒出，不再请求随机 API；仅 random 模式入缓存（custom 直链本就稳定），`img.onload` 确认加载成功后才写入，失败的 URL 不会污染缓存
- 实测：概览页 → 壁纸设置页跨页导航，`--mz-wallpaper` URL 完全一致（缓存命中）

**移动端适配：卡片至少两卡一行 + 登录框透明度**
- 移动端信息卡 4 列挤压导致型号等长值截断（`Hiveton H5000M (CpuMark : 2…`）。`≤1023.98px` 下 `.mz-info-cards` / `.mz-rings` 改为 `repeat(2, minmax(0,1fr))` 两卡一行；`≤480px` 环形卡改纵向堆叠（表盘 80px 居中在上、标签在下），信息值允许换行（`overflow-wrap:anywhere`）不再截断
- 移动端环形卡改三卡一行（2026-09-08 追加）：CPU / 内存 / 存储三张环形卡在 `≤1023.98px` 固定 `repeat(3, minmax(0,1fr))` 单行排布，`≤480px` 表盘缩至 72px、内边距收紧，390px 视口实测三卡各 102px 同行、无横向溢出；PC 端 auto-fit 布局不变
- 实测 390px：信息卡 162px×2、环形卡 160px×2（column 堆叠）、端口卡两卡一行、无横向溢出；型号完整显示
- 登录页：`≤640px` 登录框背景透明度由 `rgba(15,21,36,.55)` 降至 `.38`，透出更多壁纸；**PC 端 `.55` 保持不变**
- 移动端卡片透明度与 PC 一致性：实测两端的卡片计算背景完全相同（`rgba(255,255,255,0.07)`，390px 截图像素差甚至小于 PC），观感差异来自移动 UA 命中的壁纸源组不同（移动端走 seaya/alcy 移动源），卡片样式本身无差异

**卡片风格重做：参照「星境导航」深色微透玻璃（全部卡片同一透明度）**
- 参考图特征：壁纸是绝对主角，卡片只是一层约 6-10% 白的极淡玻璃板，浅色文字，所有卡片完全一致，没有任何白色实心块
- 根因（上一版 0.38 白 + 深色文字依旧偏"白卡片"）：亮色主题变量 `--mz-color-surface: #ffffff` / 文字 `#1a2233` 在壁纸模式下仍按浅色页面设计
- 修复：`body.mz-has-wallpaper` 统一覆写整套变量——`--mz-panel-bg: rgba(255,255,255,0.07)`（strong 0.13 / soft 0.045）、`--mz-color-surface: rgba(255,255,255,0.07)`、`--mz-color-border: rgba(255,255,255,0.12)`、文字翻转 `--mz-color-text: #eef2f8`（muted 72% 透明）、底色 `--mz-color-background: #16202f`；亮暗两主题共用同一套值，所有卡片透明度严格一致
- 卡片表头同步：`.mz-net-header` / `.mz-data-table thead th` 由 `rgba(primary,0.9)` 不透明色条降为 `0.4` 微透，与面板同风格
- 实测（1600 视口）：info/环形/网络卡内部像素 (151-157, 156-160, 168-173)，与页面壁纸间隙 (147,150,159) 仅差 7-10——壁纸完整透出，卡片是"若隐若现的面板"；文字计算色全部为浅色（`rgb(238,242,248)`），深色壁纸上的对比度良好
- 回归：1600/1280/768/390 四分辨率无横向溢出、无 pageerror、overlay 0.45、设置页正常渲染

**概览页卡片行宽不一致（各行右边缘参差不齐）**
- 根因：`@media (min-width: 1024px)` 下 `.mz-info-cards` / `.mz-rings` 使用**固定像素轨道**（`repeat(4, 220px)` / `repeat(3, 300px)`），在 1224px 内容区里只占 910px / 928px；而 `.mz-port-grid` / `.mz-net-grid` 用 `minmax(..., 1fr)` 自动撑满 1224px。上下行宽差约 300px，视觉上就是「卡片没对齐」
- 实测（1600 视口）：info 行末尾 x=996、环形行 x=1244、端口行 x=1540 —— 参差不齐
- 修复：文件末尾新增对齐块，`min-width: 1024px` 下改用 `repeat(auto-fit, minmax(Npx, 1fr))`（info 200px / rings 280px / sys 240px / port·net·wifi 400px），行数不变但每行都撑满容器
- 复测：各行 `unusedRight=0`，卡片左右边缘统一在 316..1540（sys-grid 末行 11 项填 4 列留下的空位属正常换行，非错行）

**卡片不够透——毛玻璃把壁纸"洗白"**
- 根因（量化）：`--mz-panel-bg` 为 `rgba(255,255,255,0.72)`。截图采样显示卡片内部像素均值 (219,220,224)，而页面壁纸背景为 (147,150,159)，差值约 73 —— 卡片近似实色白板，壁纸完全透不出来
- 修复：透明度调至经典 glassmorphism 区间——亮色 `0.38 / 0.58 / 0.22`（bg / bg-strong / bg-soft），暗色 `0.42 / 0.64 / 0.26`；文字 halo 同步加强保证可读
- 复测：卡片均值降到 (180-190)，与壁纸差值由 73 降到约 23，壁纸清晰可透；四分辨率无横向溢出、无 pageerror

**概览页标题未汉化（System information / DHCP leases / UPnP port mappings 等）**
- 根因：`po` 译文一直齐全（`系统信息` / `DHCP 租约` / `UPnP 端口映射` 等均在 `theme.po` 中），但更名 `luci-theme-mintzero → luci-theme-mint` 后设备上只有旧的 `luci-theme-mintzero.zh-cn.lmo`，**不存在** `luci-theme-mint.zh-cn.lmo`，LuCI 查不到对应语言目录，于是回退英文原文
- 修复：`scripts/po2lmo.py` 重新编译生成 `luci-theme-mint.zh-cn.lmo` 并部署到 `/usr/lib/lua/luci/i18n/`；同时把 `po/zh_Hans/theme.po` 更名为 `luci-theme-mint.po`，使 `luci.mk` 构建时稳定产出与包名一致的 lmo，避免下次再缺
- 复测：概览标题全部中文（端口状态 / 网络 / 系统信息 / DHCP 租约 / 无线 / UPnP 端口映射），英文串消失

### Added (2026-09-07)

**随机壁纸按设备切换 + NTP 列表样式**
- 随机壁纸改为按访问设备类型自动选择第三方 API：桌面端 `api.paugram.com/wallpaper/`，移动端（UA 检测）`uapis.cn/api/v1/random/image?category=acg&type=mb`；带时间戳防缓存，API 加载失败自动回退本地 Bing 壁纸池，再失败回退渐变兜底（原流程不受影响）
- 候选 NTP 服务器等 cbi-dynlist 动态列表主题化：条目卡片化（浅灰底、圆角、悬停描边）、新增输入行与 + 按钮对齐排版，宽度收敛至 480px
- cbi-dynlist 条目注入可见的「编辑 ✎ / 删除 ✕」按钮：LuCSI 原生删除热区是不可见的 ::after 伪元素（本主题无样式导致热区为 0 宽，无法删除），且原生无就地编辑；通过 `L.dom.findClassInstance` 调用 DynamicList 组件原生 removeItem/addItem，保证与 uci staging 正确同步（实测编辑/删除/保存并应用后 /etc/config/system 生效）

**顶栏与状态栏增强**
- 顶栏面包屑导航（`renderBreadcrumb`，基于 `L.env.dispatchpath` 逐级显示当前页面路径）
- 主题切换按钮选择持久化到 localStorage（`mz-theme`），刷新后不再回退
- 端口/网络/系统/DHCP/无线/UPnP 区块识别改为中英文双语匹配，兼容英文界面
- postrm 卸载时同时清理 `/usr/share/luci/acl.d/` 与 `/usr/share/rpcd/acl.d/` 两处 ACL 及主题 uci 变体

**弹窗系统与表单布局**
- 全站弹窗系统样式（`#modal_overlay` fixed 全屏 + z-index 2000 + 半透明背景，`.modal` 居中 720px/90vh 内部滚动，640px 以下窄屏适配）
- 保存/应用操作栏吸底（`.cbi-page-actions` sticky bottom），滚动时始终可见
- 「保存并应用」统一主色（蓝底白字 + hover 提亮），样式一致不再丑
- 表单控件全局 `box-sizing: border-box`，修复 system 页输入框溢出字段容器 26px
- 表格操作列相邻按钮间距 + 单元格 `overflow-wrap`

**壁纸功能与第三方兼容**
- 壁纸来源可选 Bing 每日壁纸或自定义图片；自定义支持上传图片（≤3MB，写入 /www/luci-static/mint/custom.jpg）或填写 http(s) 图片直链
- 「刷新 Bing 缓存」手动刷新按钮（新增 `admin/mint/wallpaper/refresh` JSON 端点，跳过节流锁强制重取）
- cbi 选项卡（`ul.cbi-tabmenu`）完整样式：active 蓝色下划线、disabled 灰色
- 第三方应用设计变量桥接：定义 `--brand/--surface/--text/--hairline` 等 21 个变量映射到主题 token（修复 taygedo 等应用白底白字不可见）
- 新增 `scripts/po2lmo.py`（po → lmo 编译器，PoC 于实机验证）

### Changed (2026-09-07)

**主题与仓库更名 → luci-theme-mint**
- 包名、GitHub 仓库、ACL/menu 清单文件、po Project-Id-Version、CI 构建路径与产物统一更名 `luci-theme-mintzero` → `luci-theme-mint`
- 路径统一 `mintzero` → `mint`：`/luci-static/mint`、`/www/luci-static/mint`、`ucode/mint/`、`view/mint/`、`rpcd/mint`、`/etc/config/mint`
- 标识符同步：UCI 段 `mint.wallpaper`、ubus 对象 `mint`、`window.mintWallpaper`、ucode 模块 `luci.mint.wallpaper`、视图 `mint.sysauth`、`L.require('menu-mint')`
- 变体更名 `mintzero-light/dark` → `mint-light/dark`（symlink 重建）、注册键 `MintLight/MintDark`
- 注意：UCI 段名变更（`mintzero` → `mint`）会使升级后旧壁纸配置失效并回退默认，旧段有意不做迁移

**随机壁纸多源化**
- 随机壁纸支持多源：桌面端默认 `api.paugram.com/wallpaper/` + `t.alcy.cc/bd`，移动端默认 `api.seaya.link/wap` + `t.alcy.cc/mp`
- 前端随机打乱源列表逐个尝试，单源失败自动切换下一源，全部失败才回退 CSS 渐变
- 设置页新增「桌面随机源 / 移动随机源」多值列表（每行一个 URL），支持自定义增删；留空使用内置默认
- 登录页来源标注改为动态显示实际命中的随机源域名

**移动端壁纸 API 更换**
- 移动端随机壁纸源由 `uapis.cn/api/v1/random/image?category=acg&type=mb` 更换为 `api.seaya.link/wap`（桌面端 Paugram 不变）；登录页/管理页来源标注与 po 文案同步更新

**壁纸设置迁移 + 按钮挂载加固**
- 移除 mint 独立菜单与 Dashboard 页面（与概览页功能冲突）：删除 `admin/mint/*` 全部路由与 `view/mint/dashboard.js`
- 壁纸设置迁移至「系统」菜单下，更名「Mint壁纸设置」（`admin/system/mintwallpaper/settings`），刷新端点同步迁移至 `admin/system/mintwallpaper/refresh`
- 壁纸页刷新/上传按钮挂载逻辑加固：优先注入地图自带操作栏（与保存/重置同排），操作栏未渲染时回退插入地图顶部

**去 Bing 化 + RPC 刷新端点**
- 壁纸页全面去 Bing 字样：标题「Mint Wallpaper」，来源选项「每日壁纸（Bing 源）/ 自定义图片」，市场选项改为「壁纸市场（每日模式）」，刷新按钮改为「刷新壁纸缓存」
- 刷新端点从页面路由改为 **rpcd ubus 服务**（`/usr/libexec/rpcd/mint`，方法 `mint refresh`）：不再注册菜单/tab，点击按钮不再跳出后台 JSON 页面，改由 ubus RPC 原地返回状态
- 部署设置 `luci.main.resource_version=mz20260907f` 强制所有客户端浏览器刷新静态资源缓存（解决 view JS 缓存导致按钮/选项不显示的问题）
- 清理 po 中 Dashboard 遗留条目，新增迁移后文案的简体中文翻译

**双端独立壁纸源**
- 新增「后台页面随机壁纸」开关：开启后随机壁纸**全局覆盖登录后的所有页面**（body 背景 + 可调遮罩 + 面板 86% 半透明，保证文字可读），关闭后仅登录页生效
- 随机壁纸每次登录/刷新自动更换（时间戳防缓存），加载失败自动回退渐变兜底
- 壁纸来源重构为**桌面端 / 手机端双组独立配置**：各组可选「随机 API（桌面 Paugram / 手机 Uapis ACG）」或「自定义图片」
- 自定义支持直链或上传（分别写入 custom-pc.jpg / custom-mobile.jpg，3MB 上限）
- 登录页按访问设备 UA 自动使用对应组的配置，失败保持渐变兜底
- 移除 Bing 每日壁纸模式及市场/缓存期选项，上传后端服务改经 rpcd ubus
- 登录页顶部移除 mint 文字，改用方形像素头像图（login-logo.png，泛洪抠白保透明、88px 圆角展示）
- 登录页 logo 改用圆形像素头像（login-logo.png 换为圆形透明版）
- 状态概览页信息卡上方新增方形像素头像 banner（overview-banner.png，96px 居中，随面板惰性创建）
- 侧栏品牌区移除 mint 文字，仅保留居中的品牌 logo
- 侧栏品牌 logo 更新为方形像素头像（overview-banner.png，56px 圆角居中）
- 主题显示名更名为 **Mint**（LUCI_TITLE=Mint Theme、README、alt 文本；包名/路径随 2026-09-07 仓库更名统一为 mint）

**毛玻璃卡片与表格自适应**
- 壁纸模式下全部卡片统一改为**半透明毛玻璃**：rgba 面板底（浅 0.72 / 暗 0.72）+ `backdrop-filter: blur(12px) saturate(1.15)`，hover/focus-within 时提高至 0.88 保证焦点区可读，disabled 态降至 0.58 并降饱和
- 标题/标签/说明文字加白色/深色 **halo 文字阴影**，配合加深的遮罩保证明暗两种模式下对比度
- **接口总览表不再撑破卡片**：table width 100% + 单元格 overflow-wrap:anywhere，卡片容器 overflow-x:auto（窄屏局部滚动），按钮 nowrap + 操作栏 flex-wrap
- 实测 1600/1280/768/390 四种分辨率均无横向滚动、无文字截断，深色模式卡片 rgba(23,30,44,0.86) + 浅色文字正常

**概览页与接口页卡片透明化 + 信息精简**
- **补全所有遗漏的半透明卡片类**：概览页 .mz-net-card/.mz-sys-grid/.mz-wifi-card/.mz-empty-state/.mz-table-card、接口页 .ifacebox/.ifacebox-head/.ifacebox-body/.ifacebadge 等全部纳入毛玻璃样式，壁纸可在所有页面卡片后透出
- 新增 --mz-color-primary-rgb 变量，使网络/DHCP 表格蓝色表头也能半透明；接口页防火墙区域表头保留色相但强制 78% 透明度（深色模式 55%），覆盖内联样式
- **概览页信息精简**：网络卡片仅保留 协议/地址/网关/DNS/已连接 5 项关键信息，DNS 多条合并为一条，过长地址截断并显示 title；内存卡片移除冗长的缓存/缓冲明细，仅保留 used/total；端口卡片内边距与字号整体收紧
- 网络卡片 body 改为 2 列网格布局，标签与值对齐更整齐；系统信息网格本身作为半透明卡片容器（其子项保持透明底+底边框），兼顾统一风格与可读性

**品牌形象更新**
- 全新像素风品牌 logo：侧栏品牌、登录页 logo、favicon（svg/48/180）全部替换为像素猫娘头像
- 边缘白底经泛洪填充转为透明、圆形裁剪去除 JPEG 噪点，透明像素完整保留

### Fixed (2026-09-07)

**实机验证修复（2026-09-07）**
- 升级后壁纸配置丢失：更名使旧 UCI 段 `mintzero.wallpaper` 不再被读取（新代码只读 `mint.wallpaper`），且旧包 postrm 会删除 `/www/luci-static/mintzero/` 下上传的壁纸 → uci-defaults 增加一次性迁移：复制旧段全部选项至 `mint.wallpaper`、迁移自定义图片文件、清理旧段与 `/etc/config/mintzero`、并修正指向已删除 `mintzero` 静态路径的 mediaurlbase

- 修复 header.ut 模板编译错误：`{% else: %}` 的非法冒号导致 LuCI ucode 模板引擎报 `Syntax error: Expecting expression`，主题加载失败回退 fallback → 改为 `{% else %}`（`if/elif/for` 条件行带冒号为官方写法，`else` 不接受冒号）
**第二轮代码审查 · 遗留修复（本轮）**
- P2：防火墙 zone 头颜色桥接失效——`initZoneColors` 正则 `rgba\?\(` 把 `?` 转义为字面量，永不匹配 computed 背景色（`rgba(...)`/`rgb(...)`）→ `--zone-color-rgb` 从不设置，壁纸模式下所有 zone 头回退为同一种灰 → 正则改回 `rgba?\(`（程序验证 4 种实际格式全部匹配）
- P2：登录卡壁纸遮挡——`.mz-login-card` 透明度 0.72 叠加登录页遮罩后卡片区壁纸透出仅 ≈11–15% → 降至 0.55（透出 ≈18–25%），保留 blur(14px) 毛玻璃保证文字对比度
- P3：登出对空会话仍静默——`L.ui.sessions.getLocal()` 返回空会话（登录态已过期）时点击登出无任何响应 → 空会话分支直接跳转 `/admin/logout`
- P3：overview.js `setHtml` 死代码（全仓无调用方）→ 删除

**代码审查 TZ/OT 全量修复**
- 壁纸链路：移除无实际缓存的「刷新壁纸缓存」按钮与 rpcd 预取逻辑（`refresh` 方法保留为兼容桩）；上传改用 FileReader base64 + 防重入；overlay/blur 表单校验 + 服务端钳制；`ui_random` 默认与模板对齐；菜单标题英文化（Mint Wallpaper / Wallpaper Settings）
- 模板：overview.js 仅在 Status > Overview 加载；配色变体由 mediaurlbase 推导；theme-color 跟随变体；移除永久隐藏的 modemenu；壁纸后端失败时输出 HTML 注释
- 前端：壁纸 UA/API 逻辑收敛到共享 `mzWpUtil`；登录页与管理页图片请求抑制 referrer；登出检查响应状态；目录面包屑与菜单渲染时序加固
- i18n：po/pot 按当前代码重建（77 条），删除 Dashboard/Bing 遗留与重复条目，补全新增文案的简体中文翻译
- 资源：删除 3 个内嵌光栅图的 logo SVG（约 418KB）；favicon.svg 换成真正的轻量矢量图标
- 文档：README 去 Bing 化并同步最新机制、目录树、设置路径与选项表

**手机端排版与壁纸按钮**
- P1：手机端保存/应用/重置按钮全宽——480/768px 断点把操作栏堆叠并把所有按钮拉伸到 100% 宽 → 恢复行内排列、内容自适应宽度（32px 高）
- P1：应用成功后无任何提示（LuCSI 应用完成仅关闭弹窗）——主题监听 `uci-applied` / `uci-reverted` 事件弹出成功/回滚通知；因应用成功后页面会重载，通知通过 sessionStorage 标记在重载后的页面上补显
- P2：「正在应用更改」弹窗美化：居中排版、加大字号、底部进度条动画
- P1：手机端保存/应用/重置按钮过宽——统一收窄（内容自适应宽、32px 等高、文字不截断，下拉省略符隐藏仅保留箭头）

**壁纸背景排版**
- P0：全局壁纸开启后整个主内容被顶到页面下方——壁纸样式误将固定定位的侧栏改为 position:relative 使其进入文档流 → 侧栏定位不再被触碰，仅提升层级，并同步处理 stray 选择器
- 表格与表单区块在壁纸模式下补 90% 底色，保证可读性
- 登录欢迎语更新为「可可，嗨嗨嗨~！登录以管理你的网络。」

**概览页修复**
- 移除状态概览面板上方的像素头像 banner（应需求撤下），相关 JS 注入与 CSS 一并清理
- 修复 overview.js 在 banner 调整过程中被误损坏的问题：概览面板数据卡片与 CPU/内存/存储圆环恢复正常渲染（从完好历史版本恢复）
- 壁纸来源新增两个随机源选项：「随机壁纸（Paugram）」「随机 ACG（Uapis）」，选择后登录页直接从对应 API 拉图（模式经 header.ut 嵌入前端）；随机壁纸开关仅在每日壁纸模式下作为兼容开关

**ACL / 主题 / 弹窗链路**
- P0：ACL 只安装到 `/usr/share/luci/acl.d/` 而 rpcd 只读 `/usr/share/rpcd/acl.d/`，致 `wallpaper` 授权组缺失、`admin/mint` 菜单整体消失 → 新增 `theme/root/usr/share/rpcd/acl.d/luci-theme-mint.json`，实机验证菜单恢复
- P1：暗色模式下 `warningbox`/`alert-message`/`infobox`/`cbi-change-list`/`#xhr_poll_status` 硬编码浅色背景刺眼 → 追加 `html[data-theme="dark"]` 覆盖改用 token 颜色
- P1：footer.ut 隐藏条件表达式缺少右括号（`>= 0` 后语法错误）致整个内联脚本失效 → 补全括号，`node --check` 通过
- P2：SVG 圆环 `transform-origin` 重复声明 → 收敛为 `transform-box: fill-box; transform-origin: center`
- P2：`htdocs/luci-static/mint/menu-mint.js` 死代码副本与 `resources/` 版本冲突 → 删除
- P0：LuCI 动态弹窗（无线编辑、上传、保存并应用进度等）完全无样式——`#modal_overlay` 为 body 末尾静态透明 div（实测 1600×10177px、y=-4639），被 z-40 侧栏遮挡且进度弹窗不可见（用户误以为卡死）→ 弹窗层修复后全部正常居中显示
- P1：`#modal_overlay` 初版无条件显示暗色背景与空弹窗白块 → 改为仅 `body.modal-overlay-active` 时显示背景/弹窗，默认 `pointer-events: none` 不再拦截登录页点击
- P1：syslog/dmesg 日志输出为裸 `<textarea>`，浏览器默认宽约 163px，日志被压成窄条 → `#maincontent textarea` 全宽 + 等宽字体，PC/手机验证正常
- P1：日志页筛选行 label 中途折行、控件溢出（手机端）→ 筛选行 flex 换行 + label 禁止折行
- P2：`.mz-view` 横向溢出护栏（`overflow-x: clip`），网络页表格轻微出血不再撑开页面

**壁纸与页面功能修复**
- P0：**所有页面 tab 选项卡失效、编辑弹窗全部选项平铺**——根因是 LuCI `switchTab()` 只切换 `data-tab-active` 属性，面板隐藏完全依赖主题 CSS，而主题缺少 `[data-tab-active="false"] { display: none }` 规则 → 补上后 tab 正常切换，弹窗高度从 10177px 恢复正常
- P0：cbi-dropdown 关闭态未隐藏未选中项（LuCI 用 `selected` **属性**而非 class），保存并应用按钮堆叠所有选项、高度 92px，误杀修复时又因选择器写错导致按钮文字消失 → 最终规则 `:not([selected]):not(.hidden)`
- P1：手机端每个选项间隔 ~340px——`.cbi-value-field { flex: 1 1 300px }` 的 basis 在列布局下变成高度 300px → 移动端改为 `flex: 1 1 auto`
- P1：wallpaper.uc 中 `validCustomUrl` 定义在调用方 `loadConfig` 之后，ucode 不做函数提升，登录页壁纸报 error、刷新端点 500 → 函数移到调用前
- P1：设备 `/etc/config/mint` 的 section type 为 `mint` 而视图按 `wallpaper` 过滤，设置页显示「尚无任何配置」→ 修正设备配置类型
- P2：主题 po 翻译未安装到设备（无 lmo 文件），Dashboard/mint 页面中英混杂 → po 编译 lmo 部署至 `/usr/lib/lua/luci/i18n/luci-theme-mint.zh-cn.lmo`，登录页与 mint 页面全中文
- P2：Dashboard Resources 卡片值显示 N/A 且真实值散落行外（DOM 结构错误）→ 值直接填入对应行
- P2：移动端保存/应用按钮全宽且过高 → 统一 32px 高、auto 宽度、行内排列，与「保存/重置」对齐
- P1：概览页数据冻结不自动刷新——footer.ut 的 `initOverview()` 只在加载时解析一次被 LuCI 轮询更新的隐藏原始表格，生成的面板是静态快照 → 改为可重入（重建前先移除旧面板）并每 5 秒从实时数据重建，实测运行时间/负载/CPU 使用率持续更新
- P2：保存并应用下拉按钮与「保存/重置」高度不一致 → 统一 34px（移动端 32px），下拉内部行高压平
- P2：概览信息卡内容串行（"OWRT型号Hiveton…"）——innerText 正则跨单元格吞并相邻标签 → 改为逐单元格 label→value 解析，中英文标签均支持

**品牌与交互细节**
- P1：随机壁纸去除 Bing 壁纸池回退——随机模式仅使用按设备选择的第三方 API（桌面 paugram / 移动 uapis acg-mb），API 失败时保持 CSS 渐变兜底
- P2：侧栏菜单组双重三角形显示异常——`.mz-menu-group > a::after` 在两处重复定义（border 三角与字符 ▾ 属性混合同时渲染）→ 合并为单一 border 三角
- P1：无线编辑弹窗手机端每个标签行被撑到 120px 高——`.modal .cbi-value-title { flex: 0 0 120px }` 的 flex-basis 在列布局下变成高度 → 改为 `flex: 0 0 auto; width: 100%`，弹窗内表单行恢复紧凑
- P1：壁纸设置页「刷新 Bing 缓存」「上传自定义图片」按钮缺少 type=button，点击触发 LuCI 表单提交导致跳转页面 → 补 `type='button'` 与 preventDefault，点击后原地弹出通知
- P2：弹窗内无线状态 <output> 文本块限高 9rem 内部滚动，避免状态行超过 1000px
- P2：保存/重置按钮配色对齐官方 LuCI 分层（保存浅蓝、重置浅红），修复合并后的基础按钮规则在文件后部覆盖前部配色层的问题（配色层追加至文件末尾）

### Added（早期迭代，未标日期）
- 菜单一级标题加粗 700 字重 + 深色，与二级菜单明确区分
- 顶部信息卡片（设备/运行时间/平均负载/型号）统一 72px 高度 + 垂直居中
- 系统信息 11 项整合到单个大卡片内，分隔线列表布局
- DHCP 租约 / 已连接站点 / UPnP 端口映射表格全宽居左对齐
- 端口状态 / 网络上游 / 无线 radio 固定 2 列布局
- 所有卡片及内部内容左对齐（标题 + 文字 + 容器）
- 保存并应用按钮蓝色样式 + hover 上浮效果 + 阴影
- 保存提示 / 变更列表 / 警告框语义色样式（warning 黄 / error 红 / success 绿）
- PC 端宽屏内容居中（max-width 1280px）+ 多列网格优化
- 菜单 FOUC 闪烁修复（JS 处理完成后才显示菜单）
- 概览页全 section 重写为卡片 UI（系统信息 / DHCP 租约 / 无线 / 已连接站点 / UPnP 端口映射）
- 概览页端口状态卡片（接口名 / 连接状态 / 速率 / 所属区域 / 上下行流量）
- 概览页网络上游卡片（IPv4/IPv6 协议 / 地址 / 网关 / DNS / 有效期 / 设备信息）
- 页脚居中 + mint 链接指向主题仓库
- 圆环进度条内显示百分比数字（SVG text，方向修正）

### Changed（早期迭代，未标日期）
- 系统信息 label 固定 110px 灰色，value 左对齐 flex:1 占满剩余空间
- 信息卡片 label .78rem 500 字重，value 1rem 700 字重
- 菜单一级标题 .95rem 700 字重深色，二级 .88rem 400 字重灰色
- 网格容器从 `1fr` 拉伸改为固定最大列宽，卡片不拉伸
- 表格卡片去掉 max-width 限制，全宽居左

### Fixed（早期迭代，未标日期）
- 菜单顶部多余的"管理权"节点移除（子项提升到顶层）
- 系统信息卡片高度不一致（固件版本换行致 64px vs 42px）→ 统一等高
- apply 按钮无 `.important` 类时显示为白色 → 强制蓝色
- 残留 LuCI 页面标题 H2 可见 → 隐藏
- 网页刷新时菜单先展开再折叠（FOUC）→ CSS 默认隐藏，JS 处理完加 class 显示
- PC 端内容过宽无 max-width 限制 → 1280px 居中
- 圆环百分比文字方向错误（SVG rotate(-90deg) 连带 text 旋转）→ text 反向 rotate(90deg)
- 全页面排版混乱 / 按钮样式错误 / 响应式缺失 → 全面补充 LuCI 组件样式
- 保存并应用下拉按钮显示为蓝色块 + 项目符号列表 → 补充 `.cbi-dropdown` 系列样式

---

## [0.2.0] - 2026-09-06

### Added
- 概览页 3 圆形进度环（CPU / 内存 / 存储），SVG 绘制，百分比内显
- 概览页 4 信息卡（设备 / 运行时间 / 平均负载 / 型号）
- 概览页内存详情（可用数 / 已使用 / 已缓冲 / 已缓存）
- 可折叠侧边栏菜单（8 分组，状态存 localStorage）
- 全面 UI 重写：按钮 / 表单 / 表格 / 卡片 / 菜单 / 响应式
- 深色登录页 + Bing 每日壁纸背景

### Fixed
- wallpaper.uc ucode 兼容修复（for-of / indexOf / shquote / 函数声明提升 / 模块导出）
- uci-defaults 变体名含连字符致 `uci: Parse error` → 改用驼峰 `MintLight` / `MintDark`
- 按钮下拉 / 表单布局 / 菜单默认折叠 / 响应式样式
- 圆环内百分比数字显示

---

## [0.1.0] - 2026-09-05

### Added
- 初始主题框架：header.ut / footer.ut / cascade.css
- 4 主题变体注册（mint / mint-light / mint-dark / mint-dark-compact）
- Bing 每日壁纸后端（wallpaper.uc，兼容 libucode20230711）
- GitHub Actions CI（预编译 SDK，构建时间 40-60min 降至 5-10min）
- nightly APK 自动发布

### Fixed
- P0：header.ut 调用不存在的 `uci.connect()` 致登录页 500
- P0：sysauth 双表单致登录输入丢失
- P1：壁纸端点无路由 / wallpaper.uc 引用未导入符号 / 三变体共用 mediaurlbase
- README 白名单描述修正
- Makefile postrm 同步变体名

---

[1.3.0]: https://github.com/LianXia233/luci-theme-mint/compare/v1.0.2...v1.3.0
[1.0.2]: https://github.com/LianXia233/luci-theme-mint/compare/v0.2.0...v1.0.2
[Unreleased]: https://github.com/LianXia233/luci-theme-mint/compare/v1.3.0...HEAD
[0.2.0]: https://github.com/LianXia233/luci-theme-mint/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LianXia233/luci-theme-mint/releases/tag/v0.1.0
