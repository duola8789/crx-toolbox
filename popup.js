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
