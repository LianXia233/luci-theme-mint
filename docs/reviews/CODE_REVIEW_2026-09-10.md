# luci-theme-mint 代码审查与云编译修复报告（第二次全量）

- 审查日期：2026-09-10
- 分支：`arena/01a08859-luci-theme-mint`（基于 `58cd3bc`）
- 任务：完整代码审查（参照 OpenWrt 官方 LuCI 主题 API）+ 修复 + 优化云编译 + 确保 ipk 与 apk 包都能正常编译发布
- 参照基准（sparse clone 至本地逐项核对）：
  - `openwrt/luci` master：`include/luci.mk`、`modules/luci-base`（`ucode/dispatcher.uc`、`ucode/runtime.uc`、外层 `template/header.ut` / `footer.uc`、`src/lib/luci.c`（`luci.core` C 模块）、`htdocs/luci-static/resources/rpc.js`）、官方主题 `luci-theme-bootstrap`
  - `openwrt/openwrt` main：`include/package-pack.mk`（apk/ipk 双后端）、`include/package-ipkg.mk`（23.05 后端）、`target/sdk/`
- 方法：逐文件审查 + 官方实现逐条 diff + **GitHub Actions 运行历史取证**（拉取失败 run 的 job/step 结论）+ 本地离线验证（合成包、mock 镜像、JS 语法、YAML 语法、po 覆盖率）

---

## 一、总体结论

主题本体与官方 LuCI 主题 API 的对齐度在第一轮审查（`CODE_REVIEW_2026-09-09.md`）后继续保持在高位，
本轮未发现新的主题代码高危缺陷。**本次 CI 全线变红的根因全部在校验/打包脚本与流水线设计层**，共 4 个：

| # | 缺陷 | 后果 | 严重度 |
|---|---|---|---|
| C-01 | verify/install-test 按 `usr/share/ucode/...` 断言，官方安装路径是 `usr/share/ucode/luci/...` | **每个**真包都在 Verify 步骤失败，apk/ipk 两个工作流全红，Release 拿不到产物 | 🔴 阻塞 |
| C-02 | verify 死等 `arch=all`，OpenWrt apk 后端把架构无关包记为 `arch:noarch` | 修正 C-01 后 apk 仍 100% 失败 | 🔴 阻塞 |
| C-03 | 简中翻译包 `luci-i18n-mint-zh-cn`（官方规范：`po/` → 独立包）从未被选中/收集/发布；README 却宣称「lmo 随包安装」 | Release 只有英文主题，中文用户界面回退英文，文档与事实不符 | 🟡 发布完整性 |
| C-04 | install-test 的 apk 分支在空 root 里 `apk add` 必然因缺 `luci-base`/`curl` 依赖失败（该分支从未真正跑通） | 校验环节给假信心 | 🟡 正确性 |

另有 4 项云编译优化（O-01…O-04）与 1 项流水线瘦身（删遗留 `build.yml`），见第四节。

**取证**：`api.github.com/.../actions/runs` 显示 2026-09-09 的 4 个 job（apk/ipk × 25.12/snapshot）全部
`Build with the official OpenWrt SDK = success`、`Verify package metadata and payload = failure`、
后续步骤 skipped——SDK 构建本身一直是好的，坏的只是验收环节。

---

## 二、问题与修复

### C-01 🔴 ucode 载荷断言路径错误（CI 全红主因）

官方 `luci.mk`：

```make
UCODE_LIBRARYDIR := /usr/share/ucode/luci
...
ifneq ($(wildcard ${CURDIR}/ucode),)
	$(INSTALL_DIR) $(1)$(UCODE_LIBRARYDIR)
	cp -pR $(PKG_BUILD_DIR)/ucode/* $(1)$(UCODE_LIBRARYDIR)/
```

即 `theme/ucode/template/themes/mint/*.ut` → **`/usr/share/ucode/luci/template/themes/mint/*.ut`**，
`theme/ucode/mint/wallpaper.uc` → **`/usr/share/ucode/luci/mint/wallpaper.uc`**。
模板运行时（`modules/luci-base/ucode/runtime.uc`）的 `template_directory` 也是
`/usr/share/ucode/luci/template`；模块 `luci.mint.wallpaper` 从 `/usr/share/ucode/luci` 解析
（同目录的 `luci.core` 是 luci-base 的 C 模块 `core.so`）。

`verify-package.sh` / `install-test.sh` 却按 `usr/share/ucode/...`（少一层 `luci`）断言 →
对每个真包报 4 条 missing，Verify 步骤必然失败。此前 CI 从未对真包跑通过 verify（该步骤是后加的），
所以一直没暴露。

**修复**：两个脚本的必需文件清单全部改为官方安装路径，并加注释引用 `UCODE_LIBRARYDIR`。
本地用真实主题载荷构造的结构等价 ipk/apk 四件套（主题+翻译 × 双后端）已全部通过。

### C-02 🔴 apk 后端架构字段是 `noarch` 而非 `all`

`openwrt/openwrt` main `include/package-pack.mk`：

```make
apk mkpkg $(APK_TMPDIR) $(FILES) \
	$(if $(findstring all,$(PKGARCH)),--info "arch:noarch",--info "arch:$(PKGARCH)") \
	...
```

apk 世界的「架构无关」叫 `noarch`；ipk 世界的叫 `all`。verify 的 `--expect-arch all` 对 apk 永假。

**修复**：`--expect-arch all` 语义化为「架构无关」——ipk 收 `all`、apk 收 `noarch`，其他值一律失败
（仍防止混入目标相关产物）。`.buildinfo.txt` 与发布说明如实记录两种字段值。

### C-03 🟡 简中翻译包缺失（官方 API 的独立包）

官方 LuCI 对 `po/<lang>/` 的处理是 `luci.mk` 的 `LuciTranslation`：生成独立包
`luci-i18n-mint-zh-cn`（`HIDDEN:=1`、依赖主题包、`VERSION:=$(PKG_PO_VERSION)`、
lmo 装到 `/usr/lib/lua/luci/i18n/luci-theme-mint.zh-cn.lmo`、附 `etc/uci-defaults/luci-i18n-mint-zh-cn`
注册 `luci.languages.zh-cn`）。关键点：

- 该包 kconfig 默认 **不选中**（HIDDEN + default n），不显式 `CONFIG_PACKAGE_luci-i18n-mint-zh-cn=m`
  就根本不会编出来；
- 翻译目录名经 `LC_ALIAS zh_Hans → zh-cn` 归一（官方 `luciname` 逻辑），与 LuCI 运行时
  `replace(lang, '_', '-')` 的 `zh_cn → zh-cn` 归一相互衔接——master dispatcher 已自行归一，
  主题 postinst 里的 `zh_cn`/`zh_CN` 软链只服务 23.05/24.10 旧 dispatcher，属防御性兼容，保留；
- i18n lmo 的 msgid 是**全局合并查找**（luci-base `luci.core` 的 catalog 合并语义），
  主题模板里 `_()` 能否译中只取决于 `luci-theme-mint.zh-cn.lmo` 是否在 i18n 目录 →
  只发主题包 = 主题字符串全英文。

**修复**（`build-package.sh` + `theme/Makefile`）：

1. `configure_sdk` 显式选中 `CONFIG_PACKAGE_luci-i18n-mint-zh-cn=m`，defconfig 后与依赖链一起校验；
2. Makefile 新增 `PKG_PO_VERSION ?=` 注入点，CI 与主题同版本注入（否则翻译包版本随 LuCI feed
   git 状态/文件 mtime 漂移，形如 `0.<日期>`）；
3. 收集两个包，各自改名 `luci-i18n-mint-zh-cn-<版本>-<系列>-<target>-all.<fmt>` 并各出
   `.buildinfo.txt`；缺翻译包 = 硬失败（宁可红着，不发半套 Release）；
4. verify（按文件名自动区分模式：翻译包检查 lmo + uci-defaults + 依赖主题包）、install-test
   （翻译包无需可执行位/JSON 断言）、release-notes（双行表格 + 成对安装命令）全部支持。

po 完整性已用脚本核验：po/pot 各 109 条，**0 条未翻译**；模板/JS 中 108 个 `_()` 字符串
**100% 命中**（此前报告的 1 条"缺失"是 po 转义解析的假象）。

### C-04 🟡 install-test apk 分支从未可用

`apk add --allow-untrusted --root <空root> 主题.apk` 中 apk 仍做依赖解析：
`luci-base`、`curl` 不在空 root → 直接失败。该分支在 CI（Ubuntu 无 apk-tools）里永远走
python 解包回退，真实 apk 路径从未被执行。

**修复**：安装先生成最小 unsigned 依赖 stub（单 gzip 流、只含 `.PKGINFO`、无 payload 的合法 apk），
stub 装进空 root 后真包才能通过**真实 apk 解析器**安装——依赖解析、元数据解析、post-install 脚本
执行（官方包装的 `default_postinst` 在空 root 下安全早退）都得到真实覆盖。
顺带修复 JSON 断言 `A && B || C` 优先级 bug（文件不存在时误报 `invalid JSON`）。

### 其余复核结论（官方对照，无改动）

| 项 | 结论 |
|---|---|
| 包命名/版本 | apk `luci-theme-mint-<ver>-r1.apk`、ipk `luci-theme-mint_<ver>-r1_all.ipk`，`PKG_RELEASE?=1` 自动补 `-r1`；build-package.sh 的版本剥离链对两种形状均正确 |
| APK 脚本包装 | post-install = `default_postinst` + 主题 postinst 体；post-upgrade 带 `PKG_UPGRADE=1` 且**不带** `default_postinst`；postrm 原样——主题的 `rpcd reload`/变体清理/壁纸清理假设全部成立 |
| conffiles | `/etc/config/mint` 双后端均 honored（ipk `keep.d`/`.conffiles`；apk `.conffiles` + `.conffiles_static` sha256） |
| sysauth 契约 | 主题 `sysauth.ut` 提供的 scope 与 dispatcher 消费的 `{duser,fuser,auth_fields,auth_message,auth_html,auth_assets}` 完全一致 |
| 外层模板契约 | `include('themes/mint/header')` + 注入 `luci.js` + `L = new LuCI({...})`、footer 尾 `include('themes/mint/footer')`——与官方 bootstrap 主题布局逐段一致 |
| `LUCI_PKGARCH:=all` | luci.mk 对无 `src/` 的包本就默认 `all`，显式 `:=all` 冗余但无害，保留 |
| 模板编译失败回退 | dispatcher `trycompile` 失败会静默换主题（`media_error`）——`.ut` 源码随包分发（`LUCI_MINIFY_UT:=0`）由设备 ucode `loadfile` 编译是官方认可的形态 |
| jsmin | CI 走 SDK 默认 `CONFIG_LUCI_JSMIN=y`，全部 htdocs JS 会过 jsmin；本地 `node --check` 全部 JS 语法通过 |
| `menu-mint.js` CSRF 回退 | 从内联 `L = new LuCI({...})` 正则恢复 32 位 hex token——官方 `L.config` 不暴露下的合理兜底，已注释说明 |
| `L.rpc.declare` | 与 master `rpc.js` 签名一致（object/method/params → 返回 promise 调用函数）；回退 fetch 用 `L.env.ubuspath`（R-09 已改） |

### 主题代码遗留观察（非阻塞，不改）

1. `overview-dashboard.js:255` 的 `root.innerHTML = '' + ...` 仅拼接 `__(label)` 静态译文
   （值后续走 textContent 填充），无用户数据注入面；`overview-mobile.js` 动态值全部经 `esc()`。
2. `overview-mobile.js` / `mz-nftables.js` 中约 60 处硬编码中文为**既定策略**（R-08 文档化）：
   目标用户为中文环境，且 stock LuCI 视图 DOM 的**解析键**（`pick()`/`CAT_PREFIXES`）必须保持字面，
   强行全量 `_()` 会把匹配逻辑译坏。英文用户看到中文提示是可接受的降级。
3. i18n 包的 `etc/uci-defaults/luci-i18n-mint-zh-cn` 为 0644（`echo >` 生成）——与官方全部
   i18n 包行为一致，`/etc/init.d/uci-defaults` 以 shell source 方式执行，无需执行位。

---

## 三、云编译优化（已实施）

| # | 优化 | 收益 |
|---|---|---|
| O-01 | 矩阵 `2 版本 × 2 目标` → `2 版本 × 1 目标`（x86/64）。主题无 `src/`，包与目标平台无关，mediterranean/filogic 构建产出与 x86 完全同构 | CI 时间与下载量近似减半（4 job → 2 job/流水线） |
| O-02 | ipk 流水线改请求**原生 ipk 系列**（24.10 + 23.05）。旧逻辑请求 25.12/snapshot：下载 ~300MB SDK → 解包 → 探测 `baked USE_APK=y` → 拒绝 → 再下载 24.10，每 run 白烧 4 个候选；`--allow-legacy` 保留作安全网。23.05 保留是因为它仍走独立的 `package-ipkg.mk` 代码路径，覆盖价值真实存在 | 每 run 省 2×(300MB 下载 + 解包 + feeds + 探测)；Release 里 ipk 全部是原生构建，不再有「兼容构建」标记噪音 |
| O-03 | SDK tarball 按官方 sha256 进 GitHub Actions cache：`get-openwrt-sdk.sh --print` 新增 `tarball_sha256`（sha256sums 行直接解析）；`--cache-dir` 全链路透传。快照 URL 可变，但**具体 tarball 内容不可变**（按 digest 寻址），缓存安全；复用仍按官方 `sha256sums` 重校验，污染条目丢弃后自动重下（自愈） | verify 失败重跑/复核从 ~15min 降至分钟级 |
| O-04 | 删除遗留 `build.yml`：其 softprops 直接发布 `nightly`/标签 Release，与 `release.yml` 竞争同一标签；现有 nightly Release 里的 `luci-theme-mint-0-*`（版本号为 0 的坏包）、ImmortalWrt 杂项产物均出自它；其 OpenWrt 快照构建与 build-apk.yml 重复 | Release 来源唯一化；`nightly` 不再积累垃圾资产（旧资产将手动清理） |

IWW 兼容性说明：删除 IWW 快照构建不等于放弃 IWW 兼容——主题按官方 LuCI master 主题 API 实现，
IWW 的 LuCI 派生自同一 API；原 IWW 构建不进入 Release 管道，仅产出未发布的 artifacts，覆盖价值低。
如需恢复 IWW 验证，可单独加一条 verify-only 工作流，不触碰发布。

---

## 四、本地验证（沙箱无 OpenWrt 网络，以下为离线等价验证）

| 验证 | 工具 | 结果 |
|---|---|---|
| 包结构/元数据/载荷/可执行位（主题+翻译 × apk+ipk 四件套，真实主题载荷按官方安装布局装配） | `scripts/ci-simulate.sh`（新增） | ✅ 全过 |
| 负例：改名 apk 当 ipk / 目标架构 `x86_64` / 丢执行位 | 同上 | ✅ 均被拒绝 |
| SDK 解析器：`24.10 → 24.10.8` 点版本回退、sha256 发现 + `GITHUB_OUTPUT`、下载 + sha256 校验、baked `USE_APK` 后端探测（`default y`→仅 apk / `default n`→ipk）、缓存复用、污染缓存自愈 | `scripts/ci-mirror-test.sh`（新增，本地 mock 镜像） | ✅ 全过 |
| 版本注入（`PKG_VERSION`/`PKG_PO_VERSION` sed）与 `pkg_version_of` 四种文件名形状 | 单元脚本 | ✅ |
| 全部 JS `node --check`（jsmin/设备运行时语法） | node | ✅ 12 个文件全过 |
| 三个 workflow YAML 解析 + 矩阵展开 | pyyaml | ✅ |
| po/pot 完整性：109 条、0 未翻译、108 个 `_()` 字符串全覆盖 | 自写解析器 | ✅ |
| 全部 shell 脚本 `bash -n` | bash | ✅ |

**尚待 CI 真机验证**（沙箱无法访问 downloads.openwrt.org / 真 SDK）：真实 SDK 下
`make package/feeds/luci/luci-theme-mint/compile` 一次编出两包、`defconfig` 保留 i18n 选中、
24.10.8/23.05.6 SDK 的 ipk 后端可用性、release.yml 双包发布。预期全部为绿；若有偏差，
CI 日志现在会把失败定位到具体包与具体断言（比此前「整段 verify 红」精确得多）。

---

## 五、变更文件清单

- `scripts/verify-package.sh` — C-01/C-02 + 翻译包模式
- `scripts/install-test.sh` — C-01/C-04 + 翻译包模式 + stub 依赖
- `scripts/build-package.sh` — C-03（选中/注入/收集/双 buildinfo）+ O-03（`--cache-dir`）
- `scripts/get-openwrt-sdk.sh` — O-03（`tarball_sha256` 输出、`--cache-dir`、缓存自愈）
- `theme/Makefile` — `PKG_PO_VERSION ?=` 注入点
- `.github/workflows/build-apk.yml` / `build-ipk.yml` — O-01/O-02/O-03
- `.github/workflows/build.yml` — 删除（O-04）
- `scripts/ci-simulate.sh` / `scripts/ci-mirror-test.sh` — 新增离线验证工具
- `scripts/make-release-notes.sh` / `README.md` / `RELEASE.md` / `CHANGELOG.md` — 双包发布文档
