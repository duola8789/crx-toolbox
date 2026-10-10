document.addEventListener('DOMContentLoaded', function () {
  const methods = ['log', 'info', 'warn'];
  const toggles = {};
  const statusElements = {};

  // 初始化每个方法的开关和状态显示
  methods.forEach(method => {
    toggles[method] = document.getElementById(`${method}Toggle`);
    statusElements[method] = document.getElementById(`${method}Status`);

    // 从存储中获取当前状态
    chrome.storage.local.get([`console${method}Disabled`], function (result) {
      toggles[method].checked = result[`console${method}Disabled`] || false;
      updateStatusText(method, result[`console${method}Disabled`] || false);
    });

    // 监听开关变化
    toggles[method].addEventListener('change', function () {
      const isDisabled = toggles[method].checked;

      chrome.storage.local.set({ [`console${method}Disabled`]: isDisabled }, function () {
        updateStatusText(method, isDisabled);

        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'toggleConsoleMethod',
              method: method,
              disable: isDisabled,
            });
          }
        });
      });
    });
  });

  function updateStatusText(method, isDisabled) {
    statusElements[method].textContent = isDisabled ? `${method}: 已禁用` : `${method}: 已启用`;
  }

  // 京东一键评价：只在 content.js 会响应的评价页可用，改动时须与 content.js 中 window.onload 的分支保持一致
  const JD_EVALUATE_PAGES = ['myJdcomments/myJdcomment', 'orderVoucher', 'saveCommentSuccess'];

  // AI 状态点：按钮文字前那个圈，只读、不提供任何可操作入口——开关与配置都在设置页。
  // 判定（与 spec 的「弹窗中的 AI 状态」一致）：
  //   不展示  AI 开关关着，或三项配置一项都没填（等于没配置）
  //   黄     有配置，但最近一次验证没有通过（没验过、验失败、或配置改过后失效）
  //   绿     有配置，且最近一次验证通过
  // 注意这里只读不写：弹窗永远不修改 AI 相关存储。
  const AI_CONFIG_FIELDS = ['aiBaseUrl', 'aiApiKey', 'aiModel'];

  const aiBadge = document.querySelector('#aiBadge');
  const aiStatusText = document.querySelector('#aiStatusText');
  if (aiBadge) {
    chrome.storage.local.get(['aiReviewDisabled', 'aiVerifiedOk', ...AI_CONFIG_FIELDS], function (result) {
      const filledCount = AI_CONFIG_FIELDS.filter(key => String(result[key] || '').trim()).length;
      if (result.aiReviewDisabled || filledCount === 0) {
        aiBadge.hidden = true;
        if (aiStatusText) aiStatusText.textContent = 'AI 评语未启用';
        return;
      }

      // 绿色要同时满足"三项填全"和"验证通过"：只认标记的话，标记万一过期就会谎称可用
      const verified = !!result.aiVerifiedOk && filledCount === AI_CONFIG_FIELDS.length;
      aiBadge.hidden = false;
      aiBadge.dataset.state = verified ? 'ready' : 'unverified';
      aiBadge.title = verified ? 'AI 评语：已通过验证' : 'AI 评语：尚未验证通过';
      if (aiStatusText) aiStatusText.textContent = verified ? 'AI 评语已通过验证' : 'AI 评语尚未验证通过';
    });
  }

  const jdBtn = document.querySelector('#jdBtn');
  if (jdBtn) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      const url = (tabs[0] && tabs[0].url) || '';
      jdBtn.disabled = !JD_EVALUATE_PAGES.some(page => url.includes(page));
    });

    jdBtn.addEventListener('click', function () {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'jdEvaluate',
          });
        }
      });
    });
  }
});
