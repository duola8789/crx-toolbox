// 设置页逻辑。固定 id 契约见 options.html：改动时两处必须同步。
// 本文件不接触任何网络请求——请求与密钥读取全部在 background.js（Service Worker）里。

const els = {
  aiToggle: document.getElementById('aiToggle'),
  aiStatus: document.getElementById('aiStatus'),
  aiConfig: document.getElementById('aiConfig'),
  baseUrl: document.getElementById('baseUrl'),
  apiKey: document.getElementById('apiKey'),
  apiKeyReveal: document.getElementById('apiKeyReveal'),
  model: document.getElementById('model'),
  modelList: document.getElementById('modelList'),
  save: document.getElementById('save'),
  saveHint: document.getElementById('saveHint'),
  verify: document.getElementById('verify'),
  insecureWarn: document.getElementById('insecureWarn'),
  result: document.getElementById('result'),
};

// 与 background.js 的错误分类一一对应，让「密钥错/路径错/网络不通」在界面上一眼可分
const CATEGORY_LABELS = {
  auth: '认证失败',
  path: '路径错误',
  network: '网络不可达',
  timeout: '请求超时',
  'rate-limit': '被限流',
  http: '端点错误',
  config: '配置不全',
};

let saveHintTimer = null;

// ---------------------------------------------------------------------------
// 小工具：一律用 textContent 建节点。端点的响应体是不可信输入，不能拼进 innerHTML
// ---------------------------------------------------------------------------

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// 表单当前值（验证用它，而不是已保存值——spec: 验证使用表单当前值）
function readForm() {
  return {
    baseUrl: els.baseUrl.value.trim(),
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim(),
  };
}

// ---------------------------------------------------------------------------
// 配置的读取与显式保存
// ---------------------------------------------------------------------------

function loadConfig() {
  chrome.storage.local.get(['aiBaseUrl', 'aiApiKey', 'aiModel'], result => {
    els.baseUrl.value = result.aiBaseUrl || '';
    els.apiKey.value = result.aiApiKey || '';
    els.model.value = result.aiModel || '';
    syncInsecureWarn();
  });
}

function saveConfig() {
  const { baseUrl, apiKey, model } = readForm();
  chrome.storage.local.get(['aiBaseUrl', 'aiApiKey', 'aiModel'], current => {
    const changed = String(current.aiBaseUrl || '') !== baseUrl || String(current.aiApiKey || '') !== apiKey || String(current.aiModel || '') !== model;

    const patch = { aiBaseUrl: baseUrl, aiApiKey: apiKey, aiModel: model };
    // 配置真的变了，上一次的验证结论就不再覆盖它，弹窗的状态点要退回黄色。
    // 原样重存（值没变）不作废，否则"点一下保存"就会把已验证的绿点冤枉成黄色。
    if (changed) patch.aiVerifiedOk = false;

    chrome.storage.local.set(patch, () => showSaveHint('已保存'));
  });
}

function showSaveHint(text) {
  els.saveHint.textContent = text;
  clearTimeout(saveHintTimer);
  saveHintTimer = setTimeout(() => {
    els.saveHint.textContent = '';
  }, 2000);
}

// ---------------------------------------------------------------------------
// 密钥可见性：默认掩码，主动切换才显示明文
// ---------------------------------------------------------------------------

function toggleKeyVisibility() {
  const revealed = els.apiKey.type === 'text';
  els.apiKey.type = revealed ? 'password' : 'text';
  els.apiKeyReveal.textContent = revealed ? '显示' : '隐藏';
  els.apiKeyReveal.setAttribute('aria-pressed', String(!revealed));
}

// ---------------------------------------------------------------------------
// AI 评语总开关
//
// 存储键是 aiReviewDisabled（true = 关闭），界面上的开关按正向表达，两者互为取反。
// 开关立即生效，刻意不走下面的「显式保存」：总开关还要记得按保存太反直觉。
// ---------------------------------------------------------------------------

function renderAiState(enabled) {
  els.aiStatus.textContent = enabled
    ? '当前状态：已开启，评价时优先调用 AI 生成评语。'
    : '当前状态：已关闭，评语全部取自本地词池，不会发起任何外部请求。下面的端点配置已收起，但保存的值不会被清除，重新开启即可继续使用。';
  // 关闭时收起配置区与验证结果：这里只切换显隐，绝不碰存储
  els.aiConfig.hidden = !enabled;
}

function loadAiSwitch() {
  chrome.storage.local.get(['aiReviewDisabled'], result => {
    const enabled = !result.aiReviewDisabled;
    els.aiToggle.checked = enabled;
    renderAiState(enabled);
  });
}

function toggleAiSwitch() {
  const enabled = els.aiToggle.checked;
  // 只写开关这一个键：已保存的 base_url / api_key / model 与上一次的验证结果都原样留着
  chrome.storage.local.set({ aiReviewDisabled: !enabled }, () => renderAiState(enabled));
}

// ---------------------------------------------------------------------------
// 明文传输告警
// ---------------------------------------------------------------------------

function syncInsecureWarn() {
  els.insecureWarn.hidden = !/^http:\/\//i.test(els.baseUrl.value.trim());
}

// ---------------------------------------------------------------------------
// 验证结果的渲染
// ---------------------------------------------------------------------------

function renderIdle(text) {
  els.result.textContent = '';
  els.result.appendChild(node('span', 'idle', text));
}

function renderStep(step) {
  const box = node('div', 'step');

  const head = node('div', 'step-head');
  head.appendChild(node('span', `chip ${step.ok ? 'ok' : 'fail'}`, step.ok ? '通过' : '失败'));
  head.appendChild(node('span', 'step-title', `第 ${step.step} 步 · ${step.label}`));
  box.appendChild(head);

  if (step.message) box.appendChild(node('p', 'step-msg', step.message));

  // 实际请求的完整 URL：区分类别的唯一依据，成功失败都展示
  if (step.url) {
    const line = node('p', 'kv');
    line.appendChild(node('b', null, '实际请求：'));
    line.appendChild(document.createTextNode(step.url));
    box.appendChild(line);
  }

  // 类别与状态码分开判断：网络不可达/超时时 status 为 0，但类别标签正是区分错误类型的依据
  if (step.status || step.category) {
    const line = node('p', 'kv');
    if (step.status) {
      line.appendChild(node('b', null, 'HTTP 状态：'));
      line.appendChild(document.createTextNode(String(step.status)));
    }
    if (step.category) {
      if (step.status) line.appendChild(document.createTextNode('　'));
      line.appendChild(node('b', null, '类别：'));
      line.appendChild(document.createTextNode(CATEGORY_LABELS[step.category] || step.category));
    }
    box.appendChild(line);
  }

  if (step.notice) box.appendChild(node('p', 'kv', step.notice));

  if (Array.isArray(step.models) && step.models.length) {
    const wrap = node('div', 'models');
    step.models.forEach(id => wrap.appendChild(node('span', null, id)));
    box.appendChild(wrap);
  }

  // 服务端原始错误体（已由 SW 脱敏 + 截断），失败时才有
  if (!step.ok && step.rawBody) {
    box.appendChild(node('p', 'kv', '服务端原始响应：'));
    box.appendChild(node('pre', null, step.rawBody));
  }

  return box;
}

function renderResult(result) {
  els.result.textContent = '';
  if (!result || !Array.isArray(result.steps) || !result.steps.length) {
    els.result.appendChild(node('span', 'idle', '未收到后台脚本的响应。请到 chrome://extensions 重新加载扩展后再试。'));
    return;
  }
  result.steps.forEach(step => els.result.appendChild(renderStep(step)));
}

function fillModelList(models) {
  if (!Array.isArray(models) || !models.length) return;
  els.modelList.textContent = '';
  models.forEach(id => {
    const option = document.createElement('option');
    option.value = id;
    els.modelList.appendChild(option);
  });
}

// ---------------------------------------------------------------------------
// 验证
// ---------------------------------------------------------------------------

async function runVerify() {
  const config = readForm();
  els.verify.disabled = true;
  els.verify.textContent = '验证中…';
  renderIdle('正在验证…');

  let result = null;
  try {
    result = await chrome.runtime.sendMessage({ action: 'verifyAiConfig', config });
  } catch (error) {
    result = null;
  }

  renderResult(result);
  if (result && result.steps) {
    const first = result.steps.find(step => step.step === 1);
    if (first && first.ok) fillModelList(first.models);
  }

  // 把这次的结论记下来，供弹窗的状态点判断（绿 = 通过）。两步都过才算通过。
  // 没拿到响应也记 false：状态点宁可显示"尚未验证通过"，也不要谎称可用。
  chrome.storage.local.set({ aiVerifiedOk: !!(result && result.ok) });

  els.verify.disabled = false;
  els.verify.textContent = '验证';
}

// ---------------------------------------------------------------------------
// 接线
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadAiSwitch();
  els.aiToggle.addEventListener('change', toggleAiSwitch);
  els.apiKeyReveal.addEventListener('click', toggleKeyVisibility);
  els.baseUrl.addEventListener('input', syncInsecureWarn);
  els.save.addEventListener('click', saveConfig);
  els.verify.addEventListener('click', runVerify);
});
