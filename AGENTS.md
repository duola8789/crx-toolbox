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
background.js   Service Worker：初始化存储、页面加载后重注入
content.js      Content Script（document_start，<all_urls>）：核心逻辑
injected.js     MAIN world 注入脚本（web_accessible_resource）
popup.html/js   扩展弹窗 UI
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

### 通信协议

`content.js` 的 `onMessage` 监听器是新增交互的唯一入口，`sendResponse` 依赖 `return true`（已保留，勿删）。

| 方向            | action                | 载荷                                                  |
| --------------- | --------------------- | ----------------------------------------------------- |
| popup → content | `toggleConsoleMethod` | `{ method: 'log'\|'info'\|'warn', disable: boolean }` |
| popup → content | `jdEvaluate`          | 无                                                    |

自定义事件：`TOGGLE_CONSOLE_METHOD`（content → injected）。

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

### 支持的 console 方法

目前仅 `log`、`info`、`warn`。新增方法（如 `error`、`debug`）要同时改：`background.js` 的 `methods` 数组、`content.js` 的 `originalConsoleMethods`、`injected.js` 的 `_originalConsoleMethods`、`popup.html` 的开关节点 + `popup.js` 的 `methods` 数组。

## 编码约定

- 纯 ESM 之外的浏览器脚本，**不使用** import/export，文件间通过 `chrome.*` API 与 DOM 事件协作。
- 遵循 Prettier（`.prettierrc`）：`printWidth: 170`、`tabWidth: 2`、单引号、无分号结尾风格由 Prettier 决定、`arrowParens: 'avoid'`。
- 提交前执行 `npx prettier --write .`。
- 注释与 UI 文案使用中文，与现有代码保持一致。
- 京东自动化部分为 DOM 选择器驱动，脆弱且依赖站点结构；修改时请集中在该区块内，并保持 `sleep()` 等待节奏，不要引入全局副作用。

## 已知遗留问题

- `content.js` 中 `changeRuleId()` 向 `window.location.quer` 赋值，该属性不存在且调用点已注释，属死代码。
- `content.js` 直接覆盖 `window.onload`，若同 world 有其他脚本设置该属性会被覆盖。
- `manifest.json` 的 `webNavigation` 与 `scripting` 权限仅为重注入路径服务，若简化该路径可一并回收。

## 变更工作流（OpenSpec）

仓库启用 spec-driven 工作流，CLI 为 `openspec`（全局安装）。

- `openspec/specs/` 为能力主规格，`openspec/changes/` 为进行中的变更，完成后归档至 `openspec/changes/archive/`。
- 对应技能：`openspec-explore`（探索，只读）、`openspec-propose`（产出 proposal/spec/design/tasks）、`openspec-apply-change`（实施）、`openspec-archive-change`（归档）。
- `.agents/skills/.openspec-target` 指定目标代理为 `codex`；`.claude/` 下有等价副本。
- 非平凡改动应先走 propose 生成变更制品，不要直接改源码。

## 验证方式

项目**没有测试、没有 lint、没有 CI**，`npm run build` 是占位（`echo 1`）。改动后按以下方式手工验证：

1. `chrome://extensions` → 开发者模式 → 「加载已解压的扩展程序」选仓库根目录 → 改动后点「重新加载」。
2. 打开任意页面，在 DevTools Console 执行 `console.log(1)`；popup 中关闭 `log` 后应无输出。
3. 京东功能需在真实订单评价页验证，注意其选择器随时可能失效。
4. 调试 Service Worker 在 `chrome://extensions` 的「Service Worker」链接中查看，popup 可右键「审查弹出内容」。
