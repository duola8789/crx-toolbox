## Context

- 扩展是 Manifest V3、无框架、无构建、无测试的纯 JavaScript 项目，源码全部在仓库根目录。
- `content.js` 以 `<all_urls>` + `document_start` 运行在 isolated world；DOM 与 CSS 改动对页面生效，只有 console 劫持需要 `injected.js` 进 MAIN world。本次两个功能都只改 DOM/CSS，不需要 MAIN world。
- 现有 console 开关的同步方式是「popup 发消息给当前标签页 + background 在 `webNavigation` 后重注入」。新开关是全局持久偏好，需要同时作用于所有已打开标签页，因此不复用这条链路。
- popup 当前的 DOM 契约是「控制台日志 + 京东订单」两块；本次要新增第三块，属于对既有约定的有意扩展，需要同步改 AGENTS.md 与 README。
- 知乎页面由 React 渲染，`<title>` 与 favicon 链接带 `data-rh`，会被路由切换反复重写；类名是稳定语义名与构建哈希名混用。
- 项目没有测试、lint、CI；所有验证靠 `chrome://extensions` 重载后的手工走查。

## Goals / Non-Goals

**Goals:**

- 两个开关独立、全局持久、默认关闭，切换后无需刷新即可作用于所有已打开标签页。
- 文档视图覆盖全部 `*.zhihu.com` 页面，保留正文可读性，并在选择器失效时优雅退化。
- 大图隐藏覆盖知乎页面，正确处理动态插入、懒加载与窗口尺寸变化；非知乎页面不受影响。
- 不新增权限、不发起网络请求、不进入 MAIN world、不引入构建步骤。

**Non-Goals:**

- 不改变地址栏、链接悬停状态栏、右键菜单与 DevTools 网络面板中的域名。
- 不修改知乎正文文本，不删除正文或评论节点。
- 不处理 CSS 背景图、iframe 内图片、`<video>` 封面。
- 不提供主题切换、阈值调节、快捷键或整页遮罩模式。
- 不重构现有 console、京东评价与 AI 评语链路。

## Decisions

### D1. 存储键用正向语义

新增 `zhihuCamouflageEnabled` 与 `hideLargeImagesEnabled`，布尔值，未设置等同 `false`。不写入 `background.js` 的 `onInstalled` 初始化。

- 理由：界面上的勾选语义是「开启」，用 `*Disabled` 会形成双重否定；不初始化可以避免扩展更新时重置用户偏好，与 `aiBaseUrl` / `aiApiKey` 的处理一致。
- 备选：沿用 `console*Disabled` 的 `*Disabled` 命名。已否决：新功能的界面是正向开关，键名与界面语义一致更不容易出错。
- 代价：与现有 `*Disabled` 约定不一致，需要在 AGENTS.md 的存储键章节明确记录例外。

### D2. 状态同步走 `chrome.storage.onChanged`

两个新 content script 在启动时读取存储，并监听 `chrome.storage.onChanged`；popup 只写存储，不发送 `tabs.sendMessage`。

- 理由：开关是全局偏好，应同时影响所有已打开的同类标签页；存储是唯一事实来源，省掉 popup → 当前 tab 的消息链路和 background 重注入。
- 备选：复用 console 的 popup → content 消息。已否决：只能作用于当前标签页，且需要为多标签同步另写逻辑。
- 代价：content script 首次读取存储是异步的，页面可能在极短时间内显示原始外观；需要在真实页面上实测闪动是否可感知。

### D3. 样式用 manifest 注入的 CSS，按 DOM 属性开关

新增两个 CSS 文件，通过 `manifest.json` 的 `content_scripts[].css` 注入：

- `zhihu-camouflage.css`：匹配 `*://*.zhihu.com/*`，全部选择器以 `html[data-crx-zhihu-camo]` 开头。
- `image-hiding.css`：匹配 `*://*.zhihu.com/*`，规则以 `html[data-crx-hide-large-images]` 开头。

content script 在存储读取完成后给 `<html>` 设置对应属性；关闭时移除属性，样式立即失效。

- 理由：manifest 注入的 CSS 由浏览器在 `document_start` 应用，不依赖页面 CSP，也不受页面样式加载顺序影响；属性门控保证关闭时零副作用。
- 备选一：content script 插入 `<style>`。已否决：可能被知乎页面的 CSP `style-src` 拦截，且时序不如 manifest CSS 早。
- 备选二：`chrome.scripting.insertCSS`。已否决：需要 background 协调，注入时机晚于 `document_start`，且多标签切换状态更复杂。
- 约定：CSS 选择器统一加 `crx-` 前缀，关键声明加 `!important`，避免与知乎样式和后续扩展样式冲突。

### D4. 文档视图用「属性门控 + 非破坏性 DOM 外壳」

- 给 `<html>` 设置 `data-crx-zhihu-camo`，CSS 负责隐藏知乎品牌/社交元素、覆盖配色与版面。
- content script 只在 `document.body` 上插入一个带 `crx-` 前缀的外壳：伪页眉、伪页脚、伪「系统架构」SVG 区块。不替换、不删除知乎节点。
- 外壳插入具备幂等保护（例如检查已存在节点），避免 SPA 路由或重复初始化导致叠加。
- 备选：整页全屏遮罩。已否决：用户明确要求保留正文可读。
- 备选：用 Shadow DOM 隔离外壳样式。已否决：manifest CSS 无法进入 shadow root，而 shadow root 内联 `<style>` 又受页面 CSP 影响；前缀类名 + `!important` 足够隔离。
- 备选：直接修改知乎 DOM 结构。已否决：破坏性与恢复成本都高，且更容易随改版失效。

### D5. 页签标题：内容解耦 + 持续接管

- 维护一组通用技术文档标题（不包含「知乎」、问题标题或回答内容），按 URL 的稳定哈希选取；同一 URL 永远得到同一标题。
- 用 `MutationObserver` 观察 `<head>` 的标题变化；用「正在写入」标志区分扩展自己的写入与页面写入，页面写入时记录 `lastPageTitle` 后重新覆盖为伪标题。
- 关闭时停止观察并恢复 `lastPageTitle`。
- 备选：把问题标题包装成「设计文档 · <问题标题>」。已否决：问题标题本身就会泄密。
- 备选：从 background 调 `chrome.tabs.update` 改标题。已否决：需要按 tab 维护状态，且 SPA 内路由变化仍要回到 content script。

### D6. favicon：替换为扩展内置图标并接管 `<head>`

- 新增中性文档图标 `src/assets/doc-icon.svg`，加入 `web_accessible_resources`，匹配范围限制为 `*://*.zhihu.com/*`。
- 开启时保存页面原有 icon 链接，替换为指向扩展图标的 `rel="icon"`；观察 `<head>`，页面重新写回知乎图标时再次替换。
- 关闭时移除扩展图标并恢复保存的原链接。
- 备选：data URL 内联 SVG。已否决：可维护性差，且部分场景会被 CSP 或缓存策略干扰。
- 备选：canvas 动态生成图标。已否决：无必要，增加复杂度。

### D7. 知乎品牌元素的隐藏策略

- 以「稳定的语义类名 + 容器级结构规则」为主，不依赖构建哈希类名；所有选择器集中在 `zhihu-camouflage.css` 的一个区块内，并加注释说明对应页面类型。
- 只做 `display: none !important`，不删除节点；选择器失效的最坏结果是该元素仍然可见，页面其余部分正常。
- 作者操作栏整条隐藏（赞同/反对、评论、收藏、喜欢、分享、更多、收起）；头像与徽章隐藏；作者名保留并弱化为署名文本。
- 不隐藏问题标题、正文、评论内容与话题标签。
- 实现阶段需要在登录状态的知乎首页、问题页、专栏页、搜索页、个人主页上实际取样，补齐每类页面的选择器；这是实现任务，不改变本设计的结构。

### D8. POPO 浅色文档视觉

- 采用 POPO 文档的浅色调色板：`#ffffff` 背景、`#f7f8fa` 面板、`#f2f3f5` 次级面板、`#e5e6eb` 分隔线、`#1f2329` 正文、`#646a73` 弱化文字、`#3370ff` 强调色。
- 正文限制为单一列（约 1080px），提升行高；问题标题使用正文色，标题前不显示序号，标题字号与正文一致（15px），仅通过字重区分；页眉页脚使用浅色背景与分隔线。左侧团队空间侧边栏同样使用浅色 POPO 配色，与白色正文组成文档工作台。
- 信息流卡片只去掉边框，保留原有间距：`.ContentItem` / `.List-item` / `.Feed` / `.TopstoryItem` / `.QuestionHeader` / `.AnswerItem` / `.Post-Main` / `.CommentItem` / `.Card` 统一 `border: 0`、透明背景、无阴影，但不清空页面原有的 `margin` / `padding`；卡片之间的分隔线不显示，原有上下间距保留。`.Topstory-mainColumn` / `.Topstory-mainColumnCard` / `.Topstory-content` / `#TopstoryContent` 这些外层容器也统一 `box-shadow: none`、`border: 0`。架构图去掉虚线边框，但保留自身上下 margin/padding。
- 不对外层 `body` 使用 `filter: grayscale()`：它会创建新的包含块、影响 fixed 定位并带来额外合成开销。
- 备选：深色技术文档主题。曾实现并验证；用户要求整体改为 POPO 浅色，因此当前默认是浅色。深色主题可作为后续可选主题，不在本次范围。
- 备选：把知乎切到 `data-theme="dark"` 再少量覆盖。已否决：仍会保留知乎的品牌色与大量社区组件样式，且可能与页面自身的主题逻辑冲突。

### D9. 大图判定与扫描

- 判定标准：`getBoundingClientRect()` 的 `width >= 400` 或 `height >= 300`。
- 扫描时机：初始加载、`MutationObserver`（childList/subtree）后的 `requestAnimationFrame` 去抖扫描、图片 `load` 事件（capture）、`window resize`。
- 处理方式：给命中的 `<img>` 加 `data-crx-large-image`，由 `image-hiding.css` 执行 `display: none !important`；不删除节点、不改 `src/srcset`。
- 关闭时移除 `<html>` 门控属性与所有标记，图片立即恢复。
- 排除 PDF/HTML 阅读器的页面背景图：`img.bi` 与 `[class*="2html-viewer"]` / `[class*="2htmlEX"]` 内的图片不参与判定；之前误标的会撤销，避免 PDF 课程页面整页空白。
- 正文顶层媒体块：`.RichContent` / `.Post-RichText` / `.RichText` 的直接子块若包含被标记的大图，整块 `display:none`，避免图片折叠后留下固定高度的空占位。
- 备选：按 `width`/`height` HTML 属性或 `naturalWidth/naturalHeight` 判定。已否决：不能反映 CSS 缩放后的真实观感。
- 备选：为每张图建立 `ResizeObserver`。已否决：图片数量多时观察器开销大；窗口 resize 加 rAF 扫描已覆盖主要场景。
- 性能：全量 `document.images` 扫描在长信息流上可能昂贵；实现时优先只处理新增节点，并保持 rAF 去抖。

### D10. 文件与 manifest 组织

新增两个独立 content script，而不是继续把逻辑堆进 `content.js`：

- `zhihu-camouflage.js`：只匹配 `*://*.zhihu.com/*`，负责文档视图。
- `image-hiding.js`：匹配 `*://*.zhihu.com/*`，负责大图隐藏。
- 两者都用 IIFE 包裹，避免与 `content.js` 的顶层变量共享 isolated world 作用域时发生命名冲突。

`manifest.json` 的 `content_scripts` 增加两条记录，分别带自己的 CSS；`web_accessible_resources` 增加 `src/assets/doc-icon.svg`。不新增权限。

- 备选：全部写进 `content.js`。已否决：会放大现有文件体积，也把「只在知乎运行」的逻辑带到所有页面。

### D11. popup 的第三个分组

- 新增 `<section class="group">`，标题「知乎伪装」，两条开关行：「文档视图」「精简图片」。
- 不复用 console 的 `.channel` 选中态语义：console 的 checked 表示「静音」，视觉上划掉并转灰；新开关的 checked 表示「启用」，需要一套独立的 `.option` 行样式（选中时强调色亮起、名称不划掉）。可复用 `.switch` / `.track` 的开关外观。
- 新增读屏状态节点 `#docViewStatus` / `#imageHideStatus`，与 console 的 `*Status` 一起放在 `sr-only` 区域。
- `popup.js` 增加读取与写入两个新键；不再只写 console 三档键，AGENTS.md 中对应描述需同步修改。
- 备选：把新开关放进设置页。已否决：这是高频操作，设置页更适合一次性配置。

### D12. 关闭与恢复

- 品牌元素、配色、大图：移除 `<html>` 门控属性或图片标记即可恢复，无需刷新。
- 标题与 favicon：显式恢复保存的原值；若关闭时页面已发生 SPA 导航，恢复的是最近一次由页面写入的标题。
- 若页面在扩展安装/重载前已打开、没有 content script，切换开关不会即时生效，刷新后生效；这是现有扩展的固有限制，在 README 的已知限制里说明。

### D13. 测试与选择器维护

- 没有自动化测试，验收按 AGENTS.md 的手工流程：重载扩展到 `chrome://extensions`，分别走查知乎各类页面、动态信息流、非知乎站点，以及 console/京东/AI 的回归。
- 知乎选择器集中在两个带注释的区块（CSS 与 JS），改版时只需改这两处；不把选择器散落到多处。

### D14. 实页反馈修正（基于用户保存的 MHTML）

用户保存了一份登录态知乎首页的 MHTML，从中取到真实 DOM 后修正了以下选择器与内容：

- 社区编辑器是 `.WriteArea`，整块隐藏；右下角悬浮按钮是 `.CornerButtons`，一并隐藏。
- 作者操作栏是 `.ContentItem-actions`，整条隐藏；但 `.ContentItem-more` 是正文里的「阅读全文」，**不能隐藏**。之前用 `[class*='ContentItem-expand']` 误伤了它，已移除该规则，并把 `.ContentItem-more` 保留为弱化文字按钮。
- 首页右侧栏使用哈希类名，挂在 `.Topstory-container` 的第二个子节点上；用 `.Topstory-container > :not(.Topstory-mainColumn)` 做结构兜底，同时补 `.GlobalSideBar` / `.CreatorEntrance` / `.ProfileSideCreator`。
- 信息流封面是 `.RichContent-cover` / `.RichContent-cover-inner`（常见渲染尺寸仅 190×105，低于大图阈值），文档视图下直接隐藏封面与视频封面；正文内的大图仍交给「精简图片」，并用 `:has(img[data-crx-large-image])` 折叠外层容器，避免留下空白。
- 「收录于」入口用 `a[href*='/collection/']`、`[class*='Collect']` 与 `aria-label/title` 包含「收录」兜底隐藏；「1302 人赞同了该回答」等社区元信息用 `.ContentItem-status` / `.ContentItem-annotation` / `*VoteCount*` 隐藏。
- 评论整体隐藏：`.Comments`、`.CommentList`、`.CommentItem`、`.CommentItemV2`，以及热评卡。热评卡在真实 DOM 里是 `.ContentItem` 下、`.RichContent` 的兄弟节点（不是子节点），用 `.ContentItem > div[tabindex='0']:has(a[href*='/people/'] img)` 识别并隐藏；同时保留 `.RichContent--hasHotComment` 内的同类结构兜底。
- 标题本身的链接（`.ContentItem-title a` 等）改为正文色，避免整屏最亮的元素是问题标题的亮蓝色；标题前不显示序号或章节标签。
- 页眉面包屑与架构图按内部 POPO 文档「Agent 行为指标监控体系」重做：面包屑为「团队空间 / 出海项目组 / Agent 行为指标监控体系」，架构图为「对话 Agent 服务 → Langfuse → 运营后台服务 → OceanBase → 查询接口 → Agent 指标页」的单行流程，边标注 OTel 上报、REST 拉取、幂等落库、查询、展示。
- 作者名悬浮会触发名片弹层：给 `.AuthorInfo` 及其后代设 `pointer-events: none` 阻止触发，并隐藏 `.Popover` / `UserHoverCard` / `[class*='HoverCard']` 等已打开的弹层。
- 新版评论区使用哈希类名，`.RichContent--hasHotComment` 下的热评卡用 `div[tabindex='0']:has(a[href*='/people/'] img)` 结构识别并隐藏，不依赖构建哈希类名。
- 标题前不再显示序号或「02 · 设计说明」章节标签，保持干净的问题/文章标题。
- 刷新时的白色骨架屏：隐藏 `.skeleton` / `[class*='skeleton']`，以及包含骨架屏的 `.Card`（`.Card:has(.skeleton)`），避免数据加载阶段露出一块白色 loading。
- 视频播放器：CSS 隐藏 `video` / `[class*='Video']` / `[aria-label*='视频']`，并隐藏 `.RichContent` / `.Post-RichText` / `.RichText` 下承载视频或 iframe 的顶层媒体块；`hideVideoPlayers()` 从 `video` 向上找第一个 ≥240×135 的容器，加 `.crx-camo-hide-video` 一起折叠，但遇到 `.RichContent` / `.Post-RichText` / `.RichText` 立即停止，避免把正文容器当播放器容器隐藏。视频 `load` 捕获时补一次，关闭文档视图时移除这些类。**不要用 `:has(> video)` / `:has(> * > video)` 这类祖先选择器**：视频块如果是 `.RichContent` 的直接子节点，会把整个 `.RichContent` 连同正文一起隐藏。也不要在 `:has()` 里嵌套 `:has()`（如 `:has(> :has(> video))`）：Chrome 不支持，整条 selector list 会被丢弃。

### D15. 长正文内嵌架构图

- 对已展开、`textContent` 长度不少于 1200 字符、且直接子元素中至少 3 个块级节点的 `.RichContent` / `.Post-RichText` / `.RichText`，随机选一个中间块级节点，在其后插入一份与顶部相同的架构图；整页最多一份。
- 插入位置取「前半段的随机段落」，避免随机落到长文末尾、用户根本看不到；第一次没找到候选时最多重试 3 次（间隔 1.5 秒），覆盖内容晚于调度时间渲染的情况。
- 跳过 `.is-collapsed` 正文；用户点击 `.ContentItem-more`（阅读全文）后延迟 500ms 再尝试插入。
- 插入的节点带 `data-crx-inline-diagram` 标记，关闭文档视图或站内导航时移除；重复调度通过该标记与定时器去抖，避免整页重复插图。
- 复用 `createArchitectureSvg()`，只把章节标签改为「架构示意」；不引入第二份 SVG 代码。

### D16. 列表卡片内部的架构图

- 首页信息流是 React 渲染的瀑布流/虚拟列表：卡片外层是 `.TopstoryItem`，里面才是 `.Feed` / `.ContentItem`；`.ContentItem` 没有相邻兄弟，所以最初按 `.ContentItem` 找下一张卡片的方案根本插不进去。
- **不采用「卡片之间插兄弟节点」**：往 `.Topstory-recommend` 的 `.TopstoryItem` 之间插额外节点会改变列表项数量/顺序，可能破坏瀑布流测量与 React 协调，收益不值得这个风险。
- 改为在卡片**内部底部**插入：从正文向上找最外层卡片 `.TopstoryItem` → `.Feed` → `.List-item` → `.ContentItem`，在卡片的 `.ContentItem-actions` 前插入，或追加到卡片末尾。只改变卡片高度，不新增列表项。
- 卡片已有 `data-crx-inline-diagram` 时跳过；长正文内嵌图插入到某张卡片时，移除该卡片的卡片底图，保证一张卡片只有一份架构图。
- 卡片图使用同一份 SVG，但加 `.crx-camo-card-diagram`：隐藏子标题与边标注、放大 box 标题，避免在 700px 左右的信息流列里文字小到不可读。
- 滚动时以 300ms 去抖重新调度，补插懒加载出来的新卡片；`scroll` 监听在关闭时移除。卡片高度变化仍会让瀑布流重新测量；若这在实机上引起明显跳动，应优先关闭卡片图、只保留顶部与正文内嵌图。

### D17. 左侧团队空间侧边栏与内容偏移

- `createToc()` 生成 `.crx-camo-toc`，挂在 body 上并带 `data-crx-camo-shell`，随外壳清理；结构参考 POPO 团队空间：面包屑「云空间 › 团队空间」、橙色头像 + 「出海项目组」、搜索框、「首页」、「目录」标题、树形目录、底部「从云空间迁入 / 上传本地文件 / 回收站」。
- 树数据放在 `TOC_TREE`：包含 CloudFlare恢复码、IM 爬虫及其子文件夹、Agent 质量保障与智能排障、Agent 行为指标监控体系（active）等；`createTocTree()` 递归渲染，文件夹带可旋转 chevron，文档带蓝色页图标，文件夹为金色。
- 侧边栏采用浅色 POPO 配色（背景 `#f7f8fa`、文字 `#1f2329`、active `#e1eaff`/`#245bdb`），与白色正文组成 POPO 文档工作台；`position: fixed`、`top: 44px`、`bottom: 0`、`width: 260px`，可滚动但隐藏滚动条，纯展示、不做跳转。
- 内容偏移用 `margin-left: max(300px, calc((100vw - 1080px) / 2))`；侧栏 left 用 `max(16px, calc((100vw - 1080px) / 2 - 296px))`。在 1440px 宽度下侧栏右边界 276px、正文从 300px 开始，间距 24px。
- `@media (max-width: 1439px)` 隐藏侧栏并把 `#root` / `.crx-camo-top` / `.crx-camo-footer` 的 `margin-left` 重置为 `auto`，避免窄屏挤压正文。

## Risks / Trade-offs

- [知乎改版导致选择器失效] → CSS 只做非破坏性隐藏，最坏结果是品牌元素仍可见；标题、favicon、配色仍生效，页面不白屏。选择器集中维护，改版后集中修补。
- [异步读取存储导致首屏闪一下知乎原样] → 属性门控 + `document_start` 尽早应用；实测若闪动明显，再评估预置 CSS 或延迟首屏绘制，避免在本变更中盲目增加复杂度。
- [标题/favicon 观察器与知乎 React 互相覆盖] → 用写入标志区分来源，只观察 `<head>`，并对重写做去抖；观察器内部异常必须吞掉，不能影响页面。
- [大图扫描在长信息流上造成卡顿] → rAF 去抖、优先处理新增节点、避免为每张图创建观察器。
- [隐藏大图误伤二维码、验证码等功能图片] → 阈值按渲染尺寸且可整体关闭；需要时可再增加「点击显示」占位，本次不做。
- [知乎页面注入大图隐藏脚本增加少量启动开销] → 脚本保持轻量，只在开关开启时做扫描；关闭时只保留一个 storage 监听。
- [popup 第三分组打破既有契约] → 同步更新 AGENTS.md 的 popup DOM 契约、分组约定与存储键说明，并在 README 补功能描述。
- [地址栏与悬停链接仍显示 zhihu.com] → 写入 Non-goals 与 README 已知限制，避免使用者误以为能完全隐身。

## Migration Plan

- 无数据迁移：两个新键未设置即视为关闭，不影响现有 `console*Disabled`、AI 配置与京东评价。
- 上线方式仍是 `chrome://extensions` 重载扩展；不需要重新加载页面，已打开标签页通过 `storage.onChanged` 即时生效（无 content script 的旧标签页除外）。
- 回滚：关闭两个开关即可回到原行为；如需彻底回滚，移除 manifest 中的两条 content script 记录与两个新文件，不影响已有功能。

## Open Questions

- 知乎各页面类型在登录状态下的最终选择器需要在实现阶段用真实页面取样确认；这不改变设计结构，只影响具体选择器清单。
- 400×300 的阈值在真实信息流上的观感需要实测；如果后续要调整，属于规格变更，不在实现阶段自行改动。
- 首屏闪动是否可感知需要实测；若明显，再单独评估预绘制方案。
