# add-ai-review

## Why

京东一键评价目前给页面上**所有**输入框填入同一个硬编码字符串（`content.js:84-85`），一次评价多件商品会产出完全重复的评语，读起来一眼就是模板。使用者希望每次评价的文字都不一样。

实时调用模型能满足这点，但它把外部服务引入了这条"一键"链路——服务不通、密钥失效、或用户压根没配置时，评价流程仍必须走得通。趁这个功能还在迭代、代码量还小的时候把降级路径一并定下来，好过以后在本来就很脆的 DOM 自动化代码里补错误分支。

## What Changes

- **新增扩展设置页**（`options.html` / `options.js`）：配置 OpenAI 兼容端点的 `base_url`、`api_key`、`model`，并提供「验证」按钮做连通性自检。
- **新增 AI 评语生成**：评价时为每个输入框生成互不相同的评语，替代当前的单一硬编码文案。
- **新增 popup 上的 AI 开关**（存储键 `aiReviewDisabled`），与现有三个 console 开关同构；popup 同时增加进入设置页的入口。
- **新增本地评语池**（5~8 条人工撰写的完整文案），作为**保底路径**。AI 关闭、未配置、请求失败、超时、返回内容不合规等情形一律静默降级到词池，不弹窗、不重试、不打断流程。
- **降级时同页面多个输入框洗牌后按序取**，而非各自独立随机——否则仍有概率撞成同一条，等于白改。
- **填写前校验生成内容非空且长度合规**；不满足则不填、不提交，避免把空文案提交上去。
- **密钥读取面收窄**：设置项与 `api_key` 仅由 `background.js`（Service Worker）读取，`content.js` 不接触。

明确不在本次范围内：

- 不做多 provider 适配，只支持 OpenAI 兼容的 `chat/completions` 形状；Anthropic 原生格式不支持。
- 不做失败重试、不做多模型兜底级联——失败即降级到本地词池。
- 不引入构建步骤或打包器，维持现有纯 JS 形态。

## Capabilities

### New Capabilities

- `ai-review-generation`: 京东评价流程中的评语生成——AI 开关、生成与校验、以及不可用时降级到本地词池的完整行为。
- `ai-connection-settings`: 扩展设置页——AI 端点配置（`base_url` / `api_key` / `model`）的读写契约与连通性验证结果。

### Modified Capabilities

无。项目当前 `openspec/specs/` 为空，尚无既有能力规格；京东一键评价本身也还没有规格，其行为变更并入上面的 `ai-review-generation`。

## Impact

**清单与权限**

- `manifest.json`：新增 `options_ui` 注册。**不需要新增权限**——现有 `host_permissions: ["<all_urls>"]` 已覆盖用户可配置的任意 `base_url`。
- 新增文件 `options.html`、`options.js`（按 AGENTS.md 约定登记在 manifest 中）。

**代码**

- `background.js`：新增「生成评语」与「验证配置」两条消息通道；成为唯一读取 `api_key` 的位置。跨域请求只能从这里发出——`content.js` 的 fetch 按页面 origin 走 CORS，对任意第三方端点不可用。
- `content.js`：`onJdEvaluate()` 的填字逻辑从硬编码常量改为「AI 结果，否则本地词池」；新增本地评语池常量与降级分支。
- `popup.html` / `popup.js`：新增 AI 开关与设置页入口；注意 AGENTS.md 记录的 popup DOM 契约（`*Toggle` / `*Status` 的固定 id，`updateStatusText()` 会无条件写 `textContent`）。

**存储**

`chrome.storage.local` 新增四个键：`aiReviewDisabled`、`aiBaseUrl`、`aiApiKey`、`aiModel`。

**外部依赖（项目首次）**

引入一个用户自备的 OpenAI 兼容端点，默认指向 `https://api.deepseek.com` / `deepseek-flash`。这是本项目第一次引入网络调用与密钥存储，密钥以明文存放于 `chrome.storage.local`。

**文档**

AGENTS.md 需同步：新文件登记、`background.js` 承担的网络职责、四个新存储键、以及"密钥仅限 SW 读取"这条约束。

**两个原本未知的端点细节已在 design 收敛**

- 推理开销不再依赖 `thinking` 字段——不发送它，改用 `reasoning_effort: "low"`（design.md D3）。
- `base_url` 按「去尾部斜杠后追加路径」归一化，使用户填不填 `/v1` 都能用；验证操作会展示实际请求 URL（design.md D4）。
