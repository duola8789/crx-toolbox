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

async function onJdEvaluate() {
  // changeRuleId();
  await sleep(1000);

  const star5List = document.querySelectorAll('.commstar .star5');
  if (star5List.length) {
    for (let i = 0; i < star5List.length; i++) {
      const cur = star5List[i];
      cur.click();
      await sleep(100);
    }
  }
  const textareaList = document.querySelectorAll('textarea[placeholder="分享体验心得，给万千想买的人一个参考~"]');
  if (textareaList.length) {
    for (let i = 0; i < textareaList.length; i++) {
      const cur = textareaList[i];
      cur.value =
        '这次京东购物体验太赞了！买的商品质量超棒，材质好、做工精，完全符合我的期待。包装严实，到手毫无损坏。物流更是神速，下单没多久就收到。客服服务也贴心，有问必答。这性价比杠杠的，以后买东西就认准京东了，必须好评，推荐给大伙！';
      await sleep(500);
    }
  }

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
