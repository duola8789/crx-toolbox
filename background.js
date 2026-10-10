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
