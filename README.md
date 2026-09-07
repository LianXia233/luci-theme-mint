# Mint (luci-theme-mint)

<p align="center"><img src="assets/logo.png" width="200" alt="Mint logo — 像素猫娘"></p>

**Mint** —— 现代化 LuCI 主题（包名/路径随 2026-09-07 更名统一为 mint），面向 OpenWrt main / LuCI master（ucode 模板引擎）。

设计方向：现代总览页、卡片式 UI、高信息密度与大量留白，Apple/Linear 风格的克制视觉。不是对其他主题的 CSS 换肤——模板与菜单渲染均基于当前 LuCI master 主题接口实现。

## 功能特性

- 基于 CSS 变量（Design Tokens）的现代设计系统：色彩、间距、圆角、阴影、字体
- 浅色 / 深色 / 跟随系统三种配色（默认跟随系统，尊重 `prefers-color-scheme`；侧栏按钮可覆盖）
- 随机壁纸全屏登录页（按设备类型自动选择图源，带渐变兜底）；支持自定义壁纸（上传图片或填写图片直链）
- 侧栏导航从 LuCI 实时菜单树渲染（无硬编码菜单）
- 移动端抽屉式导航 + 遮罩
- 480px 至 1280px+ 全段响应式；移动端表格重排为卡片
- 总览页增强（仅在 Status > Overview 加载）：端口状态、系统信息、DHCP/Wireless/UPnP 区块卡片化；不支持的值显示 N/A，绝不造假数据
- 无障碍：跳转链接、focus-visible、aria 标签、键盘可操作的登录页
- 无 CDN、无 Web 字体、无图标字体、无前端框架、无 jQuery
- 国际化就绪（英文 + 简体中文，po 编译为 lmo 随包安装）
- LuCI 弹窗系统主题化（#modal_overlay 遮罩 + 居中对话框，保存并应用进度可见）
- cbi 选项卡（ul.cbi-tabmenu）完整样式与显隐规则
- cbi-dropdown 深度主题化：[open] 属性选择器 + 核心样式反制，全站下拉（含编辑弹窗设备选择）可正常展开选择
- 全站 8px 半透明细滚动条（webkit + Firefox），color-scheme 跟随深色模式
- 接口页定制：区域头降饱和色条、设备悬停详情面板、接口详情玻璃卡片
- 第三方应用设计变量桥接（--brand/--surface/--text 等，兼容 taygedo 等应用）；h5000m_netmode 网络出口页对比度适配

## 目录结构

```
.github/workflows/build.yml   # GitHub Actions 云编译（x86_64 + mediatek/filogic）
theme/                        # 主题源码（放入 buildroot 的 feeds/luci/themes/ 下编译）
├── Makefile                  # 基于 luci.mk 的包定义
├── htdocs/luci-static/mint/
│   ├── cascade.css           # 设计系统 + 布局 + 组件
│   ├── overview.js           # 总览页增强（仅 Status > Overview 加载）
│   ├── overview-banner.png   # 顶栏品牌图
│   ├── login-logo.png        # 登录页 Logo
│   └── favicon/              # favicon.svg（矢量）/ -48.png / -180.png
├── htdocs/luci-static/resources/
│   ├── menu-mint.js      # 侧栏/菜单渲染器（LuCI JS API）
│   └── view/mint/
│       ├── sysauth.js        # 登录页前端
│       └── wallpaper.js      # 壁纸设置表单
├── ucode/template/themes/mint/
│   ├── header.ut             # 页面骨架、侧栏、顶栏
│   ├── footer.ut             # 页脚、L.require('menu-mint')
│   └── sysauth.ut            # 登录页（保留原生认证表单）
├── ucode/mint/
│   └── wallpaper.uc          # UCI 配置读取 + 服务端钳制（无外部请求、无缓存）
├── root/
│   ├── etc/config/mint           # UCI 配置
│   ├── etc/uci-defaults/30_luci-theme-mint
│   ├── usr/libexec/rpcd/mint     # ubus 兼容桩（refresh 方法，无实际缓存）
│   ├── usr/share/luci/menu.d/luci-theme-mint.json
│   ├── usr/share/luci/acl.d/luci-theme-mint.json
│   └── usr/share/rpcd/acl.d/luci-theme-mint.json  # rpcd 授权组（菜单 ACL 必需）
└── po/                       # templates + zh_Hans
```

## 云编译（GitHub Actions）

推送到 `main` 分支自动触发构建（x86_64 与 mediatek/filogic 两个目标）：

- 基于官方**预编译 SDK**（跳过工具链编译，单次构建从约 40-60 分钟降到 5-10 分钟）
- 构建产物上传至 workflow artifacts
- 同时发布到 `nightly` prerelease

也可在 Actions 页面手动触发（workflow_dispatch）。

## 本地编译

本主题是纯数据包（无 C/Lua 源码，luci.mk 的 `Build/Compile` 为空），构建实际只有文件装配 + po 转 lmo。**不要**为它编译整套 OpenWrt 工具链——用官方预编译 SDK 最快（几分钟），或只在完整 buildroot 里启用 ccache。

### 方式一：官方预编译 SDK（推荐）

```sh
# 以 x86/64 为例；其他目标把路径换成对应的 targets/架构/
BASE=https://downloads.openwrt.org/snapshots/targets/x86/64
SDK=$(curl -fsSL "$BASE/" | grep -o 'openwrt-sdk-.*tar.zst' | head -1)
curl -fsSLO "$BASE/$SDK"
tar --zstd -xf "$SDK"
mv openwrt-sdk-* sdk
cd sdk

echo "src-git luci https://github.com/openwrt/luci.git;master" > feeds.conf.default
./scripts/feeds update luci
mkdir -p feeds/luci/themes/luci-theme-mint
cp -a /本地路径/luci-theme-mint/theme/* feeds/luci/themes/luci-theme-mint/
./scripts/feeds install -a

echo "CONFIG_PACKAGE_luci-theme-mint=m" >> .config
make defconfig
make package/feeds/luci/luci-theme-mint/compile -j$(nproc) V=s
```

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

设置页位于 `系统` > `Mint Wallpaper` > `Wallpaper Settings`（`/cgi-bin/luci/admin/system/mintwallpaper/settings`），配置文件 `/etc/config/mint`：

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

- 目标：当前 OpenWrt main / LuCI master（ucode 模板引擎，`.ut`）
- 浏览器：Chrome/Chromium、Firefox、Safari、Android WebView（`backdrop-filter` 仅为渐进增强）
- 禁用 JavaScript 时登录与后台仍可使用（壁纸、菜单渲染与动态效果需要 JS）

## 故障排查

- 主题不可选：手动执行 `sh /etc/uci-defaults/30_luci-theme-mint`，然后重启 rpcd
- 壁纸不出现：随机图由浏览器直连第三方 API；无外网或 API 不可达时显示渐变兜底属预期行为。如需完全离线请上传自定义图片
- 强制固定配色：在 系统 > 系统 > 语言和外观 选择 `mint-light` 或 `mint-dark`，或使用侧栏切换按钮

## 许可证

Apache-2.0，见 [theme/LICENSE](./theme/LICENSE)。
