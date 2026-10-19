# 更新日志 / Changelog

本文件记录 luci-theme-mint 与 luci-app-mint-wallpaper 的所有显著变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号沿用资产修订戳（`MINT_ASSET_REV`，格式 `YYYYMMDDx`；自 20261019c
起修订戳由文件 mtime 动态生成，见下条）。

---

## [20261019d] - 2026-10-19 · CI 修复：ucode 兼容门禁静默崩溃

### Fixed 修复

- **正式版发布产物不再使用 nightly 命名**：`build.yml` 的
  `RELEASE_VERSION` 现按事件派生——推送 `v*` tag 时取 tag 名
  （如 `v1.4.0`），手动 dispatch 可传 `release_version`，main 分支
  流水线仍为 `nightly`。此前 tag 构建的产物文件名固定为
  `*-nightly-*.ipk/apk`，与 nightly 通道难以区分；包内真实版本仍由
  git HEAD 派生，不受影响。
- `scripts/verify-ucode-compat.sh` 的桩生成器在提取 import 名单时，别名
  剥离规则 `s/[[:space:]]*as[[:space:]]*.*//` 因空白可选且未锚定，把任何
  以 `as` 开头的标识符（本版新增的 `assetRev`）整段抹除；单名导入
  （footer.ut 的 `import { assetRev } from ...`）被抹成空名单后
  `grep -v '^$'` 以退出码 1 失败，在 `set -e` 下静默终止整个校验脚本，
  造成 Build packages 工作流「building ucode 之后零输出、exit 1」。现改
  为锚定且强制空白的别名规则（`orig as alias` 才改写），空名单删除改用
  恒返回 0 的 `sed '/^$/d'`，并新增 `set -E` ERR 陷阱：今后任何未守卫的
  命令失败都会打印确切行号与命令，不再静默。cmake/make 失败时额外输出
  构建日志尾部便于诊断。校验逻辑与门禁结果不变。

---

## [20261019c] - 2026-10-19 · 第三方插件兼容性修复（modem-pro 反馈清单）

针对 modem-pro（5G 终端）插件方在实机（ImmortalWrt SNAPSHOT + LuCI
Master 26.275）反馈的 LuCI 第三方主题问题清单逐项处置。

### Fixed 修复

- **问题 1：静态资源硬编码版本戳，升级后 JS/CSS 永久缓存**。原实现把
  `?v=` 写死为常量（`header.ut` / `footer.ut` / `cascade.css` 三处），
  包升级替换了 `/www/luci-static/` 下的文件但 URL 不变，客户端永远拿旧
  文件，强刷也无效。现改为：
  - `wallpaper.uc` 新增 `assetRev(media)`：遍历主题静态树（media 目录
    两层深度，排除壁纸 cron 缓存与用户上传等运行时易变文件）与
    `resources/menu-mint.js`、`resources/view/mint/sysauth.js`、
    `resources/view/mint/wallpaper.js` 的 mtime，取最大值作为修订戳；
    包升级重写文件后 mtime 变化，所有 `?v=` 随之失效；两次升级之间
    数值稳定，正常 HTTP 缓存与 304 复用不受影响。文件系统遍历失败时
    回退静态戳 `20261019c`。
  - `header.ut` 不再通过 `cascade.css` 的 `@import` 加载样式层——
    `@import` 内的静态 `?v=` 无法被 ucode 重写，是升级后子样式仍走旧
    缓存的死角。改为模板直接按原级联顺序输出 13 个 `<link>`（compat →
    tokens → base → layout → navigation → container → components →
    wallpaper → background → dark → animations → responsive → login），
    每层携带同一动态修订戳；`cascade.css` 保留作为直连加载的回退聚合
    入口。
  - `overview-banner.png` / `login-logo.png` 的 `<img src>` 同样加动态
    版本戳；`background.css` 中 6 个内置图片 URL 补上静态版本戳。
  - `footer.ut` 的 `L.env.resource_version` 重打逻辑不变：主题类模块
    （`menu-mint.js`、`resources/view/mint/*.js`）继续随主题修订戳
    失效，现在该戳同样由 mtime 驱动。
- **问题 4：TAB 子菜单缺失**。`menu-mint.js` 的 `render()` 原来只走
  三层调度路径并把 TAB 条固定挂在该层节点上，二层根节点
  （`admin/services` 等）与三层以下的插件子页（自注册 children 的
  5G 终端子页等）永远没有 TAB 条。现改为遍历完整调度路径，把 TAB 条
  挂到路径上最后一个拥有 children 的节点，激活项按对应深度匹配；
  `#tabmenu` 容器一直存在，未再改动。
- **问题 5：JS 依赖不存在的 `String.prototype.format`**。浏览器与当前
  LuCI 构建均不提供该原型方法，`%s/%s.js%s".format is not a function`
  会中断所在代码路径。`mz-nftables.js`（5 处）、登录页 `sysauth.js`
  （1 处）、壁纸设置页 `wallpaper.js`（12 处）全部改为本地 `mzFmt()`
  助手（支持 `%s` / `%d` / `%%`），不再触碰字符串原型。

### 已核实无需修复

- **问题 2：服务端菜单缓存 `/tmp/luci-menu.json` 不随升级失效**：mint
  不做任何服务端菜单缓存，菜单树由前端经 `ui.menu.load()` 实时拉取；
  该文件来自 aurora 等其他主题。LuCI 自身的 `/tmp/luci-indexcache*`
  与 `/tmp/luci-modulecache/` 清理已由本主题三个包的 postinst 覆盖
  （20261019b 引入），无需额外动作。
- **问题 3：pjax 拦截干扰动态视图挂载**：mint 全程使用 LuCI 标准的
  SPA 导航（dispatcher 重放 `L.require` 视图加载），主题内无任何
  pjax / history 拦截代码；该现象同样来自 aurora。

### Changed 变更

- 资产修订戳机制从手工常量改为 mtime 动态生成；`cascade.css` 13 处
  `@import` 与 `background.css` 图片 URL 的静态戳统一基线至
  `20261019c`。
- `scripts/verify-render.py` 的页面健康断言由 `cascade.css` 改为
  `css/tokens.css`（页面不再引用聚合入口）。

### 兼容性

- 包名、UCI 键、菜单与 ACL 均不变；新增逻辑只依赖 `luci-base` 已携带
  的 `ucode-mod-fs`。
- `header.ut` / `footer.ut` / `sysauth.ut` 对 `luci.mint.wallpaper`
  模块新增 `assetRev` 读取——该模块与模板同包发布，整包升级无顺序
  问题；手工热部署时需同步更新 `wallpaper.uc`。
- 版本戳数值不再呈 `YYYYMMDDx` 格式（为十进制 mtime），仅影响 URL
  查询串外观，不影响任何功能。

---

## [20261019b] - 2026-10-19 · 安装即注册（打包与升级链路修复）

### Fixed 修复

- **装完重启前 `系统 → 设计` 里没有 Mint**：`apk add` 与 `opkg install` 都不会扫描 `/etc/uci-defaults`，旧包体只在安装时执行了 `--exec`，注册脚本要等下次开机才被消费，于是 `luci.themes` 里缺少 `mint` 项。现在：
  - `scripts/mkadbpkg.py` 生成 apk 的 `scripts` 对象（`post-install` / `post-upgrade` / `post-deinstall`），等价于 `apk mkpkg --script TYPE:FILE`；
  - `scripts/build-direct.sh` 随包附带 `/lib/apk/packages/<pkg>.list`，使 `default_postinst()` 能找到包自带的 `uci-defaults`，并在缺少 `functions.sh` 时直接 `source` 兜底；
  - IPK 的 `postinst` 同样即时执行注册脚本（opkg 也不扫描 `uci-defaults`），执行后删除该文件，避免开机重复运行。
- **`apk del` 报 `syntax error: unexpected fi`**：不带 `uci-defaults` 的包会生成空的 `else ... fi` 分支，导致 `post-deinstall` 以退出码 2 失败、`postrm` 不清 `uci` 条目。现仅在包确实拥有 `uci-defaults` 时才输出 `default_postinst` 块。
- **简中语言项始终写不进去**：生成的脚本写的是 `uci set luci.languages.zh-cn=...`，而 `uci` 选项名不允许 `-`，每次安装都打印 `uci: Parse error`。LuCI 实际使用的键是 `luci.languages.zh_cn`，已改正。
- **升级时 i18n 包的 `uci-defaults` 残留**：两个翻译包只声明了 `post-install`，`apk upgrade` 不会调用任何脚本，`/etc/uci-defaults/luci-i18n-*` 会留到下次开机。现已补 `post-upgrade`（与安装共用同一脚本体），升级后语言项立即写入并消费脚本。

### Changed 变更

- 主题、壁纸与翻译包在安装/升级后统一清理 `/tmp/luci-indexcache*` 与 `/tmp/luci-modulecache/`，并热重载 `rpcd`；不重启服务，已登录会话不中断。
- 资产修订戳 `20261019a → 20261019b`（静态资产无变化，仅用于区分修复后的包体）。

### 兼容性

- 包名、UCI 键与配置默认值不变；`luci.themes.mint` 与 `luci.languages.zh_cn` 为新增/修正的注册项。
- 实机验证：ImmortalWrt SNAPSHOT（apk-tools 3.0.5），删除 `luci.themes.mint` 后 `apk add` 四个包，注册与语言项立即生效，无需重启；`apk del` 无报错并清理 `uci` 条目。

---

## [20261019a] - 2026-10-19 · 修复 ucode 兼容性（issue #17）

### Fixed 修复

- **主题在 ImmortalWrt 25.12 上整体回退（THEME FALLBACK）**：
  `theme/ucode/mint/wallpaper.uc` 使用 `export function` 声明导出，
  而 ucode 在 2026-02-11 修复（commit `552ca3cf55`，"allow export
  function declarations without trailing semicolon"）之前，
  `compile_export()` 会在函数声明后强制消费一个分号，导致模块编译
  失败（`Unexpected token / Expecting ';'`）。ImmortalWrt 25.12.1
  自带的 ucode v0.0.20250529 早于该修复，于是
  `luci.mint.wallpaper` 编译失败 → `header.ut` 模板编译失败 →
  整个主题加载失败并回退默认主题（issue #17）。
  现将三个导出改为普通 `function` 声明 + 文件末尾单条
  `export { getWallpapers, isValidWallpaperName, wallpaperDir };`，
  该写法在所有支持模块语法的 ucode 版本上均可编译。

### Added 新增

- **CI 旧版 ucode 兼容门禁**（`scripts/verify-ucode-compat.sh`）：
  静态层直接拒绝 `export function` 形式；编译层拉取并构建
  ucode v0.0.20250529（ImmortalWrt 25.12 时代版本、修复前），
  以「模块导入 + 模板编译」两条路径真实编译全部 `.uc` / `.ut`
  资产（仓库外导入以等名桩模块补齐），任何无法过编译的写法
  直接在 CI 失败，防止同类问题再次进入发布包。

---

## [20261011f] - 2026-10-11 · 遮罩减负 · 弹窗响应式 · 内容卡片

### Changed 变更

- **全局遮罩减负**（壁纸尽量可见）：
  - 壁纸遮罩默认 0.38 → **0.32**（全链路 8 处同步：tokens、
    渐变底停 ×.40、compat fallback、表单默认、config、
    uci-defaults、wallpaper.uc、header.ut、README）
  - 管理页四态角色 scrim 各降一档（light .92→.86 / .52→.44，
    dark .90→.84 / .50→.42，移动端同比例）
  - 登录遮罩 .30→.22、登录角色 scrim .52→.42 / .50→.40
  - 新增 `--mz-scrim-soft`（.32/.40）：移动端抽屉遮罩改用软 scrim，
    强 scrim 保留给模态背板
- **弹窗响应式**：
  - `max-height` 升级为 `min(90vh, 100dvh - …)`，dvh 兜底手机地址栏
    收展导致的溢出；横屏 640px 下限 `100dvh - 4vh - 24px`
  - 底部内边距接入 `env(safe-area-inset-bottom)`（iOS/安卓手势条）
- **内容卡片打磨**：
  - 数据表格新增 `--mz-row-alt` 斑马纹（2.8% / 3.5% 明度差，
    悬停行高亮优先级不变）
  - 壁纸库卡片 hover 增加轻投影反馈（无位移，不破坏单容器规则）

---

## [20261011e] - 2026-10-11 · 组件审查（弹窗 / 下拉 / 按钮）

### Fixed 修复

- **弹窗权威层错位**：components.css 原 `.modal` 规则（0,1,0）全部输给
  compat.css 的 `#modal_overlay .modal`（1,1,0），玻璃填充、卡片圆角、
  入场动画从未真正生效。现以 (1,1,0) 特异性重写为权威层：
  `--mz-modal-bg` 玻璃填充、`--mz-radius-card`、每次打开重放
  `mz-modal-in`；保留 compat 的 `modal-overlay-active` 状态机与
  顶部锚定长对话框滚动；移动端 640px 紧凑内边距补回本层。
- **overlay 遮罩**：静态期不再常驻 scrim 背景与 `mz-overlay-in`
  动画（该 keyframe 已无引用，删除）；blur(4px) 保留。
- **cbi-dropdown 整块重复**：compat.css 连续两段几乎相同的
  dropdown 修复块（含冲突的 margin/radius/shadow），删除前一份
  （其后一份早已按层叠规则胜出，删除零渲染差异），保留块数值
  全部 token 化（8px/6px/手写阴影 → radius-md/sm + shadow-md）。

### Added 新增

- 下拉菜单**选中项高亮**：`ul.dropdown > li[selected]` 品牌软底 +
  加粗，展开时不再与闭合值条无法区分；键盘导航
  `li:focus-visible` 描边。
- 按钮语义族收编进 components.css 单一所有者：
  apply/action 实心主色、save/positive 软主色、
  reset/remove/negative 软危险色（悬停才硬化为实心红，
  与整排按钮视觉音量一致）、`btn.danger` 显式实心保留。

---

## [20261011d] - 2026-10-11 · Aurora Glass

本轮四个提交（`c22019f` → `7c939f3`）构成一次完整视觉迭代：
**壁纸清晰透出、加载更快、整体观感不变**。

### Added 新增

- **Aurora sheen 受光边**：新令牌 `--mz-view-sheen`，在唯一视觉容器 `.mz-view`
  与登录卡顶部绘制 120px 渐变高光（light .18 / dark .05），
  不产生第二层容器、不叠加遮盖壁纸。
- **渐变壁纸遮罩**：`body::before` 由纯色平铺改为
  「顶部 `.38` → 底部 `~.17`」的纵向渐变洗白，风景照下半段保留原色。
- **加载优先级分级**：登录 logo `fetchpriority="high"`（LCP 元素）；
  壁纸图片 `fetchPriority='low' + decoding='async'`；
  随机壁纸内置 API 域名 `preconnect` 预热。
- **壁纸库懒加载**：`luci-app-mint-wallpaper` 缩略图改为
  `<img loading="lazy" decoding="async">`（div 背景图保留作解码期占位），
  视口外瓦片不再全量拉取原图。

### Changed 变更

- **玻璃透光度调校**（对文字对比度 ≥ 7:1 不变）：
  - 玻璃层 `--mz-glass-bg` .78 → **.70**（light）
  - 角色背景下容器 .70 → **.62**（light）/ .74 → **.68**（dark）
  - 登录卡 .82 → **.68**（light）/ .92 → **.86**（dark）
  - 侧栏 / 顶栏 / 菜单 chrome 保持 `.86`（strong），导航对比度不变
- **壁纸遮罩默认值** 0.45 → **0.38**，全链路 7 处同步：
  表单默认、`/etc/config/mint`、uci-defaults、`wallpaper.uc`
  clampOverlay、header.ut JS fallback、compat.css 遗留 fallback、文档表。
- **移动端合成降本**：≤854px 时 glass blur 16/18px → **10/12px**、
  saturate 135% → 115%；固定背景层 `.mint-background` 加 `contain: strict`。
- **CLS 修复**：侧栏品牌图与登录 logo 补显式 `width/height` 属性。

### Removed 移除

- **旧仪表盘死代码**：`mz-ring-* / mz-info-* / mz-port-* / mz-wifi-* /
  mz-net-body… / mz-badge-* / mz-modal-* / mz-tooltip` 等 63 个零引用类
  （重构前家族，现役为 `mint-ovd-*`）相关规则全部删除，
  12 个 CSS 层净减约 **1800 行**；混合选择器列表仅摘除死分支。
- **logo 资产瘦身**：256 色 PNG 量化，overview-banner 83→17KB、
  login-logo 70→16KB、favicon 76→16KB、assets/logo 1259→111KB（-92%）。

### Fixed 修复

- 登录页暗色模式 `background` 简写会清除 sheen 的问题
  （改用 `background-color`）。
- 版本戳链路：`MINT_ASSET_REV` 同步升级
  `20260913m → 20261011a → b → c → d`（cascade.css 13 处 @import +
  header/footer.ut），浏览器缓存不再出现半更新渲染。

### 兼容性

- 所有 UCI 配置键不变；已有 `overlay` 用户值不受默认值变更影响。
- 单容器契约、action bar 全出血契约、`cbi-dropdown` 层级契约
  （禁 stacking context）逐项复核，未破坏。

---

## [20260913m] - 2026-09-13

- 版本统一：主题包名与路径统一为 `mint`，弃用 mint-light / mint-dark /
  mintzero* 变体注册（模板内防御性映射保留）。
- 上一轮完整变更见仓库 docs/reviews/ 下的评审记录与 Release Notes。
