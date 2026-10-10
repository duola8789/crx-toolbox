# crx-toolbox

一个用于浏览器控制台调试与京东订单评价的 Chrome 扩展（Manifest V3）。

## 功能

### 1. 控制台日志控制器

通过扩展弹窗上的三个开关，按需屏蔽当前页面输出的 `console.log` / `console.info` / `console.warn`。

- 开关状态保存在 `chrome.storage.local`，**跨页面、跨会话持久生效**，新打开的标签页会自动应用。
- 采用注入脚本改写页面主世界的 `window.console`，因此对页面自身脚本的日志同样有效，而非仅屏蔽扩展自身的输出。
- 每个开关旁实时显示当前状态（`log: 已禁用` / `log: 已启用`）。

### 2. 京东商品一键评价

在京东订单评价相关页面，点击弹窗中的「京东商品一键评价」按钮后自动完成评价流程：

- 逐条点击五星好评
- 向评价文本框填入预设评语
- 点击提交

支持三种页面场景，进入页面后也会自动触发：

| 页面 URL 特征              | 行为                             |
| -------------------------- | -------------------------------- |
| `myJdcomments/myJdcomment` | 找到「评价」入口并跳转后执行评价 |
| `orderVoucher`             | 直接执行评价                     |
| `saveCommentSuccess`       | 点击「查看更多」                 |

> 该功能依赖京东页面当前的 DOM 结构，页面改版后可能失效。

## 安装

无需构建，直接以「已解压的扩展程序」加载：

```bash
git clone <repo-url> crx-toolbox
```

1. 打开 `chrome://extensions`
2. 右上角开启**开发者模式**
3. 点击**加载已解压的扩展程序**，选择仓库根目录
4. 扩展即安装完成（图标出现在工具栏）

修改代码后，回到 `chrome://extensions` 点击扩展卡片上的**重新加载**按钮即可。

## 使用

**控制台开关**：点击工具栏图标 → 切换 `console.log` / `console.info` / `console.warn` 对应的开关。切换会立即作用于当前标签页，并持久化到之后打开的所有页面。

**京东评价**：打开京东订单评价页 → 点击工具栏图标 → 点击「京东商品一键评价」。

## 项目结构

```
.
├── manifest.json      扩展清单（MV3）
├── background.js      Service Worker：初始化开关状态、页面加载后重注入脚本
├── content.js         Content Script：消息处理、页面主世界脚本注入、京东自动化
├── injected.js        注入到页面主世界的脚本，负责真正改写 window.console
├── popup.html         弹窗界面（内含样式）
├── popup.js           弹窗逻辑：读取/写入开关、发送消息
├── src/assets/        图标资源
├── openspec/          规格驱动变更工作流（proposal / spec / design / tasks）
└── .claude ｜ .agents AI 编码代理的技能与命令配置
```

### 工作原理

扩展需要屏蔽的是**页面脚本**的日志，而 Content Script 运行在隔离的 JavaScript 世界中，改写其中的 `console` 无法影响页面。因此扩展通过两条通道协作：

```
popup.js ──chrome.storage.local──▶ 持久化开关状态
    │
    └──tabs.sendMessage──▶ content.js（隔离世界）
                              │
                              ├─ 注入 injected.js 到页面主世界
                              └─ CustomEvent(TOGGLE_CONSOLE_METHOD)
                                       ▶ injected.js 改写真正的 window.console
```

`background.js` 会在每个页面加载完成后重新下发一次已禁用状态，保证新页面同样生效。

## 开发

```bash
yarn install        # 安装依赖（仅 Prettier）
npx prettier --write .   # 格式化代码
```

代码风格由 `.prettierrc` 定义：单引号、`printWidth: 170`、`tabWidth: 2`、`arrowParens: 'avoid'`。

项目当前没有测试、lint、CI 与构建步骤。验证方式为在浏览器中重新加载扩展后手工验证，详见 [AGENTS.md](./AGENTS.md)。

## 变更流程

仓库使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 进行规格驱动的变更管理：

- `openspec/specs/` —— 已确认的能力规格
- `openspec/changes/` —— 进行中的变更（proposal → design → tasks → 实施）
- `openspec/changes/archive/` —— 已归档的变更

## 许可

ISC
