# Design: add-ai-review

详见 `proposal.md`（Why / What）与 `specs/`（行为契约）。本文只讲怎么实现，以及为什么这么选。

## Context

现状与本次设计相关的约束：

- `content.js` 运行在 isolated world，现有唯一入口是 `chrome.runtime.onMessage` 里的 `jdEvaluate` 分支；`background.js` 目前只负责初始化存储与页面加载后重注入，**没有任何网络职责**。
- `manifest.json` 已声明 `host_permissions: ["<all_urls>"]`——这是为已有功能加的，恰好覆盖用户可配置的任意 `base_url`（见 Risks）。
- 项目硬约束（AGENTS.md）：无框架、无打包、无构建、无测试、无 CI。文件间不用 import/export，靠 `chrome.*` 与 DOM 事件协作。
- 这是项目第一次引入网络调用与密钥存储。

## Goals / Non-Goals

**Goals:**

- 网络能力与密钥**全部收敛在 Service Worker**，页面上下文保持零网络、零密钥。
- 所有失败路径收敛成**同一个出口**，不新增任何用户可见的失败态。
- 维持无构建、无运行时依赖的形态。

**Non-Goals:**

- 不做流式响应。评语是一次性的小载荷，流式只会把解析与超时逻辑变复杂，收益为零。
- 不做请求重试、不做多模型级联兜底。
- 不为生成结果做缓存。
- 不改动 console 日志控制器那条链路（双 world 通信协议保持原样）。

## Decisions

### D1. 请求由 Service Worker 独占发起

`content.js` 的 fetch 按页面 origin 走 CORS，第三方端点不会为 `jd.com` 发 CORS 头——这条路不是"差"，是根本走不通。SW 有 `host_permissions`，不受 CORS 约束。

连带结论：**`api_key` 只在 `background.js` 出现**。`content.js` 运行在 `<all_urls>` 上，让它碰密钥只会平白扩大暴露面。

### D2. 一次调用产出 N 条，按换行切分

一次评价页可能有多个输入框。逐条调用 = N 次往返 + N 倍限流风险。

产出格式用**换行分隔**而不是 JSON：JSON 解析的失败模式太多（代码围栏、尾随逗号、中文引号），而这里根本不需要结构化字段。切分后做三步清洗：去首尾空白、丢弃空行、剥掉可能出现的 `1. ` 之类序号前缀。

### D3. 请求体形状

```
POST {endpoint}/chat/completions
Authorization: Bearer <key>
Content-Type: application/json

{
  "model": <model>,
  "messages": [
    { "role": "system", "content": "<评语写作约束>" },
    { "role": "user",   "content": "写 N 条互不相同的好评，每行一条，不要编号。" }
  ],
  "reasoning_effort": "low",
  "stream": false,
  "max_tokens": <按 N 留足余量>
}
```

- **不发 `thinking` 字段**：文档只描述了如何开启。我们既不需要开启，也不需要显式关闭，靠 `reasoning_effort: "low"` 压低开销即可。
- **`stream: false` 显式写出**，不依赖端点默认值。
- 读取 `choices[0].message.content`。**先校验 `finish_reason`**：为 `length` 时内容视为被截断、不可信，直接走降级——不能把半句话填进评价框。

### D4. base_url 归一化

```
endpoint(base, path) = base.trim().replace(/\/+$/, '') + path
```

`/chat/completions` 与 `/models` 共用这一个函数。用户填 `https://api.deepseek.com` 得到 `.../chat/completions`；填 `.../v1` 得到 `.../v1/chat/completions`。两种习惯都能用。

*备选*：探测 `/v1` 是否存在——否决。验证按钮本来就会把实际 URL 打给用户看，没必要为此多发请求。

### D5. 验证 = 两步，独立报告

| 步骤 | 请求 | 回答的问题 | 成本 |
| --- | --- | --- | --- |
| 1 | `GET {endpoint}/models` | 密钥对不对 + 有哪些模型可用 | 免费 |
| 2 | `POST {endpoint}/chat/completions`（`max_tokens` 极小） | 真正要走的路径通不通 | 可忽略 |

- 两步结果**分别报告**，第二步失败不覆盖第一步的结论。
- 失败时展示**实际请求的完整 URL** + 服务端原始错误体（脱敏后）。这是区分「密钥错」「路径错」「网络不通」的唯一依据。
- 使用**表单当前值**而非已保存值（见 `specs/ai-connection-settings`）。
- `/models` 返回的 id 列表回填 model 输入框的 `<datalist>`。
- 顺带收益：Step 2 会实测出端点是否接受 `reasoning_effort`，不被接受即为 400，一眼可见。

### D6. 降级矩阵：所有分支同一个出口

| 情况 | 处理 |
| --- | --- |
| 开关关闭 / 配置不全 | 不发起请求，用词池 |
| fetch 抛异常 | 词池 |
| `!res.ok` | 词池 |
| 超时 | 词池 |
| `finish_reason === 'length'` | 词池 |
| 内容为空 / 单条超长 | 该条剔除，其余保留；全空则整批走词池 |

**关键实现约束**：SW 侧一律 resolve 成 `{ ok: false }`，**不要 reject**。否则 `content.js` 里会散落 try/catch，而那条链路上还有京东的 DOM 自动化，越简单越好。

### D7. 超时用 AbortController，初值 8s

介于"够慢的网络"和"用户以为卡死"之间。因为与点星并行（D8），实际感知延迟通常远小于 8s。这是个可调常量，实测后可改。

### D8. 点星与生成请求并行

现状 `content.js:70` 的 `await sleep(1000)` 是纯空等。改成：先发出生成请求，同时点星，最后 `await` 结果再填字。这个 1s 的等待窗口正好被吃掉一部分，等于白捡。

AI 关闭时词池是同步的，时序与变更前一致。

### D9. 本地词池内联在 content.js

一个常量数组，≥5 条人工撰写的完整评语。取用时**先洗牌再按序取**，保证同页 N 个输入框两两不同；若 N 超过词池长度，则循环取（此时必然重复，属可接受降级）。

放在 `content.js` 内部而不是独立文件：项目无 ESM，独立文件必须靠 `manifest.json` 的 `content_scripts.js` 数组顺序来保证先加载——少一个文件、少一处登记、少一个顺序陷阱。

### D10. 存储键

| 键 | 说明 |
| --- | --- |
| `aiReviewDisabled` | 对齐现有 `console*Disabled` 的命名法 |
| `aiBaseUrl` / `aiApiKey` / `aiModel` | 设置页三项，保存时一次性 `set` |

### D11. popup 的 DOM 契约

AGENTS.md 记着一个坑：`updateStatusText()` 会**无条件**写 `statusElements[method].textContent`，删掉 `*Status` 节点会抛错。新增 AI 开关时要么纳入同一套 `*Toggle` / `*Status` 约定，要么连同 `updateStatusText()` 一起改——**倾向纳入**（`#aiToggle` / `#aiStatus`），保持结构一致。

设置入口用 `chrome.runtime.openOptionsPage()`。popup.html 已有分组标题，AI 开关归入京东那一组。

### D12. options 页形状

`options_ui.open_in_tab: true`——表单加验证结果区，塞进小弹窗太挤。`options.js` 用 `<script src>` 引入（MV3 的 CSP 本来就禁止内联脚本）。

固定 id：`#baseUrl` / `#apiKey` / `#apiKeyReveal` / `#model` / `#save` / `#verify` / `#result`。显式保存按钮，不做改完即存。

## Risks / Trade-offs

- **`<all_urls>` 身兼两职** → 它既是内容脚本的匹配范围，又是 AI 请求的通行证。将来若有人收窄这个权限，AI 会**静默失效**（降级到词池，不报错）。缓解：在 AGENTS.md 显式记下这条耦合。
- **密钥明文存于 `chrome.storage.local`** → 任何扩展内代码都可读取。缓解：读取面收窄到 SW；`content.js` 不接触。
- **变更后即便 AI 全程关闭，评语也不再是原来那条硬编码文案**，而来自词池。这是刻意的（proposal 里的"方案 B"），但对使用者是可感知的行为变化，不是纯增量。
- **`reasoning_effort` 是否被端点接受未实测** → Step 2 的验证会直接暴露（400 即不支持）。若被拒，回退方案是不发该字段。
- **京东 textarea 是否为受控组件未知** → 现状直接赋值 `value` 是可用的，本次只换内容、不改赋值方式，风险不增加。
- **目录改名会清空 `chrome.storage.local`**（AGENTS.md 已记） → 新增的四个键同样受影响，但设置页让重填只需点几下，不再是"孤儿数据"。

## Open Questions

- `reasoning_effort: "low"` 的实际效果（延迟与评语质量）需要真实使用后才知道，可能需要调整。这不改变规格与任务拆分。
- 8s 超时初值同理，属可调常量。
