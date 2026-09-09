# luci-theme-mint 完整代码审查报告

- 审查日期：2026-09-09
- 审查分支：`arena/01a08829-luci-theme-mint`（基于 `ca09f69`）
- 审查范围：`theme/`（Makefile、ucode 模板、ucode 模块、rpcd 后端、ACL/菜单、uci-defaults、全部前端 JS/CSS、po）、`scripts/`、`.github/workflows/`
- 参照基准：OpenWrt 官方 LuCI master（`openwrt/luci`）的 `luci.mk`、`modules/luci-base`（`dispatcher.uc`、`runtime.uc`、外层 `template/*.ut`、`ui.js`、rpcd ACL）、官方主题 `luci-theme-bootstrap` / `luci-theme-openwrt-2020` / `luci-theme-footstrap`，以及 `openwrt/openwrt` main 的 `base-files`（uci-defaults 执行机制）与 `include/package-pack.mk`
- 方法：逐文件静态审查 + 与官方逐条 diff；shell 脚本全部通过 `bash -n` 语法检查；前端扫描 eval/innerHTML/外联资源等风险点

---

## 一、总体结论

主题与官方 LuCI 主题 API 的**架构对齐度很高**：目录布局（`htdocs/`→`/www`、`ucode/`→`/usr/share/ucode/luci`、`root/`→`/`）、模板契约（`media`/`resource`/`dispatcher`/`dispatched`/`version`/`blank_page`/`auth_*` 变量）、`menu-<theme>.js` 命名与 `ui.menu` API、`sysauth` 的 2FA 插件协议（`auth_fields`/`auth_html`/`auth_assets`）均与官方一致或正确兼容。安全编码（`sprintf('%J')`、`striptags`、`entityencode`、rpcd 输入白名单、下载器魔数校验）整体是教科书水平。

发现 **1 个高危问题**（cron 脚本无执行权限，服务端壁纸缓存功能整体失效）、若干中/低危与一致性问题。所有问题均不影响安装可用性，但高危项会让 OT-35 设计目标（服务端 5 分钟壁纸缓存）在真机上静默落空。

---

## 二、问题清单

### 🔴 高危

#### R-01 cron 脚本 `mz-wallpaper-fetch.sh` 无执行权限 → OT-35 功能整体失效

`theme/root/usr/bin/mz-wallpaper-fetch.sh` 的 git 权限为 `100644`：

```
$ git ls-files -s theme/root/usr/bin/mz-wallpaper-fetch.sh theme/root/etc/uci-defaults/30_luci-theme-mint
100644 ... theme/root/usr/bin/mz-wallpaper-fetch.sh
100644 ... theme/root/etc/uci-defaults/30_luci-theme-mint
100755 ... theme/root/usr/libexec/rpcd/mint   ← 只有 rpcd 后端是对的
```

依据链（已逐项核实）：

1. `luci.mk` `Build/Prepare` 用 `$(CP) ./root/*`（`cp -fpR --no-dereference`）、`Package/install` 用 `cp -pR`——**源文件权限原样进入包**；
2. `scripts/build-package.sh` 与 CI 均以 `cp -a` 复制 theme 源树，无 chmod 步骤；
3. ipkg-build / apk 打包按 tar 语义保留权限；
4. uci-defaults 安装的 cron 行是 `*/5 * * * * /usr/bin/mz-wallpaper-fetch.sh`——crond 以 shell **直接执行该文件**，0644 下 `execve()` 返回 EACCES，每 5 分钟一次 permission denied。

后果：`/www/luci-static/mint/wallpaper-*.img` 永远不会生成 → `wallpaper.uc` 的 `proxy` 恒为 `null` → 前端静默回退到远程 API 直取。功能表面上"能用"，但 OT-35 声明的两层缓存、304 复用、图钉稳全部失效，且 postrm 的 cron 清理、uci-defaults 的 cron 安装都成了空转逻辑。

佐证：官方全部主题的 `root/etc/uci-defaults/*` 均为 `100755`（bootstrap/material/openwrt-2020/footstrap 逐一确认）。

**修复**：

```sh
git update-index --chmod=+x theme/root/usr/bin/mz-wallpaper-fetch.sh
# 建议一并对齐官方约定：
git update-index --chmod=+x theme/root/etc/uci-defaults/30_luci-theme-mint
```

同时建议 `scripts/verify-package.sh`：`REQUIRED_FILES` 补上 `usr/bin/mz-wallpaper-fetch.sh`，并新增可执行位断言（当前校验对 0644 静默通过，这正是 CI 没拦住的原因）。`scripts/install-test.sh` 同理。

### 🟡 中危

#### R-02 `ui_random` 默认值四源矛盾，实际默认与代码注释相反

四处来源互相打架：

| 来源 | 值 | 位置 |
|---|---|---|
| 包内 `/etc/config/mint` | `'1'` | shipped conffile |
| uci-defaults 首次播种 | `0` | section 不存在才写，但 conffile 使 section 恒存在 → **死代码** |
| `wallpaper.js` 表单 default | `'0'`（注释 OT-09：默认关闭） | 仅 option 缺失时的渲染默认 |
| `wallpaper.uc` / `header.ut` fallback | `'1'` | option 缺失时的运行时默认 |

实际新装行为由 shipped conffile 决定 = **开启**，与 OT-09「后台页随机壁纸默认关闭」的设计注释矛盾。开启状态下每个后台页面加载都会向第三方随机图 API（alcy.cc / paugram 等）发请求，属于有隐私外联含义的默认值，应保持一致并写进文档。

**建议**：全链路对齐到一个值。若要贯彻 OT-09，把 `/etc/config/mint` 的 `ui_random` 改为 `'0'`，并删除 uci-defaults 中永不执行的播种分支（或在 section 缺失时同步 '0'→与 ucode fallback 对齐）。

#### R-03 rpcd ACL 授权与官方最小权限约定不符

`theme/root/usr/share/rpcd/acl.d/luci-theme-mint.json`：

1. **有副作用的 `save` 同时挂在 read scope**。官方惯例（luci-base.json 及各 app_acl）是读方法入 read、写方法只入 write；read scope 授予 `save` 意味着只有读权限语义的主体也能触发 `uci set+commit`。当前 LuCI 会话是 acl 组并集，实际影响被掩盖，但属范式违例。
2. **write scope 缺 `uci: [["mint"]]`**。stock LuCI 的 `form.Map` 保存路径（ubus `uci` 对象 set/apply）在 ACL 严格裁剪的固件上会被 rpcd 拒绝——README 注释已承认存在这类固件并为此实现了 `mint save` 回退；既然 read 已声明 `uci mint`，write 补上是顺手且必要的加固（否则官方路径永远走不通，只能靠主题私有后门）。
3. **ACL 组名 `wallpaper` 过于通用**。官方命名约定 = 包名（`luci-app-*`/`luci-theme-*`）。通用名与其他包撞车时会污染 `menu.d` 的 `depends.acl` 判定，建议改为 `luci-theme-mint`（与 JSON 文件名一致）。

#### R-04 CI 供应链：SDK 下载只做 HTTPS，无完整性校验

`scripts/get-openwrt-sdk.sh` 把目标的 `sha256sums` 仅当作"文件名索引"解析 tarball 名，**下载后从未执行 `sha256sum -c`**（全脚本无校验步骤），`.github/workflows/build.yml` 的直链 curl 路径同样无校验。OpenWrt 官方为 SDK 提供 `sha256sums`（及签名）正是为了这个环节；nightly 产物随后进入 Release 分发给刷机用户。

**建议**：下载 `sha256sums` 后按行 `grep -F "<tarball>" | sha256sum -c -`；immortalwrt 路径同理。这是改动几行、收益直接的加固。

### 🟢 低危 / 健壮性

#### R-05 rpcd `dashboard` 以 `printf` 手工拼 JSON，字符串值未转义

`hostname`、`model`、`openwrt` 等直接 `printf '"%s"'` 注入。管理员把主机名设为含 `"` 或 `\` 的值即产出非法 JSON，前端 `JSON.parse` 失败 → 仪表盘报错态。官方设备端惯例是 `jshn.sh`（`json_init; json_add_string ...; json_dump`）自动转义；`mint_save` 各字段已白名单化不受影响，但 `dashboard`/`mint_public_ip` 建议同样处理。

#### R-06 `header.ut` 将 `wallpaper_error` 原文写入 HTML 注释

`<!-- mint wallpaper backend failed ({{ wallpaper_error }}) ... -->`：`e.message` 经 UCI 配置间接可变，含 `-->` 即可闭合注释逃逸。后端异常文本当前来源受控（ucode fs 层），实际可利用性低，但官方模板对一切外部值 `entityencode`——顺手修掉。

#### R-07 `mz-nftables.js` 一处 `innerHTML`

第 311 行把含链名的文本节点替换后以 `innerHTML` 回写（`"<code>$1</code>"`）。链名源自管理员自己的 nft 配置，是 self-XSS 面，风险低；但同类逻辑 elsewhere 都用了 `textContent`/节点构造，建议统一。

#### R-08 i18n 覆盖不一致

- `mz-nftables.js`、`overview-mobile.js`（`设备/运行时间/平均负载` 等）、rpcd 的 `未联网` 为**硬编码中文，不经 `_()`/`__()`**，英文界面必然中英混杂；
- `.po` 对 `__()` 字符串仍有少量缺口：`Gateway / N/A / No uplink / Refresh / Status / System Information / cores`；
- 建议：要么全部走翻译函数并补 po，要么在 README 明确"内置 zh 文案"的设计立场。

#### R-09 `menu-mint.js` 的 `mintSave` fetch 回退硬编码 `/ubus/`

官方前端约定走 `L.env.ubuspath`（外层 header 已注入）。主路径（`L.rpc.declare`）不受影响，仅回退路径在自定义 ubus 挂载点的固件上失效。低概率，建议改读 `L.env.ubuspath || '/ubus/'`。

#### R-10 仪表盘后端负载偏重

`dashboard` 每次调用 fork 约 20+ 个进程（jsonfilter×15、awk/grep、ubus、curl），前端 1 Hz 轮询（有 `inFlight` 防重入 + 隐藏时降频，值得肯定）。低端 SoC 上是持续可见负载；公网 IP 失败重试路径最坏约 11s 会拉长单次 rpcd 响应（5 分钟成功缓存缓解了常态）。建议：IP 获取拆成独立慢方法或加大前端慢周期。

#### R-11 版本号来源不可控（info）

Makefile 不设 `PKG_VERSION`，`luci.mk` 的 `findrev` 在 feeds/luci 仓库内取 git HEAD——产物版本号实际反映 **LuCI feed 的 commit**，而非主题自身；apk/ipk 两条流水线版本可能不同。官方主题在树内无此问题；外置源建议在 release 流程显式 `PKG_VERSION:=$(RELEASE_VERSION)`。

#### R-12 过程文档入库（info）

仓库根已有 3 份 `LAYOUT_REVIEW_*.md`（内容高度重叠，已被 09-10 合并版取代前两份）。建议归档 `docs/reviews/` 或删除旧版，保持根目录整洁。

---

## 三、官方 API 合规对照（通过项）

| Structures | 官方基准 | 本主题 | 结论 |
|---|---|---|---|
| 目录布局 | `htdocs/`、`ucode/`、`root/`、`src/`（luci.mk Build/Prepare） | 完全一致（无 src，纯数据包） | ✅ |
| 模板安装路径 | `ucode/template/themes/<theme>/*.ut` → `/usr/share/ucode/luci/template/themes/<theme>/` | 一致 | ✅ |
| 模板环境变量 | dispatcher.uc/runt​ime.uc 提供 `media/resource/dispatcher/dispatched/version/blank_page/ctx/uci/http/ubus` 等 | 全部按契约使用，无私有变量依赖 | ✅ |
| 外层 header/footer wrapper | luci-base `template/header.ut` include 主题 header 后注入 `luci.js` + `L = new LuCI({...})` | 主题依赖该机制且未越权重复加载 | ✅ |
| sysauth 契约 | `duser/fuser/auth_fields/auth_html/auth_assets/auth_message/auth_plugin` + 主题 `view/<theme>/sysauth.js` | 与 bootstrap 结构逐项一致（含 2FA/passkey 协议） | ✅ |
| 主题注册 | uci-defaults `luci.themes.<name>=/luci-static/<name>`，缺失才写 | 一致（`set_opt` 模式照抄官方） | ✅ |
| 菜单 JS | `htdocs/luci-static/resources/menu-<theme>.js` + `L.require('menu-<theme>')` + `ui.menu.load()/getChildren()` | 一致 | ✅ |
| menu.d / ACL | JSON 注册 + rpcd acl.d | 机制正确，授权范围见 R-03 | ⚠️ |
| conffiles / keep.d | 运行时改写配置需 `Package/.../conffiles` | 正确处理，含升级语义注释 | ✅ |
| postinst/postrm | opkg `upgrade` vs `remove`、apk 差异、`IPKG_INSTROOT` guard | 处理完整且注释到位，官方多数主题无此严谨度 | ✅ |
| po/lmo | `po/zh_Hans` → `zh-cn` 别名（luci.mk LUCI_LC_ALIAS）、host po2lmo 编译 | 一致；zh_cn/zh_CN symlink 是兼容层 | ✅ |
| luci.mk 变量 | `LUCI_NAME/LUCI_TITLE/LUCI_DEPENDS/LUCI_PKGARCH` | 显式 pin `LUCI_NAME` 防目录名污染，优于官方默认 | ✅ |
| 模板预编译 | `LUCI_MINIFY_UT` 默认 1＋ucode 字节码版本约束 | 显式置 0（本地模块 import 无法在 host 解析、同时规避 24.10 字节码依赖），决策正确且有注释 | ✅ |
| 文件权限 | 官方全部 executable 文件 755 入库 | rpcd 后端 ✅；cron 脚本/uci-defaults ❌（R-01/R-02） | ❌ |
| 前端资源自包含 | 无 CDN/网络字体（README 声明） | CSS/JS 无外联 `url(http`/ `@import`，符合声明 | ✅ |

---

## 四、安全审查专项结论

通过项：

- 模板输出：`sprintf('%J')`、`striptags`、`entityencode(duser/ctx, true)` 均按官方推荐位使用；未发现模板级 XSS 注入点（R-06 除外）。
- `mint save`：config/section/option 三重 `[A-Za-z0-9_]` 白名单，无 shell/uci 路径注入；审计日志只记键名不落值，正确。
- 下载器：协议白名单 + `--proto-redir` 防 302 跳 `file://` + `--max-filesize` 流式上限 + 临时文件 + 魔数校验（含 PNG NUL 字节的 od 校验修正）+ 原子替换 + `flock` 防并发 + seaya HTML 刮取后再校验——设计完整。
- 上传链路：3MB 上限、busy 防重入、rpcd-mod-file write ACL 精确到具体 jpg 路径。
- 前端：无 `eval`/`document.write`/`new Function`；遥测渲染用 `textContent`；`esc()` 覆盖移动端卡片构造；壁纸加载 `referrerPolicy=no-referrer`；会话登出经 POST + 失败降级。
- rpcd reload 而非 restart 保住在线会话——细节正确。

风险余项：R-03（ACL 授权面）、R-05（JSON 拼装）、R-06（注释逃逸）、R-07（innerHTML）见上。

---

## 五、修复优先级建议

1. **R-01**（一行命令，功能级修复）+ verify/install-test 补权限断言（杜绝再犯）
2. **R-02** 统一 `ui_random` 默认值（建议对齐 OT-09 注释 = 0）
3. **R-04** SDK 下载 `sha256sum -c`
4. **R-03** ACL 收敛（read 去 `save`、write 加 `uci mint`、组名规范化为 `luci-theme-mint`）
5. R-05/R-06/R-07 低风险转义与构造方式统一
6. R-08 i18n 补齐；R-09/R-10/R-11 列入 backlog
