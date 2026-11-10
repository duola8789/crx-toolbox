## 1. 资源与清单

- [x] 1.1 新增中性文档图标 `src/assets/doc-icon.svg`，并在 `manifest.json` 的 `web_accessible_resources` 中以 `*://*.zhihu.com/*` 匹配登记；重载扩展后确认清单无错误，且该图标可从知乎页面加载
- [x] 1.2 新增 `zhihu-camouflage.js`、`image-hiding.js`、`zhihu-camouflage.css`、`image-hiding.css` 四个空壳文件，并在 `manifest.json` 增加两条 content_scripts 记录（均只匹配 `*://*.zhihu.com/*` 带 JS+CSS，均为 `document_start`）；重载扩展后确认清单无错误，非知乎页面不加载知乎脚本
- [ ] 1.3 确认新增 content script 不改变 `content.js` / `background.js` 的既有加载与消息行为；在任意页面验证 console 开关仍生效

## 2. 文档视图

- [ ] 2.1 在登录状态的知乎首页、问题页、专栏页、搜索页、个人主页取样 DOM，确认顶栏、Logo、搜索、左导航、右侧栏、推荐流、关注按钮、头像/徽章、作者操作栏的选择器，并集中记录到 `zhihu-camouflage.css` / `zhihu-camouflage.js` 的注释区块；验证五类页面各至少有一条可命中的选择器
- [x] 2.2 在 `zhihu-camouflage.js` 实现启动读取 `zhihuCamouflageEnabled`、给 `<html>` 设置/移除 `data-crx-zhihu-camo`、监听 `chrome.storage.onChanged`；验证开启后知乎页面出现属性、非知乎页面无属性、关闭后属性移除、多标签同步生效
- [x] 2.3 实现页签标题接管：伪文档标题词表、按 URL 稳定映射、`<head>` MutationObserver、写入标志与 `lastPageTitle` 恢复；验证标题不含「知乎」与问题标题、SPA 路由切换后仍为伪标题、关闭后恢复最近一次页面标题
- [x] 2.4 实现 favicon 接管：保存原有 icon 链接、替换为扩展图标、观察 `<head>` 重写、关闭后恢复；验证页签图标替换成功、页面脚本重写后仍保持、关闭后恢复知乎图标
- [x] 2.5 实现伪外壳注入：伪页眉、伪页脚、静态「系统架构」SVG，带幂等保护；验证任一知乎页面只出现一份外壳、SPA 切换不叠加、关闭后外壳移除
- [ ] 2.6 编写 `zhihu-camouflage.css`：POPO 浅色调色板、单栏正文、页眉页脚样式、隐藏品牌与社交元素（含整条作者操作栏）、弱化作者名、保留问题标题/正文/评论/话题标签；验证五类页面正文可读、链接可点、滚动正常、操作栏完全不可见
- [x] 2.7 为标题/favicon 观察器与外壳注入加异常保护，确保选择器失效或注入失败时不产生未捕获异常；验证临时改坏一个选择器后页面仍可用，且 console/京东/AI 功能不受影响
- [x] 2.8 验证关闭恢复链路：在已伪装的知乎页面关闭「文档视图」，确认标题、favicon、配色与全部被隐藏元素无需刷新即恢复

## 3. 精简图片

- [x] 3.1 在 `image-hiding.js` 实现启动读取 `hideLargeImagesEnabled`、给 `<html>` 设置/移除 `data-crx-hide-large-images`、监听 `chrome.storage.onChanged`；验证开关切换即时生效、多标签同步
- [x] 3.2 实现大图判定与标记：遍历 `document.images`，按 `getBoundingClientRect()` 的 `width >= 400` 或 `height >= 300` 打 `data-crx-large-image`；用 1200×100、200×320、300×200、原始 4000px 但显示 200×150 的图片验证隐藏/保留结果
- [x] 3.3 实现动态与懒加载处理：MutationObserver、图片 `load` 捕获、`window resize`、`requestAnimationFrame` 去抖；验证无限滚动新增图片、懒加载图片、`src` 替换、窗口缩放后均按新尺寸重新判定
- [x] 3.4 实现恢复与不误伤：只移除扩展标记、不删除节点、不改 `src/srcset`、只处理 `<img>`；验证关闭后图片立即恢复、小图标/头像保留、CSS 背景图/iframe 内图片/视频封面不受影响
- [x] 3.5 验证健壮性与性能：页面无未捕获异常；在长信息流持续滚动无明显卡顿；console/京东/AI/文档视图功能均不受影响
- [x] 3.6 把精简图片收窄到知乎：manifest 两个 content_scripts 都只匹配 `*://*.zhihu.com/*`；在 salon 等非知乎页面刷新后验证脚本不运行、图片不受影响
- [x] 3.7 排除 PDF/HTML 阅读器的页面背景图：`img.bi` 与 `[class*='2html-viewer']` / `[class*='2htmlEX']` 内的图片不参与判定，已误标的撤销；在 fixture 中验证 PDF 阅读器图片保留

## 4. popup 界面

- [x] 4.1 在 `popup.html` 新增「知乎伪装」分组，包含「文档视图」「精简图片」两行、悬停提示、读屏 aria 标签，以及 `#docViewStatus` / `#imageHideStatus` 两个 `sr-only` 状态节点；验证分组顺序、id 与文案符合约定
- [x] 4.2 为新增分组编写 `.option` 行样式：未选中为灰色，选中时强调色亮起且名称不划掉，与 console 的「静音」选中语义区分；验证亮色/暗色模式下状态正确
- [x] 4.3 在 `popup.js` 读取两个新键、绑定 change 写入 `chrome.storage.local`、更新读屏状态文本；验证开关状态持久化、重开 popup 状态一致、切换后不需要发送 `tabs.sendMessage` 即可生效
- [x] 4.4 走查文案与无障碍：可见文案为「知乎伪装 / 文档视图 / 精简图片 / 悬停可查看每项说明」，悬停提示与读屏标签说明生效范围；用键盘 Tab 与读屏器验证焦点和播报

## 5. 文档与回归

- [x] 5.1 更新 `AGENTS.md`：文件清单、popup 三块契约、存储键例外、两个新功能的架构约束、已知限制与验证方式
- [x] 5.2 更新 `README.md`：功能列表与使用说明，明确地址栏/正文文字/背景图/iframe 无法伪装，旧标签页需刷新才能应用新脚本
- [x] 5.3 运行 `npx prettier --write .`，确认新增 JS/CSS/HTML/Markdown 均已格式化且没有意外改动
- [ ] 5.4 回归现有功能：console.log/info/warn 三档开关、京东一键评价（含 AI 成功与降级路径）、AI 设置页验证；确认新功能不干扰
- [ ] 5.5 按 `specs/zhihu-camouflage/spec.md` 与 `specs/large-image-hiding/spec.md` 的场景逐条验收，并覆盖两个开关的 4 种组合，记录结果

## 6. 实页反馈修正

- [x] 6.1 根据用户保存的 MHTML 隐藏 `.WriteArea`（提问/写想法编辑器）与 `.CornerButtons`（右下角 AI/回到顶部悬浮按钮）；在 MHTML 中验证计算样式为 `none`
- [x] 6.2 恢复 `.ContentItem-more`「阅读全文」按钮，移除误伤的 `[class*='ContentItem-expand']` 规则，并把它保留为弱化文字按钮；在 MHTML 中验证 `display: inline-flex`
- [x] 6.3 隐藏「收录于 · 某合集」入口：`a[href*='/collection/']`、`[class*='Collect']`、`aria-label/title` 含「收录」兜底
- [x] 6.4 热评卡与评论区整体隐藏：`.Comments` / `.CommentList` / `.CommentItem` / `.CommentItemV2`，以及 `.RichContent--hasHotComment` 下的热评卡；用构造的评论卡验证 `display:none`
- [x] 6.5 标题链接（`.ContentItem-title a` 等）改为正文色；标题前不再显示章节编号；在 MHTML 中验证标题链接颜色为 `#1f2329`
- [x] 6.6 文档视图隐藏 `.RichContent-cover` / 视频封面；精简图片用 `:has(img[data-crx-large-image])` 折叠外层容器，避免隐藏后留下空白
- [x] 6.7 首页右侧栏按 `.Topstory-container > :not(.Topstory-mainColumn)` 结构兜底隐藏，并补充 `.GlobalSideBar` / `.CreatorEntrance` / `.ProfileSideCreator`
- [x] 6.8 面包屑改为「团队空间 / 出海项目组 / Agent 行为指标监控体系」，架构图改为 POPO 文档的六节点流程；在 fixture 中验证节点、子标题与边标注
- [x] 6.9 隐藏「1302 人赞同了该回答」等社区元信息：`.ContentItem-status`、`.ContentItem-annotation`、`*VoteCount*`；用构造元素验证计算样式为 `none`

## 7. 二次反馈修正

- [x] 7.1 作者悬浮名片：给 `.AuthorInfo` 及后代设 `pointer-events: none`，并隐藏 `.Popover` / `UserHoverCard` / `[class*='HoverCard']`；在 fixture 中验证 pointer-events 为 none、弹层 display 为 none
- [x] 7.2 新版哈希热评卡：`div[tabindex='0']:has(a[href*='/people/'] img)` 识别 `.RichContent--hasHotComment` 下的热评卡后整体隐藏；在 fixture 中用哈希类名元素验证
- [x] 7.3 长正文内嵌架构图：≥1200 字符且 ≥3 个块级子元素时随机插入同一份 SVG，整页最多一份，点击 `.ContentItem-more` 后延迟插入，关闭/导航移除；在 fixture 中验证内嵌图存在、6 个节点、关闭后移除
- [x] 7.4 隐藏标题序号与「02 · 设计说明」章节前缀：移除 `ContentItem-title::before` 计数器与 `QuestionHeader-title/Post-Title::before`；在 fixture 中验证标题前无编号
- [x] 7.5 隐藏刷新时的白色骨架屏：`.skeleton` / `[class*='skeleton']` / `.Card:has(.skeleton)` / `.LoadingBar` / `.ModalLoading`；在 fixture 中验证骨架 Card 计算样式为 `none`
- [x] 7.6 内嵌架构图改为正文前半段随机插入，并在首次无候选时最多重试 3 次（间隔 1.5 秒）；在 fixture 中延迟渲染长正文，验证重试后成功插入

## 8. 列表卡片内部的架构图与视频隐藏

- [x] 8.1 为信息流/列表卡片在**卡片内部底部**插入紧凑架构图：从正文向上找最外层 `.TopstoryItem` / `.Feed` / `.List-item` / `.ContentItem`，正文 ≥ 200 字符时在 `.ContentItem-actions` 前或卡片末尾插入；在 fixture 中验证图在卡片内部、列表项数量与顺序不变
- [x] 8.2 卡片图使用 `.crx-camo-card-diagram` 紧凑样式：隐藏子标题与边标注、放大 box 标题；在 fixture 中验证隐藏与字号
- [x] 8.3 与长正文内嵌图去重：卡片已有内嵌图时跳过，内嵌图插入时移除卡片底图；在 fixture 中验证一张卡片只有一份图
- [x] 8.4 滚动加载新卡片补插：`scroll` 300ms 去抖重新调度；在 fixture 中新增卡片并触发 scroll，验证补插成功，关闭后两类图全部移除
- [x] 8.5 视频播放器隐藏：CSS 隐藏 `video` / `[class*='Video']` / `[aria-label*='视频']` 与正文顶层媒体块，并用 `hideVideoPlayers()` 给 ≥240×135 的播放器容器加 `.crx-camo-hide-video`（遇到 `.RichContent`/`.RichText` 停止）；在 fixture 中验证 video 与 640×360 容器均为 `display:none`、`.RichContent` 不被误隐藏，关闭后恢复
- [x] 8.6 放弃 `card.after()` 的卡片间兄弟节点方案：首页是 React 瀑布流，新增列表项会改变测量；改为卡片内部插入，仅改变卡片高度。同时修复 `:has(> :has(> video))` 嵌套 `:has` 导致整条选择器失效的问题

## 9. 左侧团队空间侧边栏与内容偏移

- [x] 9.1 `createToc()` 生成 POPO 团队空间侧边栏：云空间/团队空间面包屑、橙色头像 + 出海项目组、搜索、首页、目录标题、底部迁入/上传/回收站；随 `data-crx-camo-shell` 清理
- [x] 9.2 `TOC_TREE` + `createTocTree()` 渲染树形目录：CloudFlare恢复码、IM 爬虫及其子文件夹、Agent 质量保障与智能排障、Agent 行为指标监控体系（active）等；文件夹金色、文档蓝色、open 文件夹 chevron 旋转；在 fixture 中验证 17 个条目、active 项与底部三项
- [x] 9.3 浅色侧栏样式：`#f7f8fa` 背景、`#1f2329` 文字、active `#e1eaff`/`#245bdb`、fixed top 44px / width 260px、可滚动且隐藏滚动条
- [x] 9.4 内容整体右移让位：`#root` / `.crx-camo-top` / `.crx-camo-footer` 使用 `margin-left: max(300px, calc((100vw - 1080px)/2))`；在 1500px 视口验证侧栏右边界 276px、正文左边界 300px，无重叠
- [x] 9.5 窄屏与清理：`@media (max-width: 1439px)` 隐藏侧栏并把 margin-left 重置为 auto；关闭文档视图时侧栏随外壳移除，正文恢复原位
- [x] 9.6 去掉卡片之间的分隔线与边框，但保留原有间距：`.ContentItem` / `.List-item` / `.Feed` / `.TopstoryItem` / `.QuestionHeader` / `.AnswerItem` / `.Post-Main` / `.CommentItem` / `.Card` 统一 `border:0`、透明背景、无阴影，不清空 `margin`/`padding`；`.Topstory-mainColumn` / `.Topstory-mainColumnCard` / `.Topstory-content` / `#TopstoryContent` 外层容器也统一 `box-shadow:none`、`border:0`；顶部/内嵌/卡片架构图去掉虚线边框但保留上下 margin/padding；在 fixture 中验证卡片无边框且间距保留
- [x] 9.7 标题字号与正文一致：`.QuestionHeader-title` / `.Post-Title` / `.ContentItem-title` 使用 `font-size: var(--crx-body-size)`（15px）、`line-height: 1.85`，仅保留 `font-weight: 650` 区分层级；在 fixture 中验证标题与正文计算字号一致
- [x] 9.8 评论整体隐藏：确认热评卡是 `.ContentItem` 下、`.RichContent` 的兄弟节点而非懒加载，用 `.ContentItem > div[tabindex='0']:has(a[href*='/people/'] img)` 隐藏；同时保留 `.RichContent--hasHotComment` 内同类结构兜底；在 fixture 中验证兄弟节点热评卡 `display:none`

## 10. 媒体块占位修正

- [x] 10.1 大图隐藏后折叠正文顶层媒体块：`.RichContent` / `.Post-RichText` / `.RichText` 的直接子块包含 `img[data-crx-large-image]` 时整块 `display:none`；在 fixture 中验证带固定高度的媒体块不留下空白
- [x] 10.2 视频/iframe 隐藏后折叠正文顶层媒体块：`.RichContent` / `.Post-RichText` / `.RichText` 的直接子块包含 `video` 或 `iframe` 时整块 `display:none`；在 fixture 中验证视频容器不留下黑底/空占位
