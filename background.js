// 初始化存储
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    consolelogDisabled: false,
    consoleinfoDisabled: false,
    consolewarnDisabled: false,
  });
});

// 监听页面加载完成事件
chrome.webNavigation.onCompleted.addListener(async details => {
  const methods = ['log', 'info', 'warn'];
  const state = await chrome.storage.local.get(methods.map(m => `console${m}Disabled`));

  // 检查是否有任何方法被禁用
  const hasDisabled = methods.some(m => state[`console${m}Disabled`]);

  if (hasDisabled) {
    // 注入脚本
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ['injected.js'],
    });

    // 为每个被禁用的方法发送消息
    methods.forEach(method => {
      if (state[`console${method}Disabled`]) {
        chrome.tabs.sendMessage(details.tabId, {
          action: 'toggleConsoleMethod',
          method: method,
          disable: true,
        });
      }
    });
  }
});

// ============================================================================
// AI 评语：网络能力与密钥全部收敛在本文件
//
// 两个原因：content.js 的 fetch 按页面 origin 走 CORS，第三方端点不会为 jd.com
// 发 CORS 头，这条路根本走不通；而 content.js 运行在 <all_urls> 上，让它碰密钥
// 只会平白扩大暴露面。因此 content.js 全文不出现 aiApiKey。
//
// 注意：下面三个 ai* 配置键刻意不写进 onInstalled 的初始化。onInstalled 在扩展
// 更新时也会触发，把用户填的配置一并重置成空等于每次更新都清掉 api_key。
// 未设置的键读出来是 undefined，本身就是正确的默认值。
// ============================================================================

const AI_REVIEW_DISABLED_KEY = 'aiReviewDisabled';

// design.md D7：介于"够慢的网络"和"用户以为卡死"之间。与点星并行，实际感知远小于此。
const AI_TIMEOUT_MS = 8000;

// 评语长度上限：与 content.js 的 REVIEW_MAX_LENGTH 必须保持一致（两处同步，同 JD 页面 URL 清单的约定）
const REVIEW_MAX_LENGTH = 500;

// 单条中文评语约 60~120 token，按条留余量；点数上限兜住异常大的 count
const REVIEW_TOKENS_PER_ITEM = 200;
const REVIEW_MAX_TOKENS_CAP = 4096;
const REVIEW_COUNT_CAP = 20;

// base_url 归一化（design.md D4）：去尾部斜杠后追加路径，/chat/completions 与 /models 共用
function aiEndpoint(baseUrl, path) {
  return `${String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '')}${path}`;
}

// 读取配置；只在本文件调用
async function readAiConfig() {
  const state = await chrome.storage.local.get([AI_REVIEW_DISABLED_KEY, 'aiBaseUrl', 'aiApiKey', 'aiModel']);
  return {
    disabled: !!state[AI_REVIEW_DISABLED_KEY],
    baseUrl: String(state.aiBaseUrl || '').trim(),
    apiKey: String(state.aiApiKey || '').trim(),
    model: String(state.aiModel || '').trim(),
  };
}

// 密钥脱敏：端点在错误体里原样回显密钥时，展出的内容不能带着它（spec: 错误信息脱敏）
function maskSecret(text, secret) {
  if (!text || !secret) return text || '';
  const masked = secret.length >= 12 ? `${secret.slice(0, 3)}****${secret.slice(-4)}` : '****';
  return String(text).split(secret).join(masked);
}

// 统一的请求出口：任何失败都以返回值表达，绝不 reject（design.md D6），
// 否则调用链上会散落 try/catch，而那条链路上还有京东的 DOM 自动化
async function aiRequest(url, { method, apiKey, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: res.status, ok: res.ok, rawBody: await res.text(), failure: null };
  } catch (failure) {
    return { status: 0, ok: false, rawBody: '', failure };
  } finally {
    clearTimeout(timer);
  }
}

// 让「密钥错」「路径错」「网络不通」三者可区分（task 3.3）——这是验证报告的唯一依据
function classifyAiFailure({ failure, status }) {
  if (failure) {
    return failure.name === 'AbortError'
      ? { category: 'timeout', message: `请求超时：超过 ${AI_TIMEOUT_MS / 1000} 秒仍未返回` }
      : { category: 'network', message: `无法连接该主机：${failure.message || '网络不可达'}` };
  }
  if (status === 401 || status === 403) return { category: 'auth', message: '认证失败：api_key 无效或无权访问该端点' };
  if (status === 404 || status === 405) return { category: 'path', message: '路径错误：该地址下没有对应接口，请检查 base_url' };
  if (status === 429) return { category: 'rate-limit', message: '请求被限流：端点拒绝了本次调用' };
  return { category: 'http', message: `端点返回错误状态 ${status}` };
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 生成请求体（design.md D3）：不发 thinking 字段，用 reasoning_effort 压低推理开销
function buildChatBody(model, messages, maxTokens) {
  return {
    model,
    messages,
    reasoning_effort: 'low',
    stream: false,
    max_tokens: maxTokens,
  };
}

// design.md D2：按换行切分 → 去首尾空白 → 丢空行 → 剥序号前缀 → 去重
// 用换行而不是 JSON：JSON 的失败模式太多（代码围栏、尾随逗号、中文引号），这里也不需要结构化字段
function splitReviews(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:\d+\s*[.、)）]|[-*•])\s*/, '').trim())
    .filter(Boolean)
    .filter(line => line.length <= REVIEW_MAX_LENGTH);
  // 去重：规格要求各输入框内容互不相同，模型偶发重复行时由这里兜住
  return [...new Set(lines)];
}

// 展示用的原始响应体做长度兜底，避免一处错误把整个结果区撑爆
function rawBodyForDisplay(rawBody, apiKey) {
  const redacted = maskSecret(String(rawBody || ''), apiKey);
  return redacted.length > 2000 ? `${redacted.slice(0, 2000)}…（已截断）` : redacted;
}

// ---------------------------------------------------------------------------
// 配置验证通道（design.md D5）
// ---------------------------------------------------------------------------

// Step 1：GET {endpoint}/models —— 免费，回答"密钥对不对、有哪些模型可用"
async function aiVerifyModels({ baseUrl, apiKey }) {
  const url = aiEndpoint(baseUrl, '/models');
  const { status, ok, rawBody, failure } = await aiRequest(url, { method: 'GET', apiKey });
  const base = { step: 1, label: '密钥与模型列表', url, status, rawBody: rawBodyForDisplay(rawBody, apiKey) };

  if (ok) {
    const data = safeParseJson(rawBody);
    const models = Array.isArray(data && data.data) ? data.data.map(item => item && item.id).filter(Boolean) : [];
    return { ...base, ok: true, models, message: models.length ? `密钥可用，端点提供 ${models.length} 个模型` : '密钥可用（端点未返回模型列表）' };
  }

  const { category, message } = classifyAiFailure({ failure, status });
  return { ...base, ok: false, category, message };
}

// Step 2：POST {endpoint}/chat/completions —— max_tokens 取极小值，只问"真要走的那条路径通不通"
async function aiVerifyChat({ baseUrl, apiKey, model }) {
  const url = aiEndpoint(baseUrl, '/chat/completions');
  const messages = [{ role: 'user', content: 'ping' }];

  let attempt = await aiRequest(url, { method: 'POST', apiKey, body: buildChatBody(model, messages, 16) });
  let notice = '';

  // 端点可能以 400 拒绝 reasoning_effort——顺带被 Step 2 实测出来，移除该字段重试一次并向用户说明
  if (!attempt.ok && attempt.status === 400 && /reasoning_effort/i.test(attempt.rawBody)) {
    const body = buildChatBody(model, messages, 16);
    delete body.reasoning_effort;
    const retried = await aiRequest(url, { method: 'POST', apiKey, body });
    if (retried.ok) {
      attempt = retried;
      notice = '该端点不接受 reasoning_effort 字段，已自动移除后重试成功；正式生成时会沿用同样的处理。';
    }
  }

  const base = { step: 2, label: '生成接口', url, status: attempt.status, rawBody: rawBodyForDisplay(attempt.rawBody, apiKey) };

  if (attempt.ok) {
    // 这里只关心路径与 model 是否被接受；max_tokens 极小，finish_reason 为 length 属预期，不算失败
    return { ...base, ok: true, notice, message: `生成接口可用，model「${model}」被端点接受` };
  }

  const { category, message } = classifyAiFailure({ failure: attempt.failure, status: attempt.status });
  return { ...base, ok: false, category, notice, message };
}

// 两步分别报告：第二步失败不覆盖第一步的结论（spec: 第二步失败不掩盖第一步结论）
async function verifyAiConfig(config) {
  const baseUrl = String((config && config.baseUrl) || '').trim();
  const apiKey = String((config && config.apiKey) || '').trim();
  const model = String((config && config.model) || '').trim();
  const steps = [];

  if (!baseUrl || !apiKey) {
    steps.push({
      step: 1,
      label: '密钥与模型列表',
      ok: false,
      category: 'config',
      url: baseUrl ? aiEndpoint(baseUrl, '/models') : '',
      status: 0,
      message: !baseUrl ? '未填写 base_url，无法发起验证' : '未填写 api_key，无法发起验证',
      rawBody: '',
    });
    return { ok: false, steps };
  }

  const first = await aiVerifyModels({ baseUrl, apiKey });
  steps.push(first);
  if (!first.ok) return { ok: false, steps };

  if (!model) {
    steps.push({
      step: 2,
      label: '生成接口',
      ok: false,
      category: 'config',
      url: aiEndpoint(baseUrl, '/chat/completions'),
      status: 0,
      message: '未填写 model，无法验证生成路径',
      rawBody: '',
    });
    return { ok: false, steps };
  }

  const second = await aiVerifyChat({ baseUrl, apiKey, model });
  steps.push(second);
  return { ok: first.ok && second.ok, steps };
}

// ---------------------------------------------------------------------------
// 评语生成通道
// ---------------------------------------------------------------------------

// 失败路径一律 resolve 成 { ok: false }（design.md D6），降级矩阵里的每个分支都从这里出去
async function generateReviews(count) {
  const config = await readAiConfig();
  if (config.disabled) return { ok: false, reason: 'disabled' };
  if (!config.baseUrl || !config.apiKey || !config.model) return { ok: false, reason: 'not-configured' };

  const wanted = Math.max(1, Math.min(REVIEW_COUNT_CAP, Math.floor(Number(count)) || 1));
  const messages = [
    {
      role: 'system',
      content: '你是电商评价助手。请写中文商品好评，每条 40~100 字，口吻自然、像不同买家写的，具体而不空泛；不要出现 AI、客服、模板 之类的字眼，不要加引号，不要编号。',
    },
    { role: 'user', content: `写 ${wanted} 条互不相同的好评，每行一条，不要编号。` },
  ];

  const url = aiEndpoint(config.baseUrl, '/chat/completions');
  const maxTokens = Math.min(REVIEW_MAX_TOKENS_CAP, 256 + REVIEW_TOKENS_PER_ITEM * wanted);
  const { status, ok, rawBody, failure } = await aiRequest(url, { method: 'POST', apiKey: config.apiKey, body: buildChatBody(config.model, messages, maxTokens) });

  if (failure) return { ok: false, reason: classifyAiFailure({ failure, status }).category };
  if (!ok) return { ok: false, reason: classifyAiFailure({ failure: null, status }).category };

  const data = safeParseJson(rawBody);
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  if (!choice) return { ok: false, reason: 'empty' };

  // 先校验 finish_reason：为 length 说明内容被截断，半句话不能填进评价框，整批不可信（design.md D3）
  if (choice.finish_reason === 'length') return { ok: false, reason: 'truncated' };

  const reviews = splitReviews(choice.message && choice.message.content);
  if (!reviews.length) return { ok: false, reason: 'empty' };

  return { ok: true, reviews };
}

// ---------------------------------------------------------------------------
// 消息通道
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || typeof request !== 'object') return false;

  if (request.action === 'verifyAiConfig') {
    verifyAiConfig(request.config).then(sendResponse);
    return true;
  }

  if (request.action === 'generateReviews') {
    generateReviews(request.count).then(sendResponse);
    return true;
  }

  // 其余消息（如 popup 发给 content.js 的 toggleConsoleMethod）不归本文件处理
  return false;
});
