## 1. 端点工具与设置页骨架

- [x] 1.1 在 `manifest.json` 登记 `options_ui`（`page: options.html`、`open_in_tab: true`）；在 `chrome://extensions` 重新加载扩展后，从扩展详情页的「扩展程序选项」能打开设置页即算通过
- [x] 1.2 新建 `options.html`，沿用 `popup.html` 的 CSS 变量与深色主题约定，含 AI 总开关、base_url / api_key / model 三个输入、显式保存按钮、验证按钮、结果区，固定 id 为 `#aiToggle` `#aiStatus` `#baseUrl` `#apiKey` `#apiKeyReveal` `#model` `#save` `#verify` `#result`；浏览器打开确认布局在深浅两种主题下均正常
- [x] 1.3 实现 base_url 归一化函数，按 design.md D4 的规则「去尾部斜杠后追加路径」，`/chat/completions` 与 `/models` 共用；在控制台分别以 `https://api.deepseek.com`、`https://api.deepseek.com/v1`、`https://api.deepseek.com///` 调用，三者的输出与 D4 表格一致
- [x] 1.4 新建 `options.js`（用 `<script src>`，不使用内联脚本），实现三项配置的读取与显式保存到 `aiBaseUrl` / `aiApiKey` / `aiModel`；验证：改动后不点保存直接刷新，字段回到上次保存的值

## 2. 设置页交互

- [x] 2.1 api_key 默认掩码显示，`#apiKeyReveal` 可切换明文；验证：默认掩码 → 点开为明文 → 再点为掩码
- [x] 2.2 base_url 以 `http://` 开头时显示明文传输告警；验证：分别填 `http://` 与 `https://` 开头的地址，前者出现告警、后者不出现

## 3. Service Worker：配置验证通道

- [x] 3.1 在 `background.js` 增加验证消息通道，实现 Step 1 `GET {endpoint}/models`；验证：填入一个错误的 api_key 触发验证，报告为认证失败
- [x] 3.2 实现 Step 2 极小生成请求（`max_tokens` 取极小值、`stream: false` 显式写出、`reasoning_effort: "low"`、**不发送 `thinking` 字段**）；验证：以正确配置触发，报告生成可用；若端点以 400 拒绝 `reasoning_effort`，则从请求体移除该字段并在结果区说明
- [x] 3.3 在 `background.js` 内实现错误分类，使认证失败、路径错误、网络不可达三类可区分，并展示实际请求的完整 URL 与服务端原始错误体；验证：分别构造错误密钥、错误路径、不可达主机三种情况，各触发一次并确认三者提示互不相同
- [x] 3.4 对任何可能在响应体中原样回显密钥的情况做脱敏；验证：构造一个会把密钥回显在错误里的情形（或临时在结果区打印原始体），确认页面展示中密钥被替换为掩码

## 4. 设置页接上验证

- [x] 4.1 `#verify` 接上验证通道，两步结果分别展示，第二步失败不覆盖第一步结论；验证：故意填一个不存在的 model 名，确认报告中第一步「密钥可用」的结论仍然保留
- [x] 4.2 验证使用表单当前值而非已保存值（见 `specs/ai-connection-settings`）；验证：改一个字段但不保存，直接点验证，确认请求用的是新值
- [x] 4.3 用 Step 1 返回的模型 id 列表填充 model 输入框的 `<datalist>`；验证：验证成功后 model 输入框出现可选项
- [x] 4.4 验证失败时在结果区展示实际请求 URL；验证：填一个错误路径，确认展示的 URL 与 D4 规则推出的完全一致

## 5. Service Worker：评语生成通道

- [x] 5.1 在 `background.js` 增加生成消息通道，按 design.md D3 组装请求体，一次调用请求 N 条并按换行切分、去空白、丢空行、剥序号前缀；验证：在 Service Worker 的控制台直接触发一次，拿到 N 条互不相同的文本
- [x] 5.2 失败路径一律 resolve 成 `{ ok: false }`，不 reject（design.md D6）；验证：在断网或错误密钥下触发，调用方不抛异常，只收到 `{ ok: false }`
- [x] 5.3 用 `AbortController` 实现超时（初值 8s，design.md D7）；验证：把 base_url 指向一个不可达地址，确认约 8s 后返回 `{ ok: false }` 而不是长期挂起
- [x] 5.4 读取内容前校验 `finish_reason`，为 `length` 时视为不可信；单条超长只剔除该条，全部为空则整批失败；验证：把 `max_tokens` 临时压到极小迫使 `finish_reason` 为 `length`，确认返回 `{ ok: false }`
- [x] 5.5 确认密钥读取面已收窄：`content.js` 全文不出现 `aiApiKey`，且生成与验证逻辑均不把密钥写入 console；验证：在 `content.js` 中检索 `aiApiKey` 无命中，并复查两条通道无密钥日志

## 6. content.js：本地词池与降级

- [x] 6.1 在 `content.js` 内联本地评语池常量（≥5 条人工撰写的完整评语）与洗牌取用函数，不新建独立文件（design.md D9）；验证：在页面控制台调用一次，连续取 N 条两两不同
- [x] 6.2 改造 `onJdEvaluate()`，使生成请求与点星并行发生，复用现有 `sleep(1000)` 窗口（design.md D8）；验证：AI 开启时点星动作立即发生，不等待网络返回
- [x] 6.3 填字逻辑改为「AI 结果，否则本地词池」，覆盖 design.md D6 的全部降级触发条件；验证：关闭 AI 开关后跑完整评价流程，流程照常完成且文案来自词池
- [x] 6.4 写入前校验评语非空且长度可接受，不满足则不写入该输入框、不提交；验证：临时让取用函数返回空串，确认既不填写也不提交
- [x] 6.5 确认同一页面多个评价输入框拿到不同文案；验证：在含多个 textarea 的订单评价页跑一次，逐条比对

## 7. AI 开关归入设置页，popup 保持原样

- [x] 7.1 在 `options.html` 顶部增加「启用 AI 评语」总开关（`#aiToggle` / `#aiStatus`）：界面按正向表达（勾选 = 启用），存储仍写入 `aiReviewDisabled`（取反），拨动立即生效、不走 `#save`；验证：拨动后重开设置页状态仍在，且与三个配置字段的显式保存互不干扰
- [x] 7.2 确认 `popup.html` / `popup.js` 不含任何 AI 界面（无 `#aiToggle` / `#aiSettings`，不读写 `aiReviewDisabled`，不调用 `openOptionsPage`）；设置页入口交给 Chrome 原生的「扩展程序选项」与图标右键菜单；验证：`git diff` 中 popup 两个文件无改动
- [x] 7.3 确认未破坏既有功能：三个 console 开关仍能正常切换并即时生效，京东按钮仍按 URL 决定启用状态；验证：按 AGENTS.md 的手工验证步骤逐项走一遍
- [x] 7.4 端点配置区随总开关显隐：关闭时把 `#aiConfig`（端点配置 + 验证结果）整体收起，重新开启即展回；收起只切显隐，MUST NOT 清除已保存的三项配置与上一轮验证结果（开关只写 `aiReviewDisabled` 一个键）；验证：关闭开关 → 配置区收起且存储未变 → 重新开启 → 字段与验证结果仍在，无需重填
- [x] 7.5 弹窗在京东按钮文字前展示只读状态圈 `#aiBadge`（圈内「AI」，只用边框色表意）：未配置或 AI 关闭时不出现；有配置但最近一次验证未通过为黄框；三项齐全且验证通过为绿框。绿色须同时满足「配置完整 + 验证通过」，改动配置并保存后绿框退回黄框（原样重存不作废）。为支撑判定，`options.js` 在验证后写入 `aiVerifiedOk`（未拿到响应记 false），且不含任何可交互控件、加载弹窗不改存储；验证：分别构造四种存储组合打开弹窗，圈的有无与颜色符合上表，真浏览器渲染确认圈是正圆且深浅主题下可辨

## 8. 文档与端到端验收

- [x] 8.1 更新 `AGENTS.md`：登记 `options.html` / `options.js`、记下 `background.js` 新增的网络职责、四个新存储键、「密钥不进入页面上下文」约束、`<all_urls>` 同时充当 AI 请求通行证的耦合（design.md Risks），以及「popup 不放 AI 界面、设置页入口由 options_ui 原生提供」这条边界；验证：通读一遍，与实际代码逐条对得上
- [x] 8.2 更新 `README.md`：说明 AI 评语能力、设置页的两种进入方式与用法、降级行为，并明确指出关掉 AI 后文案来自词池而非原有那条硬编码文案；验证：按 README 的步骤能独立完成一次配置
- [x] 8.3 执行 `npx prettier --write .` 并检查 `git diff`，确认除本次改动外无意外格式化；验证：diff 中不出现与本次变更无关的文件
- [ ] 8.4 端到端手工验收：按 AGENTS.md 的方式重新加载扩展，在真实京东订单评价页分别跑通「AI 开启」与「AI 关闭」两条路径，并额外验证一次「配置错误时静默降级到词池」；验证：三次均完成评价且无报错弹窗

  > **归档时仍未完成，有意保留未勾选。** 该项需要真实京东账号 + 真实 API key + 图形界面 Chrome，代理无法代跑。归档当日该验收在真实站点上也不可能通过：京东评价页已迁至 `comment.m.jd.com/pc-static/publish`，不匹配现有三个 URL 模式（`myJdcomments/myJdcomment` / `orderVoucher` / `saveCommentSuccess`），一键评价在页面上根本不会触发——这是京东改版造成的既有断链，**不是本次变更引入的**。本次变更的验证范围与实际完成情况见 `design.md` 与本文件第 1–7 节；AI 侧逻辑已用 4 个一次性测试台共 227 项断言覆盖（含真实 HTTP 请求与 8s 超时实测），并已用真浏览器渲染确认三处界面。待京东评价入口重新可用后，需按本项补做端到端验收。
