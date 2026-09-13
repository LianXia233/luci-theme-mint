# 四态角色背景系统

> 引入版本：1.3.0（2026-09-13）
> 相关文件：`theme/htdocs/luci-static/mint/css/background.css`、`theme/htdocs/luci-static/mint/images/*`、`theme/ucode/template/themes/mint/header.ut`、`theme/htdocs/luci-static/resources/menu-mint.js`、`theme/htdocs/luci-static/resources/view/mint/sysauth.js`、`theme/htdocs/luci-static/mint/css/login.css`

Mint 主题的默认页面背景由「一张 CSS 渐变」换成了一套**四态独立的角色立绘层**。本文说明它的分层结构、状态判定、资源规格、与用户壁纸的关系，以及为什么这样实现不会破坏 LuCI 原生行为。

---

## 1. 四态独立，而不是两条轴塌缩成一条

| 设备 \ 模式 | Light | Dark |
| --- | --- | --- |
| **PC** | `character-pc-light.webp` — Arona，1000×1000 方图 | `character-pc-dark.webp` — Plana，1000×1000 方图 |
| **Mobile** | `character-mobile-light.webp` — Arona，840×1120 竖版 | `character-mobile-dark.webp` — Plana，840×1120 竖版 |

四条硬性约束：

1. **亮暗是两张不同的插画**（Arona / Plana），**不是**同一张图加 `filter: invert()`、`brightness()`、`hue-rotate()` 之类的假暗色。滤镜产物在发色、明暗层次和透明边缘上都会露馅，而且会在路由器上增加每帧合成开销。
2. **Mobile 是独立构图**，不是把 PC 方图 `scale()` 缩小。竖版重新取景、底部锚定，角色从屏幕下缘升起，身体被视口裁切——和参考站的手机版布局一致。
3. **两张网格底纹也是两张成品图**（`triangle-grid-light.webp` / `triangle-grid-dark.webp`）。暗色网格在离线生成阶段就做好 invert + 0.3 不透明度，**运行时没有任何 `filter`**。
4. **四态各自独立配对底座色与 wedge**，暗色不是把亮色反相。

---

## 2. 分层结构

从下到上：

```
.mint-background                        fixed · inset:0 · z-index:-2 · pointer-events:none · overflow:clip
  ├── background-color                  亮 #f6fbfd  /  暗 #102433
  ├── .mint-bg-panel                    对角 wedge（clip-path: polygon(24% 0,100% 0,100% 100%,0 100%)）
  ├── .mint-bg-grid                     三角网格，background-size:1440px 810px，repeat
  ├── .mint-bg-character-light          Arona   opacity 由 data-theme 决定
  ├── .mint-bg-character-dark           Plana   opacity 由 data-theme 决定
  └── .mint-background::after           侧向 scrim（移动端改纵向）
        ───────────────────────────────  负 z-index 分界
body.mz-has-wallpaper::after            用户壁纸（仅有配置时）
body.mz-has-wallpaper::before           该壁纸的遮罩 + 单次模糊
.mz-view                                THE 毛玻璃片（页面内容）
```

### 为什么必须是独立元素 + 负 z-index

- `position: fixed` + `z-index: -2` + `pointer-events: none` 三条同时成立，意味着这个层**不在文档流内**、**不可能被命中测试选中**。因此它无法影响任何页面的布局，也无法抢走任何一次点击——表格、表单、下拉、弹窗全都不受影响。
- `overflow: clip` 把超尺寸立绘限制在层自己的盒子里，这是**任何断点横向滚动条恒为 0** 的根本保障（`hidden` 会创建滚动容器，`clip` 不会）。
- 负 z-index 让内容列**不需要**为了压在背景之上而创建层叠上下文。这一点与本主题既有的壁纸伪元素约定完全一致，不引入新的层叠语义。
- `::after` 用作 scrim：伪元素的绘制层级高于元素自身的子元素，所以遮罩正好落在立绘之上、又在 `.mint-background` 整层（负 z-index）之下，无需额外 DOM 节点。

---

## 3. 状态判定：纯 CSS，首帧即正确

```css
/* 设备 —— 媒体查询 */
@media (max-width: 854px) { … 换 mobile 图 + 底部 wedge + 纵向 scrim … }

/* 模式 —— 属性选择器 */
html[data-theme="dark"] .mint-bg-character-light { opacity: 0; }
html[data-theme="dark"] .mint-bg-character-dark  { opacity: 1; }
```

- **JavaScript 不参与**状态判定。正确的那张图在第一帧就已经画出来了——不存在「先渲染亮色再被 JS 改成暗色」的闪烁窗口。
- 854px 是本主题既有的桌面/移动分界（侧栏在此以下变为抽屉），所以「≤854px 就按手机构图」与「侧栏已经变抽屉」始终是同一个时刻，不会出现布局与背景不一致的中间态。
- 明暗切换**复用侧栏既有的按钮**，它只翻转 `<html data-theme>`，交叉淡入的过渡由 CSS 自己跟上。主题没有新增任何选择器、没有改动明暗入口，主题名仍是 Mint。
- 两个立绘层在**同一个规则集**里声明 `background-image`，因此两张图在页面加载时都已被引用并解码。切换就是改两个 `opacity`——**零网络请求、零解码、不闪白**。

### 按需下载

Mobile / PC 的图片规则分别位于 `@media` 块内与块外，浏览器**不会请求规则不匹配的图片**：手机只下载 2 张移动图，桌面只下载 2 张 PC 图。

---

## 4. 与毛玻璃 UI 的配合

角色背景激活时，唯一页面容器 `.mz-view` 的填充从亮 0.78 / 暗 0.84 降到 **亮 0.70 / 暗 0.74**：

- 这是一次**刻意的 4 个百分点下调**，目的是让立绘可见而正文仍然清晰；实测两种模式下正文对比度均 ≥ 7:1。
- 只改 `--mz-container-background` 一个令牌。侧栏、顶栏、指示条和所有下拉继续使用 `--mz-panel-bg*`，**导航与菜单的可读性与改动前完全一致**。
- 选择器带 `:not(.mz-wp-custom)`：一旦用户配了壁纸，背景变成亮度未知的照片，就恢复原始不透明度，不做任何减免。
- 该层 `background-repeat` 为 `no-repeat`、`background-size: contain`，透明通道完整保留（四张立绘均为 RGBA，四角 alpha 为 0），因此叠在任何底色上都不会出现白方块。

### 宽屏构图

| 断点 | 行为 |
| --- | --- |
| < 1700px | 容器按原有规则铺满列宽，立绘透过玻璃隐约可见 |
| ≥ 1700px | 容器左锚，右侧预留 **260px** 角色通道 |
| ≥ 2100px | 右侧通道加宽到 **320px** |

只改 `width` / `margin`，不动 `--mz-container-pad`、圆角，以及全出血 Action Bar 的契约。这复刻了参考站「内容在左、角色在右」的英雄区构图。

---

## 5. 与用户壁纸的关系

优先级：**用户壁纸 > 内置角色背景**。

| 场景 | 结果 |
| --- | --- |
| 未配置壁纸（默认） | 角色背景是唯一底色；`body.mz-char-bg` 有，`mz-wp-custom` 无 |
| 配置了自定义壁纸（库选中 / 直链） | 加 `body.mz-wp-custom` → 角色层 `display: none`，壁纸接管 |
| `wallpaper.enabled=0` | 角色层**不注入**（模板层就没有这个元素），回到纯色底 |

- 角色层 `display: none` 而不是「盖住」：图片已经挡住了它，保留一个每帧都要合成的透明层是纯粹的浪费。
- `body::after` 在角色模式下的渐变回退被撤掉（改为 `background-image: var(--mz-wallpaper, none)`）。该渐变的存在意义是让**没有任何图片**的裸页面不至于是一块死板；而在角色模式下它会被整片画在立绘之上。底色由角色层自己提供。
- 上传 / 切换 / 删除 / 强制刷新壁纸库的完整链路不受影响，`mz-wp-ver` 的缓存戳机制照旧。

---

## 6. 登录页：纯净，且不可能继承后台立绘

- 登录页模板中 `blank_page = true`，`header.ut` 的角色层注入条件含 `!blank_page`，因此**登录页的 HTML 里根本没有 `.mint-background` 这个节点**——它不是「被 CSS 藏起来」，而是从未存在。
- `sysauth.js` 删除了随机源打乱与时间戳逻辑，只有 `mode='custom'` 且 `url` 非空时才绘制壁纸。默认态是参考站渐变（亮 `#e7f4fb→#f6fbfd→#dbedfa`，暗 `#0b1a26→#102433→#153a4d`）加一层轻量 veil。
- 交叉验证（未登录上下文实测）：`hasLayer=false`、`body` class 无 `mz-char-bg`、`--mz-wallpaper` 未设置、**对 `/mint/images/` 的请求数为 0**。

---

## 7. 缓存戳

```js
// theme/ucode/template/themes/mint/header.ut
const MINT_ASSET_REV = '20260913c';
// theme/ucode/template/themes/mint/footer.ut
{% const MINT_ASSET_REV = '20260913c'; %}
/* theme/htdocs/luci-static/mint/cascade.css —— 全部 12 条 @import 的 ?v= */
```

**改动 `htdocs/luci-static/mint/` 下任何文件（包括 `images/`）都必须同步 bump 这三处。** 路由器对静态资源的长缓存头会让浏览器在新版本安装后继续使用旧样式，bump 是唯一可靠的手段。

图片 URL 自身不带 `?v=`（它们由 `background.css` 内的 `url()` 引用，随 CSS 一起被缓存戳覆盖）。

---

## 8. 验证

`scripts/verify-background.py` 覆盖两个方向：

**四态矩阵**（Playwright，12 个视口）

| 设备 | 视口 | × | 模式 |
| --- | --- | --- | --- |
| PC | 1366×768 / 1920×1080 / 2560×1440 | × | light / dark |
| Mobile | 360×800 / 390×844 / 412×915 | × | light / dark |

每个组合断言：解析到的 `background-image` 文件名与预期一致、`scrollWidth == clientWidth`（零横向溢出）、图层几何（`position:fixed` / `z-index:-2` / `pointer-events:none` / 单层实例）、明暗两层的 `opacity` 恰好 1/0 互换。

**页面扫描**：9 个后台页面（状态总览 / 网络 / 系统 / 路由 / 防火墙 / 管理 / 启动项 / DHCP / 服务）逐页断言 `layer=True` 且 `overflow=+0`。

**资源可用性**：6 张图片全部 HTTP 200；登录页断言无角色层且不请求 `/mint/images/`。

实测结果：四态矩阵 12/12 命中、全部零横向溢出、9 页扫描通过、6 资源 200、明暗 opacity 正确互换、`.mz-view` 背景为 `rgba(255,255,255,.7)`（立绘透出）。

> 脚本已知缺陷：登录页断言在「先登录再访问 `/cgi-bin/luci/`」时会因被重定向到概览页而误报。需要复核登录页时，应在**独立的未登录浏览器上下文**中访问，或使用 `scripts/_probe_bg.py` 形态的探针。

---

## 9. 修改指引（速查）

| 想改什么 | 改哪里 |
| --- | --- |
| 立绘构图 / 换图 | 替换 `images/character-*.webp`（保持文件名与四态对应），**同时 bump `MINT_ASSET_REV`** |
| 底座色 / wedge / scrim | `background.css` 的 `--mz-char-base` / `--mz-char-wedge` / `--mz-char-scrim`（暗色在同名的 `html[data-theme="dark"]` 块） |
| 桌面/移动分界 | `background.css` 的 `@media (max-width: 854px)` —— **必须与侧栏抽屉断点保持同一个值** |
| 立绘位置 | `.mint-bg-character` 的 `background-position`（PC `right center`，移动 `bottom center`） |
| 容器让位宽度 | `@media (min-width: 1700px)` / `(min-width: 2100px)` 的 `calc(100% - var(--mz-container-margin) - Npx)` |
| 毛玻璃透明度 | `body.mz-char-bg:not(.mz-wp-custom) .mz-view` 的 `--mz-container-background` |

### 不要做的事

- **不要**用 CSS 滤镜从亮色图生成暗色图。
- **不要**用 JS UA 检测替代媒体查询来决定设备（可保留为兜底，但媒体查询必须是主机制）。
- **不要**给角色层加 `pointer-events` 能力、`z-index` 正值，或把它移进内容流。
- **不要**在角色模式下恢复 `body::after` 的渐变回退。
- **不要**改 `wallpaper.uc` 后端、`/etc/config/mint` 键名或 uci-defaults —— 它们属于 `luci-app-mint-wallpaper` 包。
