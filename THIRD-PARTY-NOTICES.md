# 第三方素材与知识产权声明

本文件是 [`README.md`](README.md) 「许可证与版权声明」一节的逐项展开，用于记录 `luci-theme-mint` 仓库中**不属于项目原创代码**的内容及其权利归属与取证信息。

> 适用对象：仓库 `main` 分支当前状态。新增、替换或移除角色素材时，须同步更新本文件、README 对应章节与 `MINT_ASSET_REV`。

---

## 1. 项目代码与文档

| 项目 | 内容 |
|:--|:--|
| 覆盖范围 | `theme/`（`ucode/` 模板、`htdocs/` 下的 CSS / JS，**不含** `images/` 角色素材）、`wallpaper/`、`scripts/`、`docs/` 中的原创文字 |
| 许可证 | GNU General Public License v3.0 |
| SPDX 标识 | `GPL-3.0-only`（依据：`LICENSE` 为 GPLv3 全文；源码头未声明「or any later version」，按 GPLv3 §14 锁定为 v3.0） |
| 版权 | `Copyright (C) 2026 LianXia233` |
| 完整条款 | [`LICENSE`](LICENSE) |

主题以 `PKGARCH:=all` 分发；分发 `.ipk` / `.apk` 时须提供完整对应源码、保留版权与许可证声明（§0、§4–§6），且不得附加额外限制（§10）。

> **对原表述的修正**：旧版 README 的「仅供交流学习与个人非商业部署使用」对 GPL 覆盖的代码构成额外使用限制，与 GPLv3 §10 不符，已删除；对第三方素材的使用范围，改由第 2.3 节按权利人条件单独说明。

---

## 2. 角色素材（不在 GPL-3.0 范围内）

主题内置**两组来源不同**的角色素材，权利归属独立，须分别处理。

### 2.1 「薄荷」（Mint）—— 主题 Logo

| 项目 | 内容 |
|:--|:--|
| 文件 | `assets/logo.png`（720×718 PNG，README 顶部 Logo） |
| 角色 | 薄荷（Mint） |
| 作品 | 《异环》（NTE, Neverness to Everness） |
| 开发 / 著作权人 | 苏州幻塔网络科技有限公司（Hotta Studio，完美世界旗下工作室） |
| 全球发行 | 完美世界游戏 |
| SHA-256（前 16 位） | `d5b5745946cdf219` |

### 2.2 「阿罗娜」/「普拉娜」—— 四态立绘与登录页立绘

| 文件 | 角色 | 尺寸 | SHA-256（前 16 位） |
|:--|:--|:--|:--|
| `theme/htdocs/luci-static/mint/images/character-pc-light.webp` | 阿罗娜（Arona），亮色 | 1000×1000 | `91f5831319570014` |
| `theme/htdocs/luci-static/mint/images/character-pc-dark.webp` | 普拉娜（Plana），暗色 | 1000×1000 | `8c5bd7aa2f53bf52` |
| `theme/htdocs/luci-static/mint/images/character-mobile-light.webp` | 阿罗娜（Arona），亮色 | 840×1120 | `4d820a655c2cfed2` |
| `theme/htdocs/luci-static/mint/images/character-mobile-dark.webp` | 普拉娜（Plana），暗色 | 840×1120 | `fc4aa644dcf5ab78` |

| 项目 | 内容 |
|:--|:--|
| 作品 | 《蔚蓝档案》（Blue Archive） |
| 开发 / 著作权人 | NEXON Games Co., Ltd.（原 NAT Games，开发主体 MX Studio） |
| 区域发行 | Yostar（日本）、NEXON Korea（全球）、上海星啸（中国大陆）等获授权主体；**发行商不是本主题的授权方** |
| 用途 | 页面四态立绘层（`background.css`）、登录页立绘（`login.css`） |

### 2.3 授权状态、来源与限制

- **授权状态**：两组素材均未取得权利人的书面许可；本项目不主张任何权利，未将其用于商业目的。
- **来源记录**：素材的获取途径与授权凭证**未在仓库内留存**。建议维护者另行保存素材来源、作者与获取时间；如后续取得授权，应在本节补充许可范围、地域与期限。
- **分发性质**：素材以聚合（aggregate）形式与 GPL 代码一并打包（GPLv3 §5 末段），权利状态不因打包或本项目采用 GPL-3.0 而改变；下游再分发须自行确认权利人条件。
- **使用限制**：不得用于商业用途、二次创作发布、模型训练或其他超出界面展示目的的场景；`docs/previews/*.jpg` 等截图中的角色形象同受约束。
- **替换流程**：见 [`docs/character-background.md`](docs/character-background.md)，替换后须同步更新本文件、README 与 `MINT_ASSET_REV`。

---

## 3. 名称与商标

| 名称 | 权利人 | 本仓库中的使用方式 |
|:--|:--|:--|
| OpenWrt、ImmortalWrt、LuCI | 各自项目及其基金会 / 社区 | README 徽章与兼容性说明 |
| Apple、Linear | Apple Inc. / Linear Orbit, Inc. | 「Apple / Linear 级极简」仅为设计风格比较 |
| GitHub、GitHub Actions | GitHub, Inc. | 云编译流程说明 |

上述名称均用于**指示性描述**（nominative use），不表示官方背书、赞助或合作关系。

---

## 4. 免责

本主题按「现状」提供，适用 GPLv3 §15–§16 的担保免责与责任限制；本文件不构成法律意见，具体授权事宜以权利人书面许可为准。

---

## 5. 权利主张渠道

如权利人认为本项目的使用超出合理范围，请通过 [GitHub Issues](https://github.com/LianXia233/luci-theme-mint/issues) 提出，并附：

1. 权利证明（著作权登记、授权链或官方声明）；
2. 具体文件路径与使用位置；
3. 期望处理方式（署名 / 替换 / 移除）。

维护者核实后将及时响应，并按第 3 项所述方式处置。

---

## 6. 变更记录

| 日期 | 变更 |
|:--|:--|
| 2026-10-20 | 初版：区分「薄荷」（异环）与「阿罗娜 / 普拉娜」（蔚蓝档案）两组素材，补充权利人法律实体、素材指纹与来源说明；删除与 GPLv3 §10 冲突的非商业限制表述 |
