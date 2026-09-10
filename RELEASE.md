# Release Guide

本文档说明如何创建和发布 luci-theme-mint 的正式版本。

## 自动发布流程

该项目使用 GitHub Actions 自动化构建和发布流程。

### 构建触发条件

1. **推送到 main 分支** → 自动构建并发布到 `nightly` prerelease
2. **推送版本标签** (如 `v1.0.0`) → 自动构建并创建正式 Release
3. **手动触发** → 在 GitHub Actions 页面手动触发，可指定版本号

### 工作流说明

#### build.yml（直出 IPK + APK）

主题是纯数据包（无 `src/`），无需 OpenWrt SDK 交叉编译。`scripts/build-direct.sh` 按 `luci.mk` 安装布局装配载荷，再写出与官方后端一致的容器：

- ipk = `gzip(tar(debian-binary, data.tar.gz, control.tar.gz))`（OpenWrt `scripts/ipkg-build`）
- apk = apk-tools v3 ADB 容器（`ADBd` + raw deflate，与 `apk mkpkg` 一致）
- 一次产出全部 4 个包（主题 + 简中翻译 × 两种格式），数十秒完成
- 每个产物都经过结构校验（`verify-package.sh`）与安装测试（`install-test.sh`）

#### release.yml（汇总发布）

`Build packages` 成功后，`release.yml` 下载 artifact、复核包结构并发布：

```
nightly
├── luci-theme-mint-nightly.apk              # OpenWrt 25.12+
├── luci-app-mint-wallpaper-nightly.apk
├── luci-i18n-mint-zh-cn-nightly.apk
├── luci-theme-mint-nightly-all.ipk          # OpenWrt 24.10 / 23.05（opkg）
├── luci-app-mint-wallpaper-nightly-all.ipk
├── luci-i18n-mint-zh-cn-nightly-all.ipk
└── *.buildinfo.txt / RELEASE-NOTES.md
```

Release 说明中会明确写出：**APK 与 IPK 不能互换**——APK 包无法被 opkg 安装，IPK 包无法被 apk 安装。

### 产物说明

每次发布提供**六个**架构无关文件。`luci-app-mint-wallpaper` 自 2026-09-11 起
从主题中拆出，可单独安装、升级与卸载（不装它时主题只提供 UI，壁纸设置页面
与后台缓存任务缺席，主题本身不受影响）：

```
luci-theme-mint-<release>-all.ipk
luci-theme-mint-<release>.apk
luci-app-mint-wallpaper-<release>-all.ipk
luci-app-mint-wallpaper-<release>.apk
luci-i18n-mint-zh-cn-<release>-all.ipk
luci-i18n-mint-zh-cn-<release>.apk
```

官方 LuCI 规范将 `po/` 编译为独立翻译包；只装主题时界面为英文，
主题与翻译须成对安装。壁纸设置页面的中文复用主题的翻译包。

包内架构字段：ipk 为 `all`，apk 为 `noarch`（均为「架构无关」，内容相同，可装于任意目标）。

例如：

- `luci-theme-mint-v1.0.0.apk` / `luci-theme-mint-v1.0.0-all.ipk`
- `luci-app-mint-wallpaper-v1.0.0.apk` / `luci-app-mint-wallpaper-v1.0.0-all.ipk`
- `luci-i18n-mint-zh-cn-v1.0.0.apk` / `luci-i18n-mint-zh-cn-v1.0.0-all.ipk`

每个产物附带同名 `.buildinfo.txt`，记录主题 commit、包版本、包格式/架构、构建方式（direct / no SDK）。

每个版本在两个位置都可下载：
1. **GitHub Releases** - 正式版本页面
2. **GitHub Actions Artifacts** - 工作流临时产物

## 创建正式版本发布

### 方法一：使用发布脚本（推荐）

```bash
# 创建并推送 v1.0.0 标签，自动触发构建
./scripts/create-release.sh v1.0.0

# 不指定版本则默认为 v1.0.0
./scripts/create-release.sh
```

脚本会：
- 验证版本号格式（必须是 v<major>.<minor>.<patch> 形式）
- 检查工作树是否干净
- 创建注解标签
- 推送标签到远程仓库
- 自动触发 GitHub Actions 构建

### 方法二：手动 git 命令

```bash
# 创建注解标签
git tag -a v1.0.0 -m "Release v1.0.0"

# 推送标签到远程仓库
git push origin v1.0.0

# 或推送所有标签
git push origin --tags
```

### 方法三：GitHub Web 界面

1. 访问 https://github.com/LianXia233/luci-theme-mint/tags
2. 点击"Releases"或"Create a new release"
3. 输入标签名 `v1.0.0`
4. 添加发布说明
5. 点击"Publish release"

## 监视构建进度

### GitHub Actions

1. 访问 https://github.com/LianXia233/luci-theme-mint/actions
2. 找到 "Build APK packages" / "Build IPK packages" 工作流运行
3. 查看各个步骤的日志

### Releases 页面

1. 访问 https://github.com/LianXia233/luci-theme-mint/releases
2. 找到对应的版本（如 v1.0.0）
3. 查看产物文件列表

## 版本号约定

遵循 [Semantic Versioning](https://semver.org/)：

- **MAJOR** - 重大更新，不兼容的改动
- **MINOR** - 功能更新，向后兼容
- **PATCH** - 错误修复，向后兼容

例如：
- `v1.0.0` - 首个稳定版本
- `v1.1.0` - 增加新功能
- `v1.0.1` - 修复 bug
- `v2.0.0-beta` - 预发布版本

## 发布检查清单

在创建正式版本前，确保：

- [ ] 所有代码已提交到 `main` 分支
- [ ] 所有测试通过
- [ ] README 已更新，包括新功能说明
- [ ] 版本号已决定
- [ ] 准备好发布说明（Release notes）

## 发布说明建议

在 GitHub Releases 页面添加详细说明：

```markdown
# 新增功能

- 功能 1
- 功能 2

# 改进

- 改进 1
- 改进 2

# 修复

- 修复 1
- 修复 2

# 安装

按设备的包管理器选择对应格式（**APK 与 IPK 不能互换**；主题与简中翻译**成对安装**）：

```sh
# 壁纸设置包为可选；不安装它时主题只提供 UI。安装顺序无关。

# OpenWrt 25.12+（apk）
scp luci-theme-mint-v1.0.0.apk luci-app-mint-wallpaper-v1.0.0.apk \
    luci-i18n-mint-zh-cn-v1.0.0.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 "apk add --allow-untrusted /tmp/luci-theme-mint-*.apk /tmp/luci-app-mint-wallpaper-*.apk /tmp/luci-i18n-mint-zh-cn-*.apk"

# 仍使用 opkg 的系统（24.10 / 23.05）
scp luci-theme-mint-v1.0.0-all.ipk luci-app-mint-wallpaper-v1.0.0-all.ipk \
    luci-i18n-mint-zh-cn-v1.0.0-all.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 "opkg install /tmp/luci-theme-mint-*.ipk /tmp/luci-app-mint-wallpaper-*.ipk /tmp/luci-i18n-mint-zh-cn-*.ipk"
```

# 致谢

感谢所有贡献者！
```

## 常见问题

### Q: 如何撤销发布？
A: 删除 GitHub 上的标签：
```bash
git tag -d v1.0.0          # 删除本地标签
git push origin :refs/tags/v1.0.0  # 删除远程标签
```

### Q: 如何重新发布同一版本？
A: 发布脚本会检查标签是否存在。删除标签后重新创建：
```bash
git tag -d v1.0.0
git push origin :refs/tags/v1.0.0
./scripts/create-release.sh v1.0.0
```

### Q: 如何修改发布说明？
A: 在 GitHub Releases 页面直接编辑版本信息，无需重新构建。

### Q: 构建失败怎么办？
A: 查看 GitHub Actions 日志，修复问题后删除标签重新发布。

### Q: 如何下载特定版本？
A: 访问 https://github.com/LianXia233/luci-theme-mint/releases/tag/v1.0.0

## 更多信息

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Semantic Versioning](https://semver.org/)
- [OpenWrt 安装包管理](https://openwrt.org/)
