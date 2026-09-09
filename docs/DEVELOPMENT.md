# Mint 开发指南

面向要改这个仓库的人。行为描述均来自当前代码；架构层面的解释见
[ARCHITECTURE.md](ARCHITECTURE.md)，面向用户的用法见根 [README.md](../README.md)。

## 1. 环境

必需：`bash`、`git`、`python3`、`curl`、`tar`（`zstd`/`xz` 视 SDK 压缩格式而定）。
可选：`node`（JS 语法自检）、`busybox`（ash 语法自检）、`opkg`/`apk-tools`（缺失时安装测试
自动退化为「解包 + 文件级断言」，不会失败）、OpenWrt SDK 或完整 buildroot（真正打包时）。

**没有网络也能做的验证**（本仓库在干净 Linux 沙箱里实测通过，各约 2 秒）：

```sh
./scripts/ci-simulate.sh      # 造包 + verify + install-test + 三个负例
./scripts/ci-mirror-test.sh   # mock 镜像下的 SDK 解析/校验/缓存回退
```

## 2. 目录约定

| 目录 | 说明 |
|---|---|
| `theme/` | 唯一进包的目录；其内部结构就是 `feeds/luci/themes/luci-theme-mint/` 的结构 |
| `theme/htdocs/luci-static/mint/` | 主题自有静态资源 → 设备 `/www/luci-static/mint/` |
| `theme/htdocs/luci-static/resources/` | 必须放在 LuCI 资源根下的东西（`menu-mint.js` 被 `L.require` 解析、`view/mint/*.js` 被 `instantiateView` 解析）→ `/www/luci-static/resources/` |
| `theme/ucode/` | → 设备 `/usr/share/ucode/luci/`（**多一层 `luci`**，`UCODE_LIBRARYDIR`） |
| `theme/root/` | → 设备 `/`（UCI、uci-defaults、rpcd 后端与 ACL、menu.d、keep.d、cron 脚本） |
| `theme/po/` | `templates/theme.pot` + `zh_Hans/luci-theme-mint.po` → 翻译包 |
| `scripts/` | 构建 / 校验 / 发布 / 离线测试 |
| `docs/reviews/` | 审查报告存档，**只追加新日期文件，不改写历史** |
| `assets/` | 仓库文档用图（不进包） |

命名约定：主题自有类名 `mz-*`（`mz-sidebar`、`mz-has-wallpaper`…）与
`mint-*`（`mint-ovd-*`、`mint-overview-dashboard`、`mint-dedup-hidden`）；
注入到上游 DOM 的 dataset 键用 `data-mint-*` / `data-mz-*`。

## 3. 硬性约束（CI 会拦住的那种）

1. **LF 行尾**。`.gitattributes` 已强制；提交前自查：
   ```sh
   git grep -lI $'\r'      # 无输出（exit 1）才算干净
   ```
2. **可执行位**。`theme/root/` 下所有脚本必须 `0755` 入库——`luci.mk` 用 `cp -pR`，
   仓库里的 mode 就是设备上的 mode。`scripts/verify-package.sh` 的 `REQUIRED_EXEC`
   会对以下文件断言执行位，丢了就在 CI 硬失败：
   `usr/bin/mz-wallpaper-fetch.sh`、`usr/libexec/rpcd/mint`、
   `etc/uci-defaults/30_luci-theme-mint`。
   新增 `root/` 下的可执行文件时，**同步把路径加进 `REQUIRED_FILES` / `REQUIRED_EXEC`**，
   否则它既不被断言存在、也不被断言可执行。
3. **不引入前端依赖**：无框架、无 jQuery、无图标字体/Web 字体/CDN。
4. **不硬编码设备事实**：接口名、IP、型号、端口数量、温度阈值都不许写死；取不到就显示
   `--` / `N/A`。
5. **动态内容不用 `innerHTML` 拼字符串**：用 `E()`/`createElement` + `textContent`；
   要写入上游 DOM 的文本一律当纯文本处理。
6. **设备侧 shell 只用 ash + `uci` + `jsonfilter` 能给的**：不假设 GNU coreutils；
   `rpcd` 后端输出的每个字符串都要过 `json_escape()`。

## 4. 常用配方

### 4.1 加/改一段 CSS

改 `theme/htdocs/luci-static/mint/cascade.css`，尽量复用 `--mz-*` 令牌，写在语义相符的
区块里（`overview-dashboard.css` 只放 `.mint-overview-dashboard` 命名空间下的内容）。
对上游 DOM 的选择器用后代而非子代组合器；需要压过上游内联样式时加 `!important` 的 class，
不要写 `element.style`。

### 4.2 加一个「仅某页生效」的前端增强

1. 新文件放 `theme/htdocs/luci-static/mint/`（纯脚本，IIFE，自带 `__()` 兜底），或
   需要 LuCI class 能力时放 `resources/` 下并用 `L.require` 加载。
2. 在 `footer.ut` 里按 `join('-', length(ctx.request_path) ? ctx.request_path : ctx.path)`
   与目标路径（形如 `admin-status-overview`）比较后再 `<script src=… defer>` 注入。
3. 脚本自己也要**二次判定** `document.body.dataset.page`（`mz-nftables.js` 的做法），
   因为 SPA 导航不会重新执行注入逻辑。
4. 生命周期照抄 `overview-dashboard.js`：`start()/stop()/destroy()`，把 `setInterval`、
   `ResizeObserver`、`MutationObserver`、事件监听全部登记再全部拆除。

### 4.3 加一个 UCI 选项（**必须同步 5 处**，历史上就因不同步出过 bug）

| 位置 | 作用 |
|---|---|
| `theme/root/etc/config/mint` | 随包默认值 |
| `theme/root/etc/uci-defaults/30_luci-theme-mint` | 只在 section 缺失时播种（老设备升级不会自动获得新键，需要 `wallpaper.uc` 给默认） |
| `theme/ucode/mint/wallpaper.uc` | `loadConfig()` 里给运行时兜底 + 钳制/校验 |
| `theme/htdocs/luci-static/resources/view/mint/wallpaper.js` | 表单控件与 `.default` |
| `theme/ucode/template/themes/mint/header.ut` | 若前端要用，必须加进 `window.mintWallpaper` |

别忘了 `/etc/config/mint` 是 conffile：新增键在**升级**时会因「新包文件 vs 旧用户文件」
的处理而表现为「用户文件原样保留」，所以任何新增键都必须有运行时默认，不能指望随包文件。

### 4.4 加/改一条文案

1. 模板：`{{ _('…') }}`；视图/类内：`_(…)`；纯脚本：`__(…)`（`_` + `window.TR` 兜底）。
2. 中文译名写进 `theme/po/zh_Hans/luci-theme-mint.po`，并在
   `theme/po/templates/theme.pot` 补上同名 `msgid`（pot 是手工维护的，已知会滞后 1 条）。
3. 需要本地生成 `.lmo` 调试时：`python3 scripts/po2lmo.py <in.po> <out.lmo>`
   （正式构建用 luci-base 的 host `po2lmo`）。
4. 注意有例外：用于**匹配上游渲染文本**的字面量（`overview-mobile.js` 的 `CAT_PREFIXES`、
   `pick()` 标签、`mz-nftables.js` 的 `classifyChain()` 正则）刻意不翻译。

### 4.5 改 rpcd 后端 / ACL

- 新方法要同时出现在 `list` 的返回值与 `/usr/share/rpcd/acl.d/luci-theme-mint.json` 的
  read **或** write 作用域里（有副作用的一律 write）。
- 菜单可见性依赖组名：`menu.d` 的 `depends.acl` 写的是**组名** `luci-theme-mint`。
- 权限变更后设备侧要 `/etc/init.d/rpcd reload`（重启会踢掉所有已登录会话，主题安装脚本
  因此一律用 reload）。

## 5. 提交前的本地检查

```sh
# 语法自检（四条都应在本仓库当前状态下通过）
find theme/htdocs -name '*.js' -exec node --check {} \;            # 无输出 = 通过
for f in theme/root/usr/libexec/rpcd/mint theme/root/usr/bin/*.sh theme/root/etc/uci-defaults/*; do
  busybox ash -n "$f" || dash -n "$f" || echo "SYNTAX FAIL: $f"    # ash 语法，设备上就是这个
done
python3 -c "import json,glob; [json.load(open(p)) for p in glob.glob('theme/root/usr/share/**/*.json', recursive=True)]; print('json OK')"
git grep -lI $'\r'          # 必须无输出（exit 1）

# 包级校验（结构等价真实产物，含负例）
./scripts/ci-simulate.sh
./scripts/ci-mirror-test.sh
```

`node --check` 只做解析（LuCI 模块的顶层 `return baseclass.extend(…)` 在 CommonJS 下合法）；
`E()`、`_()`、`L` 等全局是运行时才注入的，不会也不能被静态检查覆盖——真正的功能验证请看 §7。

## 6. 构建与打包

两条路（详细命令见根 README 的「本地编译」）：

- **官方 SDK**（推荐，也是 CI 的做法）：`./scripts/build-package.sh --version 25.12
  --target x86/64 --format apk --release-version v1.0.0 --out dist`；
  产物名 `luci-theme-mint-<release>-<系列>-<target_slug>-all.<apk|ipk>`，旁附
  `*.buildinfo.txt`。`--format ipk` 会自动选到仍提供 ipk 后端的系列；`--allow-legacy`
  是安全网（宁可回退老 SDK，也绝不改名造假包）。
- **完整 buildroot**：把 `theme/` 放进 `feeds/luci/themes/luci-theme-mint/`，
  选中 `CONFIG_PACKAGE_luci-theme-mint` 与 `CONFIG_PACKAGE_luci-i18n-mint-zh-cn` 后
  `make package/luci-theme-mint/compile V=s`。

`configure_sdk()` 还会：显式打开 `CONFIG_PACKAGE_luci-i18n-mint-zh-cn`（menuconfig 里 HIDDEN
且默认 n）、`CONFIG_LUCI_JSMIN=y`、`# CONFIG_LUCI_CSSTIDY is not set`、
`CONFIG_SIGNED_PACKAGES=n`（**产物未签名**：apk 侧因此必须 `apk add --allow-untrusted`，
opkg 侧只要设备没有启用 `/etc/opkg.conf` 里的 `option check_signature` 就能直接装），
然后在 `defconfig` 之后逐个确认
`luci-base curl rpcd ucode ucode-mod-html ucode-mod-uci liblucihttp-ucode libubus libubox
cgi-io luci-i18n-mint-zh-cn` 都进了 `.config`（缺任何一个即 die——这是「feed 被覆盖导致半路爆错」
的提前拦截），最后核对 `CONFIG_USE_APK` 与请求格式是否一致（不一致则让 ipk 分支回退到别的 SDK）。

`PKG_VERSION ?=` / `PKG_PO_VERSION ?=` 是刻意留空给 CI 注入主题仓库自身 revision 的口子；
手工在 feed 里构建时保持留空即可（走 luci.mk 的 `findrev`）。

### 6.1 SDK 缓存的实际生效条件

workflow 里挂缓存的步骤带 `if: steps.resolve.outputs.tarball_sha256 != ''`：只有
`get-openwrt-sdk.sh --print` 能从目标目录的 `sha256sums` 解析出 tarball 摘要时才创建
`actions/cache` 条目。main 上最近一次运行该步骤是 **skipped**（没解析到值），也就是那个系列
每次都会重下 ~300 MB tarball。`--cache-dir` 在本地照样有效，但别把它当成「CI 一定秒级复用」
的前提；改动解析逻辑后用 `./scripts/ci-mirror-test.sh` 回归 `sha256sums` 发现、缓存复用与
污染自愈三条路径。

---

## 7. 真机验证

日常改 CSS/JS 不需要重新打包，直接覆盖 `/www` 下的文件即可：

```sh
scp theme/htdocs/luci-static/mint/cascade.css root@192.168.1.1:/www/luci-static/mint/
ssh root@192.168.1.1 'rm -f /tmp/luci-indexcache*; /etc/init.d/rpcd reload'
```

`htdocs/**` 全是静态文件（含 `resources/` 下的 `menu-mint.js`、`view/mint/*.js`），同样可以
scp 覆盖后立即生效（浏览器强刷即可）。`ucode/**` 与 `root/**` 落在包管理路径下，手工覆盖后
必须清缓存才看得到效果：

```sh
ssh root@192.168.1.1 'rm -f /tmp/luci-indexcache*; rm -rf /tmp/luci-modulecache/; /etc/init.d/rpcd reload'
```

改了 `po/**` 或 `Makefile`（包定义、conffiles、postinst/postrm）就**必须重装包**：翻译目录、
rpcd ACL、cron 行与 uci-defaults 都只在安装期落地。

建议的验证清单（历次审查就是按这套做的，含 1440/390 两档视口）：

- 桌面 1440px：登录页有壁纸或渐变、无闪烁；侧栏渲染完整、分组折叠可记忆；
  Overview 有 `h2.mint-ovd-title`（「状态」）且只出现一次、环/曲线在跑；`Status > nftables`
  分组正常；「保存并应用」下拉可展开；设置页保存后 `uci show mint` 真的变了。
- 手机 390px：`.mz-mobilebar` 玻璃顶栏、标题不重叠、抽屉与遮罩可用；Overview 走
  `overview-mobile.js` 的卡片重排。
- 深色模式切换：无白屏闪烁、卡片对比度达标（注意 README「已知差异」第 1 条）。
- 断网/防火墙拦死第三方 API：登录页仍即时渲染（渐变兜底），控制台不应有未捕获异常。
- 关掉 JavaScript：登录页与页面骨架仍可显示，`noscript` 提示出现。

自动化侧可用 Playwright 对 `admin-status-overview`、`admin-system-mintwallpaper-settings`、
`admin-status-nftables` 三个路径做「关键 DOM 存在 + 无 console error」的冒烟检查
（本仓库的审查报告里就是这么取证「标题回归」这类问题的）。

## 8. 脚本清单

| 脚本 | 关键选项 / 说明 |
|---|---|
| `get-openwrt-sdk.sh` | `--version`、`--target`、`--format apk\|ipk`、`--print`、`--cache-dir`；输出 `key=value`（`sdk_dir`、`sdk_url`、`sdk_file`、`tarball_sha256`、`openwrt_release`、`openwrt_series`、`openwrt_base_url`、`kernel_version`、`supports_apk`、`supports_ipk`），人类日志走 stderr；可被 `source`（仅直接执行时才跑 main）；`OPENWRT_BASE_URL`/`OPENWRT_MIRRORS` 可覆盖 |
| `build-package.sh` | 上述 + `--release-version`、`--out`、`--workdir`、`--jobs`、`--luci-branch`、`--allow-legacy`；`LUCI_FEED_URL` 可指镜像或本地 `file://` 克隆。LuCI 分支映射：`snapshot/main→master`、`25.12→openwrt-25.12`、`24.10→openwrt-24.10`、`23.05→openwrt-23.05`，其他 `X.Y→openwrt-X.Y` |
| `verify-package.sh` | `--file`/`--dir`、`--expect-arch`、`--expect-name`；校验包格式魔数、元数据字段、架构（ipk `all` / apk `noarch`）、依赖、必需载荷、执行位 |
| `install-test.sh` | `--file`、`--root`；按文件名自动识别主题包 / 翻译包（`luci-i18n-mint-*`），apk 分支会造 stub 依赖包让真实解析器跑一遍 |
| `make-release-notes.sh` | `--assets --tag --out`；把 `*.buildinfo.txt` 渲染成 apk/ipk 两张表（`legacy_compat_sdk=1` 标「兼容构建」） |
| `create-release.sh` | `VERSION [REMOTE]`：校验 `vX.Y.Z(-suffix)`、要求干净工作树、建注解标签并推送。**不触发 CI**（见 `RELEASE.md`） |
| `po2lmo.py` | `in.po out.lmo`；与 luci-base 的 `po2lmo.c` 同格式，仅本地调试用 |
| `ci-simulate.sh` / `ci-mirror-test.sh` | 见 §1，无网络依赖 |

## 9. 提交与变更记录

- 直接在 PR 描述里说明「影响哪些层」（CSS / 前端脚本 / 模板 / 后端 / 包定义 / CI），
  因为这决定要跑哪些本地检查。
- 每个可发布的用户可见变更写进 `CHANGELOG.md` 的 `[Unreleased]`（Keep a Changelog 格式，
  按 `### Added / Fixed / Changed` 分组，日期前缀标注轮次）。
- 审查报告作为过程记录放 `docs/reviews/`：`CODE_REVIEW_*.md`（代码/打包/CI）与
  `LAYOUT_REVIEW_*.md`（界面布局）。它们**只记录发现与结论**，不是待办清单——已修项在
  CHANGELOG 里，报告本身保留取证与判据（引用的官方实现路径、行号、运行历史）。

## 10. 现存过程文档索引

| 文件 | 内容 |
|---|---|
| `docs/reviews/CODE_REVIEW_2026-09-09.md` | 第一轮全量审查：R-01…R-12（执行位、默认值一致性、ACL 收敛、SDK 校验、JSON 注入、模板注释注入、innerHTML、i18n、ubus 端点、RPC 耗时、版本溯源、文档归档） |
| `docs/reviews/CODE_REVIEW_2026-09-10.md` | 第二轮全量 + 云编译修复：C-01…C-04（ucode 载荷断言路径、`noarch`、翻译包缺失、install-test apk 分支）与 O-01…O-04 优化 |
| `docs/reviews/LAYOUT_REVIEW_2026-09-09.md` | 布局审查（顶栏/页脚/移动端表格/登录页矮屏/死代码） |
| `docs/reviews/LAYOUT_REVIEW_2026-09-10.md` | 布局审查合并修订版（含保存并应用下拉、全局下拉、首页端口/网络/无线、壁纸兼容性问题） |
| `docs/reviews/LAYOUT_REVIEW_PORT_NETWORK_2026-09-10.md` | 首页端口/网络区块的专项审查 |
