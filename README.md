# Mint (luci-theme-mint)

<p align="center"><img src="assets/logo.png" width="200" alt="Mint logo — 像素猫娘"></p>

**Mint** —— 现代化 LuCI 主题（包名/路径随 2026-09-07 更名统一为 mint），面向 OpenWrt main / LuCI master（ucode 模板引擎）。

设计方向：现代总览页、卡片式 UI、高信息密度与大量留白，Apple/Linear 风格的克制视觉。不是对其他主题的 CSS 换肤——模板与菜单渲染均基于当前 LuCI master 主题接口实现。

## 功能特性

- **单层视觉容器架构（2026-09-13）**：每页**只有一个**视觉容器——`.mz-view` 是全站唯一允许绘制 background / border / radius / shadow 的元素（容器令牌 `--mz-container-*` 单一真源）；内部 Section / CBI / 表格 / 卡片全部透明扁平化，只负责布局、间距与排版，**禁止 Card 套 Card、多重边框/圆角/阴影**。Action Bar 为独立功能层（底部 sticky、全出血、不做完整卡片）。壁纸在最底层，每页只做一次模糊（body::before），容器自身禁用 backdrop-filter——避免创建层叠上下文困住 cbi-dropdown（z 1000）被侧栏（z 400）遮挡，也是路由器唯一可承受的模糊预算
- **分层 CSS 架构（2026-09-13）**：`cascade.css` 只做 `@import` 编排，规则按职责拆为 `css/compat | tokens | base | layout | navigation | container | components | wallpaper | background | dark | animations | responsive | login` 十三层；旧样式整体保留为兼容底座，新设计系统按级联顺序覆盖，功能零回退。`background` 排在 `wallpaper` 之后——让角色背景能撤销壁纸层的兜底渐变。全站静态资源带 `?v=<MINT_ASSET_REV>` 缓存戳（header.ut 常量 + cascade.css @import 同步更新），且该戳经 `<meta name="mz-asset-rev">` 注入 `L.env.resource_version`，**JS 模块同享一套缓存键**，升级后浏览器不会残留旧样式或旧脚本
- **容器几何只有一个所有者（2026-09-13 修正）**：`.mz-view` 的 width / max-width / padding / margin **只由 `layout.css` + `container.css` 配合 tokens 决定**，`compat.css` 不得再声明它们。此前 compat 里残留一条 `#mz-view { max-width:1280px; margin:0 auto; padding:24px 28px }`，因为是 **ID 选择器**而击败了类选择器 `.mz-view`，把 `--mz-content-max`(1680px) 钳到 1280px、`--mz-container-pad`(22px) 换成 24/28px，并强制居中——改 tokens 完全无效。现行契约是**两侧留白对称**：容器用 `margin: var(--mz-container-margin) auto`，富余宽度平均分到两侧，任何宽度都不出现单边空洞（1920px 下左右各 13/14px）。**「左锚」与「右侧预留角色通道」两种改法都已被实测否掉**——它们只是把空洞从一侧搬到另一侧（先出现 219px 左侧空洞，后出现约 260px 右侧空白条）。角色立绘本就由 `fixed` 图层（`z-index:-2`）透过容器可见，无需为它独占宽度。宽度上限 `--mz-content-max` 为 1920px，详见「布局与容器几何」
- **四态角色背景系统（2026-09-13）**：每页默认背景是一套**四态独立**的角色立绘层——PC×亮色 Arona、PC×暗色 Plana、Mobile×亮色 / Mobile×暗色各一张**独立 3:4 竖版构图**（不是把 PC 方图缩放）。四张图真不同源，**没有一态是另一态的 CSS 滤镜副本**。设备由 media query 判定、明暗由 `<html data-theme>` 判定，**纯 CSS、首帧即正确**，JS 不参与；切换只翻转 `data-theme`，两层立绘以 opacity 交叉淡入（两张图同规则集引用 → 均已解码，切换零请求、不闪白）。层为 `.mint-background`（`fixed; inset:0; z-index:-2; pointer-events:none; overflow:clip`），不参与文档流、不接收指针事件，全站零横向溢出。手机只下载两张移动图、桌面只下载两张 PC 图。用户配置的自定义壁纸优先于角色背景
- **登录页角色背景（Plana，2026-09-13）**：登录页是单屏单一身份，不套四态，而是自己一套 `.mint-background.mz-login-char`，只含**一个**立绘节点（Plana，亮暗同一角色）；桌面右锚 `contain`、手机底部锚定 `cover` 全幅。登录页图层**自己绘制**参考站渐变，因此完全不透明——下方的东西透不过来。登录页只有两种状态：角色背景（默认）与显式选择的壁纸（`mz-wp-custom`），不存在"随机缓存照片"这第三种
- 基于 CSS 变量（Design Tokens）的现代设计系统：色彩、间距、圆角、阴影、字体、**层叠层级（`--mz-z-*`）**、**玻璃参数（`--mz-glass-*`）**、**容器令牌（`--mz-container-*`）**、**动效曲线（`--mz-ease` / `--mz-dur-*`）**
- **Glass & Layered 视觉语言（2026-09-13）**：不对称容器圆角（14/4/22/4px）、品牌色偏移阴影、节标题 2px 下边线 + 强调色条、侧栏毛玻璃、菜单线性 SVG 图标（menu-mint.js 按 LuCI 节点名注入，纯装饰不触碰链接与折叠逻辑）+ SVG 折叠箭头（flex 对齐、垂直居中）
- 浅色 / 深色 / 跟随系统三种配色（默认跟随系统，尊重 `prefers-color-scheme`；侧栏按钮可覆盖）。浅色为白色微透毛玻璃（0.64–0.86 / blur 16–18px），深色为深灰毛玻璃（0.88–0.92）。两种配色各配一张角色立绘与一套底色（亮色 `#f6fbfd` / 暗色 `#102433`），暗色**不再是纯色空底**
- 登录页默认使用**角色背景（Plana）**——桌面右锚立绘、手机底部锚定全幅，亮暗两套底色（`#e7f4fb→#f6fbfd→#dbedfa` / `#0b1a26→#102433→#153a4d`）；后台旧「随机壁纸」默认**关闭**，由角色背景顶替。两者都只影响默认值——用户显式配置的自定义壁纸（上传图片或 http(s) 直链）依旧生效并覆盖角色背景。壁纸设置入口：系统 → Mint 壁纸 → 壁纸设置
- **壁纸客户端缓存版本戳（2026-09-13）**：设置页每次应用 / 上传 / 删除 / 强制刷新都会递增 `mz-wp-ver`，所有壁纸 URL 追加 `_mzv` 参数并预加载解码后再绘制，切换壁纸不再命中旧缓存；删除壁纸后立即回退渐变背景
- 服务端壁纸缓存：cron 每 5 分钟把随机图落到 `/luci-static/mint/wallpaper-<kind>.img`，后台优先使用这份本地缓存（可 304 复用、零外部请求）。「后台随机壁纸」开关只控制是否每次导航重新拉取远程随机图，关闭时本地缓存仍会生效
- 壁纸与布局解耦：壁纸层为 body 伪元素并置于**负 z-index**，因此内容区不需要抬升层级，弹出层永远不会被侧栏或卡片压住
- 侧栏导航从 LuCI 实时菜单树渲染（无硬编码菜单）
- 移动端抽屉式导航 + 遮罩
- 480px 至 1280px+ 全段响应式；移动端表格重排为卡片
- 总览页增强（仅在 Status > Overview 加载）：端口状态、系统信息、DHCP/Wireless/UPnP 区块卡片化；不支持的值显示 N/A，绝不造假数据
- 无障碍：跳转链接、focus-visible、aria 标签、键盘可操作的登录页
- 无 CDN、无 Web 字体、无图标字体、无前端框架、无 jQuery
- 国际化就绪（英文 + 简体中文：`po/` 编译为独立翻译包 `luci-i18n-mint-zh-cn` 随 Release 发布）
- LuCI 弹窗系统主题化（#modal_overlay 遮罩 + 居中对话框，保存并应用进度可见）
- cbi 选项卡（ul.cbi-tabmenu）完整样式与显隐规则
- 桌面隐藏页面标题栏（页面自身 `<h2>` 已承担标题）；**LuCI 原生 `#indicators` 槽位拆为独立 `.mz-indicatorbar`**，因此隐藏标题栏不会连带丢失未保存更改/应用指示器与轮询徽标。移动端保留标题栏并抑制重复标题
- cbi-dropdown 深度主题化：`[open]` 属性选择器 + 核心样式反制。**展开方向与定位完全交还 LuCI 组件 JS**（主题不预设 `top`/`bottom`），下拉在空间不足时可正常向上翻转；全站下拉（含编辑弹窗设备选择）可正常展开与选择
- 全站 8px 半透明细滚动条（webkit + Firefox），color-scheme 跟随深色模式
- 接口页定制：区域头降饱和色条、设备悬停详情面板、接口详情玻璃卡片
- 第三方应用设计变量桥接（--brand/--surface/--text 等，兼容 taygedo 等应用）；h5000m_netmode 网络出口页对比度适配
- **壁纸设置已拆分为独立包 `luci-app-mint-wallpaper`**（2026-09-11）：主题包只提供 UI 与模板，壁纸设置页、rpcd 后端、缓存 cron 与 UCI 配置归该包所有，可单独安装/升级/卸载。侧栏入口位于「系统」分组下的「Mint 壁纸」；并自带独立翻译包 `luci-i18n-mint-wallpaper-zh-cn`

## 目录结构

```
.github/workflows/build.yml     # GitHub Actions 云编译：直出 .ipk + .apk（all/noarch）
.github/workflows/release.yml   # 汇总构建产物并发布到 GitHub Release
theme/                          # 主题包源码（luci-theme-mint，纯 UI）
├── Makefile                    # 基于 luci.mk 的包定义
├── htdocs/luci-static/mint/
│   ├── cascade.css             # 入口：仅声明 css/ 下各层的加载顺序
│   ├── css/                    # 分层样式表（compat 为旧版全量兼容底座）
│   │   ├── compat.css          # 旧版规则全量保留（LuCI 兼容 / 第三方视图）
│   │   ├── tokens.css          # 设计令牌（后加载覆盖旧令牌）
│   │   ├── base.css            # 文档默认 / 排版 / 滚动条
│   │   ├── layout.css          # 应用骨架（侧栏 / 主列 / 页脚）
│   │   ├── navigation.css      # 侧栏菜单 / 页签 / 面包屑（SVG caret 对齐）
│   │   ├── container.css       # 单层视觉容器（.mz-view 唯一容器 + 内部扁平化）
│   │   ├── components.css      # 按钮 / 表单 / 表格 / 弹窗 / 徽章 / 提示
│   │   ├── wallpaper.css       # 壁纸 -> 遮罩 -> 玻璃 -> 内容 层级栈
│   │   ├── background.css      # 四态角色背景层（PC/Mobile × Light/Dark 立绘 + 网格 + wedge + scrim）
│   │   ├── dark.css            # 深色模式结构差异
│   │   ├── animations.css      # 关键帧与入场动效（含 reduced-motion）
│   │   ├── responsive.css      # 断点（854 抽屉+横向 Tab 滑动条 / 640 手机+动作条单行 / 400 窄屏）
│   │   └── login.css           # 登录页
│   ├── images/                 # 角色背景资源（四态立绘 + 亮/暗三角网格，共 6 张 webp）
│   ├── overview-dashboard.js   # PC 端总览仪表盘（仅桌面端 Status > Overview 加载）
│   ├── overview-mobile.js      # 移动端总览增强（仅手机/平板 Status > Overview 加载）
│   ├── mz-ui.js                # 设备无关通用 UI 辅助（全后台页面加载）
│   ├── overview-banner.png     # 顶栏品牌图
│   ├── login-logo.png          # 登录页 Logo
│   └── favicon/                # favicon.svg（矢量）/ -48.png / -180.png
├── htdocs/luci-static/resources/
│   ├── menu-mint.js            # 侧栏/菜单渲染器（LuCI JS API）
│   └── view/mint/
│       └── sysauth.js          # 登录页前端
├── ucode/template/themes/mint/
│   ├── header.ut               # 页面骨架、侧栏、顶栏
│   ├── footer.ut               # 页脚、L.require('menu-mint')
│   └── sysauth.ut              # 登录页（保留原生认证表单）
├── ucode/mint/
│   └── wallpaper.uc            # 渲染期配置解析（只读 UCI；被 header.ut 静态 import，故随主题发布）
├── root/
│   └── etc/uci-defaults/30_luci-theme-mint   # 主题注册 + 迁移清理
└── po/                         # templates + zh_Hans

wallpaper/                      # 壁纸设置包源码（luci-app-mint-wallpaper，可独立安装）
├── Makefile                    # 基于 luci.mk 的包定义（Depends: luci-base +curl）
├── po/zh_Hans/                 # 独立翻译目录（生成 luci-i18n-mint-wallpaper-zh-cn）
├── htdocs/luci-static/resources/view/mint/
│   └── wallpaper.js            # 壁纸设置表单
└── root/
    ├── etc/config/mint                 # UCI 配置（本包 conffile）
    ├── etc/uci-defaults/30_luci-app-mint-wallpaper
    ├── lib/upgrade/keep.d/luci-app-mint-wallpaper
    ├── usr/bin/mz-wallpaper-fetch.sh   # 服务端壁纸缓存刷新（cron 每 5 分钟）
    ├── usr/libexec/rpcd/mint           # ubus 后端（save / refresh / dashboard）
    └── usr/share/luci/menu.d/luci-app-mint-wallpaper.json  # 独立顶级菜单入口
```

## 云编译（GitHub Actions）

推送到 `main` 分支或打 `v*` 标签自动触发，也可在 Actions 页面手动触发（workflow_dispatch）。单条构建流水线 + 一条汇总发布：

| Workflow | 说明 |
| --- | --- |
| `build.yml` | 一次产出全部 4 个包：主题 + 简中翻译 × `.ipk`（`all`）+ `.apk`（`noarch`）。纯数据直出，无需 SDK，数十秒完成 |
| `release.yml` | 构建成功后汇总产物，发布 `nightly`（推 main）或正式版本（打 `v*` 标签） |

产出**四个文件**：主题 `luci-theme-mint` 与简中翻译 `luci-i18n-mint-zh-cn`
（官方 LuCI 规范将 `po/` 编译为独立翻译包，只装主题时界面为英文），各两种格式，成对发布、成对安装。

- 主题是纯数据包（无 `src/`），包与目标平台无关：一份 `all`/`noarch` 包可装于任意目标
- **不再拉取 OpenWrt SDK**：`scripts/build-direct.sh` 按 `luci.mk` 的安装布局装配载荷，再用与官方后端一致的容器格式打包
  - ipk = `gzip(tar(debian-binary, data.tar.gz, control.tar.gz))`（OpenWrt `scripts/ipkg-build`）
  - apk = apk-tools v3 ADB 容器（`ADBd` + raw deflate，与 `apk mkpkg` 一致）
- 每个产物先过 `scripts/verify-package.sh`（结构 + 元数据 + 载荷清单 + 可执行位），再进 `scripts/install-test.sh`（安装到临时 root）
- 每个 `.apk`/`.ipk` 旁附 `.buildinfo.txt`（主题 commit、包版本、构建方式等证据）

## 本地编译

本主题是纯数据包（无 C/Lua 源码，主题自身的 `Build/Compile` 只是文件装配 + po 转 lmo），但它依赖的 `luci-base` 及其依赖链是真实代码，需要 SDK 的交叉工具链。**不要**为它手编整套 OpenWrt 工具链——用官方预编译 SDK 最快，或只在完整 buildroot 里启用 ccache。

### 方式一：官方预编译 SDK（推荐）

```sh
# 以 x86/64 为例；其他目标把路径换成对应的 targets/架构/
BASE=https://downloads.openwrt.org/snapshots/targets/x86/64
SDK=$(curl -fsSL "$BASE/" | grep -o 'openwrt-sdk-.*tar.zst' | head -1)
curl -fsSLO "$BASE/$SDK"
tar --zstd -xf "$SDK"
mv openwrt-sdk-* sdk
cd sdk

# 关键：保留 SDK 自带的 feeds.conf.default（base feed 提供 rpcd/ucode/libubox，
# packages feed 提供 curl/cgi-io），只更新 feeds，不要用 luci 单 feed 覆盖它——
# 否则 luci-base 的依赖链会在元数据扫描时被静默丢弃，编译到一半才报缺头文件。
./scripts/feeds update -a

# 注入主题并手动链接（feeds update 生成的索引看不到后注入的目录）
mkdir -p feeds/luci/themes/luci-theme-mint
cp -a /本地路径/luci-theme-mint/theme/. feeds/luci/themes/luci-theme-mint/
./scripts/feeds install -a
mkdir -p package/feeds/luci
ln -sfn ../../../feeds/luci/themes/luci-theme-mint package/feeds/luci/luci-theme-mint

echo "CONFIG_PACKAGE_luci-theme-mint=m" >> .config
echo "CONFIG_PACKAGE_luci-i18n-mint-zh-cn=m" >> .config   # 简中翻译（独立包，menuconfig 中 HIDDEN）
echo "CONFIG_LUCI_JSMIN=y" >> .config          # jsmin 随 luci-base/host 提供
echo "# CONFIG_LUCI_CSSTIDY is not set" >> .config
make defconfig
grep -q '^CONFIG_PACKAGE_luci-theme-mint=m' .config   # 确认主题被选中

make package/feeds/luci/luci-base/host/compile -j$(nproc) V=s  # po2lmo/jsmin
make package/feeds/luci/luci-theme-mint/compile -j$(nproc) V=s
```

> 提示：SDK 的包格式由其自带配置决定（25.12+/snapshot 为 `.apk`，24.10 SDK 为 `.ipk`），`CONFIG_USE_APK` 在 SDK 内是无提示项，改 `.config` 不会生效。以上流程等价于仓库里的 `scripts/build-package.sh`，需要多目标/双格式时可直接用它。

### 方式二：完整 buildroot

把 `theme/` 目录内容放入 buildroot 的 `feeds/luci/themes/luci-theme-mint/`，然后：

```sh
./scripts/feeds update -a
./scripts/feeds install luci-theme-mint
make menuconfig   # LuCI -> 4. Themes -> luci-theme-mint
make package/luci-theme-mint/compile -j$(nproc) V=s
```

buildroot 场景强烈建议启用 ccache（首次仍要编译工具链，之后增量编译显著加速）：

```sh
echo "CONFIG_CCACHE=y" >> .config
make defconfig
```

构建出的 `.apk`/`.ipk` 安装到设备即可。JS 压缩由 luci-base 的 `jsmin` 处理；CSS 压缩（csstidy）位于 packages feed，默认未启用。包为架构无关的 `all` 包。

## 主题启用

安装后 uci-defaults 会自动注册并启用主题：

```sh
uci set luci.main.mediaurlbase=/luci-static/mint
uci commit luci
/etc/init.d/rpcd reload
```

## 背景与壁纸机制

### 默认背景：四态角色层（无需任何配置）

```
html[data-theme]  ──>  亮色 / 暗色        （属性选择器，纯 CSS）
@media ≤854px     ──>  Mobile / PC        （媒体查询，纯 CSS）
        |
        v
.mint-background（fixed / inset:0 / z-index:-2 / pointer-events:none / overflow:clip）
  ├── background-color      亮 #f6fbfd  ·  暗 #102433
  ├── .mint-bg-panel        对角 wedge（clip-path，亮「右半」/ 移动端「下半」）
  ├── .mint-bg-grid         三角网格平铺（亮 / 暗各一张成品图，运行时零 filter）
  ├── .mint-bg-character-light  Arona（PC 方图 / Mobile 3:4 竖版）
  ├── .mint-bg-character-dark   Plana（PC 方图 / Mobile 3:4 竖版）
  └── ::after               侧向（移动端纵向）scrim，压在立绘之上、内容之下
        |
        v
body.mz-wp-custom::after  用户壁纸（配置了才存在，位于角色层之上）
        |
        v
.mz-view                  唯一页面容器（毛玻璃片）
```

登录页是**同一套机制的单角色变体**——`sysauth.ut` 自己注入 `.mint-background.mz-login-char`（只含 Plana 一个节点），复用上面的 wedge / 网格 / 手机取景，差异（立绘、配色、veil）全在 `login.css`：

```
.mint-background.mz-login-char
  ├── background-image      参考站渐变（亮 #e7f4fb→#f6fbfd→#dbedfa / 暗 #0b1a26→#102433→#153a4d）
  ├── .mint-bg-panel / .mint-bg-grid     同上（wedge 改为半透明，让渐变透气）
  ├── .mz-login-char-art    Plana（桌面 right center + contain / 手机 bottom center + cover）
  └── ::after               自上而下的轻 veil（卡片居中，不用侧向）
```

- 四态资源在 `theme/htdocs/luci-static/mint/images/`，共 6 张 `.webp`：4 张四态立绘 + 2 张三角网格（登录页复用同一批资源，不额外增图）
- 明暗两态是**两张不同插画**（Arona / Plana），不是同一张图的滤镜或透明度变体；Mobile 是**独立 3:4 竖版重新取景**，不是 PC 方图缩放
- 设备与模式判定全部在 CSS 内完成，JS 不参与，**首帧即正确**；切换明暗只翻转 `data-theme`，两层立绘 opacity 交叉淡入（两张图都已解码，**零请求、零解码、不闪白**）
- 该层 `fixed` + 负 z-index + 不接收指针事件 → 不在文档流内、不可能被命中测试选中，任何页面（状态 / 系统 / 网络 / 服务 / 防火墙 / 软件包 / 实时图表）的布局、表格、表单、下拉都不会受影响；`overflow:clip` 保证立绘永远不撑出文档盒，**任何断点横向滚动条恒为 0**
- 登录页图层**不透明**（渐变画在图层自身）且 `.mz-login-bg` 在无 `mz-wp-custom` 时 `display: none`：随机壁纸缓存即使在浏览器里残留，也没有任何路径能透到角色之上

### 用户壁纸（可选，覆盖角色层）

```
第三方随机图 API（浏览器直连，不经路由器代理；多源随机，失败自动切换下一源）
  桌面端：api.paugram.com/wallpaper/、t.alcy.cc/bd
  移动端（UA 检测）：api.seaya.link/wap、t.alcy.cc/mp
        |   （源列表可在设置页增删，每行一个 URL；留空用内置默认）
  自定义图片优先（壁纸库上传，或 http(s) 直链）
        |
  管理页 JS（new Image() 预加载 → 解码 → 绘制 → 加 mz-wp-custom 盖住角色层）
        v
  四态角色背景兜底（永远可用）
```

- **登录页默认不加载随机壁纸**：只有 `mode='custom'`（用户显式配置的图片或直链）才绘制，随机源不参与；未配置时是**角色背景（Plana）**——`mz-login-char` 图层自绘参考站渐变，故完全不透明，随机缓存透不进来
- **管理页随机壁纸默认关闭**（`ui_random '0'`）：显式打开后才会在每次导航重新拉取远程随机图；关闭时由角色背景相当
- 配置了自定义壁纸后，`mz-wp-custom` 令角色层 `display:none`（图片已盖住它，没必要保留一层合成开销），容器透明度也恢复原值（照片亮度未知，不做减免）
- 服务端**无壁纸缓存**（ucode 后端只读 UCI 配置 + 钳制数值），因此没有"刷新缓存"按钮
- 图片来源标注在登录页右下角（本地自定义 / 实际命中的随机源域名），永不移除
- 暗色模式不绘制照片壁纸：直接保留角色层（Plana）与深色底色，且不发起任何壁纸请求

### 离线行为

API 不可达（无外网、DNS 失败、超时）时页面依然即时渲染，按以下优先级兜底：

1. 自定义图片（如已上传或配置直链） → 2. 四态角色背景

壁纸加载绝不阻塞或破坏任何页面。

### 缓存戳

`MINT_ASSET_REV` 常量同时存在于 `header.ut`、`footer.ut`，以及 `cascade.css` 全部 `@import` 的 `?v=`。**改动 `htdocs/luci-static/mint/` 下任何文件（含 `images/`）都必须同步 bump 三处**，否则路由器长缓存头会让浏览器继续用旧样式。

#### JS 模块也吃这个戳（2026-09-13 修复）

LuCI 的 `L.require(name)` 会把每个模块拼成 `<resource>/<name>.js?v=<env.resource_version>`，而 `env.resource_version` **不是**主题的 `MINT_ASSET_REV`，是 LuCI 自身从 `luci.js` 那个 `<script>` 的 `?v=` 取到的**构建字符串**（形如 `26.246.30574~1df16f1-1789224237`）。它只在刷固件时变，跟主题升级毫无关系——于是主题自己的 JS（`menu-mint.js`、`view/mint/sysauth.js`）会被浏览器按一个**永远不变**的 key 长期缓存，会出现「明明部署了新主题，页面还在跑旧一轮的 JS」。这就是「登录页 Plana 背景被随机壁纸缓存透出」的真正根因：残留的旧 `sysauth.js` 把 cron 缓存的随机图刷到了登录层上。

三层修法（缺一不可）：

```
header.ut        <meta name="mz-asset-rev" content="{{ MINT_ASSET_REV }}">   ← JS 侧唯一真源
                        |
footer.ut        IIFE：读 meta → L.env.resource_version = rev（仅当不同时改）
sysauth.ut       同一段 IIFE（登录页是 blank_page，footer.ut 那个 version 脚本不执行）
                        v
            此后所有 L.require() 出来的模块 URL 都带主题戳
```

- `L.env` 就是模块闭包读取的那个对象，重写 `resource_version` 之后，**后续**每个 `require()` 出来的主题模块都会带上新戳，无需改 LuCI 本体
- 配套 `wallpaper.css` 的样式兜底：`html[data-wp-random="0"]` 时用 `content: none` 摘除 `body::after` 壁纸伪元素（特异性 0,3,2 压过角色层的 0,3,1，`:not(.mz-wp-custom)` 保留显式壁纸）
- `header.ut` 的 `<html>` 上同时带 `data-wp-random="0|1"`，让样式层能独立于 JS 判断「随机壁纸是否该出场」
- 回归测试：`scripts/verify-cache-conflict.py`（模拟残留旧构建写入壁纸变量，断言登录层 `display:none`、`body::after` `content:none`、管理页无壁纸伪元素）
- 操作栏回归测试（一组契约，两个入口）：`scripts/verify-action-bar.py` 不需要路由器，本地夹具挂真实 `cascade.css` 后读计算样式，改 CSS 即可跑；`scripts/verify-action-bar-device.py` 登录实机对**已部署**资源复测同一组契约（需 `MZ_BASE`/`MZ_PASS`）。断言：关闭态拆分按钮仅 1 个可见选项、`⋯` 不绘制、`dd/ul/li/.open` 高度一致、**桌面容器两侧留白对称（|左 − 右| ≤ 20px；`--mz-content-max` 未咬合时每侧 ≤ 40px）**、无横向溢出
- 容器几何专测：`scripts/verify-geometry.py`（需 `MZ_BASE`/`MZ_PASS`）扫 1366/1536/1600/1920/2560/3440 六档，断言留白对称、上限未咬合时两侧无空洞、无横向溢出、概览页系统信息网格末行无残缺轨道；可选 `MZ_SHOT_DIR` 顺便出图。详见上方「布局与容器几何」
- 下拉菜单回归测试：`scripts/verify-dropdown.py` 不需要路由器，夹具挂真实 `cascade.css` 后读计算样式，改 CSS 即可跑；加 `--css <url>` 可对**已部署**的样式表复测。夹具**同时**渲染两种标记形态 —— 完整 LuCI 的 `ul.dropdown`（含 `ul.preview`）与精简构建的裸 `ul` —— 断言：①浅色模式下两种形态的弹层背景相对亮度 ≥ 0.75（必须是浅色玻璃，不得是硬编码深色）②打开态左右内边距对称 ③完整构建下全部选项可见。详见「暗色 / 壁纸模式与下拉菜单」
- 保存并应用链路实机回归：`scripts/verify-save-apply-device.py`（需 `MZ_BASE`/`MZ_PASS`）。断言：caret 展开出 `ul.dropdown` 且全部选项可见、菜单不被手机高度链压扁（`clientHeight == scrollHeight`）并完整落在视口内、可再关闭；主按钮点击触发提交（默认拦截 CGI 写请求只验证动作，`--real` 放行并要求 `apply_rollback` 被调用）；「强制应用」切换 negative 态；普通表单下拉不受影响；登录页「记住我」与输入框左对齐（PC + 手机）；无横向溢出、无未捕获异常

## 布局与容器几何

主题全站只有 `.mz-view` 一个视觉容器（单层容器架构），它的几何由三个令牌独占，改宽度 / 间距只需动 `tokens.css`：

| 令牌 | 值 | 作用 |
|---|---|---|
| `--mz-content-max` | `1920px` | 容器宽度上限。常见桌面（1366 / 1536 / 1600 / 1920）都不咬合，直接铺满；仅超宽屏收口 |
| `--mz-container-margin` | `14px` | 容器与页面列两侧的间距（**两侧对称**） |
| `--mz-container-pad` | `22px` | 容器内边距；同时是全出血动作条负 margin 的基准 |

摆放规则只有一条基础声明，`container.css` 与 `background.css` 都**刻意不再覆盖它**：

```css
.mz-view { margin: var(--mz-container-margin) auto; }
```

`auto` 把富余宽度**对称**分摊到两侧，因此任何宽度下都不会出现单边空洞。这条契约的由来值得记一笔 —— 同一处几何被反向报告过两次：

| 版本 | 做法 | 实测结果 |
|---|---|---|
| 旧（bug） | `compat.css` 残留 ID 规则 `#mz-view{max-width:1280px;margin:0 auto;padding:24px 28px}`，以 ID 特异性压掉整套令牌 | 1920px 下菜单与内容之间 **219px** 空洞（2560px 下 539px） |
| `20260913f`（修错方向） | 删掉 ID 规则，但改成「左锚 + 右侧预留 260/320px 角色通道」 | 左侧空洞消失，右侧长出约 **260px** 空白条 |
| `20260913g` | 两处覆盖全删，回归 `margin: … auto`；`--mz-content-max` 由 1680 上调至 1920px | 两侧对称：1920px 各 13/14px，2560px 各 219/220px（上限生效） |

> 现行缓存戳为 `20260913h`。该版只改了**下拉菜单**的背景令牌与 `#mz-view` 内边距泄漏（见「暗色 / 壁纸模式与下拉菜单」），未触碰容器几何，因此上表结论对 h 版同样成立。

角色立绘不依赖预留通道：`.mint-background` 是 `fixed` 独立图层（`z-index:-2`、`pointer-events:none`），透过 `.mz-view` 的半透明填充可见，所以把宽度还给内容不会丢立绘。

页面内部另有一处独立空洞：概览页系统信息网格共 **9** 项，排 4 列会变成 4+4+1（末行右侧约 958px 空白），故固定 **3 列**（9 = 3×3，任意宽度都不会残缺）。改动 `.mint-ovd-sys-grid` 列数前，请先确认项数仍是该列数的整数倍。

回归测试见「缓存戳」小节末尾（`verify-geometry.py` + `verify-action-bar*.py`）。

## 暗色 / 壁纸模式与下拉菜单

主题的**控件浮层**（下拉候选列表、原生 `<select>` 的 option、拆分按钮菜单）必须**只**通过令牌决定颜色。这里有一条踩过两次的约定：

**`body.mz-has-wallpaper` 不等于深色模式。** `menu-mint.js` 在**每个**后台页面无条件给 `<body>` 加上这个类，浅色模式也不例外 —— 它表达的是「这一页允许绘制壁纸」，而不是「这一页是深色」。任何形如 `body.mz-has-wallpaper … { background: <深色> }` 的规则都会在浅色页面生效，而**没有任何主题模式能撤销它**，用户看到的是一块突兀的深色浮层。深色专用声明一律以 `html[data-theme="dark"]` 开头。

**不要依赖 `.dropdown` 类。** 本主题要兼容**精简 LuCI 构建**：这类构建的 `cbi.js` 不含 `CBI.Dropdown`，浮动 `<ul>` 因此拿不到 `.dropdown` 类（完整构建由 `ui.js` 的 `openDropdown()` 加上，并同时插入 `ul.preview` 克隆，然后由 `menu-mint.js` 之外的 `mz-ui.js` 兜底接管交互）。所以**只写 `.cbi-dropdown[open] > ul.dropdown` 是不够的** —— 精简构建下这条选择器不匹配，更早的宽松规则（如 `> ul`）会意外胜出。放置浮层样式时，要么同时覆盖 `> ul` 与 `> ul.dropdown` 两种形态，要么把颜色收敛到一条两种形态都会命中的令牌声明上。

**内边距同理**：`#mz-view ul, #mz-view ol { padding-left: 20px }` 是给正文列表的缩进，但它是 **ID 选择器**，会连带命中表单里每个下拉 `<ul>` 并压掉所有基于类的弹层规则（实测打开态菜单得到 `4px 4px 4px 20px` 的左右不对称内边距）。主题已在 `#mz-view` 下为下拉控件恢复其自身内边距；**新增任何 `#mz-view` 级别的 `ul` / `ol` 规则时都要先确认不会波及下拉**。

对应修复见 CHANGELOG 的「同日深夜：下拉菜单颜色与排版全面异常」，回归测试为 `scripts/verify-dropdown.py`（离线夹具，同时渲染两种标记形态，断言浅色模式下弹层必须是浅色且内边距对称）。

## 壁纸设置

设置页位于 `系统` > `Mint 壁纸`（`/cgi-bin/luci/admin/system/mint-wallpaper/settings`），由独立包 `luci-app-mint-wallpaper` 提供；配置文件 `/etc/config/mint`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| enabled | 布尔 | 1 | 壁纸与角色背景总开关（0 时角色层也不注入） |
| ui_random | 布尔 | **0** | 管理页面是否也使用随机壁纸（默认关闭，由角色背景顶替） |
| pc_mode | 枚举 | random | 桌面端来源（random / custom） |
| pc_wallpaper | 文件名 | 空 | 桌面端壁纸库选中的文件（优先级高于 pc_url 与随机源） |
| pc_url | 直链 | 空 | 桌面端自定义图片 http(s) 直链 |
| pc_sources | 列表 | paugram + t.alcy.cc/bd | 桌面随机源（每行一个 URL，随机选取、失败自动切换） |
| mobile_mode | 枚举 | random | 移动端来源（random / custom） |
| mobile_wallpaper | 文件名 | 空 | 移动端壁纸库选中的文件（规则同 pc_wallpaper） |
| mobile_url | 直链 | 空 | 移动端自定义图片 http(s) 直链 |
| mobile_sources | 列表 | seaya + t.alcy.cc/mp | 移动随机源（每行一个 URL，随机选取、失败自动切换） |
| overlay | 浮点 | 0.45 | 深色遮罩不透明度（0.0 - 1.0） |
| blur | 像素 | 0 | 背景模糊（0 禁用，最大 40） |

上传的图片写入 `/www/luci-static/mint/wallpapers/`（`pc_wallpaper` / `mobile_wallpaper` 指向库内文件名；旧版单槽 `custom-pc.jpg` / `custom-mobile.jpg` 会被 uci-defaults 一次性接管进库），卸载时自动清理。

## 兼容性

### 兼容的 OpenWrt / ImmortalWrt 版本

| 发行版 | 最低版本 | 模板引擎 | 包格式 | 说明 |
| --- | --- | --- | --- | --- |
| OpenWrt | 23.05+ / main | ucode（`.ut`） | `.ipk` | 主线 OpenWrt 23.05+ 已切换至 ucode 模板引擎；主线 main / snapshot 持续跟进 |
| ImmortalWrt | 21.02+ | ucode | `.apk` | ImmortalWrt 早于主线迁移至 ucode，并默认使用 apk 包管理 |
| LEDE / OpenWrt ≤ 19.07 | — | — | — | **不支持**：ucode 模板与 rpcd ACL 路径在旧分支不可用 |

云编译产物在每次 Release 同时提供双格式：`.apk`（OpenWrt 25.12+ / ImmortalWrt）与 `.ipk`
（仍使用 opkg 的 24.10 / 23.05），直接选择与你设备包管理器对应的产物安装；两种格式各含主题与简中翻译，共 4 个包。

### 运行时依赖

由 `theme/Makefile` 中的 `LUCI_DEPENDS` 自动声明，安装时 opkg / apk 会一并拉取：

| 包名 | 作用 | 是否必需 |
| --- | --- | --- |
| `luci-base` | 模板引擎、ACL、ubus 桥接、cbi.js / i18n 端点 | 必需 |
| `curl` | 壁纸随机源抓取 cron 脚本 `mz-wallpaper-fetch.sh` 的唯一可用下载器；OpenWrt 默认仅装 `uclient-fetch`，缺它时 cron 必然失败 | 必需 |
| rpcd：`mint` 对象 | `dashboard`（Overview 实时仪表盘）、`refresh`（壁纸强制刷新） | 必需；ACL 由 `/usr/share/rpcd/acl.d/luci-theme-mint.json` 注册 |
| `luci-i18n-mint-zh-cn` | 本主题的简体中文翻译（`luci-theme-mint.zh-cn.lmo`，官方 LuCI 规范的独立翻译包） | 需要中文界面时必需，与主题成对安装 |
| `luci-i18n-base-zh-cn` | LuCI 内置界面的简体中文翻译 | 强烈建议 |

### 浏览器

- 桌面：Chrome / Chromium、Firefox、Safari、Edge（近 2 年版本）
- 移动：Android WebView / Chrome for Android、iOS Safari
- `backdrop-filter` 仅为渐进增强（毛玻璃卡片）；不支持时自动降级为半透明白色，不影响功能
- 禁用 JavaScript 时登录页与后台仍可访问（仅壁纸随机、菜单折叠、动态效果不可用）

### 已知限制

- 主题是纯数据（`htdocs` / `root` / `ucode` 模板 / `po`），不依赖具体目标架构；`PKGARCH:=all`
- 编译需启用 `luci-base/host`（提供 `po2lmo` 与 `jsmin`）；CSS 压缩 `csstidy` 故意关闭以免引入额外的 packages feed
- 升级时 `postinst` 仅重载 rpcd（不重启），保留已登录管理员的 ubus 会话

## 故障排查

- 主题不可选：手动执行 `sh /etc/uci-defaults/30_luci-theme-mint`，然后重启 rpcd
- 壁纸不出现：随机图由浏览器直连第三方 API；无外网或 API 不可达时显示渐变兜底属预期行为。如需完全离线请上传自定义图片
- 切换配色：使用侧栏切换按钮（system → 亮色 → 暗色循环）。主题仅注册单一 `Mint` 变体

## 许可证

Apache-2.0，见 [theme/LICENSE](./theme/LICENSE)。
