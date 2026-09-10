#!/usr/bin/env bash
#
# make-release-notes.sh - turn the *.buildinfo.txt files produced by
# build-direct.sh into release notes that state, per artifact, which
# theme revision and package version it was built from.
#
# Copyright (C) 2026 LianXia233
# SPDX-License-Identifier: Apache-2.0
#
# Usage:
#   ./scripts/make-release-notes.sh --assets dist --tag nightly --out notes.md

set -euo pipefail

ASSETS="" TAG="nightly" OUT=""

while [ $# -gt 0 ]; do
	case "$1" in
	--assets) ASSETS="${2:-}"; shift 2 ;;
	--tag)    TAG="${2:-}"; shift 2 ;;
	--out)    OUT="${2:-}"; shift 2 ;;
	-h|--help) sed -n '2,12p' "$0"; exit 0 ;;
	*) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
	esac
done

[ -n "$ASSETS" ] || { echo "--assets is required" >&2; exit 2; }
[ -n "$OUT" ] || OUT="$ASSETS/release-notes.md"

info() { # info <buildinfo file> <key>
	sed -n "s/^$2[[:space:]]*:[[:space:]]*//p" "$1" | head -n1
}

emit_table() {
	local pattern="$1" title="$2" note="$3" found=0

	printf '### %s\n\n' "$title"
	printf '%s\n\n' "$note"
	printf '| 文件 | 包版本 | 主题提交 | 架构 | 构建方式 |\n'
	printf '| --- | --- | --- | --- | --- |\n'

	local f
	for f in "$ASSETS"/*.buildinfo.txt; do
		[ -f "$f" ] || continue
		local pkg fmt ver commit arch builder
		pkg="$(info "$f" package)"
		fmt="$(info "$f" package_format)"
		[ "$fmt" = "$pattern" ] || continue
		found=1
		ver="$(info "$f" package_version)"
		commit="$(info "$f" theme_commit)"
		arch="$(info "$f" package_arch)"
		builder="$(info "$f" builder)"
		[ -n "$builder" ] || builder="direct"
		printf '| `%s` | %s | `%s` | %s | %s |\n' \
			"$pkg" "$ver" "$commit" "$arch" "$builder"
	done

	[ "$found" = 1 ] || printf '| _(本次未构建)_ | | | | |\n'
	printf '\n'
}

{
	printf '# luci-theme-mint %s\n\n' "$TAG"

	printf '## 下载说明\n\n'
	printf -- '- **APK**：推荐用于 **OpenWrt 25.12+**（默认 apk 包管理器）。\n'
	printf -- '- **IPK**：用于仍使用 **opkg/ipkg** 的系统（OpenWrt 24.10 / 23.05）。\n'
	printf -- '- 两种格式**不可互换**：APK 包无法被 opkg 安装，IPK 包无法被 apk 安装。\n'
	printf -- '- 主题 `luci-theme-mint` 与简中翻译 `luci-i18n-mint-zh-cn` 成对发布、成对安装。\n'
	printf -- '- 所有包均为架构无关（纯数据：CSS / JS / ucode 模板 / menu / ACL）：\n'
	printf -- '  ipk 记录为 `all`，apk 记录为 `noarch`，内容相同、可装于任意目标平台。\n'
	printf -- '- 主题为纯数据包，CI 直接按 OpenWrt 官方容器格式打包（ipk = gzip-tar，\n'
	printf -- '  apk = ADB v3），无需 SDK 交叉编译，产物与官方后端生成的包结构一致。\n\n'

	printf '## 构建产物\n\n'
	emit_table apk "APK（OpenWrt 25.12+）" \
		"apk-tools v3 ADB 容器（\`ADBd\` magic），与 \`apk mkpkg\` 字节布局一致。"
	emit_table ipk "IPK（OpenWrt 24.10 / 23.05）" \
		"OpenWrt \`scripts/ipkg-build\` 容器布局：\`gzip(tar(debian-binary, data.tar.gz, control.tar.gz))\`。"

	printf '## 安装\n\n'
	printf '```sh\n'
	printf '# OpenWrt 25.12+（apk）：主题 + 简中翻译，成对安装\n'
	printf 'apk add --allow-untrusted ./luci-theme-mint-*.apk ./luci-i18n-mint-zh-cn-*.apk\n\n'
	printf '# 仍使用 opkg 的系统（24.10 / 23.05）\n'
	printf 'opkg install ./luci-theme-mint-*.ipk ./luci-i18n-mint-zh-cn-*.ipk\n'
	printf '```\n\n'
	printf '安装后执行 `/etc/init.d/rpcd reload` 或重新登录即可在'
	printf '「系统 → 系统 → 语言和界面」中选择 Mint，\n'
	printf '并将语言设为简体中文（`luci-i18n-mint-zh-cn` 会自动注册 `zh-cn`）。\n'
} > "$OUT"

printf 'release notes written to %s\n' "$OUT"
