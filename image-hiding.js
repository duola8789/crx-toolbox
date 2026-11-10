(() => {
  'use strict';

  const LARGE_IMAGE_KEY = 'hideLargeImagesEnabled';
  // 与 image-hiding.css 的门控属性保持一致
  const HTML_FLAG = 'data-crx-hide-large-images';
  const IMAGE_MARK = 'data-crx-large-image';

  // 判定只看渲染尺寸，不看原始像素或文件大小；与 spec 的「大图判定」一致
  const MIN_WIDTH = 400;
  const MIN_HEIGHT = 300;

  // PDF2HTMLEX 等阅读器把每一页渲染成一张背景图（img.bi），隐藏会直接破坏阅读器
  const EXCLUDED_IMAGE_SELECTOR = '[class*="2html-viewer"], [class*="2htmlEX"]';

  let enabled = false;
  let mutationObserver = null;
  let resizeObserver = null;
  let scheduled = false;
  const observedImages = new Set();

  init();

  async function init() {
    try {
      const state = await chrome.storage.local.get(LARGE_IMAGE_KEY);
      setEnabled(!!state[LARGE_IMAGE_KEY]);
    } catch (error) {
      // 读取失败时保持关闭，不影响页面
    }

    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[LARGE_IMAGE_KEY];
        if (change) setEnabled(!!change.newValue);
      });
    } catch (error) {
      // 扩展上下文失效时静默退出
    }
  }

  function setEnabled(next) {
    if (next === enabled) return;
    enabled = next;

    if (enabled) {
      try {
        document.documentElement.setAttribute(HTML_FLAG, '');
      } catch (error) {
        // 属性写入失败时仍尝试启动扫描
      }

      try {
        startObservers();
      } catch (error) {
        // 观察器启动失败不影响页面
      }

      scheduleScan();
      return;
    }

    try {
      stopObservers();
    } catch (error) {
      // 停止观察器失败时继续清理标记
    }

    try {
      clearMarks();
    } catch (error) {
      // 清理标记失败时仍移除门控属性
    }

    try {
      document.documentElement.removeAttribute(HTML_FLAG);
    } catch (error) {
      // 属性移除失败时保持静默
    }
  }

  function startObservers() {
    if (!mutationObserver) {
      mutationObserver = new MutationObserver(handleMutations);
    }
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset'],
    });

    if (!resizeObserver && typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(handleResizeEntries);
    }

    document.addEventListener('load', handleImageLoad, true);
    window.addEventListener('resize', scheduleScan, { passive: true });
  }

  function stopObservers() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    observedImages.clear();
    document.removeEventListener('load', handleImageLoad, true);
    window.removeEventListener('resize', scheduleScan);
  }

  function handleMutations(mutations) {
    if (!enabled) return;

    for (const mutation of mutations) {
      // src / srcset 变化后重新判定；先去掉旧标记，否则会被折叠成 0 尺寸而无法测量
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement && mutation.target.hasAttribute(IMAGE_MARK)) {
        mutation.target.removeAttribute(IMAGE_MARK);
      }
    }

    scheduleScan();
  }

  function handleResizeEntries(entries) {
    if (!enabled) return;

    for (const entry of entries) {
      const image = entry.target;
      if (!(image instanceof HTMLImageElement) || image.hasAttribute(IMAGE_MARK)) continue;
      evaluateImage(image);
    }
  }

  function handleImageLoad(event) {
    if (event.target instanceof HTMLImageElement) scheduleScan();
  }

  function scheduleScan() {
    if (!enabled || scheduled) return;
    scheduled = true;

    requestAnimationFrame(() => {
      scheduled = false;
      if (enabled) scanAll();
    });
  }

  function scanAll() {
    try {
      pruneObservedImages();

      const images = document.images;
      for (let i = 0; i < images.length; i++) {
        evaluateImage(images[i]);
      }
    } catch (error) {
      // 单次扫描失败不影响后续扫描与页面本身
    }
  }

  function evaluateImage(image) {
    if (!image || !image.isConnected) return;

    if (isExcludedImage(image)) {
      // 之前若被误标，先撤销，避免阅读器页面继续空着
      if (image.hasAttribute(IMAGE_MARK)) image.removeAttribute(IMAGE_MARK);
      return;
    }

    observeImage(image);
    if (image.hasAttribute(IMAGE_MARK)) return;

    let rect;
    try {
      rect = image.getBoundingClientRect();
    } catch (error) {
      return;
    }

    if (rect.width >= MIN_WIDTH || rect.height >= MIN_HEIGHT) {
      try {
        image.setAttribute(IMAGE_MARK, '');
      } catch (error) {
        // 属性写入失败时跳过该图片
      }
    }
  }

  function observeImage(image) {
    if (!resizeObserver || observedImages.has(image)) return;
    observedImages.add(image);
    resizeObserver.observe(image);
  }

  function isExcludedImage(image) {
    if (image.classList.contains('bi')) return true;
    return !!image.closest(EXCLUDED_IMAGE_SELECTOR);
  }

  function pruneObservedImages() {
    if (!resizeObserver) return;
    for (const image of observedImages) {
      if (!image.isConnected) {
        resizeObserver.unobserve(image);
        observedImages.delete(image);
      }
    }
  }

  function clearMarks() {
    try {
      document.querySelectorAll(`img[${IMAGE_MARK}]`).forEach(image => image.removeAttribute(IMAGE_MARK));
    } catch (error) {
      // 恢复失败时保持静默
    }
  }
})();
