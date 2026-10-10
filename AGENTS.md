# AGENTS.md

面向 AI 编码代理的项目约定。人类开发者请看 [README.md](./README.md)。

## 项目概览

Chrome Extension（Manifest V3），无框架、无打包、无构建步骤的纯 JavaScript 项目。

两个彼此独立的能力：

1. **控制台日志控制器** —— 通过 popup 开关，按站点持久化禁用页面中 `console.log` / `console.info` / `console.warn`。
2. **京东一键评价** —— 在京东订单相关页面自动点五星、填评语、提交。

## 目录结构

源码全部位于仓库根目录，**不要**新建 `src/scripts`、`src/pages` 之类的分层目录（v1 曾用过该结构，已废弃）。`src/` 下只保留静态资源。

```
manifest.json   扩展清单，新增文件必须在此登记
background.js   Service Worker：初始化存储、页面加载后重注入、AI 评语的全部网络调用
content.js      Content Script（document_start，<all_urls>）：核心逻辑、京东自动化、本地评语池
injected.js     MAIN world 注入脚本（web_accessible_resource）
popup.html/js   扩展弹窗 UI
options.html/js 扩展设置页（options_ui）：AI 评语开关 + base_url / api_key / model + 连通性验证
src/assets/     图标等静态资源
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

### 通信协议

`content.js` 的 `onMessage` 监听器是新增交互的唯一入口，`sendResponse` 依赖 `return true`（已保留，勿删）。

| 方向                 | action                | 载荷                                                               |
| -------------------- | --------------------- | ------------------------------------------------------------------ |
| popup → content      | `toggleConsoleMethod` | `{ method: 'log'\|'info'\|'warn', disable: boolean }`              |
| popup → content      | `jdEvaluate`          | 无                                                                 |
| options → background | `verifyAiConfig`      | `{ config: { baseUrl, apiKey, model } }`（表单当前值，非已保存值） |
| content → background | `generateReviews`     | `{ count: number }`（配置由 SW 自己从存储读）                      |

自定义事件：`TOGGLE_CONSOLE_METHOD`（content → injected）。

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

### 需要两处同步的常量

项目没有 ESM，跨文件共享常量只能靠约定。改这些值时两处一起改：

| 常量                 | 位置                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| JD 页面 URL 模式清单 | `content.js` 的 `window.onload` 分支 + `popup.js` 的 `JD_EVALUATE_PAGES` |
| `REVIEW_MAX_LENGTH`  | `background.js`（剔除超长行）+ `content.js`（写入前校验）                |

### 支持的 console 方法

目前仅 `log`、`info`、`warn`。新增方法（如 `error`、`debug`）要同时改：`background.js` 的 `methods` 数组、`content.js` 的 `originalConsoleMethods`、`injected.js` 的 `_originalConsoleMethods`、`popup.html` 的开关节点 + `popup.js` 的 `methods` 数组。

## 编码约定

- 纯 ESM 之外的浏览器脚本，**不使用** import/export，文件间通过 `chrome.*` API 与 DOM 事件协作。
- 遵循 Prettier（`.prettierrc`）：`printWidth: 170`、`tabWidth: 2`、单引号、无分号结尾风格由 Prettier 决定、`arrowParens: 'avoid'`。
- 提交前执行 `npx prettier --write .`。
- 注释与 UI 文案使用中文，与现有代码保持一致。
- 京东自动化部分为 DOM 选择器驱动，脆弱且依赖站点结构；修改时请集中在该区块内，并保持 `sleep()` 等待节奏，不要引入全局副作用。

### popup 的 DOM 契约

`popup.js` 靠固定 id 取节点：`#logToggle` / `#infoToggle` / `#warnToggle`、`#logStatus` / `#infoStatus` / `#warnStatus`、`#jdBtn`。改 `popup.html` 结构时这些 id 必须保留。

其中三个 `*Status` 是 `sr-only` 隐藏元素（视觉状态改由通道行本身的信号条与删除线表达），但 `popup.js` 仍在往它们写 `textContent`——**删掉节点会抛错**，只能连同 `updateStatusText()` 一起改。

**popup 刻意只放「控制台日志」与「京东订单」两块，不放任何 AI 操作入口。** 弹窗是高频、临时的操作面，AI 配置是一次性动作，混在一起两边都变重。AI 的开关与端点配置都在设置页，不要为了"方便"把它们加回弹窗。

popup 里唯一与 AI 有关的是**只读状态圈** `#aiBadge`——京东按钮内、按钮文字之前，圈内只有「AI」二字，**没有文案**，含义全在边框颜色上：

| 展示                              | 条件                              |
| --------------------------------- | --------------------------------- |
| `hidden`                          | AI 开关关着，或三项配置一项都没填 |
| `data-state="unverified"`（黄框） | 有配置，但最近一次验证没通过      |
| `data-state="ready"`（绿框）      | 三项全填且最近一次验证通过        |

约束：

- **不是可点的东西**：它是 `<span>` 而非 `button`/`a`，圈内不得出现别的文案节点。按钮文字前**也没有**第二个装饰圆点（曾经有个京东红的 `.dot`，加状态圈时一并删掉了，别再加回去）。
- **`popup.js` 读状态时只读不写**，`chrome.storage.local.set` 永远只用于 console 三档开关。
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

因此**改仓库目录名会让三个日志开关的保存状态重置**，这是预期行为，不是 bug。要避免就得在 `manifest.json` 里加 `key` 固定 ID。
