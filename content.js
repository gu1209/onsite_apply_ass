'use strict';

const CACHE_KEY    = 'oaa_data';
const SETTINGS_KEY = 'oaa_settings';

// ─────────────────────────────────────────────────────────────
// 解析器
// ─────────────────────────────────────────────────────────────

function parseProfile(doc) {
  const items = [];
  const push = (title, buttonText, fillContent) => { if (fillContent) items.push({ title, buttonText, fillContent }); };

  const h1 = doc.querySelector('h1');
  const name = h1?.querySelector('span')?.textContent?.trim() || h1?.textContent?.trim() || '';
  push('基本信息', '姓名',    name);
  push('基本信息', '英文名',  doc.querySelector('meta[name="author"]')?.getAttribute('content') || '');
  push('基本信息', '邮箱',    (doc.querySelector('a[href^="mailto:"]')?.getAttribute('href') || '').replace('mailto:', ''));
  push('基本信息', '手机',    (doc.querySelector('a[href^="tel:"]')?.getAttribute('href') || '').replace('tel:+86', '').replace('tel:', ''));

  const about = doc.querySelector('#about');
  if (about) {
    push('自我评价', '简短介绍', about.querySelector('p.text-gray-700, p.leading-relaxed')?.textContent?.trim());
    push('自我评价', '核心优势', about.querySelector('.text-primary-800, [class*="primary-800"]')?.textContent?.trim());
    for (const card of about.querySelectorAll('.card-glow')) {
      const ct = card.textContent || '';
      if (!/(硕士|学士|本科|博士)/.test(ct)) continue;
      const school = card.querySelector('h3')?.textContent?.trim(); if (!school) continue;
      const dept   = card.querySelector('h3')?.closest('div')?.querySelector('p')?.textContent?.trim();
      const pTags  = Array.from(card.querySelector('[class*="space-y"]')?.querySelectorAll('p') ?? []);
      const degree = pTags[0]?.textContent?.trim();
      const timeP  = pTags.find(p => /\d{4}/.test(p.textContent) && p.textContent.includes('-'));
      const label  = ct.includes('硕') ? '研究生教育' : '本科教育';
      push(label, '学校', school); push(label, '院系', dept); push(label, '学历', degree);
      if (degree) { const m = degree.replace(/[硕博]士$/, '').replace(/学士$/, '').replace(/本科$/, '').trim(); if (m !== degree) push(label, '专业', m); }
      push(label, '时间', timeP?.textContent?.trim());
      push(label, 'GPA', ct.match(/GPA[：:]\s*([\d.]+\/[\d.]+)/)?.[1]);
      const rk = ct.match(/专业前(\d+%)/)?.[1]; if (rk) push(label, '专业排名', `专业前${rk}`);
    }
  }

  const exp = doc.querySelector('#experience');
  if (exp) {
    for (const card of exp.querySelectorAll('.card-glow')) {
      const h3 = card.querySelector('h3'); if (!h3) continue;
      const company = h3.querySelector('span')?.textContent?.trim() || h3.textContent?.trim(); if (!company) continue;
      let role = '';
      for (const p of card.querySelectorAll('p')) { if (p.className.includes('primary')) { role = p.querySelector('span')?.textContent?.trim() || p.textContent?.trim(); break; } }
      const time = card.querySelector('[class*="whitespace-nowrap"] span')?.textContent?.trim();
      const bullets = [];
      for (const li of card.querySelectorAll('ul > li')) { const sp = li.querySelectorAll('span'); if (sp.length >= 2) { const t = sp[sp.length - 1].textContent?.trim(); if (t && t.length > 5) bullets.push(t); } }
      push(company, '公司名称', company); push(company, '岗位', role); push(company, '时间', time);
      if (bullets.length) { push(company, '工作内容', bullets.map((b, i) => `${i + 1}. ${b}`).join('\n')); push(company, '核心亮点', bullets[0]); }
    }
  }

  const skills = doc.querySelector('#skills');
  if (skills) {
    const all = [];
    for (const card of skills.querySelectorAll('.card-glow')) {
      const gt = card.querySelector('h3')?.textContent?.trim(); if (!gt) continue;
      if (gt.includes('认证') || gt.includes('证书')) {
        for (const el of card.querySelectorAll('[class*="text-gray-700"]')) { const t = el.textContent?.trim(); if (t && t.length > 3) push('证书', t.split(/[：:]/)[0].trim() || t.slice(0, 8), t); }
      } else if (gt.includes('语言')) {
        const langs = Array.from(card.querySelectorAll('span > span')).map(s => s.textContent?.trim()).filter(Boolean);
        if (langs.length) push('语言能力', '语言', langs.join('；'));
      } else {
        const list = Array.from(card.querySelectorAll('.skill-tag-hover span, [class*="cursor-default"] span')).map(s => s.textContent?.trim()).filter(Boolean);
        if (list.length) { push('技能', gt, list.join('、')); all.push(...list); }
      }
    }
    if (all.length) push('技能', '技能综合', [...new Set(all)].join('、'));
  }

  return { name, orderedData: items.map((item, i) => ({ ...item, order: i })), fetchedAt: Date.now(), modified: false };
}

// ─────────────────────────────────────────────────────────────
// 主类
// ─────────────────────────────────────────────────────────────

class FormFillAssistant {
  constructor() {
    this.sidebar     = null;
    this.toggleBtn   = null;
    this.sidebarOpen = false;
    this.lastInput   = null;
    this.profile     = null;
    this.editMode    = false;

    this._pendingAutoEdit    = null;
    this._syncConfirmPending = false;
    this._syncConfirmTimer   = null;
    this._clickCapture       = null;
    this._dragMoveHandler    = null;
    this._dragUpHandler      = null;

    this._init();
  }

  // ── 存储 ───────────────────────────────────────────────────

  async _getCache()      { try { return (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY]    ?? null; } catch { return null; } }
  async _getSettings()   { try { return (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] ?? null; } catch { return null; } }
  async _saveData()      { if (this.profile) try { await chrome.storage.local.set({ [CACHE_KEY]: this.profile }); } catch {} }
  async _saveSettings(s) { try { await chrome.storage.local.set({ [SETTINGS_KEY]: s }); } catch {} }

  // ── 初始化 ─────────────────────────────────────────────────

  async _init() {
    this._buildSidebar();
    this._buildToggleBtn();
    this._bindInputTracker();
    this._bindKeyboardShortcut();

    const [cached, settings] = await Promise.all([this._getCache(), this._getSettings()]);

    if (!settings && !cached) { this._showOnboarding(); return; }

    if (cached) {
      this.profile = cached;
      this._renderButtons();
      this._setStatus(`上次同步：${this._timeAgo(cached.fetchedAt)}${cached.modified ? ' · 已修改' : ''}`);
      this._autoFillAll();
    }
    if (settings?.sourceUrl && !cached) await this._fetchAndApply(settings.sourceUrl);

    this._bindDomObserver();
  }

  // ── 页面加载后批量自动填写完全匹配的空字段 ────────────────────

  _autoFillAll(root = document) {
    if (!this.profile?.orderedData) return;
    const selector = 'input:not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable="true"],[role="textbox"]';
    for (const el of root.querySelectorAll(selector)) {
      if (this.sidebar?.contains(el)) continue;
      const empty = !(el.tagName === 'SELECT' ? el.value : (el.value || el.textContent?.trim() || ''));
      if (!empty) continue;
      const label = this._getFieldLabel(el);
      if (!label) continue;
      const exact = this._findExactMatch(label);
      if (exact) this._fillInputEl(el, exact.fillContent);
    }
  }

  // ── MutationObserver：监听 SPA 动态插入的新表单 ───────────────

  _bindDomObserver() {
    if (this._domObserver) return;
    this._domObserver = new MutationObserver(mutations => {
      if (!this.profile?.orderedData) return;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          // 新节点本身是输入框
          const selector = 'input:not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable="true"],[role="textbox"]';
          if (node.matches?.(selector)) {
            if (!this.sidebar?.contains(node)) {
              const empty = !(node.tagName === 'SELECT' ? node.value : (node.value || node.textContent?.trim() || ''));
              if (empty) {
                const label = this._getFieldLabel(node);
                const exact = label ? this._findExactMatch(label) : null;
                if (exact) this._fillInputEl(node, exact.fillContent);
              }
            }
          }
          // 新节点包含输入框
          if (node.querySelectorAll) this._autoFillAll(node);
        }
      }
    });
    this._domObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ── 直接填写指定元素（不依赖 lastInput / activeElement）────────

  _fillInputEl(el, content) {
    if (el.tagName === 'SELECT') {
      const o = Array.from(el.options).find(o => o.text.includes(content) || o.value === content);
      if (o) { el.value = o.value; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return;
    }
    if (el.contentEditable === 'true' || el.getAttribute('role') === 'textbox') {
      el.textContent = content; el.dispatchEvent(new InputEvent('input', { bubbles: true })); return;
    }
    const proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, content); else el.value = content;
    el.dispatchEvent(new InputEvent('input',  { bubbles: true, inputType: 'insertText', data: content }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── 键盘快捷键 Alt+Q ───────────────────────────────────────

  _bindKeyboardShortcut() {
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key.toLowerCase() === 'q') {
        e.preventDefault();
        this.toggleSidebar();
      }
    });
  }

  toggleSidebar() { this.sidebarOpen ? this._closeSidebar() : this._openSidebar(); }

  // ── 数据拉取 ───────────────────────────────────────────────

  async _fetchAndApply(url) {
    this._setStatus('同步中…', true);
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      this.profile = parseProfile(doc);
      await this._saveData();
      this._renderButtons();
      this._setStatus('已同步 · 刚刚');
      this._autoFillAll();
      this._bindDomObserver();
    } catch (err) {
      console.error('[OAA] 同步失败:', err.message);
      this._setStatus(this.profile ? '同步失败 · 使用已保存数据' : '获取失败，请检查网址');
      if (!this.profile) this._renderError();
    }
  }

  async _handleRefresh() {
    const settings = await this._getSettings();
    if (!settings?.sourceUrl) { this._showSettings(); return; }

    if (this.profile?.modified) {
      if (!this._syncConfirmPending) {
        this._syncConfirmPending = true;
        this._setStatus('将覆盖已修改内容，再次点击确认');
        clearTimeout(this._syncConfirmTimer);
        this._syncConfirmTimer = setTimeout(() => {
          this._syncConfirmPending = false;
          this._setStatus(`上次同步：${this._timeAgo(this.profile?.fetchedAt)}${this.profile?.modified ? ' · 已修改' : ''}`);
        }, 4000);
        return;
      }
      this._syncConfirmPending = false;
      clearTimeout(this._syncConfirmTimer);
    }
    await this._fetchAndApply(settings.sourceUrl);
  }

  // ── 侧边栏构建 ─────────────────────────────────────────────

  _buildSidebar() {
    if (document.getElementById('ffa-sidebar')) { this.sidebar = document.getElementById('ffa-sidebar'); return; }
    this.sidebar = document.createElement('div');
    this.sidebar.id = 'ffa-sidebar';

    // Header
    const header = document.createElement('div');
    header.className = 'ffa-header';
    const logo = document.createElement('img');
    logo.className = 'ffa-logo'; logo.src = chrome.runtime.getURL('images/logo.jpg'); logo.alt = '网申助手';
    logo.addEventListener('click', () => new Audio(chrome.runtime.getURL('audio/1.mp3')).play().catch(() => {}));

    const statusBar = document.createElement('div');
    statusBar.className = 'ffa-status-bar';
    const statusText = document.createElement('span');
    statusText.id = 'ffa-status-text'; statusText.textContent = '加载中…';

    const mk = (id, html, title, fn) => {
      const b = document.createElement('button');
      b.id = id; b.className = 'ffa-icon-btn'; b.title = title; b.innerHTML = html;
      b.addEventListener('click', fn); return b;
    };
    statusBar.append(
      statusText,
      mk('ffa-refresh-btn', '&#x21BB;', '从数据源重新同步',  () => this._handleRefresh()),
      mk('ffa-edit-btn',    '✎',        '编辑数据',          () => this._toggleEditMode()),
      mk('ffa-settings-btn','⚙',        '设置',              () => this._showSettings()),
    );
    header.append(logo, statusBar);

    // Body：搜索栏 + 按钮容器
    const body = document.createElement('div');
    body.className = 'ffa-body';

    const searchWrap = document.createElement('div');
    searchWrap.id = 'ffa-search-wrap'; searchWrap.className = 'ffa-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.type = 'text'; searchInput.id = 'ffa-search'; searchInput.className = 'ffa-search-input'; searchInput.placeholder = '搜索条目…';
    const searchClear = document.createElement('button');
    searchClear.className = 'ffa-search-clear'; searchClear.innerHTML = '×'; searchClear.title = '清除';
    searchInput.addEventListener('input', () => {
      searchClear.style.display = searchInput.value ? 'flex' : 'none';
      this._filterButtons(searchInput.value);
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = ''; searchClear.style.display = 'none'; this._filterButtons(''); searchInput.focus();
    });
    searchWrap.append(searchInput, searchClear);

    const btnContainer = document.createElement('div');
    btnContainer.id = 'ffa-buttons';
    body.append(searchWrap, btnContainer);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'ffa-footer';
    footer.textContent = '左键填写 · 右键复制 · Alt+Q 打开';

    this.sidebar.append(header, body, footer);
    document.body.appendChild(this.sidebar);
  }

  _setStatus(text, spinning = false) {
    const el = document.getElementById('ffa-status-text');
    if (el) el.textContent = text;
    document.getElementById('ffa-refresh-btn')?.classList.toggle('ffa-spinning', spinning);
  }

  _showSearchBar(show) {
    const wrap = document.getElementById('ffa-search-wrap');
    if (!wrap) return;
    wrap.style.display = show ? 'flex' : 'none';
    if (!show) { const i = document.getElementById('ffa-search'); if (i) { i.value = ''; } wrap.querySelector('.ffa-search-clear').style.display = 'none'; }
  }

  // ── 搜索过滤 ───────────────────────────────────────────────

  _filterButtons(query) {
    const q = query.trim().toLowerCase();
    for (const group of document.querySelectorAll('#ffa-buttons .ffa-group')) {
      const titleText = group.querySelector('.ffa-group-title')?.textContent?.toLowerCase() || '';
      let anyVisible = false;
      for (const item of group.querySelectorAll('.ffa-btn, .ffa-edit-row')) {
        const label = (item.querySelector('.ffa-edit-label') || item)?.textContent?.toLowerCase() || '';
        const hint  = item.dataset.content?.toLowerCase() || item.title?.toLowerCase() || '';
        const show  = !q || label.includes(q) || hint.includes(q) || titleText.includes(q);
        item.style.display = show ? '' : 'none';
        if (show) anyVisible = true;
      }
      // 编辑模式下添加按钮在有搜索词时隐藏
      const addBtn = group.querySelector('.ffa-add-entry-btn');
      if (addBtn) addBtn.style.display = q ? 'none' : '';
      group.style.display = (!q || anyVisible || titleText.includes(q)) ? '' : 'none';
    }
    const addGroupBtn = document.querySelector('#ffa-buttons .ffa-add-group-btn');
    if (addGroupBtn) addGroupBtn.style.display = q ? 'none' : '';
  }

  // ── 浮动按钮 ───────────────────────────────────────────────

  _buildToggleBtn() {
    if (document.getElementById('ffa-toggle')) { this.toggleBtn = document.getElementById('ffa-toggle'); return; }
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'ffa-toggle'; this.toggleBtn.textContent = '网申助手'; this.toggleBtn.title = '打开/收起（可拖动）· Alt+Q';
    document.body.appendChild(this.toggleBtn);
    this.toggleBtn.addEventListener('click', () => { if (this.toggleBtn.dataset.dragged === '1') return; this.toggleSidebar(); });
    this._initDrag();
  }

  _openSidebar()  { this.sidebar.classList.add('ffa-open');    this.toggleBtn.textContent = '收起';    this.sidebarOpen = true;  }
  _closeSidebar() { this.sidebar.classList.remove('ffa-open'); this.toggleBtn.textContent = '网申助手'; this.sidebarOpen = false; }

  _initDrag() {
    const btn = this.toggleBtn; let ox, oy, bx, by, dragging = false;
    btn.addEventListener('mousedown', e => { const r = btn.getBoundingClientRect(); ox = e.clientX; oy = e.clientY; bx = r.left; by = r.top; dragging = false; e.preventDefault(); });
    this._dragMoveHandler = e => {
      if (ox === undefined) return; const dx = e.clientX - ox, dy = e.clientY - oy;
      if (!dragging && Math.hypot(dx, dy) > 5) dragging = true; if (!dragging) return;
      const nx = Math.max(10, Math.min(bx + dx, window.innerWidth  - btn.offsetWidth  - 10));
      const ny = Math.max(10, Math.min(by + dy, window.innerHeight - btn.offsetHeight - 10));
      btn.style.setProperty('left', nx + 'px', 'important'); btn.style.setProperty('top', ny + 'px', 'important');
      btn.style.setProperty('right', 'auto', 'important');   btn.style.setProperty('bottom', 'auto', 'important');
    };
    this._dragUpHandler = () => { const was = dragging; ox = oy = bx = by = undefined; dragging = false; if (was) { btn.dataset.dragged = '1'; setTimeout(() => { btn.dataset.dragged = '0'; }, 100); } };
    document.addEventListener('mousemove', this._dragMoveHandler);
    document.addEventListener('mouseup',   this._dragUpHandler);
  }

  // ── 输入框追踪 ─────────────────────────────────────────────

  _bindInputTracker() {
    this._clickCapture = e => {
      if (this.sidebar?.contains(e.target)) return;
      const el = e.target.closest('input:not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable="true"],[role="textbox"]');
      if (el) this.lastInput = el;
    };
    document.addEventListener('click', this._clickCapture, true);

    // 聚焦时触发自动填写 / 建议
    document.addEventListener('focusin', e => {
      if (this.sidebar?.contains(e.target)) return;
      const target = e.target.closest('input:not([type=file]):not([type=button]):not([type=submit]):not([type=reset]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable="true"],[role="textbox"]');
      if (!target) return;
      this.lastInput = target;
      clearTimeout(this._sugHideTimer);
      this._onFieldFocus(target);
    }, true);

    document.addEventListener('focusout', e => {
      if (this.sidebar?.contains(e.target)) return;
      this._sugHideTimer = setTimeout(() => {
        if (!document.getElementById('ffa-suggestion')?.matches(':hover')) this._hideSuggestion();
      }, 180);
    }, true);
  }

  // ── 引导页 ─────────────────────────────────────────────────

  _showOnboarding() {
    this._setBodyContent(c => {
      this._showSearchBar(false);
      this._setStatus('咕~ 终末地企业管理员就位！');
      const w = document.createElement('div'); w.className = 'ffa-onboard';

      const greeting = el('p', 'ffa-onboard-desc', '咕咕嘎嘎！本管理员奉命协助您完成网申任务，请按指示操作，不得拖延！');

      const urlTitle = el('p', 'ffa-onboard-title', '🌐 数据同步（推荐）');
      const urlDesc  = el('p', 'ffa-onboard-desc',  '将您的个人主页或在线简历地址上报给本管理员');
      const urlInput = document.createElement('input');
      urlInput.type = 'url'; urlInput.className = 'ffa-form-input'; urlInput.placeholder = 'https://yourname.github.io';

      const fetchBtn = el('button', 'ffa-form-save ffa-block-btn', '📋 即刻同步，咕！');
      fetchBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim(); if (!url.startsWith('http')) { urlInput.focus(); return; }
        await this._saveSettings({ sourceUrl: url }); this._renderButtons(); await this._fetchAndApply(url);
      });
      urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') fetchBtn.click(); });

      const divider  = el('div', 'ffa-onboard-divider', '— 咕咕嘎嘎 —');
      const manualBtn = el('button', 'ffa-onboard-manual-btn', '✏️  手动上报数据');
      manualBtn.addEventListener('click', async () => {
        await this._saveSettings({ sourceUrl: null });
        this.profile = { name: '我', orderedData: [], fetchedAt: Date.now(), modified: false };
        await this._saveData(); this._setStatus('手动模式 · 点 ✎ 开始添加');
        this.editMode = false; this._renderButtons(); this._toggleEditMode();
      });

      w.append(greeting, urlTitle, urlDesc, urlInput, fetchBtn, divider, manualBtn);
      c.appendChild(w); setTimeout(() => urlInput.focus(), 100);
    });
  }

  // ── 设置页 ─────────────────────────────────────────────────

  _showSettings() {
    document.getElementById('ffa-settings-btn')?.classList.add('ffa-icon-active');
    this._setBodyContent(async c => {
      this._showSearchBar(false);
      this._setStatus('设置');
      const settings = await this._getSettings();
      const w = document.createElement('div'); w.className = 'ffa-settings';

      // 返回
      const backBtn = el('button', 'ffa-back-btn', '← 返回');
      backBtn.addEventListener('click', () => {
        document.getElementById('ffa-settings-btn')?.classList.remove('ffa-icon-active');
        this._setStatus(this.profile ? `上次同步：${this._timeAgo(this.profile.fetchedAt)}${this.profile.modified ? ' · 已修改' : ''}` : '设置完成');
        this._renderButtons();
      });

      // 数据源
      const srcLabel = el('p', 'ffa-settings-label', '数据源 URL');
      const urlInput = document.createElement('input');
      urlInput.type = 'url'; urlInput.className = 'ffa-form-input'; urlInput.placeholder = 'https://yourname.github.io';
      urlInput.value = settings?.sourceUrl || '';
      const updateBtn = el('button', 'ffa-form-save ffa-block-btn', '保存并重新获取');
      updateBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim(); if (!url.startsWith('http')) { urlInput.focus(); return; }
        await this._saveSettings({ sourceUrl: url });
        document.getElementById('ffa-settings-btn')?.classList.remove('ffa-icon-active');
        this._renderButtons(); await this._fetchAndApply(url);
      });
      urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') updateBtn.click(); });
      const urlNote = el('p', 'ffa-settings-note', '留空则切换为纯手动模式，数据不会被远程覆盖');
      const saveManualBtn = el('button', 'ffa-outline-btn ffa-block-btn', '保存（手动模式）');
      saveManualBtn.addEventListener('click', async () => {
        await this._saveSettings({ sourceUrl: null });
        document.getElementById('ffa-settings-btn')?.classList.remove('ffa-icon-active');
        this._setStatus(this.profile ? `上次同步：${this._timeAgo(this.profile.fetchedAt)}${this.profile.modified ? ' · 已修改' : ''}` : '手动模式');
        this._renderButtons();
      });

      // 导入 / 导出
      const ioLabel = el('p', 'ffa-settings-label', '数据备份');
      const exportBtn = el('button', 'ffa-outline-btn ffa-block-btn', '⬇ 导出 JSON');
      exportBtn.addEventListener('click', () => this._exportJSON());

      const importFile = document.createElement('input');
      importFile.type = 'file'; importFile.accept = '.json'; importFile.style.display = 'none';
      importFile.addEventListener('change', e => { const f = e.target.files[0]; if (f) this._importJSON(f); e.target.value = ''; });
      const importBtn = el('button', 'ffa-outline-btn ffa-block-btn', '⬆ 导入 JSON');
      importBtn.addEventListener('click', () => importFile.click());

      // 危险操作
      const dangerLabel = el('p', 'ffa-settings-label ffa-danger-label', '危险操作');
      const clearBtn = el('button', 'ffa-danger-btn', '清空所有数据并重置');
      clearBtn.addEventListener('click', async () => {
        if (clearBtn.dataset.confirm === '1') {
          await chrome.storage.local.remove([CACHE_KEY, SETTINGS_KEY]);
          this.profile = null; this.editMode = false;
          document.getElementById('ffa-settings-btn')?.classList.remove('ffa-icon-active');
          document.getElementById('ffa-sidebar')?.classList.remove('ffa-edit-active');
          this._showOnboarding();
        } else {
          clearBtn.dataset.confirm = '1'; clearBtn.textContent = '确认清空（不可恢复）'; clearBtn.classList.add('ffa-danger-confirm');
          setTimeout(() => { clearBtn.dataset.confirm = '0'; clearBtn.textContent = '清空所有数据并重置'; clearBtn.classList.remove('ffa-danger-confirm'); }, 3000);
        }
      });

      w.append(backBtn, srcLabel, urlInput, updateBtn, urlNote, saveManualBtn, ioLabel, exportBtn, importBtn, importFile, dangerLabel, clearBtn);
      c.appendChild(w);
    });
  }

  // ── 导出 / 导入 JSON ──────────────────────────────────────

  _exportJSON() {
    const data = this.profile?.orderedData;
    if (!data?.length) { this._showToast('暂无数据可导出', true); return; }
    const json = JSON.stringify(
      data.map(({ title, buttonText, fillContent, aliases }) => ({ title, buttonText, fillContent, ...(aliases?.length ? { aliases } : {}) })),
      null, 2
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `网申助手_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this._showToast('已导出 JSON 文件');
  }

  _importJSON(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!Array.isArray(parsed)) throw new Error('格式应为数组');
        const orderedData = parsed
          .filter(item => item.title && item.buttonText)
          .map((item, i) => ({
            title: String(item.title).trim(), buttonText: String(item.buttonText).trim(),
            fillContent: item.fillContent != null ? String(item.fillContent) : '', order: i,
            ...(Array.isArray(item.aliases) && item.aliases.length ? { aliases: item.aliases.map(a => String(a).trim()).filter(Boolean) } : {}),
          }));
        if (!orderedData.length) throw new Error('没有找到有效条目');
        this.profile = { name: this.profile?.name ?? '我', orderedData, fetchedAt: this.profile?.fetchedAt ?? Date.now(), modified: true };
        this._saveData();
        document.getElementById('ffa-settings-btn')?.classList.remove('ffa-icon-active');
        this._setStatus(`已导入 ${orderedData.length} 条 · 已修改`);
        this._renderButtons();
        this._showToast(`导入成功，共 ${orderedData.length} 条`);
      } catch (err) { this._showToast('导入失败：' + err.message, true); }
    };
    reader.readAsText(file);
  }

  // ── 编辑模式 ───────────────────────────────────────────────

  _toggleEditMode() {
    this.editMode = !this.editMode;
    const btn = document.getElementById('ffa-edit-btn');
    if (btn) { btn.textContent = this.editMode ? '✓ 完成' : '✎'; btn.classList.toggle('ffa-icon-active', this.editMode); }
    document.getElementById('ffa-sidebar')?.classList.toggle('ffa-edit-active', this.editMode);
    this._renderButtons();
  }

  // ── 渲染按钮 ───────────────────────────────────────────────

  _renderButtons() {
    this._setBodyContent(c => {
      this._showSearchBar(true);
      const data = this.profile?.orderedData;

      if (!data?.length) {
        const empty = el('p', 'ffa-empty', this.editMode ? '' : '暂无数据，点 ✎ 开始添加');
        if (!this.editMode) c.appendChild(empty);
      }

      if (data?.length) {
        const groups = new Map();
        for (const item of data) { if (!groups.has(item.title)) groups.set(item.title, []); groups.get(item.title).push(item); }

        for (const [title, items] of groups) {
          const groupEl = document.createElement('div'); groupEl.className = 'ffa-group';
          const titleEl = el('div', 'ffa-group-title' + (this.editMode ? ' ffa-title-editable' : ''), title);
          if (this.editMode) {
            titleEl.contentEditable = 'true'; titleEl.spellcheck = false;
            titleEl.addEventListener('blur', () => { const nt = titleEl.textContent.trim(); if (nt && nt !== title) this._renameGroup(title, nt); });
            titleEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });
          }
          groupEl.appendChild(titleEl);

          const btnsEl = document.createElement('div'); btnsEl.className = 'ffa-group-btns';
          for (const item of items) {
            if (this.editMode) {
              btnsEl.appendChild(this._buildEditRow(item));
            } else {
              const btn = document.createElement('button');
              btn.className = 'ffa-btn';
              btn.textContent = item.buttonText;
              btn.dataset.content = item.fillContent; // 用于搜索过滤
              btn.title = (item.fillContent.length > 60 ? item.fillContent.slice(0, 60) + '…' : item.fillContent) + '\n（左键填写 · 右键复制）';
              btn.addEventListener('click', e => { e.stopPropagation(); this._fillInput(item.fillContent); });
              btn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); this._copyToClipboard(item.fillContent); });
              btnsEl.appendChild(btn);
            }
          }

          if (this.editMode) {
            const addBtn = el('button', 'ffa-add-entry-btn', '＋ 添加条目');
            addBtn.addEventListener('click', () => this._addEntry(title));
            btnsEl.appendChild(addBtn);
          }
          groupEl.appendChild(btnsEl); c.appendChild(groupEl);
        }
      }

      if (this.editMode) {
        const addGroupBtn = el('button', 'ffa-add-group-btn', '＋ 新建分组');
        addGroupBtn.addEventListener('click', () => this._addGroup());
        c.appendChild(addGroupBtn);
      }

      if (this._pendingAutoEdit != null) {
        const order = this._pendingAutoEdit; this._pendingAutoEdit = null;
        c.querySelector(`.ffa-edit-row[data-order="${order}"]`)?.querySelector('.ffa-icon-btn')?.click();
      }
    });
  }

  _renderError() {
    this._setBodyContent(c => { this._showSearchBar(false); c.appendChild(el('p', 'ffa-empty', '无法获取数据，请点 ↻ 重试')); });
  }

  // ── 右键复制 ───────────────────────────────────────────────

  _copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => this._showToast('已复制到剪贴板')).catch(() => this._fallbackCopy(text));
    } else {
      this._fallbackCopy(text);
    }
  }

  _fallbackCopy(text) {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    Object.assign(ta.style, { position: 'fixed', opacity: '0' });
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); this._showToast('已复制到剪贴板'); } catch { this._showToast('复制失败，请手动复制', true); }
    ta.remove();
  }

  // ── 编辑行 ─────────────────────────────────────────────────

  _buildEditRow(item) {
    const row = document.createElement('div'); row.className = 'ffa-edit-row'; row.dataset.order = item.order;
    const label = el('span', 'ffa-edit-label', item.buttonText);
    const editBtn = el('button', 'ffa-icon-btn', '✎'); editBtn.title = '编辑（Ctrl+Enter 保存）';
    editBtn.addEventListener('click', () => this._toggleEditForm(item, row));
    const delBtn = el('button', 'ffa-icon-btn ffa-del-btn', '×'); delBtn.title = '删除';
    delBtn.addEventListener('click', () => this._deleteEntry(item));
    row.append(label);
    if (item.aliases?.length) { const tag = el('span', 'ffa-alias-tag', `@${item.aliases.length}`); tag.title = '别名：' + item.aliases.join('、'); row.appendChild(tag); }
    row.append(editBtn, delBtn); return row;
  }

  _toggleEditForm(item, row) {
    const existing = row.nextElementSibling;
    if (existing?.classList.contains('ffa-edit-form')) { existing.remove(); return; }
    document.querySelectorAll('.ffa-edit-form').forEach(f => f.remove());

    const form = document.createElement('div'); form.className = 'ffa-edit-form';
    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.className = 'ffa-form-input'; nameInput.placeholder = '按钮名称'; nameInput.value = item.buttonText;
    const aliasInput = document.createElement('input');
    aliasInput.type = 'text'; aliasInput.className = 'ffa-form-input ffa-alias-input';
    aliasInput.placeholder = '别名（逗号分隔，用于自动识别字段，如：名字,全名）';
    aliasInput.value = item.aliases?.join('、') || '';
    const contentArea = document.createElement('textarea');
    contentArea.className = 'ffa-form-textarea'; contentArea.placeholder = '填写内容'; contentArea.value = item.fillContent;

    const actions = document.createElement('div'); actions.className = 'ffa-form-actions';
    const saveBtn = el('button', 'ffa-form-save', '保存');
    saveBtn.addEventListener('click', () => {
      const nt = nameInput.value.trim(); if (!nt) { nameInput.focus(); return; }
      const aliases = aliasInput.value.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
      this._updateEntry(item, nt, contentArea.value, aliases); form.remove();
    });
    const cancelBtn = el('button', 'ffa-form-cancel', '取消');
    cancelBtn.addEventListener('click', () => form.remove());
    [nameInput, aliasInput, contentArea].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) saveBtn.click(); }));

    actions.append(saveBtn, cancelBtn); form.append(nameInput, aliasInput, contentArea, actions);
    row.insertAdjacentElement('afterend', form); nameInput.focus(); nameInput.select();
  }

  // ── 数据操作 ───────────────────────────────────────────────

  _markModified() {
    this.profile.modified = true; this._saveData();
    this._setStatus(`上次同步：${this._timeAgo(this.profile.fetchedAt)} · 已修改`);
  }

  _updateEntry(item, text, content, aliases = []) {
    const e = this.profile.orderedData.find(d => d.order === item.order); if (!e) return;
    e.buttonText = text; e.fillContent = content;
    if (aliases.length) e.aliases = aliases; else delete e.aliases;
    this._markModified(); this._renderButtons();
  }
  _deleteEntry(item)           { this.profile.orderedData = this.profile.orderedData.filter(d => d.order !== item.order); this._markModified(); this._renderButtons(); }
  _renameGroup(old_, new_)     { for (const i of this.profile.orderedData) if (i.title === old_) i.title = new_; this._markModified(); }
  _addEntry(groupTitle) {
    const max = this.profile.orderedData.reduce((m, d) => Math.max(m, d.order), -1);
    this.profile.orderedData.push({ title: groupTitle, buttonText: '新条目', fillContent: '', order: max + 1 });
    this._pendingAutoEdit = max + 1; this._markModified(); this._renderButtons();
  }
  _addGroup() {
    const max = this.profile.orderedData.reduce((m, d) => Math.max(m, d.order), -1);
    this.profile.orderedData.push({ title: '新分组', buttonText: '新条目', fillContent: '', order: max + 1 });
    this._pendingAutoEdit = max + 1; this._markModified(); this._renderButtons();
  }

  // ── 填写 ───────────────────────────────────────────────────

  _getTarget() {
    const a = document.activeElement;
    if (a && a !== document.body && !this.sidebar?.contains(a) &&
        a.matches('input:not([type=file]):not([type=button]):not([type=submit]):not([type=reset]),textarea,select,[contenteditable="true"],[role="textbox"]')) return a;
    if (this.lastInput && document.contains(this.lastInput)) return this.lastInput;
    return null;
  }

  // ── 字段识别与智能建议 ──────────────────────────────────────

  _getFieldLabel(el) {
    const aria = el.getAttribute('aria-label')?.trim();
    if (aria) return aria;
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) { const t = document.getElementById(labelledBy)?.textContent?.trim(); if (t) return t; }
    if (el.id) {
      try { const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (lbl?.textContent?.trim()) return lbl.textContent.trim(); } catch {}
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input,textarea,select').forEach(i => i.remove());
      const t = clone.textContent.trim(); if (t) return t;
    }
    const ph = el.placeholder?.trim(); if (ph) return ph;
    return el.name?.trim() || el.id?.trim() || '';
  }

  _normalizeLabel(s) {
    return s.replace(/[请输入您的你的（()）\s:：*【】「」]/g, '').toLowerCase();
  }

  _matchScore(fieldLabel, entryText) {
    const a = this._normalizeLabel(fieldLabel);
    const b = this._normalizeLabel(entryText);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    const sa = new Set(a), sb = new Set(b);
    let common = 0; for (const c of sa) if (sb.has(c)) common++;
    return (common / Math.max(sa.size, sb.size)) * 0.5;
  }

  _findExactMatch(label) {
    if (!label || !this.profile?.orderedData) return null;
    const norm = this._normalizeLabel(label);
    return this.profile.orderedData.find(item => {
      if (this._normalizeLabel(item.buttonText) === norm) return true;
      return item.aliases?.some(a => this._normalizeLabel(a) === norm);
    }) ?? null;
  }

  _findBestMatch(label) {
    if (!label || !this.profile?.orderedData) return null;
    let best = null, bestScore = 0;
    for (const item of this.profile.orderedData) {
      if (!item.fillContent) continue;
      for (const t of [item.buttonText, ...(item.aliases || [])]) {
        const score = this._matchScore(label, t);
        if (score > bestScore) { bestScore = score; best = item; }
      }
    }
    return bestScore >= 0.5 ? best : null;
  }

  _onFieldFocus(el) {
    const label = this._getFieldLabel(el);
    if (!label) { this._hideSuggestion(); this._highlightSidebarBtn(null); return; }
    // Feature 1：空字段且完全匹配 → 直接填写
    const empty = !(el.tagName === 'SELECT' ? el.value : (el.value || el.textContent?.trim() || ''));
    if (empty) {
      const exact = this._findExactMatch(label);
      if (exact) {
        this._hideSuggestion();
        this._highlightSidebarBtn(exact);
        this._fillInputEl(el, exact.fillContent);
        return;
      }
    }
    // Feature 2：最佳匹配 → 显示建议浮层 + 高亮侧边栏按钮
    const best = this._findBestMatch(label);
    if (best) { this._showSuggestion(el, best); this._highlightSidebarBtn(best); }
    else { this._hideSuggestion(); this._highlightSidebarBtn(null); }
  }

  _showSuggestion(fieldEl, item) {
    this._hideSuggestion();
    if (fieldEl.tagName === 'SELECT') return; // SELECT 有原生下拉，不叠加
    const rect = fieldEl.getBoundingClientRect();
    const preview = item.fillContent.length > 38 ? item.fillContent.slice(0, 38) + '…' : item.fillContent;
    const tip = document.createElement('div'); tip.id = 'ffa-suggestion';
    const lbl  = document.createElement('span'); lbl.className = 'ffa-sug-label'; lbl.innerHTML = `💡 <b>${item.buttonText}</b>`;
    const prev = document.createElement('span'); prev.className = 'ffa-sug-preview'; prev.textContent = preview;
    const fill = document.createElement('button'); fill.className = 'ffa-sug-fill'; fill.textContent = '填入↵';
    const cls  = document.createElement('button'); cls.className = 'ffa-sug-close'; cls.textContent = '×';
    tip.append(lbl, prev, fill, cls);
    const top  = rect.bottom + window.scrollY + 5;
    const left = Math.max(4, Math.min(rect.left + window.scrollX, window.innerWidth - 330));
    tip.style.cssText = `position:absolute;top:${top}px;left:${left}px;z-index:2147483645;`;
    fill.addEventListener('mousedown', e => {
      e.preventDefault(); clearTimeout(this._sugHideTimer);
      this._fillInput(item.fillContent); this._hideSuggestion();
    });
    cls.addEventListener('mousedown', e => { e.preventDefault(); this._hideSuggestion(); });
    document.body.appendChild(tip);
  }

  _hideSuggestion() { document.getElementById('ffa-suggestion')?.remove(); }

  _highlightSidebarBtn(item) {
    document.querySelectorAll('#ffa-buttons .ffa-btn.ffa-btn-match').forEach(b => b.classList.remove('ffa-btn-match'));
    if (!item) return;
    for (const btn of document.querySelectorAll('#ffa-buttons .ffa-btn')) {
      if (btn.textContent === item.buttonText) { btn.classList.add('ffa-btn-match'); btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); break; }
    }
  }

  _fillInput(content) {
    const el = this._getTarget(); if (!el) { this._showToast('请先点击要填写的输入框', true); return; }
    el.focus();
    if (el.tagName === 'SELECT') { const o = Array.from(el.options).find(o => o.text.includes(content) || o.value === content); o ? (el.value = o.value, el.dispatchEvent(new Event('change', { bubbles: true }))) : this._showToast('未找到匹配选项', true); return; }
    if (el.contentEditable === 'true' || el.getAttribute('role') === 'textbox') { el.textContent = content; el.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
    const proto  = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, content); else el.value = content;
    el.dispatchEvent(new InputEvent('input',  { bubbles: true, inputType: 'insertText', data: content }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    this._showToast('已填写');
  }

  // ── Toast ──────────────────────────────────────────────────

  _showToast(msg, isError = false) {
    document.getElementById('ffa-toast')?.remove();
    const t = document.createElement('div'); t.id = 'ffa-toast'; if (isError) t.classList.add('ffa-toast-error'); t.textContent = msg;
    document.body.appendChild(t); t.getBoundingClientRect(); t.classList.add('ffa-toast-show');
    setTimeout(() => { t.classList.remove('ffa-toast-show'); setTimeout(() => t.remove(), 300); }, 1800);
  }

  // ── 工具 ───────────────────────────────────────────────────

  _setBodyContent(builderFn) {
    const c = document.getElementById('ffa-buttons'); if (!c) return; c.innerHTML = ''; builderFn(c);
  }

  _timeAgo(ts) {
    if (!ts) return '未知'; const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s}秒前`; if (s < 3600) return `${Math.round(s / 60)}分钟前`; return `${Math.round(s / 3600)}小时前`;
  }
}

// DOM 元素快捷创建
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ─────────────────────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────────────────────

function boot() {
  if (window.__oaa__) return;
  try { window.__oaa__ = new FormFillAssistant(); } catch (e) { console.error('[OAA] 初始化失败:', e); }
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'open')   { if (!window.__oaa__) boot(); window.__oaa__?._openSidebar(); }
  if (msg.action === 'toggle') { if (!window.__oaa__) boot(); window.__oaa__?.toggleSidebar(); }
});

document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
