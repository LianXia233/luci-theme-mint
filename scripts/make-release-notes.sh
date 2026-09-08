#!/usr/bin/env bash
#
# make-release-notes.sh - turn the *.buildinfo.txt files produced by
# build-package.sh into release notes that state, per artifact, which
# OpenWrt SDK / kernel / LuCI branch it was built against.
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
	printf '| 文件 | OpenWrt | Kernel | LuCI 分支 | SDK 系列 | 兼容性 |\n'
	printf '| --- | --- | --- | --- | --- | --- |\n'

	local f
	for f in "$ASSETS"/*.buildinfo.txt; do
		[ -f "$f" ] || continue
		local pkg fmt rel kern luci legacy series
		pkg="$(info "$f" package)"
		fmt="$(info "$f" package_format)"
		[ "$fmt" = "$pattern" ] || continue
		found=1
		rel="$(info "$f" openwrt_release)"
		kern="$(info "$f" kernel_version)"
		luci="$(info "$f" luci_branch)"
		series="$(info "$f" openwrt_series)"
		legacy="$(info "$f" legacy_compat_sdk)"
		if [ "$legacy" = 1 ]; then
			printf '| `%s` | %s | %s | %s | %s | 兼容构建（非原生） |\n' \
				"$pkg" "$rel" "$kern" "$luci" "$series"
		else
			printf '| `%s` | %s | %s | %s | %s | 原生 |\n' \
				"$pkg" "$rel" "$kern" "$luci" "$series"
		fi
	done

	[ "$found" = 1 ] || printf '| _(本次未构建)_ | | | | | |\n'
	printf '\n'
}

{
	printf '# luci-theme-mint %s\n\n' "$TAG"

	printf '## 下载说明\n\n'
	printf -- '- **APK**：推荐用于 **OpenWrt 25.12+**（默认 apk 包管理器）。\n'
	printf -- '- **IPK**：用于仍使用 **opkg/ipkg** 的兼容系统（如 OpenWrt 24.10 / 23.05）。\n'
	printf -- '- 两种格式**不可互换**：APK 包无法被 opkg 安装，IPK 包无法被 apk 安装。\n'
	printf -- '- 所有包架构均为 `all`（纯数据主题：CSS / JS / ucode 模板 / menu / ACL）。\n\n'

	printf '## 构建产物\n\n'
	emit_table apk "APK（推荐用于 OpenWrt 25.12+）" \
		"由对应 OpenWrt 官方 SDK 的 apk 后端（\`CONFIG_USE_APK=y\`）真实构建。"
	emit_table ipk "IPK（用于仍使用 opkg 的系统）" \
		"由 OpenWrt 官方 SDK 的 ipk 后端真实构建；若目标系列已不提供 ipk 后端，则回退到仍提供该后端的官方 SDK，并在表中标注为兼容构建。"

	printf '## 安装\n\n'
	printf '```sh\n'
	printf '# OpenWrt 25.12+（apk）\n'
	printf 'apk add --allow-untrusted ./luci-theme-mint-*.apk\n\n'
	printf '# 仍使用 opkg 的系统\n'
	printf 'opkg install ./luci-theme-mint-*.ipk\n'
	printf '```\n\n'
	printf '安装后执行 `/etc/init.d/rpcd reload` 或重新登录即可在'
	printf '「系统 → 系统 → 语言和界面」中选择 Mint / Mint Light / Mint Dark。\n'
} > "$OUT"

printf 'release notes written to %s\n' "$OUT"
