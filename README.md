# Mint — 现代 LuCI 主题（luci-theme-mint）

<p align="center"><img src="assets/logo.png" width="200" alt="Mint logo — 像素猫娘"></p>

**Mint** 是一个面向 **OpenWrt main / LuCI master（ucode 模板引擎）** 的 LuCI 主题。
本仓库同时是它的**发布工程**：主题源码、包定义、CI 云编译流水线、包校验/安装测试脚本与
审查报告都在这里。

- 设计方向：现代总览页、卡片式 UI、高信息密度 + 大量留白，Apple/Linear 式克制视觉。
- 实现方式：不是对既有主题做 CSS 换肤。模板（`.ut`）、菜单渲染、总览仪表盘、登录页、
  设置页、`rpcd` 后端全部按当前 LuCI master 的主题接口自行实现。
- 主题本体是**纯数据包**（`htdocs/` + `root/` + `ucode/` + `po/`，无 `src/`），
  `LUCI_PKGARCH:=all`，产物可装于任意目标平台。
- 只注册**单一主题变体** `luci.themes.mint`（`/luci-static/mint`）；浅色/深色由侧栏
  按钮在前端切换，不再有 `mint-light` / `mint-dark` 之类的额外注册项。

文档索引：本文是使用总览 ·
[theme/README.md](theme/README.md)（英文，位于 `theme/` 源码目录内、随 feed 分发，但**不在**包载荷里）·
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（设备侧结构与数据流）·
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)（构建 / 脚本 / 约定）·
[RELEASE.md](RELEASE.md)（发布流程）·
[CHANGELOG.md](CHANGELOG.md) · [docs/reviews/](docs/reviews/)（审查报告存档）

---

## 目录

- [特性](#特性)
- [快速开始](#快速开始)
- [仓库结构](#仓库结构)
- [包内部件与设备安装路径](#包内部件与设备安装路径)
- [配置项：/etc/config/mint](#配置项etcconfigmint)
- [壁纸子系统](#壁纸子系统)
- [总览页仪表盘](#总览页仪表盘)
- [nftables 状态页增强](#nftables-状态页增强)
- [表单保存兜底与 ubus 接口](#表单保存兜底与-ubus-接口)
- [外观与设计令牌](#外观与设计令牌)
- [国际化](#国际化)
- [菜单与权限模型](#菜单与权限模型)
- [兼容性与运行时依赖](#兼容性与运行时依赖)
- [云编译与发布](#云编译与发布)
- [本地编译](#本地编译)
- [本地离线验证](#本地离线验证)
- [安装 / 升级 / 卸载的真实行为](#安装--升级--卸载的真实行为)
- [故障排查](#故障排查)
- [开发约定](#开发约定)
- [已知差异与限制](#已知差异与限制)
- [许可证](#许可证)

---

## 特性

以下逐条对应仓库中实际存在的代码，未实现的宣传一律不写。

**框架层**

- CSS 变量设计令牌系统（颜色 / 圆角 / 阴影 / 间距 / 字体 / 布局），`cascade.css`
  约 5.6k 行，浅色与 `html[data-theme="dark"]` 两套值
- 浅色 / 深色 / 跟随系统三态：默认跟随 `prefers-color-scheme`，侧栏按钮可覆盖并写入
  `localStorage['mz-theme']`（`header.ut` 内联脚本负责首屏无闪烁）
- 侧栏导航由 `ui.menu` 的实时菜单树渲染（最多 3 层），分组可折叠，折叠状态按分组名
  持久化在 `localStorage['mz-nav-<标题>']`
- 移动端抽屉导航 + 遮罩 + `≤854px` 的 sticky 玻璃顶栏（`.mz-mobilebar`，由
  `menu-mint.js` 注入并把页面 `h2` 标题搬进顶栏）
- 无 CDN、无 Web 字体、无图标字体、无前端框架、无 jQuery；所有脚本均为本地纯 DOM
- 无障碍：管理页跳转链接、`:focus-visible` 轮廓、图标按钮 `aria-label`、
  顶栏 `aria-live="polite"`、仪表盘数值是真实 DOM 文本（环中心数字 + `aria-live` 统计卡）、
  图表卡片附 sr-only 标题、`prefers-reduced-motion` 降级

**页面级增强**

- 登录页：保留 100% 原生 LuCI 认证表单（`POST luci_username/luci_password`），前端只做
  记住用户名（`localStorage['mz-username']`）与背景壁纸；2FA 的 `auth_fields` /
  `auth_html` 原样透传；Passkey 按钮为**契约位**（`hidden` + `disabled`，由认证插件的
  `auth_assets` 脚本启用），主题自身不含任何 WebAuthn 逻辑
- 总览页（仅 `Status > Overview`）：桌面端完整实时仪表盘 + 移动端紧凑面板，详见
  [总览页仪表盘](#总览页仪表盘)
- nftables 状态页（仅 `Status > nftables`）：链分组 / 折叠 / 搜索 / 零流量行隐藏
- 弹窗（`#modal_overlay`）、`ul.cbi-tabmenu`、`cbi-dropdown`（含 `[open]` 与
  `ul.preview` 的区分）、进度条、表格、按钮体系均已完整主题化
- 「保存并应用」SplitButton 下拉在桌面端可正常展开（`ul.dropdown` 浮层化、不裁剪溢出）
- `mz-ui.js`（全站）：为 `uci-applied` / `uci-reverted` 补成功提示（跨重载用
  `sessionStorage['mz-apply-ok']` 复播一次）；给 `cbi-dynlist` 每一项注入显式
  编辑 / 删除按钮（原生仅有不可见热区）
- 第三方应用令牌桥接：把 `--brand` / `--surface` / `--text` / `--hairline` 等映射到本
  主题令牌（兼容 taygedo 之类自带样式的应用）；`h5000m_netmode` 网络出口页的卡片对比度
  单独适配

**壁纸**

- 登录页全屏壁纸 + 管理页可选壁纸，桌面/移动两套独立配置
- 来源优先级：自定义（上传图片优先于直链）→ 服务端 5 分钟缓存 → 多源随机（打乱逐个
  尝试，失败自动换源）→ 内置 CSS 渐变兜底；**任何情况下都不阻塞登录页**
- 设置页 `系统 → Mint Wallpaper → Wallpaper Settings`，配置落在 `/etc/config/mint`

**工程**

- GitHub Actions 用**官方 OpenWrt SDK** 真实构建双格式产物（`.apk` / `.ipk`），每个产物
  先过结构校验再过真实包管理器安装测试，并附构建证据 `.buildinfo.txt`
- 国际化：`po/` 由 `luci.mk` 编成独立翻译包 `luci-i18n-mint-zh-cn`，与主题成对发布、成对安装
- 可离线复现 CI 校验环节的两个本地脚本（`ci-simulate.sh` / `ci-mirror-test.sh`）

---

## 快速开始

```sh
# 1) 从 GitHub Releases 下载与设备包管理器匹配的**两个**包（主题 + 简中翻译）
#    apk（OpenWrt 25.12+ / snapshot）
scp luci-theme-mint-*.apk luci-i18n-mint-zh-cn-*.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 "apk add --allow-untrusted /tmp/luci-theme-mint-*.apk /tmp/luci-i18n-mint-zh-cn-*.apk"

#    ipk（OpenWrt 24.10 / 23.05，仍用 opkg 的系统）
scp luci-theme-mint-*.ipk luci-i18n-mint-zh-cn-*.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 "opkg install /tmp/luci-theme-mint-*.ipk /tmp/luci-i18n-mint-zh-cn-*.ipk"
```

安装后由 `/etc/uci-defaults/30_luci-theme-mint` 在**下次开机时**注册并启用主题
（且只有全新安装才写 `luci.main.mediaurlbase`，升级绝不改动你当前选的主题）。
不想重启就直接手工执行：

```sh
uci set luci.themes.mint=/luci-static/mint
uci set luci.main.mediaurlbase=/luci-static/mint
uci commit luci
/etc/init.d/rpcd reload        # 重载（不是重启）以读取新的 rpcd ACL
```

> **只装主题不装翻译包时界面是英文**——这是官方 LuCI 规范的预期行为（`po/` 独立成包），
> 不是 bug。
>
> `--allow-untrusted` 是必需的：CI 以 `CONFIG_SIGNED_PACKAGES=n` 构建，包**未签名**。
> opkg 侧只要设备没启用 `/etc/opkg.conf` 的 `option check_signature` 就能直接装。

---

## 仓库结构

```
luci-theme-mint/
├── .github/workflows/
│   ├── build-apk.yml          # OpenWrt 25.12 + snapshot → .apk（arch: noarch）
│   ├── build-ipk.yml          # OpenWrt 24.10 + 23.05    → .ipk（arch: all）
│   └── release.yml            # workflow_run 汇总两条流水线的产物 → nightly / vX.Y.Z Release
├── .gitattributes             # * text=auto eol=lf（BusyBox ash 不吃 CRLF，脚本必须 LF）
├── .gitignore                 # 仅 Python 构建产物
├── assets/logo.png            # 仓库文档用 Logo（不入库到包）
├── docs/reviews/              # 代码 / 布局审查报告存档（带日期，只追加不删除）
├── scripts/                   # 构建、校验、发布、离线测试脚本（见「本地离线验证」）
├── theme/                     # 主题源码：整目录 = feeds/luci/themes/luci-theme-mint/
│   ├── Makefile               # 基于 luci.mk 的包定义（含 postinst / postrm / conffiles）
│   ├── LICENSE README.md
│   ├── htdocs/                # → 设备上 /www
│   ├── ucode/                 # → 设备上 /usr/share/ucode/luci
│   ├── root/                  # → 设备上 /
│   └── po/                    # templates/theme.pot + zh_Hans/luci-theme-mint.po
├── CHANGELOG.md README.md RELEASE.md
```

`theme/` 是唯一会被打进包的目录；`scripts/` 与 `.github/` 只服务于构建与校验。

---

## 包内部件与设备安装路径

`luci.mk` 的映射规则：`htdocs/*` → `/www`，`ucode/*` → `/usr/share/ucode/luci`
（`UCODE_LIBRARYDIR`，**不是** `/usr/share/ucode`），`root/*` → `/`。

| 仓库路径（`theme/` 下） | 设备路径 | 作用 |
|---|---|---|
| `htdocs/luci-static/mint/cascade.css` | `/www/luci-static/mint/cascade.css` | 设计令牌 + 布局 + 全站组件覆盖（唯一主样式表） |
| `htdocs/luci-static/mint/overview-dashboard.css` | 同目录 | 总览仪表盘样式，命名空间 `.mint-overview-dashboard`，仅在 Overview 加载 |
| `htdocs/luci-static/mint/mz-ui.js` | 同目录 | 全站通用前端辅助：apply/revert 提示、dynlist 编辑删除、`sfh` 翻译兜底 |
| `htdocs/luci-static/mint/overview-dashboard.js` | 同目录 | PC 端实时仪表盘（SVG 环 + canvas 图 + 卡片） |
| `htdocs/luci-static/mint/overview-mobile.js` | 同目录 | 移动端 Overview 面板重排（端口 / DHCP / 无线 / UPnP） |
| `htdocs/luci-static/mint/mz-nftables.js` | 同目录 | `Status > nftables` 页分组 / 折叠 / 搜索 |
| `htdocs/luci-static/mint/overview-banner.png` | 同目录 | 侧栏品牌图 |
| `htdocs/luci-static/mint/login-logo.png` | 同目录 | 登录页 Logo |
| `htdocs/luci-static/mint/favicon/{favicon.svg,favicon-48.png,favicon-180.png}` | 同目录 | 站点图标 |
| `htdocs/luci-static/resources/menu-mint.js` | `/www/luci-static/resources/menu-mint.js` | 侧栏 / 抽屉 / 配色 / 壁纸 / 保存兜底（`L.require('menu-mint')` 加载） |
| `htdocs/luci-static/resources/view/mint/sysauth.js` | `…/view/mint/sysauth.js` | 登录页视图（`ui.instantiateView('mint.sysauth')`） |
| `htdocs/luci-static/resources/view/mint/wallpaper.js` | `…/view/mint/wallpaper.js` | 壁纸设置 CBI 表单 + 图片上传 |
| `ucode/template/themes/mint/header.ut` | `/usr/share/ucode/luci/template/themes/mint/header.ut` | 页面骨架：侧栏 / 顶栏 / 首屏配色脚本 / 内联 `window.mintWallpaper` 与 `window.mzWpUtil` |
| `ucode/template/themes/mint/footer.ut` | 同上 | 页脚 + `L.require('menu-mint')` + 按路径条件注入 overview / nftables 脚本 + 原生区块去重 |
| `ucode/template/themes/mint/sysauth.ut` | 同上 | 登录页（单表单 + `auth_fields` / `auth_assets` 透传） |
| `ucode/mint/wallpaper.uc` | `/usr/share/ucode/luci/mint/wallpaper.uc` | `luci.mint.wallpaper`：读 UCI + 服务端钳制/校验，解析出 `pc/mobile` 两组配置 |
| `root/etc/config/mint` | `/etc/config/mint` | UCI 默认配置（同时被声明为 conffile，升级时保留） |
| `root/etc/uci-defaults/30_luci-theme-mint` | `/etc/uci-defaults/…` | 注册主题、迁移旧配置、播种壁纸默认值、安装 cron、清理遗留项 |
| `root/lib/upgrade/keep.d/luci-theme-mint` | `/lib/upgrade/keep.d/…` | sysupgrade 保留上传的 `custom-*.jpg` |
| `root/usr/libexec/rpcd/mint` | `/usr/libexec/rpcd/mint` | `ubus` 对象 `mint`：`refresh` / `dashboard` / `save` |
| `root/usr/bin/mz-wallpaper-fetch.sh` | `/usr/bin/mz-wallpaper-fetch.sh` | cron 用壁纸抓取器（服务端缓存，见下节） |
| `root/usr/share/luci/menu.d/luci-theme-mint.json` | 同路径 | 设置菜单位与 `depends` |
| `root/usr/share/rpcd/acl.d/luci-theme-mint.json` | 同路径 | rpcd 授权组 `luci-theme-mint` |
| `po/templates/theme.pot`、`po/zh_Hans/luci-theme-mint.po` | 编译进翻译包 | 见[国际化](#国际化) |

> **注意**：`/usr/share/luci/acl.d/`（旧 LuCI ACL 目录）已**不再**由本包提供——ACL 自
> 2026-09 起放在 `/usr/share/rpcd/acl.d/`。`postinst` 与 `uci-defaults` 仍会顺手删除旧路径下
> 的 `luci-theme-mint*.json` 残留（旧版本遗留文件会覆盖 rpcd 授权、让设置页失效）。

前端脚本的加载矩阵（由 `footer.ut` 决定，非全站脚本都是按需注入）：

| 页面 | 加载内容 |
|---|---|
| 所有管理页 | `cascade.css`、`L.require('menu-mint')`、`mz-ui.js` |
| 登录页（`blank_page`） | `cascade.css`、`sysauth.ut` 视图 `mint.sysauth`（**不**加载 `menu-mint` / `mz-ui`） |
| `admin/status/overview` | 上述 + `overview-dashboard.css`；按「UA 或 `max-width:854px`」判定：桌面注入 `overview-dashboard.js`，移动注入 `overview-mobile.js` |
| `admin/status/nftables` | 上述 + `mz-nftables.js` |

---

## 配置项：/etc/config/mint

唯一 section：`config mint 'wallpaper'`。默认值取自 `root/etc/config/mint`，运行时由
`ucode/mint/wallpaper.uc` 做兜底与钳制。

| 选项 | 类型 | 默认 | 说明（= 代码实际语义） |
|---|---|---|---|
| `enabled` | 布尔 | `1` | 壁纸总开关；`0` 时 `window.mintWallpaper.enabled=false`，前后端一律不取图，仅渐变兜底 |
| `ui_random` | 布尔 | **`0`** | 管理页是否也使用随机壁纸；登录页不受此项限制。**默认关闭**（避免后台向第三方 API 发请求），四处默认值已对齐：随包配置、`uci-defaults` 播种、设置表单 `.default`、`wallpaper.uc` 运行时回退 |
| `pc_mode` | `random`\|`custom` | `random` | 桌面端来源 |
| `pc_url` | http(s) 直链 | 空 | 桌面端自定义 URL（若已上传 `custom-pc.jpg`，上传文件优先） |
| `pc_sources` | list | `https://api.paugram.com/wallpaper/`、`https://t.alcy.cc/bd` | 桌面端随机源；留空则回落到 `wallpaper.uc` 内置默认 |
| `mobile_mode` | `random`\|`custom` | `random` | 移动端来源 |
| `mobile_url` | http(s) 直链 | 空 | 移动端自定义 URL（上传的 `custom-mobile.jpg` 优先） |
| `mobile_sources` | list | `https://api.seaya.link/wap`、`https://t.alcy.cc/mp` | 移动端随机源 |
| `overlay` | 浮点 | `0.45` | 遮罩不透明度；`wallpaper.uc` 只接受 `0` / `1` / `0.x` / `1.0*`，否则回退 `0.45`（刻意不用 `=~`，见文件内 TZ-20 说明） |
| `blur` | 整数 px | `0` | 背景模糊；钳制到 `0..40` |

设备侧速查：

```sh
uci show mint                     # 当前配置
logread -e mz-wallpaper           # cron 抓取器日志（refusing non-http source 等）
ubus call mint refresh            # 兼容桩：恒返回 {"spawned":false,"mode":"random"}
```

---

## 壁纸子系统

### 数据流

```
                     ┌──────────────────────────────────────────────┐
 /etc/config/mint ──►│ ucode/mint/wallpaper.uc  getWallpapers()      │  纯配置解析 + 钳制
                     │  · custom: 上传文件 stat() 优先，其次 http(s) 直链│  （不发任何网络请求）
                     │  · random: 若 wallpaper-<kind>.img 存在则给出 proxy│
                     └───────────────────┬──────────────────────────┘
                                         │ header.ut 内联为 window.mintWallpaper（无额外请求）
                    ┌────────────────────┴─────────────────────┐
                    ▼                                          ▼
        view/mint/sysauth.js（登录页）              resources/menu-mint.js（管理页）
        custom → proxy → 打乱 sources 逐个尝试      暗色模式：不取壁纸，仅玻璃层
                                                     custom → proxy → sessionStorage(5min) → 打乱逐个尝试
                    └────────────────────┬─────────────────────┘
                                         ▼
                    全部失败 → CSS 渐变兜底（登录页 .mz-login-bg / 管理页 body.mz-has-wallpaper::after）
```

服务端缓存（OT-35）：随机图 API **每次请求都 302 到不同图片**，浏览器无法靠任何缓存策略
固定一张。于是由路由器把随机性消化掉：

```sh
*/5 * * * * /usr/bin/mz-wallpaper-fetch.sh #mz-wallpaper
```

`/usr/bin/mz-wallpaper-fetch.sh`（由 `uci-defaults` 幂等安装，卸载时移除该行并重启 cron）：

- 仅在对应 `*_mode=random` 时抓取；`custom` 模式直接跳过
- 从 UCI 列表里轮转取一个源（`$RANDOM`+秒 取模，空列表用内置默认），**只接受 `http(s)`**
  ——此脚本以 root 运行且直接写 `uhttpd` 文档根，未限制协议就等于「把任意本地文件发布给未认证访客」
- `curl` 带 `--proto '=http,https' --proto-redir '=http,https'`（连 302 跳转也限协议）、
  `--max-filesize 8388608`（8 MiB 硬上限，防把 `/www` 写满）、`--: ` 选项终止符
- 校验：≥3 KB 且魔数是 JPEG/PNG/GIF/WEBP 才算成功；先写 `.tmp` 再 `mv` 原子替换，坏源不会覆盖好图
- `api.seaya.link/wap` 返回的是 HTML，脚本会从中提取 `img.seaya.link` 直链，**并对抓到的
  URL 重新做一次协议校验**（该值来自远端 HTML，属攻击者可控）
- `flock -n` 单实例，`od -An -tx1` 读魔数（不能用 `$(dd …)`：PNG 头含 NUL 会被截断）

产物 `wallpaper-pc.img` / `wallpaper-mobile.img` 由 uhttpd 带 `Last-Modified` 提供，浏览器
在 5 分钟窗口内命中 304：登录页与管理页在**同一缓存窗口内看到的是同一张图**（因此
「每次刷新都换图」只在缓存文件缺失时才成立）。

### 优先级与显示

| 场景 | 结果 |
|---|---|
| 已上传 `custom-pc.jpg` / `custom-mobile.jpg` | 用本地文件（覆盖 `pc_url` / `mobile_url`），右下角标注「本地自定义图片」 |
| `*_mode=custom` 且只填了直链 | 用直链，标注其域名 |
| `*_mode=random` 且缓存文件已生成 | 用 `/luci-static/mint/wallpaper-<kind>.img`，标注「缓存随机壁纸」 |
| `*_mode=random` 且无缓存文件 | 打乱 `*_sources` 逐个 `new Image()` 预加载（URL 追加 `_mzt=<ts>` 防缓存），单源 16 s 超时/失败换下一源；管理页额外有 `sessionStorage['mz-wp-url-<kind>']` 5 分钟记忆 |
| 全部失败 | 内置渐变，页面照常渲染 |

其他实现细节：预加载 `img.referrerPolicy='no-referrer'`（不泄露路由器 URL）；图片源标注
（`#mz-login-copyright`）永不移除；`overlay`/`blur` 经 CSS 变量注入；**管理页在深色模式下
不取壁纸**（`menu-mint.js` 移除 `--mz-wallpaper*` 并保留 `mz-has-wallpaper` 类，意图是得到「纯黑玻璃」；
但**抑制渐变的 CSS 规则当前不生效**，见[已知差异与限制](#已知差异与限制)第 2 条）。

### 关闭服务端抓取

```sh
uci set mint.wallpaper.enabled=0 && uci commit mint   # 前端不再请求壁纸
# 或者只停 cron：
sed -i '/mz-wallpaper-fetch/d' /etc/crontabs/root && /etc/init.d/cron restart
rm -f /www/luci-static/mint/wallpaper-*.img
```

---

## 总览页仪表盘

数据只来自一个 `ubus` 调用（浏览器绝不直接读 `/proc`）：

```sh
ubus call mint dashboard
```

`root/usr/libexec/rpcd/mint` 的 `mint_dashboard()` 是**无状态采集器**，输出
`cpu{cores,freq_khz,stat}` / `memory{total_kb,available_kb,free_kb,buffers_kb,cached_kb}` /
`temperature[]`（`/sys/class/thermal/thermal_zone*` + `hwmon*/*_input`，毫度）/
`storage`（`df -k /`）/ `load` / `uptime` / `conntrack{count,max}` /
`network{uplink{…}, public_ipv4}` / `system{…}`；百分比、速率、CPU 占用增量全部在浏览器侧算。

上行接口**动态判定**（`ubus call network.interface dump` 里取默认路由所属接口，含 IPv6
兄弟接口回退），没有任何硬编码的 `wan` / IP。公网出口 IP 来自 `ipv4.im`，`/tmp` 缓存
5 分钟，最坏 2 次×2 s 重试；连续失败后进入退避——只有 `ping` 公网（223.5.5.5 /
119.29.29.29）成功才重新探测，失败时返回哨兵 `未联网`，前端显示 `Offline/未联网`。
所有字符串字段过 `json_escape()`（防手改的 hostname/model 破坏 JSON 结构）。

前端（`overview-dashboard.js`，桌面）：

| 区块 | 内容 |
|---|---|
| 环 ×4 | CPU / 内存 / 温度 / 存储（SVG `r=52` 环，中心数字 + 副标题） |
| 卡片 ×6 | 负载、运行时间、活动连接（conntrack）、上行接口、地址、实时吞吐 |
| 曲线 ×3 | CPU/内存、网络 RX/TX、温度，各 180 点 ≈ 最近 3 分钟（canvas，随容器尺寸重绘） |
| 系统信息 ×9 | 主机名 / 型号 / 架构 / 温度 / 目标平台 / 固件 / 内核 / OpenWrt / LuCI 版本 |

生命周期与节制策略：三档轮询（1 s 快、3 s 中、10 s 慢）；标签页隐藏时降为 10 s；离开
Overview 时 `destroy()` 全量拆除定时器与 observer（反复进出不泄漏）；RPC 失败显示错误条
而非旧数据；标题 `h2.mint-ovd-title`（「状态」）由仪表盘自己渲染，同时 `footer.ut` 的去重
脚本会用 `.mint-dedup-hidden` 隐藏原生「系统 / 内存 / 存储」三块，避免重复统计。
**取不到的值一律显示 `--` / `N/A`，绝不造假数据。**

移动端（`overview-mobile.js`）不重新采集，而是**读取原生 Overview 已渲染的 DOM** 重组为卡片
（端口状态、DHCP 租约、无线、UPnP 映射 + 核心环），并就地打补丁避免每次 XHR 轮询重建 DOM；
若检测到桌面仪表盘 DOM 存在，则抑制自身重复面板；隐藏原生区块按「面板类别」分组判断
（只在该类别确实渲染成功时才隐藏，避免误删信息）。

---

## nftables 状态页增强

`mz-nftables.js`（仅 `admin/status/nftables`）在不改上游视图的前提下：按 family/用途把
链分桶（基础 / NAT / mangle / 区域转发 / helper / 第三方表）、为每条链加可点击折叠头与
「规则数 · 流量」摘要、默认折叠全零流量链、提供 展开全部 / 折叠全部 / 关键字过滤 /
隐藏 0 B 规则行 的工具栏。特性：幂等（`dataset` 标记）、纯 DOM 构造（无 `innerHTML`，
链名 `<code>` 亦用 `textNode` 组装）、`MutationObserver` 在 SPA 导航后重跑；链名正则
（`classifyChain` 等）刻意保持中文字面量，因为它们是**匹配上游渲染文本的解析键**，
翻译会破坏匹配。

---

## 表单保存兜底与 ubus 接口

部分 LuCI 构建（典型是被精简过 `cbi.js` 的固件）存在两个坑：`.cbi-map` 外层没有
`<form>`，以及 JS 的 `save()` 只发 `uci set`、不发 `uci commit`（会话级 `uci commit`
也被 rpcd ACL 拒绝）。结果是开关点了「保存」但从未落盘。主题侧修掉：

1. `menu-mint.js` `ensureCbiForm()`：仅当 `.cbi-map` 不在 `<form>` 内时才注入
   `<form data-mint-injected>`（含从页面内联 JSON 里恢复的 CSRF `token` 与 `cbi.submit`），
   并把 `.cbi-page-actions` / `.cbi-apply` / `.cbi-map-actions` / `.cbi-map-descr` 一起搬入；
   已正确包裹的 stock LuCI 一律不动。
2. 渲染时 `snapshotCbiValues()` 给每个控件记 `data-mint-init`；`collectCbiValues()`
   **只提交与快照不同的项**（空密码跳过，未选中的 radio 跳过）——避免另一个陈旧标签页
   在点保存时把旧值回写（这正是当年 `ui_random` 神秘归零的根因）。
3. 接管 `cbi-button-save/apply` 的点击 → 按 `config/section` 分组调用
   `ubus call mint save`，由 rpcd（root）执行 `uci set` + `uci commit`，随后 reload。
   输入被清洗为 `[A-Za-z0-9_]`（无路径穿越 / 无 shell 注入），并 `logger` 记录提交的
   选项名（不记值，避免泄露秘密）。ubus 端点优先走 `L.rpc.declare`，降级路径读
   `L.env.ubuspath`，不硬编码 `/ubus/`。

`ubus` 对象 `mint` 的三个方法：

| 方法 | 权限 | 语义 |
|---|---|---|
| `dashboard` | read | 上述快照 JSON（`overview-dashboard.js` 用） |
| `save` | write | `mint save`：`{config, section, values:[[opt,val],…]}` → `uci set`+`uci commit` |
| `refresh` | read | **兼容桩**，恒返回 `{"spawned":false,"mode":"random"}`（为旧的 ACL 授权与 API 调用方保留；壁纸刷新实际由 cron 完成，此调用不会触发抓取） |

设置页的上传按钮走的是 luci-base 自带的 `file` 对象（`rpc file.write`），写入
`/www/luci-static/mint/custom-{pc,mobile}.jpg`；限制 3 MiB，`accept` 为
`image/jpeg,image/png,image/webp`；上传成功后不会自动切模式（提示「设为自定义才会使用」），
双击被 `input.disabled` 挡住。

---

## 外观与设计令牌

`:root`（浅色）与 `html[data-theme="dark"]`（深色）两套令牌，节选实际值：

| 令牌 | 浅色 | 深色 |
|---|---|---|
| `--mz-color-primary` | `#4f6ef7` | `#7d93ff` |
| `--mz-color-background` | `#f5f6f8` | `#10151f` |
| `--mz-color-surface` / `-2` | `#ffffff` / `#fafbfc` | `#171e2c` / `#1d2536` |
| `--mz-color-border` | `#e4e7ec` | `#2a3348` |
| `--mz-color-text` / `-muted` | `#1a2233` / `#64708a` | `#e6e9f0` / `#8b94ab` |
| `--mz-color-success/warning/danger` | `#2f9e6e` / `#d9861f` / `#d9484f` | `#4cbd8b` / `#e8a04c` / `#ef6a70` |
| `--mz-radius-sm/md/lg/xl` | `6px / 10px / 14px / 20px` | （同值） |
| `--mz-spacing-xs…xl` | `4 / 8 / 14 / 22 / 34px` | （同值） |
| `--mz-sidebar-width` / `--mz-topbar-height` | `236px / 56px` | （同值） |
| `--mz-transition` | `180ms ease` | （同值） |
| 字体 | `system-ui, -apple-system, …, "PingFang SC", "Microsoft YaHei"`，等宽 `ui-monospace, …` | 同 |

- 深色**不用纯黑**背景，配 `color-scheme: dark`（原生下拉/滚动条跟随），并有
  `<meta name="darkreader-lock">` 屏蔽 Dark Reader 二次改写。
- 壁纸玻璃层：`body.mz-has-wallpaper` 启用 `::after`（固定定位图像层，规避 iOS Safari
  忽略 `background-attachment: fixed` 的问题）+ `::before`（遮罩 + `backdrop-filter` 模糊），
  卡片透明度取 `--mz-panel-bg{,-strong,-soft}`；`backdrop-filter` 仅为渐进增强，不支持时
  退化为半透明实色。
- 全站细滚动条：`scrollbar-width: thin` + `::-webkit-scrollbar{width:8px}`，滑块
  `rgba(148,163,184,.45)`。
- 断点：`≤480 / ≤640 / ≤767-768 / ≤854 / ≥1024 / ≥1400 / ≥1600`；移动端表格重排为卡片，
  首页端口/网络/无线网格在桌面为 `>150px` 卡片、手机两列；`prefers-reduced-motion` 关动效。
- 接口页：区域头去饱和色条（`--zone-color-rgb` 由 `initZoneColors()` 从 LuCI 内联
  `background-color` 反推，配 `MutationObserver` 跟随轮询重绘）、`ifacebox`/`ifacebadge`
  卡片化、`.cbi-tooltip` 悬停详情。

---

## 国际化

- 目录：`theme/po/templates/theme.pot`（模板）+ `theme/po/zh_Hans/luci-theme-mint.po`
  （简体中文，109 条 msgid，**全部已译**）。
- `luci.mk` 的 `LuciTranslation` 会把 `po/zh_Hans` 编成**独立包**
  `luci-i18n-mint-zh-cn`（载荷 `usr/lib/lua/luci/i18n/luci-theme-mint.zh-cn.lmo`
  + 注册语言的 uci-defaults），该包在 menuconfig 中 `HIDDEN` 且默认不选中——所以 CI 与
  本地构建都必须显式 `CONFIG_PACKAGE_luci-i18n-mint-zh-cn=m`。
- `postinst` 额外建 `luci-theme-mint.zh_cn.lmo` / `.zh_CN.lmo` 符号链接，兼容把
  `luci.main.lang` 写成 `zh_cn` / `zh_CN` 的固件；`postrm` 负责删除它们。
- 模板串走 `_( )`（`header.ut` / `footer.ut` / `sysauth.ut` / `menu.d` 标题）；前端 JS 走
  LuCI 的 `_`。两个**纯脚本**（非 LuCI class）无法拿到作用域内的 `_`，因此
  `mz-ui.js` / `overview-mobile.js` 自带兜底：先试全局 `_`，再用 `window.TR`
  按 SuperFastHash 查目录——注意其 `sfh` 实现对齐的是**服务端 lmo 的哈希**（JS 位运算是
  32 位有符号，右移必须 `>>>`；`rem==2` 分支按 C 侧「异或字符串结尾 NUL」处理），否则
  部分 msgid 会在客户端目录里静默查不到。
- `po2lmo.py` 是**仅供本地调试**的 `.po → .lmo` 编译脚本（对齐 `luci-base` 的
  `po2lmo.c` 算法）；正式构建用 luci-base host 提供的 `po2lmo`。

---

## 菜单与权限模型

```
/usr/share/luci/menu.d/luci-theme-mint.json
  admin/system/mintwallpaper            order 60，type firstchild
    depends.acl = ["luci-theme-mint"]   ← 依赖 rpcd 授权组存在
    depends.uci = { mint: true }        ← /etc/config/mint 不存在时整项隐藏
  admin/system/mintwallpaper/settings   order 1，view mint/wallpaper

/usr/share/rpcd/acl.d/luci-theme-mint.json（组名 = 文件/包名，避免通用名撞车）
  read : ubus mint.{refresh,dashboard} · uci [mint] · file /www/luci-static/mint list
  write: ubus mint.save                · uci [mint] · file custom-pc.jpg / custom-mobile.jpg write
```

即：**有副作用的 `save` 只在 write 作用域**；读权限覆盖设置页要展示的 `uci:mint`；
`rpcd` 后端脚本自身的执行由 `luci-base` 的默认授权负责。菜单项的 `depends.acl` 保证
无权限的管理员看不到入口，而不是点进去 403。

---

## 兼容性与运行时依赖

| 发行版 | 最低版本 | 模板引擎 | 包格式 | 说明 |
|---|---|---|---|---|
| OpenWrt | 23.05+ / main / snapshot | ucode（`.ut`） | `.ipk`（24.10 及更早）/ `.apk`（25.12+） | 主题按 LuCI master 主题接口实现 |
| ImmortalWrt | 21.02+ | ucode | 以其镜像为准（多为 `.apk`） | 本仓库 CI **只**用官方 OpenWrt SDK 出包，不为 ImmortalWrt 单独构建；兼容性来自「只使用上游 LuCI 主题接口」这一实现前提 |
| LEDE / OpenWrt ≤ 19.07 | — | — | — | **不支持**：ucode 模板与 `/usr/share/rpcd/acl.d` 不可用 |

`theme/Makefile` 声明的依赖：`LUCI_DEPENDS:=+luci-base +curl`

| 依赖 | 为什么必需 |
|---|---|
| `luci-base` | ucode 模板运行时、`luci.core`、ACL 桥接、`cbi.js`、`file` ubus 对象、翻译端点 |
| `curl` | 仅供 `/usr/bin/mz-wallpaper-fetch.sh` 抓图；OpenWrt 默认镜像只有 `uclient-fetch`，缺 `curl` 时 cron 必然失败，故必须显式声明 |
| rpcd 对象 `mint` | 由本包自带 `/usr/libexec/rpcd/mint` + `/usr/share/rpcd/acl.d/luci-theme-mint.json` |
| `luci-i18n-mint-zh-cn` | 简体中文界面（独立包，成对安装） |
| `luci-i18n-base-zh-cn` | LuCI 自带界面的简中翻译（强烈建议，否则只有主题文案是中文） |

浏览器：Chrome/Chromium、Firefox、Safari、Edge、Android Chrome/WebView、iOS Safari（近两年版本）。
特性前提：CSS 自定义属性、flex/grid；`backdrop-filter` 与 `MutationObserver` 为渐进增强。
禁用 JavaScript 时登录页与后台页面仍能渲染与认证（`noscript` 有明确提示），但侧栏菜单树、
壁纸、总览增强、动态效果不可用。

编译期：需要 `luci-base/host`（`po2lmo`、`jsmin`）。CSS 压缩 `csstidy` 属 packages feed，
默认**不启用**（避免为主题引入额外 packages 依赖）；`LUCI_MINIFY_UT:=0`——`header.ut`
`import` 了主题自带模块 `luci.mint.wallpaper`，构建主机无法解析，故 `.ut` 以源码形式随包分发，
由设备上的 ucode 现场编译（官方 dispatcher 允许该形态）。

---

## 云编译与发布

三个 workflow，全部基于**官方预编译 SDK** 真实构建（不编工具链，但会真实编译
`luci-base`、`rpcd`、`ucode`、`lucihttp`、`curl` 等依赖链，单次约 10–20 分钟）：

| Workflow | 矩阵 | 产物 |
|---|---|---|
| `build-apk.yml` | OpenWrt `25.12` + `snapshot`，各 1 个目标 `x86/64` | `luci-theme-mint-<ver>-<系列>-x86_64-all.apk` + 同名翻译包（apk 后端把架构无关包记为 `noarch`） |
| `build-ipk.yml` | OpenWrt `24.10` + `23.05`，各 1 个目标 `x86/64` | 同上，`.ipk`（架构记 `all`）；`--allow-legacy` 仅在所请求系列已无 ipk 后端时回退 |
| `release.yml` | `workflow_run`（两条构建都 completed 后） | 汇总全部产物 + `RELEASE-NOTES.md`，发布到 GitHub Release |

流程要点：

- **触发**：推送到 `main`（→ `nightly` prerelease）或手动 `workflow_dispatch`
  （可填 `release_version`）。**打 `v*` 标签本身不会触发构建**——两个构建 workflow 的
  `on:` 只有 `push: branches:[main]` 与 `workflow_dispatch`；见 [RELEASE.md](RELEASE.md)。
- `release.yml` 用同一 `head_sha` 找两条流水线的成功 run；缺任意一条就安静跳过，
  保证 Release 永远是「apk + ipk 齐全」。`pull_request` 触发的 run 一律不发布。
- **不做**任何改名/换后缀：`.apk` 与 `.ipk` 是两次独立真实构建的产物，互不可替换。
- 每个产物依次过 `scripts/verify-package.sh`：容器类型必须与扩展名一致（`.apk` 里是改名 ipk
  立刻失败）、apk 必须有 `.PKGINFO` / ipk 必须有 `debian-binary + control.tar + data.tar.*`、
  包名与版本非空、架构在 `--expect-arch all` 下只接受 ipk `all` / apk `noarch`、依赖必须含
  `luci-base` + `curl` 且**不得**出现 `kmod-*`/`kernel`（纯数据包的守卫）、翻译包必须依赖
  `luci-theme-mint`、必需载荷清单齐全、**执行位断言**。
  再过 `scripts/install-test.sh`：`apk add --allow-untrusted --root <root> --initdb`（缺依赖时
  自动生成 stub 包，让真实解析器跑一遍）/ `opkg --offline-root <root> --force-depends --nodeps
  install`，装进临时 root 后断言落点、执行位，并对 `etc/uci-defaults`、`usr/bin`、
  `usr/libexec` 里的脚本逐个 `sh -n`；runner 上没有包管理器时退化为「按同布局解包 +
  文件级断言」。
- SDK tarball 按官方 `sha256sums` 校验后进 GitHub Actions cache（key 含 tarball sha256），
  重试秒级复用；命中缓存也会重新校验，被污染的条目会被丢弃并重下。
- 版本溯源：Makefile 里的 `PKG_VERSION ?=` / `PKG_PO_VERSION ?=` 由 `build-package.sh` 注入
  **主题仓库自身**的 revision（`yy.ddd.sssss~hash`），避免同一份源码因 `feeds/luci` HEAD 不同
  而报出不同版本号；feed 内普通构建保持 `findrev` 默认行为。
- 每个包旁附 `<包名>.buildinfo.txt`：`sdk_url`、`openwrt_release/series/target`、
  `kernel_version`、`luci_branch/commit`、`package_format/arch`、`legacy_compat_sdk`。
  `make-release-notes.sh` 把它渲染成 Release 里的产物表格。

---

## 本地编译

### 方式一：仓库脚本（与 CI 完全同一条路径，推荐）

```sh
./scripts/build-package.sh --version snapshot --target x86/64 --format apk \
        --release-version v1.0.0 --out dist --workdir build --cache-dir build/sdk-cache
```

它做全部脏活：从官方索引发现 SDK 系列/tarball 名/压缩格式 → 下载并按官方 `sha256sums`
校验（可复用 `--cache-dir`）→ 保留 SDK 自带 feed 并**追加**（不是覆盖）luci feed →
把 `theme/` 注入 `feeds/luci/themes/luci-theme-mint` 并手工 `ln -sfn` 进
`package/feeds/luci/` → 写 `.config` + `defconfig` → 校验依赖链 → 构建 → 重命名产物 +
写 `.buildinfo.txt`。要 ipk 就 `--format ipk --allow-legacy`；`LUCI_FEED_URL` 可把 luci feed
指向镜像或本地 `file://` 克隆。

### 方式二：手工用官方 SDK（想搞清 CI 在做什么时照抄）

```sh
# 让仓库脚本替你解析 + 下载 + 校验 SDK（输出 key=value，含 sdk_dir / tarball_sha256）
./scripts/get-openwrt-sdk.sh --version snapshot --target x86/64 --format apk
cd build/sdk

# 关键：保留 SDK 自带 feeds.conf.default（base feed 提供 rpcd/ucode/libubox，
# packages feed 提供 curl/cgi-io），只追加 luci feed，不要覆盖它——否则 luci-base
# 的依赖链会在元数据扫描阶段被静默丢弃，编到一半才报缺头文件。
./scripts/feeds update -a
mkdir -p feeds/luci/themes/luci-theme-mint
cp -a ../../theme/. feeds/luci/themes/luci-theme-mint/   # 从仓库根的 build/sdk 出发
./scripts/feeds install -a
mkdir -p package/feeds/luci
ln -sfn ../../../feeds/luci/themes/luci-theme-mint package/feeds/luci/luci-theme-mint

# 注意：bool 项的「关」只能写成 "# CONFIG_X is not set"，CONFIG_X=n 不是合法 .config 语法
{ echo CONFIG_PACKAGE_luci-theme-mint=m
  echo CONFIG_PACKAGE_luci-i18n-mint-zh-cn=m   # 翻译包 HIDDEN 且默认 n，必须显式开
  echo CONFIG_LUCI_JSMIN=y
  echo '# CONFIG_LUCI_CSSTIDY is not set'
  echo CONFIG_SIGNED_PACKAGES=n; } >> .config   # 产物未签名 → 设备上要 apk add --allow-untrusted
make defconfig
grep -q '^CONFIG_PACKAGE_luci-theme-mint=m' .config || echo "主题未被选中：检查 feed 是否被覆盖"

make package/feeds/luci/luci-base/host/compile -j$(nproc) V=s   # po2lmo / jsmin
make package/feeds/luci/luci-theme-mint/compile -j$(nproc) V=s
```

### 方式三：完整 buildroot

把 `theme/` 放到 `feeds/luci/themes/luci-theme-mint/`，
`./scripts/feeds install luci-theme-mint` → `make menuconfig`（LuCI ▸ 4. Themes）→
`make package/luci-theme-mint/compile -j$(nproc) V=s`。强烈建议 `CONFIG_CCACHE=y`
（首次仍要编工具链，之后增量极快）。

### 三个坑

- **包格式**：由构建根的 `CONFIG_USE_APK` 决定，而新版 SDK 把它做成**无提示项**且
  `default y`——`make defconfig` 会把 `# CONFIG_USE_APK is not set` 静默改回 `=y`。
  `build-package.sh` 因此在 defconfig 后复核 `^CONFIG_USE_APK=y`：请求 apk 却没设上就
  `die`，请求 ipk 却发现是 `=y` 就返回「该 SDK 产不出 ipk」让调用方换系列，
  **绝不改名凑数**。
- **依赖链**：defconfig 之后 `build-package.sh` 会逐个确认
  `luci-base curl rpcd ucode ucode-mod-html ucode-mod-uci liblucihttp-ucode libubus libubox
  cgi-io luci-i18n-mint-zh-cn` 都出现在 `.config` 里，缺任何一个直接失败——这正是「feed 被覆盖」
  那种半路爆错的提前拦截。
- **压缩**：JS 由 luci-base host 的 `jsmin` 处理（`CONFIG_LUCI_JSMIN=y`）；CSS 压缩
  `csstidy` 在 packages feed 里、本仓库**刻意关闭**；`.ut` 模板不预编译
  （`LUCI_MINIFY_UT:=0`，因为 `header.ut` import 了主题自带模块，构建主机的 ucode 解析不了）。

---

## 本地离线验证

`scripts/` 下每个脚本的 `--help` 都有完整选项说明；下表是用途与典型调用：

| 脚本 | 用途 |
|---|---|
| `build-package.sh` | 单条流水线的全流程：解析 SDK → 建 feed → `defconfig` → 构建主题与翻译包 → 重命名产物 + 写 `.buildinfo.txt`。`--version 25.12 --target x86/64 --format apk [--release-version v1.0.0] [--allow-legacy] [--cache-dir DIR]`。`LUCI_FEED_URL` 可指向镜像/本地 `file://` 克隆 |
| `get-openwrt-sdk.sh` | 只负责「找到并校验 SDK」：从官方索引发现系列/版本/tarball 名/压缩格式，校验 `sha256sums`，探测该 SDK 的 apk/ipk 能力。`--print` 只输出 `key=value`（含 `tarball_sha256`）；`OPENWRT_BASE_URL`/`OPENWRT_MIRRORS` 可覆盖 |
| `verify-package.sh` | 包结构与元数据校验（见上）。`--file dist/*.apk` 或 `--dir dist`，`--expect-arch all` |
| `install-test.sh` | 用真实包管理器把包装进临时 root，断言安装落点（模板 / `www` 资源 / menu.d / rpcd ACL / `/etc/config/mint` / cron 脚本）、执行位是否存活，并对装进去的 `etc/uci-defaults`、`usr/bin`、`usr/libexec` 脚本逐个 `sh -n`；apk 缺依赖时自动生成 stub 包 |
| `ci-simulate.sh` | **无需联网**：用真实主题载荷按 `luci.mk` 布局造出结构等价的 apk/ipk 四件套（含负例：改名包、目标架构、丢执行位），跑 `verify-package.sh` + `install-test.sh` |
| `ci-mirror-test.sh` | **无需联网**：起一个本地 mock OpenWrt 镜像，测 `get-openwrt-sdk.sh` 的系列回退、`sha256sums` 发现、下载校验、baked `USE_APK` 探测、缓存复用与污染自愈 |
| `make-release-notes.sh` | 由 `*.buildinfo.txt` 渲染 Release 说明（`--assets DIR --tag nightly --out notes.md`） |
| `create-release.sh` | 校验版本号格式与工作树干净 → 建注解标签 → 推送标签（**不会**触发 CI，见[云编译与发布](#云编译与发布)） |
| `po2lmo.py` | 本地把 `.po` 编成 `.lmo`（调试用；正式构建用 luci-base 的 host `po2lmo`） |

```sh
./scripts/ci-simulate.sh      # 改完 CSS/JS/Makefile 后本地跑一遍包级校验
./scripts/ci-mirror-test.sh   # 改过 SDK 解析逻辑后跑
```

---

## 安装 / 升级 / 卸载的真实行为

`theme/Makefile` 的 `postinst` / `postrm` 与 `uci-defaults` 是刻意不对称的：

- **安装 / 升级（postinst）**：只 `reload` rpcd（**不 restart**——`restart` 会把刚装完主题的
  管理员一起登出，ubus 会话在内存里）；清理旧变体键 `luci.themes.MintLight/MintDark/
  Mintzero*` 与旧 ACL 残留；把 `mediaurlbase` 里失效的变体路径重写为 `/luci-static/mint`；
  删 `/tmp/luci-indexcache*` 与 `/tmp/luci-modulecache/` 让菜单立即生效；建 i18n 别名软链。
- **uci-defaults（下次开机时执行）**：只在键不存在时才写 `luci.themes.mint`；只在**全新安装**
  （`PKG_UPGRADE != 1` **且** `luci.themes.mint` 是本次新加的）时才改
  `luci.main.mediaurlbase`；只在 `mint.wallpaper` 不存在时播种默认值；把预更名时代的
  `mintzero.wallpaper` 配置与上传的图片迁过来；删除 Bing 时代的死键（`market/cache_ttl/
  random/mode/count`）；幂等地安装壁纸 cron 行（标记 `#mz-wallpaper`）。
- **`/etc/config/mint` 是 conffile**（`Package/luci-theme-mint/conffiles`），apk 写
  `.conffiles`、ipk 写 `CONTROL/conffiles`——否则升级会把它整体替换回默认值，而
  `uci-defaults` 又只在 section 缺失时补默认值，管理员的随机源/遮罩/模糊会「静默丢失且不再回来」。
- **sysupgrade**：`/lib/upgrade/keep.d/luci-theme-mint` 保留
  `/www/luci-static/mint/custom-{pc,mobile}.jpg`；`wallpaper-*.img` **故意不保留**（cron 一个周期内就会重生成）。
- **卸载（postrm）**：`upgrade|deconfigure` 一律直接 `exit 0`（升级时必须什么都不动：新包的
  uci-defaults 要下次开机才注册，此时拆掉主题注册/cron/自定义图片会一直坏到重启为止）；
  真删除时才删主题键、rpcd ACL、两张自定义图、两个缓存 img、i18n 别名与 mintzero 残留，
  并从 `/etc/crontabs/root` 摘掉自己的那行后重启 cron，最后 `reload` rpcd。

---

## 故障排查

| 症状 | 检查 | 处理 |
|---|---|---|
| 「语言和界面」里没有 Mint / 页面仍是 bootstrap | `uci get luci.themes.mint`；`ls /usr/share/ucode/luci/template/themes/mint` | 跑一次 `sh /etc/uci-defaults/30_luci-theme-mint`，再 `/etc/init.d/rpcd reload`；确认设备是 ucode 模板的 LuCI |
| CSS/JS 404（白屏无样式） | `uci get luci.main.mediaurlbase` | 必须为 `/luci-static/mint`（旧的 `mint-light`/`mint-dark`/`mintzero*` 变体已删除） |
| 设置页看不到「Mint Wallpaper」 | `ls /usr/share/rpcd/acl.d/luci-theme-mint.json`；`uci show mint` | ACL 缺失或 `mint` 配置不存在都会被 `depends` 隐藏菜单；`apk add` 后需 `rpcd reload`，或清 `rm -f /tmp/luci-indexcache*` |
| 设置页点保存无效 | `logread \| grep mint-save` | 该固件 `cbi.js` 被精简时主题会自动走 `ubus call mint save`；若仍失败，检查 rpcd ACL 的 write 作用域与 `mint` UCI 读权限 |
| 界面是英文 | `ls -l /usr/lib/lua/luci/i18n/ \| grep mint` | 装翻译包 `luci-i18n-mint-zh-cn`，并确认 `luci.main.lang` 为 `zh_Hans`/`zh-cn`（或 `zh_cn`/`zh_CN`，靠 postinst 别名） |
| 壁纸不出现 | 浏览器网络面板看是否请求了第三方 API | 无外网/DNS 失败/API 挂了会退回渐变，属预期；离线请上传自定义图 |
| 壁纸一直是同一张 | `ls -l /www/luci-static/mint/wallpaper-*.img`；`logread -e mz-wallpaper` | 这是 5 分钟缓存（服务端 cron + 浏览器 `sessionStorage`）的正常表现；`logread` 里有 `refusing non-http source` 说明源被安全策略拒了 |
| cron 抓图从不成功 | `which curl`；`ls -l /usr/bin/mz-wallpaper-fetch.sh` | 缺 `curl` 或丢了执行位（后者已被 `verify-package.sh` 的断言在 CI 硬拦） |
| 总览仪表盘全是 `--` | `ubus call mint dashboard` | 该命令需 `luci-theme-mint` ACL 组；能返回 JSON 而页面仍空 → 浏览器控制台看 `mint` RPC 是否被拒 |
| 深色模式下背景偏亮/偏紫 | — | 见[已知差异](#已知差异与限制)第 2 条 |

---

## 开发约定

改这个仓库前请遵守这些已被代码/CI 强制的约束：

1. **行尾必须是 LF**：`.gitattributes` 已对 `*.sh` / `*.py` / `*.ut` / `*.uc` / `Makefile` /
   `*.yml` 强制 `eol=lf`；BusyBox ash 遇 CRLF 会在设备上直接崩。
2. **可执行位**：`root/` 下脚本必须 `0755` 入库（`luci.mk` 用 `cp -pR` 原样带上设备）。
   `verify-package.sh` 的 `REQUIRED_EXEC` 会在 CI 硬失败，别指望运行时发现。
3. **不引第三方依赖**：不引框架/jQuery/图标字体/Web 字体/CDN；新增包依赖需要论证。
4. **纯 DOM 构造**：动态内容用 `E()`/`createElement` + `textContent`，不用 `innerHTML`
   拼接设备可控字符串（`mz-nftables.js` 为此专门去掉了唯一一处 `innerHTML`）。
5. **不造假数据**：取不到就显示 `--` / `N/A`；不硬编码接口名、IP、型号、端口数。
6. **文案走 `_()`**：模板与 LuCI 视图内一律 `_()`；纯脚本用 `_` + `window.TR` 兜底。
   翻译完成后同步 `po/zh_Hans`（`po/templates/theme.pot` 由扫描生成，可手动补齐）。
7. **按需加载**：只在对应路径注入脚本（`footer.ut` 的 `{% if path == 'admin-…' %}`），
   并把定时器/observer 在离开页面时全部拆掉（参照 `overview-dashboard.js` 的 `stop()/destroy()`）。
8. **设备侧脚本兼容性**：`ash` + `jsonfilter` + `uci`，不假设 GNU 工具；`rpcd` 后端输出必须
   是合法 JSON（字符串一律过 `json_escape()`）。
9. **CSS**：优先复用设计令牌，新组件写在 `cascade.css` 对应区块；仪表盘样式留在
   `overview-dashboard.css` 的 `.mint-overview-dashboard` 命名空间内，避免污染上游 DOM。
10. **提交前**：`./scripts/ci-simulate.sh`；改动涉及 Makefile 载荷清单或 SDK 解析时再跑
    `./scripts/ci-mirror-test.sh`。CHANGELOG 记进 `[Unreleased]`。

---

## 已知差异与限制

诚实记录，均来自当前代码：

1. **`po/templates/theme.pot` 比 `po/zh_Hans` 少 1 条**（`Cached random wallpaper` 未回流到
   模板）。翻译本身完整（109/109 已译），只是模板滞后——`theme.pot` 在本仓库是手工维护的
   （不在 LuCI 仓库内，拿不到上游的 i18n 扫描），加新文案时需手动补 `msgid`。
2. **深色模式的壁纸玻璃规则未生效**：`cascade.css` 有 4 处选择器写成
   `body.mz-has-wallpaper[data-theme="dark"]` / `…:not([data-theme="dark"])`
   （第 3634、3652、3710、3724 行附近），但 `data-theme` 由 `header.ut` /
   `menu-mint.js` 设在 `<html>` 上，因此这几条永远不匹配——深色管理页实际会看到浅色渐变
   与浅色玻璃令牌。相邻的 `html[data-theme="dark"] body.mz-has-wallpaper …` 写法（第 3847、
   3858 行）是正确的，可参照修正。
3. **打标签不会触发 CI**：构建 workflow 只在 push `main` 与手动 dispatch 时运行；
   `scripts/create-release.sh` 结尾「workflow will now build」那句提示过于乐观（见
   [RELEASE.md](RELEASE.md) 的正确步骤）。
4. 壁纸依赖外网可达与第三方 API 可用性；`api.seaya.link/wap` 的直链靠 HTML 正则提取，
   上游改版即失效（此时自动换下一源，不影响登录）。
5. `ubus call mint refresh` 是兼容桩，**不会**触发抓图；想立刻换图只能手工跑一次
   `/usr/bin/mz-wallpaper-fetch.sh`。
6. 移动端增强依赖「读原生 Overview 的 DOM 再重组」，故上游视图的标题文案/结构变化会影响
   卡片重排效果（隐藏原生区块按类别判定，最坏情况是保持原生外观，不会丢内容）。
7. 布局验证过的最小宽度约 480px（`≤480px` 有专门断点）；更窄的屏幕未做适配。
8. `initramfs` 恢复模式与「root 无密码」会各占一条顶部告警条（`header.ut`），这是继承自
   LuCI 的强制安全提示，主题不去掉。
9. 「移动端」有两套判定：壁纸用 `header.ut` 的 UA 正则，总览页用 `footer.ut` 里更窄的 UA 正则
   **或** `max-width:854px`。桌面模式 UA 的平板因此可能出现「桌面仪表盘 + 移动端壁纸图源」的组合
   （分析见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#9-已知结构性问题)）。

---

## 许可证

Apache-2.0，见 [theme/LICENSE](theme/LICENSE)。
`scripts/po2lmo.py` 为 `luci-base` `po2lmo.c`（Jo-Philipp Wich，Apache-2.0）的等价重实现。
