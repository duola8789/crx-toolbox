// 保存原始的console方法
const originalConsoleMethods = {
  log: window.console.log,
  info: window.console.info,
  warn: window.console.warn,
};

// 检查每个方法的初始状态
chrome.storage.local.get(['consolelogDisabled', 'consoleinfoDisabled', 'consolewarnDisabled'], function (result) {
  Object.keys(originalConsoleMethods).forEach(method => {
    if (result[`console${method}Disabled`]) {
      disableConsoleMethod(method);
    }
  });
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === 'toggleConsoleMethod') {
    if (request.disable) {
      disableConsoleMethod(request.method);
    } else {
      enableConsoleMethod(request.method);
    }
    sendResponse({ success: true });
    triggerToggleEvent(request.method, request.disable);
  } else if (request.action === 'jdEvaluate') {
    onJdEvaluate();
  }
  return true;
});

function disableConsoleMethod(method) {
  window.console[method] = function () {};
}

function enableConsoleMethod(method) {
  window.console[method] = originalConsoleMethods[method];
}

function triggerToggleEvent(method, disable) {
  const event = new CustomEvent('TOGGLE_CONSOLE_METHOD', {
    detail: { method, disable },
  });
  document.dispatchEvent(event);
}

// 注入脚本到页面
function injectScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  document.documentElement.appendChild(script);
}

function sleep(time) {
  return new Promise(resolve => {
    setTimeout(resolve, time);
  });
}

function changeRuleId() {
  const orderNo = document.querySelector('.o-info a');
  if (orderNo) {
    window.location.quer = `ruleid=${orderNo.innerText}`;
  }
}

// ============================================================================
// AI 评语与本地词池
//
// 本文件不接触 api_key：请求由 background.js 发起，这里只发一条消息、拿结果。
// 拿不到结果就用下面的本地词池，任何情况下都不打断评价流程。
// ============================================================================

const AI_REVIEW_DISABLED_KEY = 'aiReviewDisabled';

// 与 background.js 的 REVIEW_MAX_LENGTH 必须保持一致（两处同步，同 JD 页面 URL 清单的约定）
const REVIEW_MAX_LENGTH = 500;

// 保底词池（design.md D9）：AI 关闭、未配置、请求失败、超时、返回内容不合规时都用它
// 内联在这里而不是独立文件——项目没有 ESM，独立文件得靠 manifest 的 js 数组顺序保证先加载
const LOCAL_REVIEW_POOL = [
  '这次京东购物体验太赞了！买的商品质量超棒，材质好、做工精，完全符合我的期待。包装严实，到手毫无损坏。物流更是神速，下单没多久就收到。客服服务也贴心，有问必答。这性价比杠杠的，以后买东西就认准京东了，必须好评，推荐给大伙！',
  '商品质量没得说，细节处理得到位，用了一周没有任何问题。包装也很用心，里外两层，完全不用担心运输磕碰。物流速度很快，前一天下单第二天就到了，整体非常满意，值得推荐给身边的朋友。',
  '买之前对比了好几家，最后还是选了这个，事实证明没选错。做工扎实，手感很好，价格也实在。京东自营的配送一如既往地稳，售后也让人放心，下次还会再来。',
  '收到货就迫不及待拆开了，实物比图片还好看，颜色正、没有色差。用了几天各方面表现都符合预期，家里人也说买得值，好评送上，有需要的可以放心下单。',
  '已经是第好几次在京东买东西了，这次同样没让人失望。东西是正品，包装完好，发货和配送都很快。客服回复也及时，问的问题都解答清楚了。综合来看性价比很高，会继续回购。',
  '东西挺实用的，做工比想象中好，边角处理得干净，没有毛刺也没有异味。价格不贵，赶上活动更划算。物流给力，快递小哥还帮忙送到了门口，整体体验很顺畅。',
];

function shuffleArray(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 写入前的评语校验：空串或超长都不写、不提交（spec: 写入前的评语校验）
function isReviewAcceptable(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= REVIEW_MAX_LENGTH;
}

// 取一批 AI 评语；AI 关闭时直接返回 null，不发起任何请求，时序与变更前一致
async function requestAiReviews(count) {
  if (count <= 0) return null;
  try {
    const state = await chrome.storage.local.get(AI_REVIEW_DISABLED_KEY);
    if (state[AI_REVIEW_DISABLED_KEY]) return null;

    const response = await chrome.runtime.sendMessage({ action: 'generateReviews', count });
    if (response && response.ok && Array.isArray(response.reviews) && response.reviews.length) return response.reviews;
  } catch (error) {
    // 静默降级：不弹窗、不重试、不打断流程（design.md D6）
  }
  return null;
}

// 填字：AI 结果，否则本地词池。返回 false 表示有输入框不合规，调用方不应提交
async function fillReviewTextareas(textareaList, aiReviews) {
  if (!textareaList.length) return true;

  // 先洗牌再按序取，保证同页 N 个输入框两两不同；N 超过词池长度时循环取
  const pool = shuffleArray(LOCAL_REVIEW_POOL);

  for (let i = 0; i < textareaList.length; i++) {
    const candidate = aiReviews && aiReviews[i];
    const text = isReviewAcceptable(candidate) ? candidate.trim() : pool[i % pool.length];

    if (!isReviewAcceptable(text)) return false;

    textareaList[i].value = text;
    await sleep(500);
  }
  return true;
}

async function onJdEvaluate() {
  // changeRuleId();
  await sleep(1000);

  const star5List = document.querySelectorAll('.commstar .star5');
  const textareaList = document.querySelectorAll('textarea[placeholder="分享体验心得，给万千想买的人一个参考~"]');

  // 先把生成请求发出去，再点星：两者并行，下面这段等待窗口被顺带吃掉一部分（design.md D8）
  const pendingReviews = requestAiReviews(textareaList.length);

  if (star5List.length) {
    for (let i = 0; i < star5List.length; i++) {
      const cur = star5List[i];
      cur.click();
      await sleep(100);
    }
  }

  const aiReviews = await pendingReviews;
  const filled = await fillReviewTextareas(textareaList, aiReviews);
  if (!filled) return;

  const submitBtn = document.querySelector('.btn-submit');
  if (submitBtn) {
    submitBtn.click();
  }
}

async function onJdEvaluateList() {
  // 评价按钮
  const newOne = document.querySelector('.operate .btn-def');

  if (newOne) {
    newOne.setAttribute('target', '_self');
    await sleep(500);
    newOne.click();
  }
  onJdEvaluate();
}

async function onJdEvaluateMore() {
  await sleep(500);

  const more = document.querySelector('.tip-hint a');
  if (more) {
    more.click();
  }
}

// 立即执行注入
injectScript();

window.onload = function () {
  setTimeout(() => {
    const href = window.location.href;
    if (href.includes('myJdcomments/myJdcomment')) {
      onJdEvaluateList();
    } else if (href.includes('orderVoucher')) {
      onJdEvaluate();
    } else if (href.includes('saveCommentSuccess')) {
      onJdEvaluateMore();
    }
  }, 500);
};
