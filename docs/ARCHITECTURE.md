# Mint 架构说明

> 本文描述**当前代码的实际形态**（`main` HEAD `90b269b`，2026-09-10）。所有断言都能在下文
> 引用的文件里找到对应实现；与设计意图不符之处集中记录在
> [已知结构性问题](#9-已知结构性问题)。

## 1. 分层

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 浏览器侧                                                                  │
│  menu-mint.js（LuCI class，L.require）  mz-ui.js / overview-*.js /        │
│  mz-nftables.js（纯脚本，按路径注入）    view/mint/{sysauth,wallpaper}.js  │
│  cascade.css / overview-dashboard.css                                     │
├─────────────────────────────────────────────────────────────────────────┤
│ 服务端 · 渲染                                                             │
│  ucode/template/themes/mint/{header,footer,sysauth}.ut                    │
│  ucode/mint/wallpaper.uc（luci.mint.wallpaper：配置解析 + 钳制）           │
├─────────────────────────────────────────────────────────────────────────┤
│ 服务端 · 数据/写回                                                        │
│  /usr/libexec/rpcd/mint（ubus 对象 mint：refresh / dashboard / save）      │
│  /usr/share/rpcd/acl.d/luci-theme-mint.json（授权组）                     │
│  /usr/share/luci/menu.d/luci-theme-mint.json（设置菜单位）                │
├─────────────────────────────────────────────────────────────────────────┤
│ 设备侧 · 后台任务与状态                                                    │
│  /usr/bin/mz-wallpaper-fetch.sh（cron */5）→ /www/…/wallpaper-{pc,mobile}.img │
│  /etc/config/mint（UCI，conffile）  /etc/uci-defaults/30_luci-theme-mint  │
│  /lib/upgrade/keep.d/luci-theme-mint（sysupgrade 保留自定义图）           │
└─────────────────────────────────────────────────────────────────────────┘
```

主题**不改动**上游任何文件：所有增强都在 `header.ut`/`footer.ut` 注入点、`cascade.css`
覆盖层与按需脚本里完成；上游 DOM 结构变化只会让增强降级，不会让页面报错。

## 2. 请求生命周期

1. `dispatcher` 用 `luci.main.mediaurlbase=/luci-static/mint` 选定主题，渲染
   `template/themes/mint/header.ut`。
2. `header.ut`：
   - `ubus.call('system','board')` 取主机名 → `<title>`；
   - 由 mediaurlbase 末段推导 `data-theme`（`mint`/`mint-light`/`mint-dark` → `system`/`light`/`dark`，
     这是为残留旧路径准备的防御映射，正常安装恒为 `system`）；
   - 仅当推导出的偏好为 `system` 时，`<head>` 内联一段**首屏配色脚本**：优先读
     `localStorage['mz-theme']`，否则跟随 `prefers-color-scheme`，并监听 OS 变更
     ——这保证深色下不闪烁（FOUC）；`data-theme="light"/"dark"` 时不注入（值已在
     `<html>` 属性上写死），`<meta name="theme-color">` 也按 light/dark 分别给值；
   - `<link>` `cascade.css` + favicon；`<script>` 翻译目录与 `cbi.js`；
   - `uci.get_all('mint','wallpaper')` + `getWallpapers()` → 内联成
     `window.mintWallpaper`（**不额外发请求**）与共享工具 `window.mzWpUtil`
     （UA 判定 + 随机源选择，登录页与管理页共用同一定义，review TZ-14）；
   - 后端抛异常时降级为 `{enabled:true,pc:null,mobile:null}`，并把错误以
     `entityencode()` 包进 HTML 注释（防 `-->` 提前闭合，R-06）。
3. 页面体渲染（上游 dispatcher 负责 `#view` 内容）。
4. `footer.ut`：页脚（LuCI 版本 / 发行版 / mint 三个外链，`rel="noreferrer"`）→
   `L.require('menu-mint')` → `mz-ui.js` → **按路径**注入
   `admin-status-overview`（`overview-dashboard.css` + 设备二选一脚本）与
   `admin-status-nftables`（`mz-nftables.js`）→ 总览页去重脚本。
5. `menu-mint.js` 的 `__init__`：`ui.menu.load()` 渲染侧栏 → 抽屉/顶栏/配色/登出 →
   管理页壁纸 → 防火墙区域色 → `ensureCbiForm()`（同步一次 + 微任务一次 + 1.5 s 再一次）→
   8 s 的 FOUC 保险（渲染失败也要把菜单放开）。

登录页走 `sysauth.ut`，它 `include('header', {blank_page:true})` / `include('footer',
{blank_page:true})`：侧栏、顶栏、`menu-mint`、`mz-ui` 全部跳过，只有 `#view` 里的
`ui.instantiateView('mint.sysauth')` 与登录卡片。

## 3. 前后端契约

### `window.mintWallpaper`（`header.ut` 内联，服务端生成）

```jsonc
{
  "enabled": true,            // wp.enabled=='0' 或后端返回 false 时为 false
  "overlay": "0.45",          // 已钳制
  "blur": "0",                // 已钳制 0..40
  "ui_random": false,         // 管理页随机壁纸开关，缺失时按 '0'
  "pc":     { "mode": "random|custom", "url": "", "proxy": "/luci-static/mint/wallpaper-pc.img", "sources": [ … ] },
  "mobile": { "mode": "…", "url": "…", "proxy": "…wallpaper-mobile.img", "sources": [ … ] }
}
```

`proxy` 仅在「该类别为 random 且缓存文件存在且非空」时非空——这是 `wallpaper.uc`
用 `stat()` 判定的结果，因此**服务端而不是浏览器**决定这一轮用哪张图。

### ubus 对象 `mint`

| 方法 | ACL 作用域 | 输入 | 输出 |
|---|---|---|---|
| `dashboard` | read | 无 | 见 §4 的快照 JSON |
| `save` | write | `{config, section, values:[[opt,val],…]}` | `{"ok":true,"written":N,"config":…,"section":…}` |
| `refresh` | read | 无 | `{"spawned":false,"mode":"random"}`（恒定的兼容桩） |

`list` 方法返回 `{"refresh":{},"dashboard":{},"save":{}}`，供 rpcd 注册。

## 4. `mint dashboard` 快照

```jsonc
{
  "cpu":   { "cores": N, "freq_khz": N|null, "stat": "cpu  user nice system idle …"|null },
  "memory":{ "total_kb":N, "available_kb":N, "free_kb":N, "buffers_kb":N, "cached_kb":N },
  "temperature": [ { "name":"x", "temp_mc":N }, … ],   // thermal_zone* + hwmon*_*_input
  "storage": { "filesystem":"…","total_kb":N,"used_kb":N,"avail_kb":N,"use_pct":N,"mount":"/" }|null,
  "load":  { "m1":N, "m5":N, "m15":N },
  "uptime": N,
  "conntrack": { "count":N|null, "max":N|null },
  "network": { "uplink": {name,device,proto,ipv4,ipv4_mask,ipv6,gateway,metric,rx_bytes,tx_bytes}|null,
               "public_ipv4": "1.2.3.4"|"未联网"|null },
  "system": { hostname, model, board_name, arch, target, distribution, version, revision, kernel, openwrt, luci }
}
```

原则：**后端只采集、不计算**；前端算 CPU 增量、内存/存储百分比、速率与历史。字符串全部经
`json_escape()`（`sed` 转义 `\` 与 `"`，`tr -d '\000-\037'`），`network` 块在 heredoc 外组装。

## 5. 权限模型

`/usr/share/rpcd/acl.d/luci-theme-mint.json` 的组名与包名一致（曾用 `wallpaper`，
R-03 改掉以免与别的包撞名）：

- read：`ubus mint.refresh`、`mint.dashboard`、`uci:mint`、`file /www/luci-static/mint list`
- write：`ubus mint.save`、`uci:mint`、`file custom-pc.jpg|custom-mobile.jpg write`

菜单可见性由 `depends.acl=["luci-theme-mint"]` + `depends.uci={mint:true}` 决定；
上传能力复用 `luci-base` 的 `file.write`（write 作用域里那两条 file 规则就是它的边界）。

设备侧图片目录是**未认证可读**的（登录页在认证之前就要取图），因此
`mz-wallpaper-fetch.sh` 对 UCI 里的源做了协议白名单——否则「配一个壁纸源」等价于
「把任意本地文件发布给匿名访客」；`api.seaya.link/wap` 的直链是从远端 HTML 里正则提取的，
提取结果会再次过一遍校验。

## 6. 缓存层级

| 层 | 载体 | 周期 | 失效条件 |
|---|---|---|---|
| L1 服务端 | `/www/luci-static/mint/wallpaper-{pc,mobile}.img`（cron `*/5`） | 5 分钟 | `*_mode=custom` 时不生成；无 `curl` / 无执行位 / 源被拒 / 校验失败 → 文件不更新 |
| L2 HTTP | uhttpd `Last-Modified` → 浏览器 304 | 随 L1 | 代理 URL 不加时间戳（加了就打穿 304） |
| L3 浏览器 | `sessionStorage['mz-wp-url-{pc,mobile}']` | 5 分钟 | 仅在 L1 缺失时起作用，用于避免每次导航换一张 |
| L4 远端 | 随机 API + `_mzt=<ts>` 防缓存 | 每次 | 全部源失败 → CSS 渐变 |

其他状态：`localStorage['mz-theme']`（配色覆盖）、`localStorage['mz-nav-<标题>']`（分组折叠）、
`localStorage['mz-username']`（记住用户名）、`sessionStorage['mz-apply-ok']`（应用成功提示跨重载复播）、
`/tmp/mint_public_ip` 与 `/tmp/mint_public_ip_f`（公网 IP 缓存与失败退避）。

`wallpaper.uc` **自身不带任何缓存**：设备状态的「新鲜度」全部来自 cron 与前端轮询。

## 7. 前端脚本的注入矩阵

| 脚本 | 注入点 | 判定 |
|---|---|---|
| `menu-mint.js` | `footer.ut` 的 `L.require('menu-mint')` | 非 blank_page（即所有管理页） |
| `mz-ui.js` | `footer.ut` `<script defer>` | 同上 |
| `overview-dashboard.css` + `overview-dashboard.js` | `footer.ut` | 路径 == `admin-status-overview` 且 **非**移动端（UA 或 `max-width:854px`） |
| `overview-mobile.js` | `footer.ut` 同一段引导脚本 | 路径 == `admin-status-overview` 且 移动端 |
| `mz-nftables.js` | `footer.ut` | 路径 == `admin-status-nftables` |
| `view/mint/sysauth.js` | `sysauth.ut` 的 `ui.instantiateView('mint.sysauth')` | 登录页 |
| `view/mint/wallpaper.js` | `menu.d` 的 `type:view path:mint/wallpaper` | 设置页 |

UA 判定集中在 `header.ut` 定义的 `window.mzWpUtil.isMobileUA()`（登录页与管理页共用，
review TZ-14），`menu-mint.js` / `sysauth.js` 里各有一份**同内容**的本地兜底（仅当
`window.mzWpUtil` 缺失时使用）。但 `footer.ut` 的总览引导脚本用的是**另一条更窄的**正则
（`Mobi|Android|iPhone|iPad|Windows Phone`）**或** `max-width:854px`：两套判定可以给出不同结果
（见[已知结构性问题](#9-已知结构性问题)第 6 条）。

## 8. 样式覆盖策略

- `cascade.css` 顺序即优先级：tokens → base → 侧栏/主区 → 按钮体系（“single source of
  truth”区块）→ 表单 → 卡片/表格/进度条/告警/标签/下拉/tooltip → 登录页 → 移动端顶栏 →
  响应式 → 总览增强 → 玻璃层 → 局部组件补丁 → 第三方应用桥接。
- 对上游 DOM 的选择器一律**优先后代、避免直接子代**（例如 `.nft-chain > h4 code`，
  曾因写成 `> code` 而结构一变即失效）。
- 覆盖上游内联样式时用带 `!important` 的 class（例如总览去重 `.mint-dedup-hidden`），
  绝不写 `style.display`（上游折叠逻辑会立刻覆盖回来）。
- 玻璃层由 `body.mz-has-wallpaper` 门控，未命中该 class 时退化为普通不透明卡片。

## 9. 已知结构性问题

以下不是「待办清单」，而是当前代码里客观存在、且尚未修的行为偏差：

1. **深色玻璃规则不生效**：`cascade.css` 第 3634、3652、3710、3724 行附近使用
   `body.mz-has-wallpaper[data-theme="dark"]` / `…:not([data-theme="dark"])`，而
   `data-theme` 由 `header.ut` 与 `menu-mint.js` 设在 `<html>` 上（同一文件第 3847、3858 行
   的 `html[data-theme="dark"] body.mz-has-wallpaper …` 写法才是有效的）。结果：管理页在深色
   模式下仍套用浅色玻璃令牌，且浅色渐变兜底背景不被抑制。
2. **`po/templates/theme.pot` 少 1 条**（`Cached random wallpaper`）：翻译完整，模板滞后。
3. **`create-release.sh` 的收尾提示**称推送标签会触发构建：两个构建 workflow 的 `on:` 里
   没有 `tags`，因此不会触发（发布流程见 `RELEASE.md`）。
4. `ubus call mint refresh` 是**空桩**：不会触发抓图，只为历史 ACL/调用方保留。
5. **两套设备判定不等价**：`mzWpUtil.isMobileUA()`（选壁纸图源）与 `footer.ut` 引导脚本
   （总览走桌面仪表盘还是移动面板）正则不同、后者还额外看视口宽度。桌面模式 UA 的平板
   （iPad Safari「请求桌面网站」、部分安卓平板）会得到「桌面仪表盘 + 移动端壁纸」的组合；
   改动任一判定都要同步评估另一处。
6. `mz-nftables.js`、`overview-mobile.js` 依赖上游视图的**文本/结构**（`pick()` 的中文标签、
   `CAT_PREFIXES`、`classifyChain()` 的正则）。这些是刻意的字面量解析键，翻译它们会破坏匹配
   （R-08 的结论），代价是上游文案变更时增强会退化。
