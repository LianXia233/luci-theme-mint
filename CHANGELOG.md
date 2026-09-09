# 更新日志

本文档记录 **luci-theme-mint** 的所有重要变更。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

---

## [Unreleased]

### 修复（CI / 云编译）

- **根因修复：luci-only feed 导致依赖链静默丢失。** `build.yml` 曾用
  `src-git luci ...` 整体覆盖 SDK 自带的 `feeds.conf.default`，元数据扫描时
  `luci-base` 对 `curl`、`libubox`、`libubus` 等的依赖被静默丢弃
  （"has a dependency on 'curl', which does not exist"），编译深入到
  lucihttp / ucode-mod-html 时才因缺少 `lua.h` / `ucode/module.h` 失败。现在
  保留 SDK 自带 feed 集合（base feed 提供 rpcd/ucode/libubox，packages feed
  提供 curl/cgi-io），并新增 `build-package.sh` 的 `setup_feeds()`：
  feeds update/install 失败即中止，安装后校验依赖链源包全部就位。
- **根因修复：`USE_APK` 在 24.10+/25.12 SDK 中是无提示（promptless）kconfig
  符号**（SDK 的 `Config-build.in` 里 `default y`），`.config` 写
  `CONFIG_USE_APK=n` 会被 `make defconfig` 静默改回 `=y`。新
  `get-openwrt-sdk.sh` 会解析 SDK 烘焙的 `USE_APK` 值判定 apk/ipk 后端；
  `build-package.sh` 在 defconfig 后复核实际生效值，ipk 构建遇到烘焙
  `=y` 的 SDK 时自动回退到 24.10 / 23.05（`--allow-legacy`），产物元数据标记
  `legacy_compat_sdk=1`。
- 移除会掩盖真实失败的三处静默：apt 步骤 `|| true`（改为必需包严格安装、
  `apk-tools`/`opkg` 不可用时输出 `::warning::`）、host tools 步骤
  `|| echo "::warning::"`（po2lmo/jsmin 编译失败即中止）、主题编译
  `IGNORE_ERRORS=1`（依赖链必须真实编过）。
- nightly 产物同名互相覆盖（每个矩阵任务都产出 `luci-theme-mint-0.*`，上传后
  只剩一个 asset）：产物名无条件追加 `-{版本}-{目标}-{SDK来源}` 后缀。
- `.config` 布尔关闭项改用规范写法 `# CONFIG_LUCI_CSSTIDY is not set`
  （`CONFIG_X=n` 对布尔符号不是合法语法）。
- 新增 `scripts/build-package.sh`（统一 SDK 获取、feeds、配置、构建、
  `.buildinfo.txt` 证据输出）与重写的 `scripts/get-openwrt-sdk.sh`
  （版本/内核/发布号/包格式后端探测，支持镜像覆盖）；三个 workflow 全部
  改为真实依赖链构建。

### 修复（主题）

- 概览页旧面板（端口状态/DHCP 租约/无线/UPnP）标题不翻译：overview.js 的 `__`
  回退到不存在的全局 `_` 时原样返回英文。现优先走 LuCI 的 `_`，未命中时用与
  固件 lmo 构建器一致的服务端 SuperFastHash（JS 实现）查询 LuCI 客户端目录
  （window.TR）——规避了 luci.js 客户端 sfh 在 len%4==2 字符串上与固件目录键
  系统性不一致的问题（"UPnP port mappings" 等永远无法命中的根源）。
- 壁纸开关缺省语义加固：header.ut 现在把 uci 中缺失的 `ui_random` 视为默认值
  （开启，与 wallpaper.uc 的 `?? '1'` 对齐）。此前选项一旦异常丢失（如 uci 提交
  被内存异常打断），前端会误判为关闭并静默停用壁纸功能。

### 改进（主题）

- 移动端标题去重（用户反馈：顶栏与页内标题重复显示）：≤854px 隐藏所有页面级标题
  （`#mz-view > h2` 与概览 `.mint-ovd-header`），仅保留 `.mz-mobilebar` 中的标题；
  概览刷新按钮（`.mint-ovd-refresh`）由 menu-mint.js 按断点搬入顶栏右侧（保留事件与
  loading 动画），跨回桌面宽度时自动搬回原 header，桌面端页内标题与刷新按钮完全不受影响。

## [1.3.4] - 2026-09-09

### 改进

- 移动端导航按钮重排：汉堡按钮从固定左上角移入新增的粘性顶栏（`.mz-mobilebar`，含页面标题），
  移除 `#mz-view` 在 854/640/480px 断点的整列左侧留白，消除按钮下方的空白列；
  顶栏随页面滚动保持吸顶，抽屉打开时与页面一同被遮罩压暗，内容零遮挡。
- 桌面端布局不受影响：顶栏在 >854px 完全隐藏，按钮恢复原有隐藏状态。

## [1.3.3] - 2026-09-09

### Changed

- **透明度整体回调一档**（用户反馈"再稍微透一点点"）：亮色壁纸模式卡片 0.55→0.45、侧栏/顶栏 0.68→0.58、输入框 0.66→0.58、Modal 0.88→0.84、页面水洗 overlay×1.2→×0.95（默认落约 0.43，与卡片同档）；无 backdrop-filter 的 fallback 亮色填充同步回调
- **暗色主题改为「纯黑背景 + 全局毛玻璃」，不再使用壁纸**：`mz-has-wallpaper` 玻璃组件层在暗色下照常生效，但壁纸图层被涂黑（`::after` 清空、`::before` 纯黑无模糊），JS 侧暗色直接跳过壁纸抓取（零外网请求）；主题切换（按钮或跟随系统）实时同步玻璃/壁纸状态。壁纸现为亮色主题专属
- **登录页欢迎语翻译更新**：zh_Hans 译文改为「可可，嗨嗨嗨~！登录以管理您的网络。」（英文 msgid 不变）
- **ACL 收紧**：撤销会话对 `uci:mint` 的写权限（`write.uci` 移除）——原生 cbi.js 的会话级 `uci set` 从此无法暂存/提交 mint 配置，壁纸设置只能经 root 上下文的 `mint save`（带 syslog 审计）写入；实测会话 `uci set` 已被拒绝且无暂存残留。这也根断了「幽灵保存」的又一条隐蔽路径

### Fixed

- **登录页欢迎语显示「你」而非「您」**：LuCI 登录页翻译目录为全机合并加载，同仓库家族的 `luci-theme-mintzero.zh-cn.lmo` 内含同一 msgid 的「你」版译文且按字母序后加载、覆盖了本主题译文。已在设备侧对 mintzero lmo 做等长字节补丁（你→您）；luci-theme-mintzero 仓库的 po 需同步修正（另行处理）

## [1.3.2] - 2026-09-09

### Changed

- **卡片间隙与卡片观感统一**：全页壁纸遮罩层（`body.mz-has-wallpaper::before`）从无模糊改为与卡片相同的玻璃模糊（`blur(max(--mz-glass-blur, --mz-wallpaper-blur)) saturate()`，亮色 14px/暗色 12px，用户配置的壁纸模糊取较大值保留），卡片间隙区域与卡片内部视觉一致；不支持 CSS 数值函数的引擎回落到原 `blur(--mz-wallpaper-blur)`

### Fixed

- **`ui_random` 等开关被"幽灵保存"写回旧值**：根因是保存动作会把页面渲染时的全部控件状态原样提交——一个在开关为 0 时渲染的旧标签页，之后任何一次未改动任何控件的「保存」都会把 0 写回。现改为渲染时快照（`data-mint-init`）、保存时只提交用户实际改动的字段：未编辑任何控件时点保存零写入（空 section 不再触发 RPC 与 commit）。radio 组在切换选择时会补发被取消旧项的 `0`，保证完整回写
- **rpcd `mint save` 审计日志**：每次 commit 以 `mint-save` 标签写 syslog（仅记 option 名不含值），`logread | grep mint-save` 可追溯所有写入

## [1.3.1] - 2026-09-09

### Changed - 透明度统一（可读性修正）

- **全局背景水洗与卡片对齐**：亮色主题下管理页白色水洗从约 0.25（overlay ×0.55）提升到约 0.54（overlay ×1.2），与卡片 0.55 白玻璃同档，内容区域不再比卡片更透；壁纸在卡片之外仍然可见。登录页样式保持不变
- **表头/悬停行抬平**：通用表头 0.18→0.38、悬停行 0.16→0.30、Overview 主色表头 0.16→0.32，均明确高于所在卡片的填充档位
- **次级文字对比度**：亮色壁纸模式 `--mz-color-text-muted` 透明度 0.68→0.8，弱化文字在亮壁纸区域保持可读

## [1.3.0] - 2026-09-09

### Changed - 壁纸模式翻转为亮色玻璃（参考 GitHub 代理加速页面风格）

- **亮色玻璃调色板**：壁纸模式默认调色板整体翻转——卡片/侧栏/顶栏从 7% 白改为 55%-68% 白色磨砂玻璃（blur 14/16px、saturate 1.25），文字从浅色改为深岩蓝 `#1c2736`，页面遮罩从深色压暗改为轻柔白色水洗（用户 overlay 值 × 0.55，默认 0.45 落在约 0.25），壁纸保持鲜活通透
- **明暗双主题各自成套**：`html[data-theme="dark"]` 恢复 1.2.0 的暗色玻璃（7% 白 + 浅色文字 + 深色输入/Modal 填充），亮暗两套令牌完全独立、互不渗漏
- **登录页亮色玻璃卡片**：`.mz-login-card` 从深色 55% 改为白色 62% + 深色文字，输入框白色 75%、label/占位符/记住我/版本号/error 提示全部适配深色文字；移动端 ≤640px 卡片 50% 白
- **组件级适配**：表头从主色 0.4 深条改为 0.16 浅色调（暗色主题保留 0.4 + 白字）；打开的下拉列表改为 96% 白色磨砂（暗色保留深色芯片）；原生 select option、autofill 填充、页面描述文字阴影均按主题拆分
- **透明度阶梯（亮色）**：页面白色水洗 ~0.25 < 卡片 0.55 < chrome 0.68 < 输入框 0.66 < Modal 0.88；暗色阶梯不变（0.07/0.13/0.42/0.86）
- **fallback 同步拆分**：`@supports not (backdrop-filter)` 下亮色主题提升到 84%-97% 白色不透明填充、暗色主题保持深色不透明填充；移动端 ≤768px 模糊降一档（14→10、16→12）

## [1.2.0] - 2026-09-08

### Added - 全局玻璃拟态（Glass-morphism）改造

- **玻璃设计令牌集中化**：`body.mz-has-wallpaper` 作用域新增 `--mz-glass-blur`（卡片 12px）/ `--mz-glass-blur-strong`（侧栏/顶栏/页脚 14px）/ `--mz-glass-blur-input`（输入框 8px）/ `--mz-glass-saturate` / `--mz-glass-border(-strong)` / `--mz-glass-shadow(-lg)` / `--mz-input-bg(-hover)`（深色可读填充 rgba(15,23,42,.42/.52)）/ `--mz-modal-bg`（rgba(17,26,39,.86)）；原有散落的 `blur(12px)/blur(14px)` 硬编码全部改为引用令牌，调参一处生效
- **输入框玻璃化**：壁纸模式下 `input/select/textarea` 使用深色可读填充 + 轻模糊，hover/focus 提升填充与主色描边；补齐 `-webkit-autofill` / `autofill` 覆盖，避免自动填充弹出亮黄色色块；disabled 态回落 soft 填充
- **Modal 玻璃化分层**：`#modal_overlay .modal` 使用专用 `--mz-modal-bg`（0.86 不透明度，比卡片高一档）+ 14px 模糊，确认框内嵌 section/表格转纯透明防止叠加
- **Overview 仪表盘卡片玻璃化**：`overview-dashboard.css` 末尾新增壁纸模式规则，gauge/stat/chart/sys 四类卡片统一 `--mz-panel-bg` + 12px 模糊 + 半透明边框
- **backdrop-filter 兼容 fallback**：`@supports not (backdrop-filter)` 时全部填充令牌提升到 0.78-0.96 不透明深色，无模糊浏览器下文字依然可读
- **移动端性能降级**：≤768px 时模糊半径降一档（12→8px、14→10px、8→6px）、浮层阴影减弱，降低低端 SoC 填充率压力

### Changed - 全局玻璃拟态改造

- 透明度阶梯明确为：页面背景透明 < 侧栏/顶栏 0.13 < 卡片 0.07 < Modal 0.86 < 输入框 0.42（深色填充），重叠容器继续保持去嵌套规则（内层透明）防止透明度相乘
- `--mz-panel-bg` 家族单值驱动明暗双主题（壁纸遮罩已压暗底色），无 per-element 明暗覆盖

## [1.1.1] - 2026-09-08

### Fixed

- **手机端（≤854px 与 ≤480px 断点）页面标题被左上角汉堡按钮遮挡**：根因是 `#mz-view`（ID 选择器）的 `padding: 24px 28px` 覆盖了 `.mz-view` 媒体查询。cascade.css 改为在 `#mz-view` 上按断点加 `padding-left: 64px / 60px`，让页面标题从按钮右侧开始
- **后台页面随机壁纸（`ui_random`）等 CBI 表单开关保存后无反应**：菜单 JS `ensureCbiForm()` 在页面渲染后检测到未被 `<form>` 包裹的 `.cbi-map` 时自动注入一个 form（action = 当前 URL，method = post，enctype = multipart/form-data，附 `token` 与 `cbi.submit=1` 隐藏域），拦截 Save 按钮调用新增的 rpcd `mint save` 方法在 root 上下文执行 `uci set` + `uci commit`，解决设备端 cbi.js 不提交、ubus `uci commit` 被 ACL 拒绝的问题。修复后 `mintwallpaper` 等所有依赖此 form 的页面保存按钮可正常写回 UCI
- **部分用户 Mint 壁纸设置页未汉化**：LuCI 编译出的 catalog 为 `luci-theme-mint.zh-cn.lmo`，但部分固件将 `luci.main.lang` 设为 `zh_cn` / `zh_CN`，导致 `/cgi-bin/luci/admin/translations/zh_cn` 返回空。`Makefile` 的 `postinst` 现在为 `zh_cn` / `zh_CN` 创建指向 `zh-cn.lmo` 的符号链接，`postrm` 同步清理

### Added

- **GitHub Actions 同时构建 IPK 与 APK**：`.github/workflows/build.yml` 矩阵从 2 项扩为 4 项（x86/64 与 mediatek/filogic × OpenWrt SDK 与 ImmortalWrt SDK）。OpenWrt SDK 产出 `.ipk`、ImmortalWrt SDK 产出 `.apk`，Release 产物文件名带 `-openwrt` / `-immortalwrt` 后缀以便区分。`PKGARCH:=all`，两种产物内容相同仅包格式不同
- **README 兼容性章节**：`theme/root/etc/config/mint` 实际声明的 `LUCI_DEPENDS:=+luci-base +curl`、编译矩阵、`/usr/lib/lua/luci/i18n/luci-theme-mint.<lang>.lmo` 翻译目录路径，全部按仓库当前内容写实

### Changed

- 移动端断点下 `.mz-view` 顶部留白收紧、汉堡按钮与首行内容不再重叠

## [1.1.0] - 2026-09-08

### Added (2026-09-08 第四轮 — Overview 实时仪表盘)

- **Overview 实时仪表盘**：rpcd `mint` 对象新增 `dashboard` 方法，一次聚合 CPU（/proc/stat 原始计数）、内存、温度（thermal + hwmon）、存储（df）、负载、运行时间、连接数（conntrack）、动态上行（ubus network dump，不硬编码接口名）与系统信息；前端新增 `overview-dashboard.js` + `overview-dashboard.css`：4 个 SVG 环形仪表、信息卡、3 个 Canvas 实时曲线（180 点 ≈ 3 分钟历史，1/3/10 秒三级刷新）、系统信息网格，DOM 构建一次后原地更新，完整生命周期（离开页面 destroy、返回重启，定时器/观察者全清理），数据缺失显示 `--`/N/A 不造假；`overview.js` 在仪表盘激活时抑制旧的 core/system/network 面板，保留端口/DHCP/无线/UPnP
- **地址卡显示公网出口 IPv4**：后端 `curl ipv4.im` 获取，/tmp 缓存 5 分钟避免每秒轮询打外网；离线显示「未联网」，失败重试 3 次，连续 ≥3 次失败后进入退避，由 ping 223.5.5.5 / 119.29.29.29 探测恢复后再重新抓取
- ACL `luci-theme-mint.json` 放行 `mint dashboard`

### Changed (2026-09-08 第四轮)

- 上行接口卡 sub 行改为内网 IPv4/掩码 + 网关（`·` 分隔单行），IPv6 不再在此显示（统一在地址卡）
- 全站删除 `mz-topbar` 整个元素（含 `#indicators`；LuCI 核心 showIndicator 自带空值保护）；面包屑 `mz-breadcrumb` 连同 `renderBreadcrumb` 彻底移除，CSS 留 `display:none` 兜底
- nftables 状态页（admin/status/nftables）规则表卡片化排版：surface 背景 + 圆角 + 表头底色 + 行分隔 + 68/32 列宽 + `overflow-wrap:anywhere`，修复原裸表格挤压换行的杂乱观感
- 后台页面随机壁纸开关默认关闭：设置表单默认值、uci-defaults、header.ut 运行时判断三处对齐（仅显式 `ui_random=1` 才开启）

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
