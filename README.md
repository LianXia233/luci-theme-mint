# Mint (luci-theme-mint)

<p align="center"><img src="assets/logo.png" width="200" alt="Mint logo — 像素猫娘"></p>

**Mint** —— 现代化 LuCI 主题（包名/路径随 2026-09-07 更名统一为 mint），面向 OpenWrt main / LuCI master（ucode 模板引擎）。

设计方向：现代总览页、卡片式 UI、高信息密度与大量留白，Apple/Linear 风格的克制视觉。不是对其他主题的 CSS 换肤——模板与菜单渲染均基于当前 LuCI master 主题接口实现。

## 功能特性

- **单层视觉容器架构（2026-09-13）**：每页**只有一个**视觉容器——`.mz-view` 是全站唯一允许绘制 background / border / radius / shadow 的元素（容器令牌 `--mz-container-*` 单一真源）；内部 Section / CBI / 表格 / 卡片全部透明扁平化，只负责布局、间距与排版，**禁止 Card 套 Card、多重边框/圆角/阴影**。Action Bar 为独立功能层（底部 sticky、全出血、不做完整卡片）。壁纸在最底层，每页只做一次模糊（body::before），容器自身禁用 backdrop-filter——避免创建层叠上下文困住 cbi-dropdown（z 1000）被侧栏（z 400）遮挡，也是路由器唯一可承受的模糊预算
- **分层 CSS 架构（2026-09-13）**：`cascade.css` 只做 `@import` 编排，规则按职责拆为 `css/compat | tokens | base | layout | navigation | container | components | wallpaper | dark | animations | responsive | login` 十二层；旧样式整体保留为兼容底座，新设计系统按级联顺序覆盖，功能零回退。全站静态资源带 `?v=<MINT_ASSET_REV>` 缓存戳（header.ut 常量 + cascade.css @import 同步更新），升级后浏览器不会残留旧样式
- 基于 CSS 变量（Design Tokens）的现代设计系统：色彩、间距、圆角、阴影、字体、**层叠层级（`--mz-z-*`）**、**玻璃参数（`--mz-glass-*`）**、**容器令牌（`--mz-container-*`）**、**动效曲线（`--mz-ease` / `--mz-dur-*`）**
- **Glass & Layered 视觉语言（2026-09-13）**：不对称容器圆角（14/4/22/4px）、品牌色偏移阴影、节标题 2px 下边线 + 强调色条、侧栏毛玻璃、菜单线性 SVG 图标（menu-mint.js 按 LuCI 节点名注入，纯装饰不触碰链接与折叠逻辑）+ SVG 折叠箭头（flex 对齐、垂直居中）
- 浅色 / 深色 / 跟随系统三种配色（默认跟随系统，尊重 `prefers-color-scheme`；侧栏按钮可覆盖）。浅色为白色微透毛玻璃（0.64–0.86 / blur 16–18px），深色为深灰毛玻璃（0.88–0.92）且**完全不加载壁纸**（不渲染壁纸层、不请求壁纸 API、不修改用户壁纸配置）
- 随机壁纸全屏登录页（按设备类型自动选择图源，带渐变兜底）；支持自定义壁纸（上传图片或填写图片直链）。壁纸设置入口：系统 → Mint 壁纸 → 壁纸设置
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
│   │   ├── dark.css            # 深色模式结构差异
│   │   ├── animations.css      # 关键帧与入场动效（含 reduced-motion）
│   │   ├── responsive.css      # 断点（854 抽屉+横向 Tab 滑动条 / 640 手机+动作条单行 / 400 窄屏）
│   │   └── login.css           # 登录页
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

## 壁纸机制

```
第三方随机图 API（浏览器直连，不经路由器代理；多源随机，失败自动切换下一源）
  桌面端：api.paugram.com/wallpaper/、t.alcy.cc/bd
  移动端（UA 检测）：api.seaya.link/wap、t.alcy.cc/mp
        |   （源列表可在设置页增删，每行一个 URL；留空用内置默认）
  自定义图片优先（已上传的 custom-pc.jpg / custom-mobile.jpg，或 http(s) 直链）
        |
  登录页/管理页 JS（随机打乱源列表逐个尝试、new Image() 预加载、淡入、referrer 抑制）
        v
  内置 CSS 渐变兜底（永远可用）
```

- 每次进入登录页、每次刷新管理页面都会随机选图（URL 带时间戳防缓存）；随机模式下**多个源随机打乱逐个尝试**，单源失败自动换下一源，全部失败才回退渐变
- 服务端**无壁纸缓存**（ucode 后端只读 UCI 配置 + 钳制数值），因此没有"刷新缓存"按钮
- 图片来源标注在登录页右下角（本地自定义 / 实际命中的随机源域名），永不移除

### 离线行为

API 不可达（无外网、DNS 失败、超时）时登录页依然即时渲染，按以下优先级兜底：

1. 自定义图片（如已上传或配置直链） -> 2. 内置 CSS 渐变

壁纸加载绝不阻塞或破坏登录页。

## 壁纸设置

设置页位于 `系统` > `Mint 壁纸`（`/cgi-bin/luci/admin/system/mint-wallpaper/settings`），由独立包 `luci-app-mint-wallpaper` 提供；配置文件 `/etc/config/mint`：

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| enabled | 布尔 | 1 | 壁纸功能开关 |
| ui_random | 布尔 | 1 | 管理页面也使用随机壁纸 |
| pc_mode | 枚举 | random | 桌面端来源（random / custom） |
| pc_url | 直链 | 空 | 桌面端自定义图片 http(s) 直链 |
| pc_sources | 列表 | paugram + t.alcy.cc/bd | 桌面随机源（每行一个 URL，随机选取、失败自动切换） |
| mobile_mode | 枚举 | random | 移动端来源（random / custom） |
| mobile_url | 直链 | 空 | 移动端自定义图片 http(s) 直链 |
| mobile_sources | 列表 | seaya + t.alcy.cc/mp | 移动随机源（每行一个 URL，随机选取、失败自动切换） |
| overlay | 浮点 | 0.45 | 深色遮罩不透明度（0.0 - 1.0） |
| blur | 像素 | 0 | 背景模糊（0 禁用，最大 40） |

上传的图片分别写入 `/www/luci-static/mint/custom-pc.jpg` 与 `custom-mobile.jpg`（≤3MB），卸载主题时自动清理。

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
