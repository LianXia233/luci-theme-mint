# 更新日志

本文档记录 **luci-theme-mint** 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

---

## [Unreleased]

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

[Unreleased]: https://github.com/LianXia233/luci-theme-mint/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/LianXia233/luci-theme-mint/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LianXia233/luci-theme-mint/releases/tag/v0.1.0
