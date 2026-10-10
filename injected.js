// 保存所有原始console方法
window._originalConsoleMethods = {
  log: window.console.log,
  info: window.console.info,
  warn: window.console.warn
};

// 设置全局函数来切换单个console方法
window.toggleConsoleMethod = function(method, disable) {
  if (disable) {
    window.console[method] = function() {};
  } else {
    window.console[method] = window._originalConsoleMethods[method];
  }
};

// 监听自定义事件
document.addEventListener('TOGGLE_CONSOLE_METHOD', function(e) {
  window.toggleConsoleMethod(e.detail.method, e.detail.disable);
});
