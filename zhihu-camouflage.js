(() => {
  'use strict';

  const ENABLED_KEY = 'zhihuCamouflageEnabled';
  // 与 zhihu-camouflage.css 的门控属性保持一致
  const HTML_FLAG = 'data-crx-zhihu-camo';
  const SHELL_FLAG = 'data-crx-camo-shell';
  const INLINE_DIAGRAM_FLAG = 'data-crx-inline-diagram';
  const CARD_DIAGRAM_FLAG = 'data-crx-card-diagram';
  const INLINE_MIN_TEXT = 1200;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // 伪标题与正文完全解耦：不包含「知乎」、问题标题或回答内容。
  // 按 URL 做稳定哈希，同一个 URL 永远得到同一个标题。
  const DOC_TITLES = [
    '分布式缓存一致性设计笔记',
    '消息补偿与最终一致性 · 设计评审',
    '高并发库存系统 · V5a 收口',
    '订单链路幂等设计 · 技术方案',
    '服务端一致性对账 · 实现说明',
    '异步消息可靠性 · 故障复盘',
    '库存预扣与补单 · 架构笔记',
    '缓存与数据库双写 · 一致性方案',
  ];

  const SECTION_LABELS = ['01 版本定位', '02 消息补偿', '03 幂等与重试', '04 对账与修复', '05 故障与边界', '06 验收与上线', '07 风险与决策', '08 实现细节'];

  // 左侧目录：参考 POPO 团队空间侧边栏的树形结构
  const TOC_TREE = [
    { type: 'doc', label: 'CloudFlare恢复码' },
    {
      type: 'folder',
      label: 'IM 爬虫',
      open: true,
      children: [
        { type: 'folder', label: 'Agent 能力融合' },
        { type: 'folder', label: 'ChinaSource 官网' },
        { type: 'folder', label: 'AgentScope 技术文档' },
        {
          type: 'folder',
          label: 'Agent 质量保障与智能排障',
          open: true,
          children: [
            { type: 'doc', label: 'Agent 质量保障与智能排障' },
            { type: 'doc', label: 'AI 自动化业务问题排查' },
            { type: 'doc', label: 'Agent 行为指标监控体系', active: true },
          ],
        },
      ],
    },
    { type: 'folder', label: '法律文档' },
    { type: 'folder', label: 'EaseSourcing' },
    { type: 'folder', label: 'mailgo' },
    { type: 'folder', label: 'LeadsNavi' },
    { type: 'folder', label: '产品KP会' },
    { type: 'folder', label: '出海项目-内容' },
    { type: 'folder', label: '出海项目-周报进展' },
    { type: 'folder', label: '运营团队周报/月报' },
  ];

  let enabled = false;
  let titleObserver = null;
  let faviconObserver = null;
  let applyingTitle = false;
  let lastPageTitle = '';
  let lastAppliedFakeTitle = '';
  let createdFaviconLink = null;
  let diagramTimer = null;
  let diagramAttempts = 0;
  let cachedFaviconUrl;
  const originalFavicon = new WeakMap();

  init();

  async function init() {
    try {
      const state = await chrome.storage.local.get(ENABLED_KEY);
      setEnabled(!!state[ENABLED_KEY]);
    } catch (error) {
      // 读取失败时保持关闭，不影响页面
    }

    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        const change = changes[ENABLED_KEY];
        if (change) setEnabled(!!change.newValue);
      });
    } catch (error) {
      // 扩展上下文失效时静默退出
    }
  }

  function setEnabled(next) {
    if (next === enabled) return;
    enabled = next;

    try {
      if (enabled) enable();
      else disable();
    } catch (error) {
      // 任何失败都不能产生未捕获异常，也不能阻断页面脚本
    }
  }

  function enable() {
    if (!document.documentElement) return;

    try {
      document.documentElement.setAttribute(HTML_FLAG, '');
    } catch (error) {
      // 属性写入失败时下面的步骤仍尽量执行
    }

    try {
      startTitleGuard();
    } catch (error) {
      // 标题接管失败不影响其余伪装
    }

    try {
      startFaviconGuard();
    } catch (error) {
      // favicon 接管失败不影响其余伪装
    }

    try {
      ensureShell();
    } catch (error) {
      // 外壳注入失败保留标题、图标与配色
    }

    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('load', onMediaLoad, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    diagramAttempts = 0;
    scheduleDiagrams(800);
    window.addEventListener('popstate', onNavigation);
    window.addEventListener('hashchange', onNavigation);
  }

  function disable() {
    clearTimeout(diagramTimer);
    diagramTimer = null;
    diagramAttempts = 0;

    try {
      stopTitleGuard();
    } catch (error) {
      // 恢复标题失败时继续恢复其余部分
    }

    try {
      stopFaviconGuard();
    } catch (error) {
      // 恢复图标失败时继续恢复其余部分
    }

    try {
      removeDiagrams();
    } catch (error) {
      // 清理正文架构图失败时继续恢复其余部分
    }

    try {
      removeShell();
    } catch (error) {
      // 外壳移除失败时仍移除门控属性
    }

    try {
      document.documentElement.removeAttribute(HTML_FLAG);
    } catch (error) {
      // 属性移除失败时保持静默
    }

    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('load', onMediaLoad, true);
    document.querySelectorAll('.crx-camo-hide-video').forEach(element => element.classList.remove('crx-camo-hide-video'));
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('popstate', onNavigation);
    window.removeEventListener('hashchange', onNavigation);
  }

  function onNavigation() {
    if (!enabled) return;

    try {
      applyFakeTitle();
    } catch (error) {
      // 导航时标题处理失败不影响页面
    }

    try {
      ensureShell();
    } catch (error) {
      // 外壳重注入失败不影响页面
    }

    try {
      removeDiagrams();
    } catch (error) {
      // 旧页面的正文架构图清理失败不影响新页面
    }

    diagramAttempts = 0;
    scheduleDiagrams(800);
  }

  // ---------------------------------------------------------------------------
  // 页签标题：只改写页面已有的 <title>，不新建标题节点
  // ---------------------------------------------------------------------------
  function startTitleGuard() {
    if (titleObserver) return;

    const head = document.head;
    if (!head) {
      document.addEventListener('DOMContentLoaded', startTitleGuard, { once: true });
      return;
    }

    applyFakeTitle();
    titleObserver = new MutationObserver(() => {
      if (!enabled) return;
      try {
        applyFakeTitle();
      } catch (error) {
        // 观察器内部异常不能冒泡到页面
      }
    });
    titleObserver.observe(head, { childList: true, subtree: true, characterData: true });
  }

  function stopTitleGuard() {
    if (titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
    }

    const titleElement = findTitleElement();
    if (titleElement && titleElement.textContent === lastAppliedFakeTitle) {
      titleElement.textContent = lastPageTitle;
    }

    applyingTitle = false;
    lastAppliedFakeTitle = '';
  }

  function applyFakeTitle() {
    const titleElement = findTitleElement();
    if (!titleElement) return;

    const fakeTitle = fakeTitleFor(location.href);
    const current = titleElement.textContent;
    if (!fakeTitle || current === fakeTitle) return;

    // 页面自己写入的标题要记下来，关闭伪装时恢复；自己写入的伪标题不记录
    if (!applyingTitle && current !== lastAppliedFakeTitle) {
      lastPageTitle = current;
    }

    applyingTitle = true;
    titleElement.textContent = fakeTitle;
    lastAppliedFakeTitle = fakeTitle;
    queueMicrotask(() => {
      applyingTitle = false;
    });

    ensureShell();
  }

  function findTitleElement() {
    if (document.head) return document.head.querySelector('title');
    return document.querySelector('title');
  }

  function fakeTitleFor(url) {
    const hash = hashString(String(url || ''));
    const title = DOC_TITLES[hash % DOC_TITLES.length];
    const section = SECTION_LABELS[Math.floor(hash / DOC_TITLES.length) % SECTION_LABELS.length];
    return `${section} · ${title}`;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  // ---------------------------------------------------------------------------
  // favicon：保存页面原有 icon 链接，替换为扩展内置的中性文档图标
  // ---------------------------------------------------------------------------

  function startFaviconGuard() {
    if (faviconObserver) return;

    const head = document.head;
    if (!head) {
      document.addEventListener('DOMContentLoaded', startFaviconGuard, { once: true });
      return;
    }

    applyFavicon();
    faviconObserver = new MutationObserver(() => {
      if (!enabled) return;
      try {
        applyFavicon();
      } catch (error) {
        // 观察器内部异常不能冒泡到页面
      }
    });
    faviconObserver.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] });
  }

  function stopFaviconGuard() {
    if (faviconObserver) {
      faviconObserver.disconnect();
      faviconObserver = null;
    }

    const url = faviconUrl();
    for (const link of iconLinks()) {
      if (link === createdFaviconLink) continue;

      const original = originalFavicon.get(link);
      if (!original) {
        if (url && link.getAttribute('href') === url) link.removeAttribute('href');
        continue;
      }

      if (original.href === null) link.removeAttribute('href');
      else link.setAttribute('href', original.href);

      if (original.type === null) link.removeAttribute('type');
      else link.setAttribute('type', original.type);
    }

    if (createdFaviconLink && createdFaviconLink.isConnected) createdFaviconLink.remove();
    createdFaviconLink = null;
  }

  function applyFavicon() {
    const url = faviconUrl();
    if (!url) return;

    const head = document.head;
    if (!head) return;

    const links = iconLinks();
    if (!links.length) {
      if (!createdFaviconLink || !createdFaviconLink.isConnected) {
        createdFaviconLink = document.createElement('link');
        createdFaviconLink.setAttribute('data-crx-camo-favicon', '');
        createdFaviconLink.setAttribute('rel', 'icon');
        createdFaviconLink.setAttribute('type', 'image/svg+xml');
        createdFaviconLink.setAttribute('href', url);
        head.appendChild(createdFaviconLink);
      }
      return;
    }

    for (const link of links) {
      if (link === createdFaviconLink) continue;

      const currentHref = link.getAttribute('href');
      const currentType = link.getAttribute('type');
      if (!originalFavicon.has(link)) {
        originalFavicon.set(link, { href: currentHref, type: currentType });
      } else if (currentHref !== url) {
        // 页面在伪装期间重写了图标：把最新的页面值记为恢复目标
        originalFavicon.set(link, { href: currentHref, type: currentType });
      }

      if (currentHref !== url) link.setAttribute('href', url);
      if (currentType !== 'image/svg+xml') link.setAttribute('type', 'image/svg+xml');
    }
  }

  function iconLinks() {
    return Array.from(document.querySelectorAll('link[rel]')).filter(link => {
      const rel = (link.getAttribute('rel') || '').toLowerCase();
      return rel.split(/\s+/).includes('icon');
    });
  }

  function faviconUrl() {
    if (cachedFaviconUrl !== undefined) return cachedFaviconUrl;
    try {
      cachedFaviconUrl = chrome.runtime.getURL('src/assets/doc-icon.svg');
    } catch (error) {
      cachedFaviconUrl = '';
    }
    return cachedFaviconUrl;
  }

  // ---------------------------------------------------------------------------
  // 伪文档外壳：页眉、架构图、页脚。只插入自己的节点，不替换知乎内容。
  // ---------------------------------------------------------------------------

  function ensureShell() {
    if (!enabled) return;

    if (!document.body) {
      document.addEventListener('DOMContentLoaded', ensureShell, { once: true });
      return;
    }

    try {
      if (!document.querySelector('.crx-camo-top')) {
        const top = document.createElement('div');
        top.className = 'crx-camo-top';
        top.setAttribute(SHELL_FLAG, '');
        top.appendChild(createHeader());
        top.appendChild(createDiagram());
        document.body.insertBefore(top, document.body.firstChild);
      }

      if (!document.querySelector('.crx-camo-footer')) {
        const footer = document.createElement('footer');
        footer.className = 'crx-camo-footer';
        footer.setAttribute(SHELL_FLAG, '');
        footer.textContent = '内部技术资料 · 请勿外传';
        document.body.appendChild(footer);
      }

      if (!document.querySelector('.crx-camo-toc')) {
        const toc = createToc();
        toc.setAttribute(SHELL_FLAG, '');
        document.body.appendChild(toc);
      }
    } catch (error) {
      // 外壳注入失败时保留标题、图标与配色伪装
    }

    scheduleDiagrams(800);
  }

  function removeShell() {
    try {
      document.querySelectorAll(`[${SHELL_FLAG}]`).forEach(node => node.remove());
    } catch (error) {
      // 移除失败时保持静默
    }
  }

  function onDocumentClick(event) {
    const target = event.target;
    if (target instanceof Element && target.closest('.ContentItem-more')) {
      diagramAttempts = 0;
      scheduleDiagrams(500);
    }
  }

  function onScroll() {
    scheduleDiagrams(300);
  }

  function onMediaLoad(event) {
    if (event.target instanceof HTMLVideoElement) hideVideoPlayers();
  }

  function scheduleDiagrams(delay) {
    if (!enabled) return;

    clearTimeout(diagramTimer);
    diagramTimer = setTimeout(() => {
      diagramTimer = null;
      if (!enabled) return;

      hideVideoPlayers();
      const inlineInserted = insertInlineDiagram();
      const cardInserted = insertCardDiagrams();
      if (inlineInserted || cardInserted) {
        diagramAttempts = 0;
        return;
      }

      if (diagramAttempts < 3) {
        diagramAttempts++;
        scheduleDiagrams(1500);
      }
    }, delay);
  }

  // 视频播放器常是哈希类名，直接按 video 元素向上找足够大的播放器容器
  function hideVideoPlayers() {
    if (!enabled) return;

    for (const video of document.querySelectorAll('video')) {
      video.classList.add('crx-camo-hide-video');

      let node = video.parentElement;
      for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
        // 正文容器本身不能被当成播放器容器隐藏；正文里的媒体块由 CSS 顶层规则负责
        if (node.matches('.RichContent, .Post-RichText, .RichText')) break;

        let rect;
        try {
          rect = node.getBoundingClientRect();
        } catch (error) {
          break;
        }

        if (rect.width >= 240 && rect.height >= 135) {
          node.classList.add('crx-camo-hide-video');
          break;
        }
      }
    }
  }

  // 长正文里随机插入同一份架构图：只插一份，避免整页都是图
  function insertInlineDiagram() {
    if (!enabled || !document.body) return false;
    if (document.querySelector(`[${INLINE_DIAGRAM_FLAG}]`)) return true;

    const all = Array.from(document.querySelectorAll('.RichContent, .Post-RichText, .RichText'));
    const candidates = all.filter(content => {
      if (content.closest(`[${SHELL_FLAG}]`)) return false;
      if (content.closest('.is-collapsed')) return false;
      return content.textContent.trim().length >= INLINE_MIN_TEXT;
    });

    // 去掉被另一个候选包含的节点，避免同一段正文被插入两次
    const outermost = candidates.filter(content => !candidates.some(other => other !== content && other.contains(content)));
    if (!outermost.length) return false;

    const content = outermost[Math.floor(Math.random() * outermost.length)];
    const blocks = Array.from(content.children).filter(element => /^(P|DIV|SECTION|BLOCKQUOTE|FIGURE|UL|OL|H[1-6])$/.test(element.tagName));
    if (blocks.length < 3) return false;

    // 在前半段的随机段落之后插入，既随机又能让读者更早看到
    const maxIndex = Math.max(1, Math.floor(blocks.length / 2));
    const index = 1 + Math.floor(Math.random() * maxIndex);
    const diagram = createDiagram();
    diagram.classList.add('crx-camo-inline-diagram');
    diagram.setAttribute(INLINE_DIAGRAM_FLAG, '');

    const label = diagram.querySelector('.crx-camo-section-label');
    if (label) label.textContent = '架构示意';

    try {
      blocks[index].after(diagram);
      // 同一张卡片的列表图与正文内嵌图不重复
      const card = findOuterCard(content);
      if (card) card.querySelectorAll(`[${CARD_DIAGRAM_FLAG}]`).forEach(node => node.remove());
      return true;
    } catch (error) {
      return false;
    }
  }

  // 信息流/列表：在卡片内部底部插紧凑架构图，不改列表结构
  function insertCardDiagrams() {
    if (!enabled || !document.body) return false;

    const contents = Array.from(document.querySelectorAll('.RichContent, .Post-RichText, .RichText'));
    const cards = new Set();

    for (const content of contents) {
      if (content.closest(`[${SHELL_FLAG}]`)) continue;
      if (content.textContent.trim().length < 200) continue;
      const card = findOuterCard(content);
      if (card) cards.add(card);
    }

    let inserted = false;
    for (const card of cards) {
      if (card.querySelector(`[${CARD_DIAGRAM_FLAG}]`)) continue;
      if (card.querySelector(`[${INLINE_DIAGRAM_FLAG}]`)) continue;

      const diagram = createDiagram();
      diagram.classList.add('crx-camo-card-diagram');
      diagram.setAttribute(CARD_DIAGRAM_FLAG, '');

      const label = diagram.querySelector('.crx-camo-section-label');
      if (label) label.textContent = '架构示意';

      const actions = card.querySelector('.ContentItem-actions');
      try {
        if (actions) actions.before(diagram);
        else card.appendChild(diagram);
        inserted = true;
      } catch (error) {
        // 单张卡片插入失败时继续处理其他卡片
      }
    }

    return inserted;
  }

  function findOuterCard(content) {
    return content.closest('.TopstoryItem') || content.closest('.Feed') || content.closest('.List-item') || content.closest('.ContentItem');
  }

  function removeDiagrams() {
    document.querySelectorAll(`[${INLINE_DIAGRAM_FLAG}], [${CARD_DIAGRAM_FLAG}]`).forEach(node => node.remove());
  }

  function createToc() {
    const nav = document.createElement('nav');
    nav.className = 'crx-camo-toc';
    nav.setAttribute('aria-hidden', 'true');

    const breadcrumb = tocEl('div', 'crx-camo-toc-breadcrumb');
    breadcrumb.append(tocEl('span', '', '云空间'), tocEl('span', 'crx-camo-toc-sep', '›'), tocEl('span', '', '团队空间'));

    const team = tocEl('div', 'crx-camo-toc-team');
    team.append(tocEl('span', 'crx-camo-toc-avatar', '*'), tocEl('span', 'crx-camo-toc-team-name', '出海项目组'), tocEl('span', 'crx-camo-toc-chevron', '⌄'));

    const search = tocEl('div', 'crx-camo-toc-search');
    search.append(tocIcon('search'), tocEl('span', '', '搜索'));

    const home = tocEl('div', 'crx-camo-toc-row');
    home.append(tocIcon('home'), tocEl('span', 'crx-camo-toc-label', '首页'));

    const header = tocEl('div', 'crx-camo-toc-header');
    const headerLabel = tocEl('span', 'crx-camo-toc-header-label');
    headerLabel.append(tocIcon('list'), tocEl('span', '', '目录'));
    header.append(headerLabel, tocEl('span', 'crx-camo-toc-actions', '≡  +'));

    const footer = tocEl('div', 'crx-camo-toc-footer');
    for (const [icon, label] of [
      ['cloud', '从云空间迁入'],
      ['upload', '上传本地文件'],
      ['trash', '回收站'],
    ]) {
      const row = tocEl('div', 'crx-camo-toc-row');
      row.append(tocIcon(icon), tocEl('span', 'crx-camo-toc-label', label));
      if (icon === 'upload') row.append(tocEl('span', 'crx-camo-toc-chevron', '›'));
      footer.appendChild(row);
    }

    nav.append(breadcrumb, team, search, home, header, createTocTree(TOC_TREE), footer);
    return nav;
  }

  function tocEl(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function tocIcon(name) {
    const paths = {
      home: 'M2 7.5 8 2l6 5.5V14H2z',
      search: 'M7 2a5 5 0 1 0 3.2 8.8L14 14',
      list: 'M3 4h10M3 8h10M3 12h6',
      folder: 'M2 4h4l1.5 2H14v7H2z',
      doc: 'M4 2h5l3 3v9H4z M9 2v3h3',
      chevron: 'M6 4l4 4-4 4',
      cloud: 'M4 11a3 3 0 0 1 .4-6 4 4 0 0 1 7.6 1.2A2.5 2.5 0 0 1 12 11z',
      upload: 'M8 12V3m0 0L5 6m3-3 3 3M3 13h10',
      trash: 'M3 5h10M6 5V3h4v2m-6 0 1 9h6l1-9',
    };

    const svg = svgElement('svg', { viewBox: '0 0 16 16', width: '14', height: '14', 'aria-hidden': 'true', class: 'crx-camo-toc-icon' });
    const path = svgElement('path', {
      d: paths[name] || '',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.4',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    });
    svg.appendChild(path);

    if (name === 'chevron') svg.classList.add('crx-camo-toc-chevron');
    if (name === 'folder') svg.classList.add('crx-camo-toc-folder');
    if (name === 'doc') svg.classList.add('crx-camo-toc-doc-icon');

    return svg;
  }

  function createTocTree(items) {
    const list = document.createElement('ul');
    list.className = 'crx-camo-toc-tree';

    for (const item of items) {
      const node = document.createElement('li');
      node.className = `crx-camo-toc-item crx-camo-toc-item--${item.type}${item.open ? ' is-open' : ''}${item.active ? ' is-active' : ''}`;

      const row = tocEl('div', 'crx-camo-toc-row');
      if (item.type === 'folder') row.appendChild(tocIcon('chevron'));
      else row.appendChild(tocEl('span', 'crx-camo-toc-icon-spacer'));
      row.appendChild(tocIcon(item.type === 'folder' ? 'folder' : 'doc'));
      row.appendChild(tocEl('span', 'crx-camo-toc-label', item.label));
      node.appendChild(row);

      if (item.children && item.children.length) node.appendChild(createTocTree(item.children));
      list.appendChild(node);
    }

    return list;
  }

  function createHeader() {
    const header = document.createElement('header');
    header.className = 'crx-camo-header';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'crx-camo-eyebrow';
    eyebrow.textContent = 'TEAM DOCS · 2026';

    const path = document.createElement('span');
    path.className = 'crx-camo-path';
    path.textContent = '团队空间 / 出海项目组 / Agent 行为指标监控体系';

    header.append(eyebrow, path);
    return header;
  }

  function createDiagram() {
    const section = document.createElement('section');
    section.className = 'crx-camo-diagram';
    section.setAttribute('aria-hidden', 'true');

    const label = document.createElement('div');
    label.className = 'crx-camo-section-label';
    label.textContent = '02 · 总体架构';

    section.appendChild(label);
    section.appendChild(createArchitectureSvg());
    return section;
  }

  function createArchitectureSvg() {
    const svg = svgElement('svg', { viewBox: '0 0 1200 230', 'aria-hidden': 'true', focusable: 'false' });

    const defs = svgElement('defs');
    const marker = svgElement('marker', {
      id: 'crx-camo-arrow',
      viewBox: '0 0 10 10',
      refX: '9',
      refY: '5',
      markerWidth: '7',
      markerHeight: '7',
      orient: 'auto-start-reverse',
    });
    marker.appendChild(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'crx-camo-arrow-head' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    const boxWidth = 150;
    const boxHeight = 56;
    const boxY = 70;
    const nodes = [
      { x: 20, title: '对话 Agent 服务', sub: '产生观测' },
      { x: 215, title: 'Langfuse', sub: '链路追踪平台' },
      { x: 410, title: '运营后台服务', sub: '周度调度任务' },
      { x: 605, title: 'OceanBase', sub: '三张指标表' },
      { x: 800, title: '查询接口', sub: '指标数据' },
      { x: 995, title: 'Agent 指标页', sub: '周报与趋势' },
    ];
    const edgeLabels = ['OTel 上报', 'REST 拉取', '幂等落库', '查询', '展示'];

    for (let i = 0; i < nodes.length - 1; i++) {
      const x1 = nodes[i].x + boxWidth;
      const x2 = nodes[i + 1].x;
      const y = boxY + boxHeight / 2;
      svg.appendChild(svgElement('line', { x1, y1: y, x2, y2: y, class: 'crx-camo-arrow', 'marker-end': 'url(#crx-camo-arrow)' }));

      const edgeLabel = svgElement('text', { x: (x1 + x2) / 2, y: boxY + boxHeight + 30, class: 'crx-camo-edge-label', 'text-anchor': 'middle' });
      edgeLabel.textContent = edgeLabels[i];
      svg.appendChild(edgeLabel);
    }

    for (const node of nodes) {
      svg.appendChild(svgElement('rect', { x: node.x, y: boxY, width: boxWidth, height: boxHeight, rx: 8, class: 'crx-camo-box' }));

      const title = svgElement('text', {
        x: node.x + boxWidth / 2,
        y: boxY + 23,
        class: 'crx-camo-box-text',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
      title.textContent = node.title;
      svg.appendChild(title);

      const sub = svgElement('text', {
        x: node.x + boxWidth / 2,
        y: boxY + 41,
        class: 'crx-camo-box-subtext',
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      });
      sub.textContent = node.sub;
      svg.appendChild(sub);
    }

    return svg;
  }

  function svgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    return element;
  }
})();
