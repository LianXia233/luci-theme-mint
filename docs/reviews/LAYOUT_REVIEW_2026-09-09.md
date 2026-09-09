# luci-theme-mint 界面布局审查报告

- 审查日期：2026-09-09
- 审查分支：`arena/01a0875f-luci-theme-mint`
- 审查对象：`theme/` 下的模板、CSS、前端 JS
- 参考依据：`CHANGELOG.md`（重点阅读 2026-09-08 / 2026-09-09 的“回归修复”和 Round 3/5/6/7/9/10 条目）、`theme/ucode/template/themes/mint/*.ut`、`theme/htdocs/luci-static/mint/cascade.css`、`theme/htdocs/luci-static/resources/menu-mint.js`、`overview-dashboard.js` / `overview-mobile.js`
- 审查方式：静态代码审查 + 依据更新日志做前后语义对照（本次未附实机截图/Playwright 验证）

---

## 1. 结论摘要

主题经过多轮迭代后，**移动端顶栏、概览仪表盘、毛玻璃卡片、nftables 页**这几块布局已经比较完整，更新日志中反复出现的“标题被遮挡”“表格撑破卡片”“移动端按钮过宽”等历史问题在现网代码里大多已有对应修复。

但当前代码仍存在一批**布局层面明显不合理**的地方，主要集中在 4 类：

1. **桌面端“顶栏/面包屑/页题/刷新指示器”整套规则已经变成死代码**，疑似在某个重构中把渲染器删掉了，CSS 却完整保留。
2. **页脚被放在了 `.mz-main` 外面**，桌面端会和固定侧栏重叠，手机端也会把整页撑出多余滚动。
3. **移动端表格处理不统一**：LuCI 原生表格转为块级堆叠，但主题自建 `.mz-data-table` 仍强制 `min-width: 500px` + 横向滚动。
4. **CSS 里对同一批网格类存在大量互相重复、互相矛盾的 `!important` 覆盖层**，历史变更中已因此出现多次“回合制”回退，维护和回归风险非常高。

---

## 2. 问题清单

### P1-01 桌面端顶栏 / 面包屑 / 页面标题 / 刷新指示器缺失（CSS 死代码）

**现状**
- `cascade.css` 仍保留完整的“应用顶栏”体系：
  - `.mz-topbar`：`cascade.css:318`
  - `.mz-breadcrumb`：`cascade.css:331`、`cascade.css:4506`
  - `.mz-indicators`：`cascade.css:346`
  - 壁纸毛玻璃顶栏：`cascade.css:3672`、`cascade.css:3682`
  - “刷新指示器放到顶栏最右”规则：`cascade.css:4433`
- 但全仓库 **没有任何模板或 JS 创建 `.mz-topbar`**：
  - `header.ut` 只输出 `#mz-sidebar-toggle`、`#mz-overlay`、`#mz-sidebar`、`.mz-main > #mz-view`；
  - `menu-mint.js` 只创建 `.mz-mobilebar`（移动端顶栏），没有任何 `renderBreadcrumb` / `createTopbar` / `.mz-topbar` 注入；
  - `grep -rn "renderBreadcrumb|mz-topbar|mz-breadcrumb|mz-indicators" theme/` 只命中 CSS，没有 DOM 生产者。

**与更新日志的冲突**
- `CHANGELOG.md` 明确记录过“顶栏面包屑导航（`renderBreadcrumb`）”、“顶栏页题只显示当前二级菜单名”、“顶栏刷新指示器”、“顶栏布局/居中对齐”等改动。
- 当前代码却没有任何对应的渲染逻辑，意味着这些更新日志描述的能力在现有代码里并不存在。

**布局影响**
- 由于 `#mz-view > h2 { display:none !important; }`（`cascade.css:2385`）会把 LuCI 残留的页面级 H2 隐藏，又没有顶栏补回页面标题，**桌面端除概览仪表盘外，很多表单/状态页会没有明显的页面标题**，用户只能靠左侧菜单定位。
- 状态页的自动刷新指示器（`#xhr_poll_status` 对应的胶囊样式）同样不会出现在顶栏。
- 移动端因为 `.mz-mobilebar` 顶栏仍存在，标题反而完整；两端信息层级不一致。

**建议修复方向**
- 恢复一个统一的后台顶栏渲染器（可在 `menu-mint.js` 中实现），在 `.mz-main` 内、`#mz-view` 前注入 `.mz-topbar`，包含当前节点名、刷新指示器，并与移动端 `.mz-mobilebar` 互斥（>854px 显示顶栏，<854px 显示移动顶栏）。
- 或不恢复顶栏时，应同步移除 `cascade.css` 中整套 `.mz-topbar / .mz-breadcrumb / .mz-indicators` 死 CSS，避免后续维护者误以为顶栏仍存在而再次基于它加样式。

---

### P1-02 页脚被放在 `.mz-main` 外：桌面与侧栏重叠、短页产生多余滚动

**现状**
- `header.ut` 打开的结构是：
  ```
  <div class="mz-main" id="maincontent"> … <main id="mz-view"> …
  ```
  `header.ut:178`、`header.ut:206`
- `footer.ut` 在关闭 `</main>` 后又关闭 `</div>`，**页脚紧跟其后**：
  ```
  </main>
  </div>
  <footer class="mz-footer"> …
  ```
  `footer.ut:7-11`
- `.mz-main` 是布局容器：`margin-left: var(--mz-sidebar-width); min-height: 100vh;`（`cascade.css:311-316`）；`.mz-footer` 没有任何 `margin-left`/`padding-left` 补偿（`cascade.css:361-371`）。

**布局影响**
- 桌面端：`.mz-main` 被右侧留出 `236px` 侧栏空间，但页脚不继承该偏移，页脚会自动从 `x=0` 开始，左侧文字/背景会**被固定侧栏压住**，页脚与内容区左右边缘不对齐。
- 任何页面：`.mz-main` 至少占满一屏高度，页脚在它之后，因此**即使内容很短，整页也会出现一条多余的滚动**，页脚永远不在首屏底部。

**建议修复方向**
- 最直接：把 `<footer>` 移进 `.mz-main` 内部（紧跟 `</main>` 之后、`</div>` 之前），让页脚与主体共同参与 `min-height:100vh` 的弹性布局。
- 或者：给 `.mz-main` 使用 `min-height: calc(100vh - <footer 高度>)` 并给 `.mz-footer` 补 `margin-left: var(--mz-sidebar-width)`。

---

### P2-01 移动端表格处理不统一：自建表格横向滚动，原生表格堆叠

**现状**
- 移动端 `<854px` 会把 LuCI 原生表格块级化：
  ```
  .table, .table .tr, table.table, table.cbi-section-table { display:block; … }
  ```
  `cascade.css:1153-1203`
- 主题自建表格 `.mz-data-table` 走另一套逻辑：
  ```
  .mz-data-table { min-width:500px; }
  .mz-table-card { overflow-x:auto; }
  ```
  `cascade.css:2367-2371`
- `overview-mobile.js` 的 DHCP 租约表格就使用 `.mz-table-card > table.mz-data-table`（`overview-mobile.js:536`）。
- `<640px` 仅缩小了 `.mz-data-table` 字号和 padding（`cascade.css:2306-2313`），**没有转成块级堆叠**。

**布局影响**
- 同一页面上：LuCI 原生表格在手机端会变成纵向堆叠；主题 DHCP 表格却要在 500px 宽容器里横向滑动，用户“同一页面两种表格交互”，体验不统一，也容易让人以为内容被裁掉。
- 手机端 DHCP 租约列很多时，横向滑动确实可读，但与“其他表格自动堆叠”的设计冲突。

**建议修复方向**
- 二选一：给 `.mz-data-table` 在 `<640px` 也做 `thead/tbody` 堆叠 + 每 cell 前显示列名（可参考 nftables 的移动端方案）；或统一所有主题卡片表格都走 `overflow-x:auto`，并去掉原生表格的块级化。

---

### P2-02 移动端 `port/net/wifi` 网格被强行固定为 2 列，早先的 1 列规则已成死规则

**现状**
- 早期规则为移动端做了 1 列降级：
  ```
  @media (max-width:640px) {
      .mz-port-grid { grid-template-columns:1fr; }
      .mz-net-grid  { grid-template-columns:1fr; }
  }
  ```
  `cascade.css:2156-2163`
- 后续又对所有宽度强制 2 列：
  ```
  .mz-port-grid  { grid-template-columns: repeat(2,1fr) !important; }
  .mz-net-grid   { grid-template-columns: repeat(2,1fr) !important; }
  .mz-wifi-radios{ grid-template-columns: repeat(2,1fr) !important; }
  ```
  以及桌面 `@media(min-width:1024px)` 的再次固定：`cascade.css:2642-2665`
- 由于后半段使用 `!important`，早先 `≤640px` 的 1 列规则已经完全失效。
- 最终移动端 `<1023.98px` 只对 `.mz-info-cards` / `.mz-rings` 做了专项覆盖（`cascade.css:4050-4060`），**没有覆盖 port/net/wifi**，所以手机上这三组网格在所有宽度都是 2 列。

**布局影响**
- 390px 视口下，端口卡约 180px 宽，可读性尚可；320px 视口下每张卡仅约 145px。
- 网络卡 `.mz-net-row` 内部是 `4.5em + 1fr`（`cascade.css:2127`），2 列布局下地址/网关/DNS 只能显示极短片段并 `ellipsis`，容易造成“网关/DNS 看不见全貌”。
- 结论不一定是“不能两列”，而是**同一套类上保留了两套互相打架的响应式策略**，一旦有人想恢复 1 列，会被后半段 `!important` 悄悄压制，属于典型的历史回归诱因。

**建议修复方向**
- 明确移动端策略并统一：
  - 若保持“两卡一行”，则删掉 `cascade.css:2156-2163` 的 1 列规则，并给 320px 级别补充压缩断点。
  - 若端口/网络/无线在手机上应改为 1 列，则把 `!important` 覆盖移入对应媒体查询，避免死规则。

---

### P2-03 登录页在矮屏/缩放/认证字段较多时可能被裁切，无滚动

**现状**
- `.mz-login` 使用 `position:fixed; inset:0; display:flex; align-items:center; justify-content:center;`（`cascade.css:918-927`）。
- 登录卡片主体 `.mz-login-card` 含 logo、欢迎语、认证错误、表单、认证附加字段（`auth_fields`）、Passkey 提示等（`sysauth.ut:20-...`）。
- `.mz-login` 和 `.mz-login-card` **都没有 `overflow-y:auto` / `max-height`**。

**布局影响**
- 当浏览器高度不足，或者启用了 WebAuthn/双因素等附加字段使卡片高度超过视口时，卡片上下两端会被裁掉，用户无法滚动到“登录”或“提示异常”内容。
- 横屏手机（如 812×375）尤其容易出现。

**建议修复方向**
- `.mz-login` 增加 `overflow-y:auto`，`.mz-login-card` 使用 `max-height: calc(100dvh - 32px); overflow-y:auto;`，避免内容被固定容器裁切。

---

### P2-04 桌面/移动排版样式层存在大量重复、矛盾、`!important` 覆盖（维护级）

**现状**
- 同一批 `.mz-info-cards / .mz-rings / .mz-port-grid / .mz-net-grid / .mz-sys-grid / .mz-wifi-radios` 在 `cascade.css` 中被连续定义了几套方向完全不同的策略：
  - 居中化 + `auto-fit`（`cascade.css:2424-2470`）
  - 固定最大列宽 + 居中（`cascade.css:2486-2545`）
  - 全部左对齐（`cascade.css:2547-2639`）
  - port/net/wifi 强行 2 列（`cascade.css:2642-2665`）
  - sys-grid 强行 2 列 / 1 列（`cascade.css:2668-2697`）
  - 末尾 `auto-fit + 1fr` 对齐块（`cascade.css:4011-4030`）
- 这些规则几乎都带 `!important`，最终效果严格取决于源码顺序；**连续多个“修复”块如果仅仅移动位置就会立刻改变实际布局**。
- 更新日志已多次记录“前一轮修复被后续重排完全回退”的回合制问题（如第 9 轮顶栏样式丢失、第 10 轮 H2 标题再次消失），与这套“打补丁式覆盖”的写法直接相关。

**布局影响**
- 它对当前运行时不一定产生可见错误（能看到的是“最后一块生效”），但它是后续布局回归的最大风险源，任何一个“新增块”放到末尾都可能翻转早先的布局意图。
- 同时大量旧规则留作死代码，让读者无法判断真实布局是居中、左对齐还是固定列宽。

**建议修复方向**
- 将各网格最终策略收敛为**单一权威定义**（例如：桌面 `auto-fit`；平板/手机信息卡 2 列、环形卡 3 列；系统卡手机 1 列），删除所有被覆盖的旧块。
- 同一类布局规则合并到同一个“网格系统”段落，减少 `!important` 交叉覆盖。

---

### P3-01 `overview.js` 与更新日志“已删除”不符，仍残留 1067 行死代码

**现状**
- `CHANGELOG.md` 在“第七轮 —— 移动端/PC 前端彻底解耦”中写明 **`overview.js` 已删除**。
- 仓库中仍有 `theme/htdocs/luci-static/mint/overview.js`（1067 行），且现网 `footer.ut` / `menu-mint.js` / 其它 JS 都没有引用它。

**影响**
- 死代码是次要问题，不会直接造成布局错误，但会误导后续维护：老文件里可能还有旧网格/旧面板选择器，容易被误以为仍参与渲染。
- 与更新日志不一致，也违反“使用更新日志作参考”的上下文。

**建议修复方向**
- 确认无人引用后直接删除 `overview.js`。

---

### P3-02 移动端汉堡按钮仍保留固定的“兜底定位”，一旦 `initMobileBar` 失败会砸到内容

**现状**
- 基础规则 `.mz-sidebar-toggle` 仍是：
  ```
  position:fixed; top:12px; left:12px; z-index:50;
  ```
  `cascade.css:276-293`
- `<854px` 媒体查询会无条件把它设为 `display:inline-flex`（`cascade.css:1185-1187`）。
- 真正把它“放进移动顶栏、取消 fixed”的规则只存在于 `.mz-mobilebar #mz-sidebar-toggle`（`cascade.css:1108-1119`），而 `.mz-mobilebar` 由 `menu-mint.js#initMobileBar` 动态创建（`menu-mint.js:357-390`）。

**影响**
- 在第 9/10 轮修复后，正常路径下按钮在顶栏内，布局正确。
- 但如果 `menu-mint.js` 加载失败、或 `initMobileBar` 因 DOM 缺失提前返回，手机端仍会出现一颗固定在 `(12,12)` 的汉堡浮在标题/内容上方的最初 bug，且当前 `.mz-view` 已不再为它预留左内边距。属于“依赖 JS 成功才成立的布局”，健壮性不足。

**建议修复方向**
- 让“移动端汉堡”的基础规则就固定在 `.mz-mobilebar` 内，或在 `initMobileBar` 失败时提供一个安全回退（例如临时给 `.mz-view` 加左侧 padding）。

---

## 3. 布局上确认“已经较好”的部分

以下内容与更新日志一致，且在当前代码中有对应实现，后续修改时建议保留：
1. 移动端 `.mz-mobilebar` 的 sticky 玻璃顶栏、标题不被按钮遮挡（`cascade.css:1065-1141`、`menu-mint.js:357-427`）。
2. 概览桌面仪表盘 `.mint-overview-dashboard`（`overview-dashboard.js/cs`）：状态 `<h2>`、Gauge、信息卡、图表、系统信息分区与媒体查询（`overview-dashboard.css`）基本成体系。
3. 移动端概览 `.mz-info-cards` 2 列、`.mz-rings` 3 列、长值换行（`cascade.css:4050-4060`）。
4. nftables 状态页的工具条、分组、折叠（`mz-nftables.js`）。
5. 毛玻璃统一、暗色主题、`.mz-hidden-section` 去重（`cascade.css` 尾部与 `footer.ut` 注入脚本）。
6. `cbi-dropdown` 的 `[open]` 属性修复，下拉可正常展开（`cascade.css:3243-3268`）。

---

## 4. 建议后续处理顺序

| 序号 | 问题 | 严重度 | 建议优先级 |
|---|---|---|---|
| 1 | 桌面端顶栏/面包屑/页题/刷新指示器缺失 | P1 | 高 |
| 2 | 页脚在 `.mz-main` 外，桌面与侧栏重叠、短页多余滚动 | P1 | 高 |
| 3 | 移动端 `.mz-data-table` 与原生表格交互不一致 | P2 | 中 |
| 4 | port/net/wifi 移动端 2 列强制与 1 列死规则冲突 | P2 | 中 |
| 5 | 登录页矮屏无滚动可能被裁切 | P2 | 中 |
| 6 | 网格 `!important` 覆盖层过多，回归风险高 | P2 | 中（建议与上两项一并重构） |
| 7 | `overview.js` 死代码未按更新日志删除 | P3 | 低 |
| 8 | 移动端汉堡兜底定位依赖 JS 路径 | P3 | 低 |

---

*本报告仅针对界面布局与结构一致性，未涉及后端逻辑、性能、安全等非排版内容。建议在正式改版前，用 1440 / 1280 / 1024 / 768 / 390 / 320 多档宽度做一次 Playwright 快照回归，并将“最终生效规则”确定为一套而非叠加多套。*
