# AGENTS.md

面向 AI 编码代理的项目约定。人类开发者请看 [README.md](./README.md)。

## 项目概览

Chrome Extension（Manifest V3），无框架、无打包、无构建步骤的纯 JavaScript 项目。

四个彼此独立的能力：

1. **控制台日志控制器** —— 通过 popup 开关，按站点持久化禁用页面中 `console.log` / `console.info` / `console.warn`。
2. **京东一键评价** —— 在京东订单相关页面自动点五星、填评语、提交。
3. **文档视图** —— 在 `*.zhihu.com` 页面把知乎换皮为 POPO 风格浅色技术文档，替换页签标题与 favicon，隐藏品牌与社交操作栏，正文保持可读。
4. **精简图片** —— 仅知乎页面按渲染尺寸折叠大图，处理动态插入与懒加载。

## 目录结构

源码全部位于仓库根目录，**不要**新建 `src/scripts`、`src/pages` 之类的分层目录（v1 曾用过该结构，已废弃）。`src/` 下只保留静态资源。

```
manifest.json   扩展清单，新增文件必须在此登记
background.js   Service Worker：初始化存储、页面加载后重注入、AI 评语的全部网络调用
content.js      Content Script（document_start，<all_urls>）：核心逻辑、京东自动化、本地评语池
zhihu-camouflage.js/css  Content Script（document_start，仅 *.zhihu.com）：文档视图
image-hiding.js/css      Content Script（document_start，*://*.zhihu.com/*）：精简图片
injected.js     MAIN world 注入脚本（web_accessible_resource）
popup.html/js   扩展弹窗 UI
options.html/js 扩展设置页（options_ui）：AI 评语开关 + base_url / api_key / model + 连通性验证
src/assets/     图标等静态资源（`doc-icon.svg` 为文档视图的 favicon）
openspec/       规格驱动变更工作流（见下）
```

## 关键架构约束

### 双 world 的 console 劫持

这是本项目最容易改错的地方：

- `content.js` 运行在 **isolated world**。它里面的 `window.console` 是隔离世界的副本，改写它**不会影响页面自身脚本的日志输出**。
- 真正生效的路径是：`content.js` 用 `<script src=chrome.runtime.getURL('injected.js')>` 把 `injected.js` 插入 **MAIN world**，由它改写真正的 `window.console`。
- 两个 world 之间不能直接调用函数，只能通过 `CustomEvent('TOGGLE_CONSOLE_METHOD', { detail: { method, disable } })` 在 `document` 上通信。

因此：**新增任何需要作用于页面上下文的逻辑，都必须走 `injected.js` + 自定义事件**，写在 `content.js` 里不会生效。

`background.js` 中 `chrome.scripting.executeScript({ files: ['injected.js'] })` 未指定 `world`，默认是 `ISOLATED`，实际不产生页面级效果；给页面发 `tabs.sendMessage` 也只是让 `content.js` 在隔离世界重复改写。改动这一块时留意，不要误以为它承担了 MAIN world 的职责。

### AI 评语的网络与密钥只在扩展内部

这是引入 AI 评语后第二处容易改错的地方：

- `content.js` 的 `fetch` 按**页面 origin** 走 CORS，第三方端点不会为 `jd.com` 发 CORS 头，这条路根本走不通。SW 有 `host_permissions`，不受 CORS 约束。
- 因此**所有网络调用都写在 `background.js`**，`content.js` 只发一条 `generateReviews` 消息、拿结果。
- **`api_key` 绝不进入页面上下文**：`content.js` 与 `injected.js` 全文不得出现 `aiApiKey`，出现即为回归。密钥的两处合法持有者是 `options.js`（用户在这一页输入、显示与保存它）和 `background.js`（唯一用它发请求的地方）。
- `content.js` 会自己读 `aiReviewDisabled` 决定是否发消息——这样 AI 关闭时整条路径与变更前时序一致，不产生任何跨进程往返。

若以后有人把生成逻辑挪进 `content.js`，上面的 CORS 与密钥两条约束会同时被破坏。

**`<all_urls>` 身兼两职**：它既是内容脚本的匹配范围，又是 AI 请求的通行证。将来若有人收窄这个权限，AI 会**静默失效**——降级到词池、不报错、不弹窗，极难发现。改动 `host_permissions` 时把这条一并考虑。

密钥以**明文**存于 `chrome.storage.local`，扩展内任何代码都能读到。缓解手段只有"读取面收窄"这一条，别再扩大它。

### 知乎伪装：文档视图与精简图片

这是第三处容易改错的地方：

- 两个功能各自一个 content script，**不要**把它们合并进 `content.js`：两者都只匹配 `*://*.zhihu.com/*`。都用 IIFE 包裹，避免与 `content.js` 的顶层变量在同一 isolated world 里命名冲突。
- 样式全部写成 `manifest.json` 的 `content_scripts[].css`，由浏览器在 `document_start` 注入；选择器以 `html[data-crx-zhihu-camo]` / `html[data-crx-hide-large-images]` 开头，content script 只负责加/删这个属性。**不要**改成 content script 插入 `<style>`：那可能被页面 CSP 拦截，时序也更晚。
- 开关状态同步走 `chrome.storage.onChanged`，popup 只写存储，**不发 `tabs.sendMessage`**。这样才能同时作用于所有已打开的同类标签页。
- 两个新键用正向语义（`zhihuCamouflageEnabled` / `hideLargeImagesEnabled`，`true` = 开启），与现有 `*Disabled` 约定相反；这是有意为之，界面勾选就是开启，避免双重否定。
- 文档视图只做非破坏性改动：CSS `display: none` 隐藏品牌/社交元素，content script 只插入自己的 `.crx-camo-*` 外壳，**不删除、不替换知乎正文节点**。选择器失效时最坏退化为「原页 + 假标题」，不能白屏。
- 真实登录态 DOM 的关键类名（来自用户保存的 MHTML）：`.WriteArea` 是提问/写想法编辑器，`.CornerButtons` 是右下角浮动按钮，`.ContentItem-actions` 是作者操作栏，`.RichContent-cover` 是信息流封面，热评卡在 `.RichContent--hasHotComment` 下且使用哈希类名。**`.ContentItem-more` 是正文的「阅读全文」按钮，不是操作栏的「更多」，不能隐藏**——这是实页反馈里踩过的坑。首页右侧栏用 `.Topstory-container > :not(.Topstory-mainColumn)` 做结构兜底。
- 作者名悬浮名片：给 `.AuthorInfo` 及其后代设 `pointer-events: none`，并隐藏 `.Popover` / `UserHoverCard` / `[class*='HoverCard']`。热评卡与评论区整体隐藏：`.Comments` / `.CommentList` / `.CommentItem` / `.CommentItemV2`，以及热评卡——真实 DOM 里它是 `.ContentItem` 下、`.RichContent` 的兄弟节点，用 `.ContentItem > div[tabindex='0']:has(a[href*='/people/'] img)` 识别，同时保留 `.RichContent--hasHotComment` 内的同类结构兜底。刷新时的白色骨架屏由 `.skeleton` / `[class*='skeleton']` 与 `.Card:has(.skeleton)` 隐藏。
- 长正文内嵌架构图：对展开且正文长度 ≥ 1200 字符的 `.RichContent` / `.Post-RichText` / `.RichText`，在前半段随机选块级子元素后插入同一份 SVG，整页最多一份；首次未找到候选时最多重试 3 次（间隔 1.5 秒），点击 `.ContentItem-more` 展开后延迟插入，关闭或导航时移除。实现集中在 `zhihu-camouflage.js` 的 `insertInlineDiagram()` / `insertCardDiagrams()` / `removeDiagrams()`。
- 列表卡片内部的架构图：从正文向上找最外层卡片 `.TopstoryItem` → `.Feed` → `.List-item` → `.ContentItem`，正文 ≥ 200 字符时在 `.ContentItem-actions` 前（或卡片末尾）插一份 `.crx-camo-card-diagram`。**不要往卡片之间插兄弟节点**：首页是 React 瀑布流/虚拟列表，新增列表项会改变测量与协调。同一张卡片已有内嵌图则跳过，内嵌图插入时会移除卡片底图。滚动以 300ms 去抖补插新卡片。两种图分别用 `data-crx-inline-diagram` / `data-crx-card-diagram` 标记，关闭或导航时一起清理。
- 标题排版：`.QuestionHeader-title` / `.Post-Title` / `.ContentItem-title` 与正文统一 `font-size: var(--crx-body-size)`（15px）、`line-height: 1.85`，只靠 `font-weight: 650` 区分层级；标题前不显示序号/章节标签。
- 卡片边框：`.ContentItem` / `.List-item` / `.Feed` / `.TopstoryItem` / `.QuestionHeader` / `.AnswerItem` / `.Post-Main` / `.CommentItem` / `.Card` 统一 `border: 0`、透明背景、无阴影，但**不要清空页面原有的 `margin` / `padding`**；`.Topstory-mainColumn` / `.Topstory-mainColumnCard` / `.Topstory-content` / `#TopstoryContent` 这些外层容器也统一 `box-shadow: none`、`border: 0`。卡片之间的分隔线不显示，原有上下间距保留。架构图去掉虚线边框，但保留自身上下 margin/padding。
- 视频隐藏：CSS 隐藏 `video` / `[class*='Video']` / `[aria-label*='视频']`，并隐藏正文里承载视频或 iframe 的顶层媒体块；`hideVideoPlayers()` 从 `video` 向上找第一个 ≥240×135 的容器加 `.crx-camo-hide-video`，但遇到 `.RichContent` / `.Post-RichText` / `.RichText` 必须停止，避免把正文容器当播放器隐藏；视频 `load` 捕获时补一次，关闭时移除类。**不要用 `:has(> video)` / `:has(> * > video)` 祖先选择器**，视频块作为 `.RichContent` 直接子节点时会把整个正文容器隐藏。
- 大图隐藏的正文媒体块：`.RichContent` / `.Post-RichText` / `.RichText` 的直接子块包含 `img[data-crx-large-image]` 时整块 `display:none`，避免图片折叠后留下固定高度的空占位。
- 伪文档页眉的面包屑与架构图参考内部 POPO 文档「Agent 行为指标监控体系」：面包屑为「团队空间 / 出海项目组 / Agent 行为指标监控体系」，架构图为「对话 Agent 服务 → Langfuse → 运营后台服务 → OceanBase → 查询接口 → Agent 指标页」。
- 左侧团队空间侧边栏 `.crx-camo-toc` 由 `createToc()` / `createTocTree()` / `tocIcon()` 生成：浅色 POPO 风格，面包屑、出海项目组、搜索、首页、目录树与底部操作，`TOC_TREE` 中「Agent 行为指标监控体系」为 active。固定左栏 260px、top 44px；正文用 `margin-left: max(300px, calc((100vw - 1080px) / 2))` 右移；视口 ≤1439px 时隐藏侧栏并把 margin-left 重置为 auto。侧栏可滚动但隐藏滚动条，纯展示，随 `data-crx-camo-shell` 一起清理。
- 标题只改写页面已有的 `<title>`，不新建标题节点；favicon 保存原有 `link[rel~="icon"]` 的 href/type 再替换为扩展图标。两者都要用 MutationObserver 持续接管知乎 react-helmet 的重写，关闭时恢复页面最近一次写入的值。
- 精简图片按 `getBoundingClientRect()` 的 `width >= 400` 或 `height >= 300` 判定，只处理 `<img>`；不处理 CSS 背景图、iframe 内图片与 `<video>` 封面。隐藏方式是为 `<img>` 打 `data-crx-large-image`，CSS 折叠，**不改 `src` / `srcset`、不删节点**。
- 大图扫描用 `MutationObserver` + 图片 `load` 捕获 + 单个 `ResizeObserver` + `requestAnimationFrame` 去抖；任何单张图片或单次扫描失败都必须吞掉，不能产生未捕获异常。
- 已知限制：地址栏、链接悬停状态栏、右键菜单里的 `zhihu.com` 改不了；正文文字本身仍可能暴露来源；扩展重载前已打开的标签页没有新 content script，需要刷新后才生效。

### 通信协议

`content.js` 的 `onMessage` 监听器是新增交互的唯一入口，`sendResponse` 依赖 `return true`（已保留，勿删）。

| 方向                 | action                | 载荷                                                               |
| -------------------- | --------------------- | ------------------------------------------------------------------ |
| popup → content      | `toggleConsoleMethod` | `{ method: 'log'\|'info'\|'warn', disable: boolean }`              |
| popup → content      | `jdEvaluate`          | 无                                                                 |
| options → background | `verifyAiConfig`      | `{ config: { baseUrl, apiKey, model } }`（表单当前值，非已保存值） |
| content → background | `generateReviews`     | `{ count: number }`（配置由 SW 自己从存储读）                      |

自定义事件：`TOGGLE_CONSOLE_METHOD`（content → injected）。

**文档视图与精简图片不在上表内**：它们不走消息通道，popup 写 `chrome.storage.local`，两个 content script 监听 `chrome.storage.onChanged` 自行应用。新增知乎伪装类开关时沿用这条路径，不要复制 console 的 popup → 当前标签页消息模式。

`background.js` 的 `onMessage` 对不认识的 action 返回 `false`，别改成无条件 `return true`——那会让 SW 一直占着消息通道。

`generateReviews` 的任何失败路径都 **resolve 成 `{ ok: false, reason }`，绝不 reject**。`content.js` 那条链路上还有京东的 DOM 自动化，简单优先：调用方只判断 `ok`，不写 try/catch。

### 京东评价页的 URL 判定（两处必须同步）

`jdEvaluate` 只在评价相关页面有意义，因此 **同一个 URL 模式清单存在于两个文件**，改动时必须一起改：

| 文件         | 位置                                      | 作用                                            |
| ------------ | ----------------------------------------- | ----------------------------------------------- |
| `content.js` | `window.onload` 里的 `href.includes` 分支 | 决定页面加载后自动执行哪个评价流程              |
| `popup.js`   | `JD_EVALUATE_PAGES` 常量                  | 决定 popup 里「京东商品一键评价」按钮是否可点击 |

当前三个模式：`myJdcomments/myJdcomment`、`orderVoucher`、`saveCommentSuccess`。

按钮的启用状态由 `chrome.tabs.query` 读到的 `tab.url` 决定。`manifest.json` 的 `host_permissions: ["<all_urls>"]` 已足以读取 `tab.url`，无需追加 `tabs` 权限；在 `chrome://`、扩展页、应用商店等 host 权限不覆盖的页面 `tab.url` 为空，按钮自动禁用，这是预期行为。

### 存储键

统一为 `console<Method>Disabled`，即 `consolelogDisabled` / `consoleinfoDisabled` / `consolewarnDisabled`，存放于 `chrome.storage.local`。

注意 `log` / `info` / `warn` 是小写拼接（`consolelogDisabled` 而非 `consoleLogDisabled`），改名需同步 `background.js`、`content.js`、`popup.js` 三处。

AI 评语另有四个键：

| 键                 | 说明                                             |
| ------------------ | ------------------------------------------------ |
| `aiReviewDisabled` | 对齐 `console*Disabled` 的命名法，勾选 = 关闭 AI |
| `aiBaseUrl`        | 设置页：OpenAI 兼容端点                          |
| `aiApiKey`         | 设置页：密钥（明文存放）                         |
| `aiModel`          | 设置页：模型标识                                 |
| `aiVerifiedOk`     | 最近一次验证是否通过，仅供弹窗状态圈判断         |

其中 `aiBaseUrl` / `aiApiKey` / `aiModel` **刻意不写进 `background.js` 的 `onInstalled` 初始化**。`onInstalled` 在扩展更新时也会触发，把用户填的配置一并重置成空等于每次更新都清掉密钥；未设置的键读出来是 `undefined`，本身就是正确的默认值。

`aiReviewDisabled` 的**存储语义与其他 `*Disabled` 键一致（`true` = 关闭）**，但设置页上的总开关按正向表达（勾选 = 启用），两者互为取反，换算只发生在 `options.js` 里。`content.js` 只认存储语义，不关心界面怎么写。

知乎伪装另有两个键，**刻意使用正向语义**（`true` = 开启），与 `*Disabled` 约定不同：

| 键                       | 说明                                  |
| ------------------------ | ------------------------------------- |
| `zhihuCamouflageEnabled` | 文档视图开关，仅对 `*.zhihu.com` 生效 |
| `hideLargeImagesEnabled` | 精简图片开关，仅知乎生效              |

这两个键**不写进 `background.js` 的 `onInstalled` 初始化**：未设置读出来是 `undefined`，按关闭处理即可；写进初始化会在扩展更新时重置用户偏好。popup 的勾选状态与存储值同向，不需要取反。

### 需要两处同步的常量

项目没有 ESM，跨文件共享常量只能靠约定。改这些值时两处一起改：

| 常量                 | 位置                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| JD 页面 URL 模式清单 | `content.js` 的 `window.onload` 分支 + `popup.js` 的 `JD_EVALUATE_PAGES`    |
| `REVIEW_MAX_LENGTH`  | `background.js`（剔除超长行）+ `content.js`（写入前校验）                   |
| 大图判定阈值 400×300 | `image-hiding.js` 的 `MIN_WIDTH` / `MIN_HEIGHT` + `large-image-hiding` 规格 |

### 支持的 console 方法

目前仅 `log`、`info`、`warn`。新增方法（如 `error`、`debug`）要同时改：`background.js` 的 `methods` 数组、`content.js` 的 `originalConsoleMethods`、`injected.js` 的 `_originalConsoleMethods`、`popup.html` 的开关节点 + `popup.js` 的 `methods` 数组。

## 编码约定

- 纯 ESM 之外的浏览器脚本，**不使用** import/export，文件间通过 `chrome.*` API 与 DOM 事件协作。
- 遵循 Prettier（`.prettierrc`）：`printWidth: 170`、`tabWidth: 2`、单引号、无分号结尾风格由 Prettier 决定、`arrowParens: 'avoid'`。
- 提交前执行 `npx prettier --write .`。
- 注释与 UI 文案使用中文，与现有代码保持一致。
- 京东自动化部分为 DOM 选择器驱动，脆弱且依赖站点结构；修改时请集中在该区块内，并保持 `sleep()` 等待节奏，不要引入全局副作用。

### popup 的 DOM 契约

`popup.js` 靠固定 id 取节点：`#logToggle` / `#infoToggle` / `#warnToggle`、`#docViewToggle` / `#imageHideToggle`、`#logStatus` / `#infoStatus` / `#warnStatus` / `#docViewStatus` / `#imageHideStatus`、`#jdBtn`。改 `popup.html` 结构时这些 id 必须保留。

其中五个 `*Status` 是 `sr-only` 隐藏元素（视觉状态改由行本身的信号条与开关表达），但 `popup.js` 仍在往它们写 `textContent`——**删掉节点会抛错**，只能连同 `updateStatusText()` 与知乎伪装的状态更新一起改。

**popup 分三块：「控制台日志」「知乎伪装」「京东订单」，不放任何 AI 操作入口。** 弹窗是高频、临时的操作面，AI 配置是一次性动作，混在一起两边都变重。AI 的开关与端点配置都在设置页，不要为了"方便"把它们加回弹窗。

「知乎伪装」组的两行使用 `.option` 而不是 `.channel`：console 的 `checked` 表示「静音」，所以选中时名称划掉、信号条转灰；知乎伪装的 `checked` 表示「启用」，选中时信号条与开关亮起、名称不划掉。**不要把两组的状态语义混用**，否则「文档视图开启」会被画成「已禁用」。该组的可见文案是「文档视图」「精简图片」「悬停可查看每项说明」，详细含义放在 `title` 悬停提示与 `aria-label` 里。

popup 里唯一与 AI 有关的是**只读状态圈** `#aiBadge`——京东按钮内、按钮文字之前，圈内只有「AI」二字，**没有文案**，含义全在边框颜色上：

| 展示                              | 条件                              |
| --------------------------------- | --------------------------------- |
| `hidden`                          | AI 开关关着，或三项配置一项都没填 |
| `data-state="unverified"`（黄框） | 有配置，但最近一次验证没通过      |
| `data-state="ready"`（绿框）      | 三项全填且最近一次验证通过        |

约束：

- **不是可点的东西**：它是 `<span>` 而非 `button`/`a`，圈内不得出现别的文案节点。按钮文字前**也没有**第二个装饰圆点（曾经有个京东红的 `.dot`，加状态圈时一并删掉了，别再加回去）。
- **`popup.js` 对 AI 相关存储只读不写**；`chrome.storage.local.set` 只用于 console 三档开关、`zhihuCamouflageEnabled` 与 `hideLargeImagesEnabled`。
- **绿色要同时满足"配置完整 + 验证通过"**，只认 `aiVerifiedOk` 会在标记过期时谎称可用。
- `.ai-badge` 用了 `display: flex`，因此**必须保留 `.ai-badge[hidden] { display: none }`**——类选择器会盖掉 UA 样式表里的 `[hidden]`，漏了这行圈就永远不消失。

`aiVerifiedOk` 由 `options.js` 维护：验证后写入本次结论（两步都过才是 `true`），配置改动并保存时作废为 `false`。**原样重存不作废**，否则"点一下保存"就会把已验证的绿圈冤枉成黄色。

`popup.html` 还用到较新的 CSS：`:has()`、`color-mix()`。扩展环境无所谓，但要搬到别处前先查兼容性。

### options 页的 DOM 契约

`options.js` 靠固定 id 取节点：`#aiToggle` / `#aiStatus`、`#baseUrl` / `#apiKey` / `#apiKeyReveal` / `#model` / `#save` / `#verify` / `#result`，另有 `<datalist id="modelList">` 供验证成功后回填模型列表。

`#aiConfig` 是包住「端点配置」与「验证结果」两块的容器，**只在总开关开启时展示**（`hidden` 切换）。注意别给 `#aiConfig` 写 `display` 样式，否则 `hidden` 会失效。

**总开关只写 `aiReviewDisabled` 一个键。** 收起配置区、重新展开都必须只是显隐，绝不能在关闭时"顺手清理"已保存的 `aiBaseUrl` / `aiApiKey` / `aiModel`——用户关掉 AI 只是暂时不用，配置与上一次的验证结论都要留着。这条在 spec 里有对应要求（`ai-connection-settings` 的「配置区的显隐」）。

设置页上有**两套保存语义**，改动时别混淆：

| 区域                   | 语义                                         |
| ---------------------- | -------------------------------------------- |
| `#aiToggle` 总开关     | **改完即存**，与 popup 上的 console 开关一致 |
| 三个配置输入 + `#save` | **显式保存**，未保存的修改不影响评价流程     |

总开关之所以不等 `#save`：开关拨完还要记得按保存太反直觉，也容易让人以为已经关掉了。

`options.js` 一律用 `textContent` 建节点，**不要改成 `innerHTML`**：`#result` 里要渲染端点返回的原始错误体，那是不可信输入。

`options.js` 必须用 `<script src>` 引入（MV3 的 CSP 禁止内联脚本），且脚本放在 `</body>` 前——它依赖 `DOMContentLoaded` 被执行前完成注册。

设置页入口由 Chrome 原生提供（扩展详情页的「扩展程序选项」、工具栏图标的右键菜单「选项」），`options_ui.open_in_tab: true` 让它在新标签页打开。**不需要也不要在别处再造一个入口按钮。**

## 已知遗留问题

- `content.js` 中 `changeRuleId()` 向 `window.location.quer` 赋值，该属性不存在且调用点已注释，属死代码。
- `content.js` 直接覆盖 `window.onload`，若同 world 有其他脚本设置该属性会被覆盖。
- `manifest.json` 的 `webNavigation` 与 `scripting` 权限仅为重注入路径服务，若简化该路径可一并回收。
- `popup.js` 的 `JD_EVALUATE_PAGES` 有收窄余地：按钮点击永远只发送 `jdEvaluate`，即「点五星 + 填评语 + 提交」的表单流程，只有 `orderVoucher` 类页面有对应 DOM。另外两个模式（`myJdcomments/myJdcomment`、`saveCommentSuccess`）下按钮是亮的但点了没反应；若要「亮着就一定能用」，应连同 `content.js` 的对应分支一起收窄成 `orderVoucher`。
- `background.js` 的 `AI_TIMEOUT_MS`（8s）与请求体里的 `reasoning_effort: 'low'` 都还没在真实端点上实测过延迟与文案质量，属可调常量。
- 评语生成路径**刻意不做重试、不做多模型兜底**（失败即降级词池）。因此端点若以 400 拒绝 `reasoning_effort`，生成会整批降级到词池；只有设置页的「验证」会移除该字段重试一次并提示用户——那里是诊断，不是自动路径。
- 文档视图的知乎选择器是站点结构驱动的，知乎改版后可能漏隐藏某个品牌元素；CSS 只做非破坏性隐藏，最坏退化为「原页 + 假标题 + 新配色」，不会白屏。选择器集中在 `zhihu-camouflage.css` 的品牌/社交区块与 `zhihu-camouflage.js` 的伪标题/favicon 逻辑中，改版后集中修补。
- 文档视图**无法伪装**地址栏域名、链接悬停状态栏、右键菜单与 DevTools 网络面板；正文文字本身也可能暴露来源。这是产品边界，不是实现缺陷。
- 精简图片只处理 `<img>`，不处理 CSS 背景图、iframe 内图片与 `<video>` 封面；若阈值隐藏了二维码/验证码等功能图片，关闭开关即可恢复。
- 扩展重载前已打开的标签页没有新的 content script，切换开关不会即时生效，刷新后生效。

## 变更工作流（OpenSpec）

仓库启用 spec-driven 工作流，CLI 为 `openspec`（全局安装）。

- `openspec/specs/` 为能力主规格，`openspec/changes/` 为进行中的变更，完成后归档至 `openspec/changes/archive/`。
- 对应技能：`openspec-explore`（探索，只读）、`openspec-propose`（产出 proposal/spec/design/tasks）、`openspec-apply-change`（实施）、`openspec-archive-change`（归档）。
- `.agents/skills/.openspec-target` 指定目标代理为 `codex`；`.claude/` 下有等价副本。
- 非平凡改动应先走 propose 生成变更制品，不要直接改源码。

## 验证方式

项目**没有测试、没有 lint、没有 CI、也没有构建步骤**（源码即产物，`package.json` 只为 prettier 而存在）。改动后按以下方式手工验证：

1. `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」选仓库根目录 → 改动后点「重新加载」。
2. 打开任意页面，在 DevTools Console 执行 `console.log(1)`；popup 中关闭 `log` 后应无输出。
3. 京东功能需在真实订单评价页验证，注意其选择器随时可能失效。
4. 调试 Service Worker 在 `chrome://extensions` 的「Service Worker」链接中查看，popup 可右键「审查弹出内容」。
5. AI 评语：扩展详情页的「扩展程序选项」打开设置页 → 填 base_url / api_key / model → 点「验证」，两步都应是「通过」。想验证降级路径，把 base_url 改成 `http://127.0.0.1:1`（必然不可达）后跑一次一键评价：流程应照常走完、不弹任何错，评语来自本地词池。
6. 在设置页关掉「启用 AI 评语」后重跑一次一键评价，可确认「不发起外部请求」这条：行为与第 5 条的降级路径一致，但不会有 8s 超时窗口。
7. 文档视图：popup 打开「文档视图」→ 在登录状态依次访问知乎首页、问题页、专栏页、搜索页、个人主页，确认顶栏/侧栏/操作栏/头像徽章/热评卡与评论区隐藏、正文可读、页签标题与 favicon 不是知乎原样；在站内跳转几次确认标题仍被接管；关闭开关确认标题、图标、配色与元素无需刷新即恢复。
8. 精简图片：在包含大小图混合的页面打开「精简图片」，确认渲染宽度 ≥400px 或高度 ≥300px 的 `<img>` 被折叠、头像/图标/小图保留；滚动触发懒加载与动态插入后新大图也被隐藏；调整窗口大小后按新尺寸重新判定；关闭开关确认全部恢复。
9. 交叉回归：两个开关的 4 种组合都可独立工作；console 三档开关、京东一键评价（含 AI 成功与降级）、AI 设置页验证不受影响。

## 本地环境坑

### Chrome 忽略 `--load-extension`，命令行加载扩展这条路不通

Chrome 137 起该开关受特性门控，实测本机 `154.0.8037.98`：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir=/tmp/xxx --load-extension=/path/to/extension \
  --remote-debugging-port=9333
```

CDP 能起来，但 profile 里 `extensions.settings` 注册扩展数为 **0**——开关被完全忽略。补 `--disable-features=DisableLoadExtensionCommandLineSwitch` 也无效（已试过）。

**加载扩展只能走 `chrome://extensions` 的手动流程**，别指望命令行走通。

### 解压扩展的 ID 与安装路径绑定

以「加载已解压的扩展程序」方式安装时，扩展 ID 由**绝对路径的 SHA-256** 推出（当前 `manifest.json` 没有 `key` 字段）。目录一改名，Chrome 会当成全新扩展：旧条目失效，旧 ID 名下的 `chrome.storage.local` 变成孤儿。

因此**改仓库目录名会让控制台三个开关与知乎伪装两个开关的保存状态重置**，这是预期行为，不是 bug。要避免就得在 `manifest.json` 里加 `key` 固定 ID。
