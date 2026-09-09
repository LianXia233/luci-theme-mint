# 发布指南（luci-theme-mint）

本文描述 `.github/workflows/` 里**实际存在**的三个工作流的行为，以及与之匹配的操作步骤。
构建/校验脚本的细节见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，用户视角的安装说明见
[README.md](README.md)。

> ⚠️ **打 `v*` 标签不会触发任何构建。** 两个构建工作流的 `on:` 只有
> `push: branches: [main]` 与 `workflow_dispatch`，`release.yml` 只有
> `workflow_run` 与 `workflow_dispatch`。`scripts/create-release.sh` 结尾那句
> 「workflow will now build and create the release」是不成立的乐观描述（脚本本身仍可用，
> 只是它只负责建/推标签）。

## 一、三个工作流

| 文件 | name | 触发 | 矩阵 | 产物 |
|---|---|---|---|---|
| `build-apk.yml` | `Build APK packages` | push `main`、`workflow_dispatch`（`release_version`，默认 `nightly`） | OpenWrt `25.12`、`snapshot`，各 1 个目标 `x86/64` | `.apk`（架构字段 `noarch`） |
| `build-ipk.yml` | `Build IPK packages` | 同上 | OpenWrt `24.10`、`23.05`，各 1 个目标 `x86/64` | `.ipk`（架构字段 `all`） |
| `release.yml` | `Release` | `workflow_run`（上述两者 completed）、`workflow_dispatch`（`release_tag`，默认 `nightly`） | — | 汇总发布到 GitHub Release |

每个系列的 job 步骤固定为：

```
Checkout → Install host tools → Resolve OpenWrt SDK URL（get-openwrt-sdk.sh --print）
        → Cache SDK tarball（actions/cache@v4，key 含 tarball 的 sha256）
        → Build with the official OpenWrt SDK（build-package.sh）
        → Verify package metadata and payload（verify-package.sh --dir dist --expect-arch all）
        → Install test（对 dist/*.apk 或 dist/*.ipk 逐个跑 install-test.sh）
        → Show build info（cat *.buildinfo.txt）
        → Upload artifact（actions/upload-artifact@v4，retention 14 天，if-no-files-found: error）
```

其他细节：

- `permissions: contents: read`（构建）/ `contents: write, actions: read`（发布），不额外给 token 权限。
- `concurrency`：构建按 `apk-`/`ipk-` 前缀分组，**push 事件**会 `cancel-in-progress`（重试不排队）；
  发布按 `release-<head_sha>` 分组且不取消。
- `timeout-minutes: 60`；`fail-fast: false`（一个系列挂了不影响另一个系列继续，方便一次看全）。
- `opkg` / `apk-tools` 在 runner 上属于「尽力安装」，装不上时安装测试自动退化为
  「按同样布局解包 + 文件级断言」，不会因此变红。
- 上传时排除 `dist/README.txt`。
- `build-ipk.yml` 传 `--allow-legacy`：若所请求系列已无 ipk 后端，允许回退到仍提供该后端的
  官方 SDK（`24.10 → 23.05`），并在 `.buildinfo.txt` 的 `legacy_compat_sdk` 与 Release 表格的
  「兼容构建（非原生）」列中标注。**绝不通过改名/换后缀伪造 ipk。**

### 产物命名

`build-package.sh` 把包重命名为（每个系列 × 每个包格式，共 **2** 个包）：

```
luci-theme-mint-<release_version>-<OpenWrt 系列>-<target_slug>-all.<apk|ipk>
luci-i18n-mint-zh-cn-<release_version>-<OpenWrt 系列>-<target_slug>-all.<apk|ipk>
```

例如 `luci-theme-mint-v1.0.0-25.12-x86_64-all.apk` 与
`luci-i18n-mint-zh-cn-v1.0.0-25.12-x86_64-all.apk`。每个包旁还有同名
`.buildinfo.txt`（`package`、`package_name/version/format/arch`、`openwrt_requested/release/
series/target`、`kernel_version`、`sdk_url`、`luci_branch`、`luci_commit`、`legacy_compat_sdk`、
`release_version`）。

> 主题是纯数据包、与目标平台无关，所以**每个系列只构建 1 个目标**（多目标只会产出内容相同的包，
> 白烧约 15 分钟与 ~300 MB 下载）。`.apk` 与 `.ipk` **不可互换**：apk 装不了 ipk，反之亦然。
> 只装主题不装翻译包时界面是英文（官方 LuCI 规范把 `po/` 编为独立翻译包）。

### `release.yml` 的汇总逻辑

1. 由 `workflow_run` 触发时，取该 run 的 `head_sha` 与 `head_branch`；`head_branch` 等于默认分支
   → `tag=nightly`，否则 `tag=<branch>`。构建结论非 success 直接跳过。
2. 用 `gh api repos/<repo>/actions/runs?head_sha=…` 找**同一 commit** 上两条流水线的成功 run；
   任一缺失就打印 `waiting for the other build workflow` 并跳过（先跑完的那条一定跳过，
   后跑完的那条才发布 → Release 永远是 apk + ipk 齐全的一套）。
3. 下载两组 artifact → **重新对每个包跑一次 `verify-package.sh`** →
   `make-release-notes.sh` 生成 `RELEASE-NOTES.md` → `softprops/action-gh-release@v2` 发布
   （`prerelease: tag == 'nightly'`，`allowUpdates: true`，`tag_overwrite: tag == 'nightly'`）。
4. `pull_request` 触发的构建 run 一律不发布（`if: github.event.workflow_run.event != 'pull_request'`）。
5. `workflow_dispatch` 手动触发时：`tag` 取输入 `release_tag`，`sha` 取
   **release.yml 检出 HEAD 的 commit**——也就是说手工发布要求两条构建流水线跑在 main 的
   **同一个 commit** 上。

`nightly` 每次被覆盖更新（`tag_overwrite`），正式版本 tag 一旦存在就不再改写。
`softprops/action-gh-release` 在 tag 不存在时会在对应 commit 上创建它，因此**预先打标签并非必需**。

## 二、发布 nightly（默认路径，无需人工干预）

推送到 `main` 即自动：两条构建 → 两条都成功后 `release.yml` 更新 `nightly` prerelease。

## 三、发布正式版本 `vX.Y.Z`

```sh
# 0) 本地自检（改过包定义/载荷清单/SDK 解析时必做）
./scripts/ci-simulate.sh && ./scripts/ci-mirror-test.sh

# 1) 确认 main 上的目标 commit（下面三次触发都必须是它）
git fetch origin && git rev-parse --short origin/main

# 2) 触发两条构建，并把版本字符串传进去
gh workflow run build-apk.yml --ref main -f release_version=v1.0.0
gh workflow run build-ipk.yml --ref main -f release_version=v1.0.0

# 3) 等两条都绿（同一 commit、都是 success）
gh run list --workflow "Build APK packages" --limit 3
gh run list --workflow "Build IPK packages" --limit 3
gh run watch <run-id>

# 4) 发布（汇总 + 重校验 + 建/复用 tag）
gh workflow run release.yml --ref main -f release_tag=v1.0.0

# 5) 核对
gh release view v1.0.0
```

要点：

- `release_version` 只是**产物文件名与 `.buildinfo.txt` 里的版本字符串**，与包内
  `PKG_VERSION` 是两件事：包内版本由 `build-package.sh` 按主题仓库 HEAD 注入
  （`yy.ddd.sssss~hash`，见 Makefile 的 `PKG_VERSION ?=` 注释）。
- 第 2 步之后**不要**再往 `main` 推提交：那会让 HEAD 前移，第 4 步按新 HEAD 找 run 时会
  找不到成对的构建而跳过。
- 想同时留下 git 标签，可在第 4 步之前跑 `./scripts/create-release.sh v1.0.0`
  （它要求工作树干净、标签不存在；只是建并推送注解标签，不触发 CI）。

## 四、产物去哪看

1. **GitHub Releases**：<https://github.com/LianXia233/luci-theme-mint/releases>
2. **Actions artifacts**（14 天保留）：对应 run 的 Artifacts 区，artifact 名为
   `luci-theme-mint-{apk,ipk}-<系列>-x86_64`

Release 正文由 `make-release-notes.sh` 生成（下载说明、apk/ipk 两张产物表、成对安装命令），
事后在 Releases 页面直接编辑即可，无需重新构建。

## 五、版本号约定

遵循 [Semantic Versioning](https://semver.org/)：MAJOR（不兼容变更）/ MINOR（新增功能）/
PATCH（修复）。已发布：`v0.1.0`、`v0.2.0`；未发布的变更累积在 `CHANGELOG.md` 的
`[Unreleased]`，发版时把它归档成对应小节并补 `compare` 链接。

## 六、发布前检查清单

- [ ] `CHANGELOG.md` 的 `[Unreleased]` 已整理完毕（用户可见变更一条不落）
- [ ] `README.md` / `theme/README.md` 与代码一致（默认值、路径、ubus 方法、依赖表）
- [ ] `./scripts/ci-simulate.sh`、`./scripts/ci-mirror-test.sh` 均通过
- [ ] `git grep -lI $'\r'` 无输出（设备侧 BusyBox ash 不吃 CRLF）
- [ ] `theme/root/` 下脚本在 git 里是 `100755`（`git ls-files -s theme/root`）
- [ ] `theme/po/zh_Hans/luci-theme-mint.po` 覆盖所有新增 msgid
- [ ] 版本号已确定；`main` HEAD 不再变动

## 七、常见问题

**Q：只想构建不发布？**
直接 `workflow_dispatch` 跑 `build-apk.yml` / `build-ipk.yml`：产物只是 artifact，
`release.yml` 在 pull_request 或分支 run 下不会发布。

**Q：Release 里少了一个格式/系列？**
看两条流水线在同一 commit 上是否**都** success——缺哪条就补跑哪条，然后手动 dispatch
`release.yml`。`verify-package.sh` 失败通常是载荷清单/执行位/架构字段变了：先本地
`./scripts/ci-simulate.sh` 复现。

**Q：`nightly` 里混进了坏包？**
历史教训：旧的 `build.yml` 与 `release.yml` 竞争同一个 `nightly` Release，产出过版本号为 0 的
坏包与 ImmortalWrt 杂项产物；该工作流已删除。现在发布来源唯一（官方 SDK 双流水线）。

**Q：撤销/重发同一版本？**

```sh
gh release delete v1.0.0 --cleanup-tag     # 删 Release 与标签
gh release delete v1.0.0                   # 只删 Release、保留标签
./scripts/create-release.sh v1.0.0         # 需要时重建本地+远端标签
gh workflow run release.yml -f release_tag=v1.0.0
```

**Q：想装某个历史版本？**
<https://github.com/LianXia233/luci-theme-mint/releases/tag/v1.0.0>（把版本号换掉即可）。

**Q：用户报「装了没生效」？**
让他贴这三条的输出——通常一眼能定位：

```sh
uci get luci.main.mediaurlbase; ls -l /usr/share/rpcd/acl.d/luci-theme-mint.json
ubus call mint dashboard >/dev/null && echo rpcd-ok
```

## 更多信息

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Semantic Versioning](https://semver.org/)
- [OpenWrt 包管理（apk/opkg）](https://openwrt.org/docs/guide-user/additional-software/beginners-guide)
