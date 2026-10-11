# 更新日志 / Changelog

本文件记录 luci-theme-mint 与 luci-app-mint-wallpaper 的所有显著变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号沿用资产修订戳（`MINT_ASSET_REV`，格式 `YYYYMMDDx`）。

---

## [20261011e] - 2026-10-11 · 组件审查（弹窗 / 下拉 / 按钮）

### Fixed 修复

- **弹窗权威层错位**：components.css 原 `.modal` 规则（0,1,0）全部输给
  compat.css 的 `#modal_overlay .modal`（1,1,0），玻璃填充、卡片圆角、
  入场动画从未真正生效。现以 (1,1,0) 特异性重写为权威层：
  `--mz-modal-bg` 玻璃填充、`--mz-radius-card`、每次打开重放
  `mz-modal-in`；保留 compat 的 `modal-overlay-active` 状态机与
  顶部锚定长对话框滚动；移动端 640px 紧凑内边距补回本层。
- **overlay 遮罩**：静态期不再常驻 scrim 背景与 `mz-overlay-in`
  动画（该 keyframe 已无引用，删除）；blur(4px) 保留。
- **cbi-dropdown 整块重复**：compat.css 连续两段几乎相同的
  dropdown 修复块（含冲突的 margin/radius/shadow），删除前一份
  （其后一份早已按层叠规则胜出，删除零渲染差异），保留块数值
  全部 token 化（8px/6px/手写阴影 → radius-md/sm + shadow-md）。

### Added 新增

- 下拉菜单**选中项高亮**：`ul.dropdown > li[selected]` 品牌软底 +
  加粗，展开时不再与闭合值条无法区分；键盘导航
  `li:focus-visible` 描边。
- 按钮语义族收编进 components.css 单一所有者：
  apply/action 实心主色、save/positive 软主色、
  reset/remove/negative 软危险色（悬停才硬化为实心红，
  与整排按钮视觉音量一致）、`btn.danger` 显式实心保留。

---

## [20261011d] - 2026-10-11 · Aurora Glass

本轮四个提交（`c22019f` → `7c939f3`）构成一次完整视觉迭代：
**壁纸清晰透出、加载更快、整体观感不变**。

### Added 新增

- **Aurora sheen 受光边**：新令牌 `--mz-view-sheen`，在唯一视觉容器 `.mz-view`
  与登录卡顶部绘制 120px 渐变高光（light .18 / dark .05），
  不产生第二层容器、不叠加遮盖壁纸。
- **渐变壁纸遮罩**：`body::before` 由纯色平铺改为
  「顶部 `.38` → 底部 `~.17`」的纵向渐变洗白，风景照下半段保留原色。
- **加载优先级分级**：登录 logo `fetchpriority="high"`（LCP 元素）；
  壁纸图片 `fetchPriority='low' + decoding='async'`；
  随机壁纸内置 API 域名 `preconnect` 预热。
- **壁纸库懒加载**：`luci-app-mint-wallpaper` 缩略图改为
  `<img loading="lazy" decoding="async">`（div 背景图保留作解码期占位），
  视口外瓦片不再全量拉取原图。

### Changed 变更

- **玻璃透光度调校**（对文字对比度 ≥ 7:1 不变）：
  - 玻璃层 `--mz-glass-bg` .78 → **.70**（light）
  - 角色背景下容器 .70 → **.62**（light）/ .74 → **.68**（dark）
  - 登录卡 .82 → **.68**（light）/ .92 → **.86**（dark）
  - 侧栏 / 顶栏 / 菜单 chrome 保持 `.86`（strong），导航对比度不变
- **壁纸遮罩默认值** 0.45 → **0.38**，全链路 7 处同步：
  表单默认、`/etc/config/mint`、uci-defaults、`wallpaper.uc`
  clampOverlay、header.ut JS fallback、compat.css 遗留 fallback、文档表。
- **移动端合成降本**：≤854px 时 glass blur 16/18px → **10/12px**、
  saturate 135% → 115%；固定背景层 `.mint-background` 加 `contain: strict`。
- **CLS 修复**：侧栏品牌图与登录 logo 补显式 `width/height` 属性。

### Removed 移除

- **旧仪表盘死代码**：`mz-ring-* / mz-info-* / mz-port-* / mz-wifi-* /
  mz-net-body… / mz-badge-* / mz-modal-* / mz-tooltip` 等 63 个零引用类
  （重构前家族，现役为 `mint-ovd-*`）相关规则全部删除，
  12 个 CSS 层净减约 **1800 行**；混合选择器列表仅摘除死分支。
- **logo 资产瘦身**：256 色 PNG 量化，overview-banner 83→17KB、
  login-logo 70→16KB、favicon 76→16KB、assets/logo 1259→111KB（-92%）。

### Fixed 修复

- 登录页暗色模式 `background` 简写会清除 sheen 的问题
  （改用 `background-color`）。
- 版本戳链路：`MINT_ASSET_REV` 同步升级
  `20260913m → 20261011a → b → c → d`（cascade.css 13 处 @import +
  header/footer.ut），浏览器缓存不再出现半更新渲染。

### 兼容性

- 所有 UCI 配置键不变；已有 `overlay` 用户值不受默认值变更影响。
- 单容器契约、action bar 全出血契约、`cbi-dropdown` 层级契约
  （禁 stacking context）逐项复核，未破坏。

---

## [20260913m] - 2026-09-13

- 版本统一：主题包名与路径统一为 `mint`，弃用 mint-light / mint-dark /
  mintzero* 变体注册（模板内防御性映射保留）。
- 上一轮完整变更见仓库 docs/reviews/ 下的评审记录与 Release Notes。
