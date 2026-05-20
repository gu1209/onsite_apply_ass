'use strict';

// Onsite Apply Assistant — AI Resume Parser
// Parses PDF/DOCX resumes and runs Socratic dialogue to extract structured data

// Use UMD builds that work with fetch+eval in content script isolated world
const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const MAMMOTH_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';

const _libCache = {};

async function _loadLib(url, globalName) {
  if (_libCache[globalName]) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const code = await res.text();
    // eval in content script context so the library is accessible here
    eval(code);
    _libCache[globalName] = true;
  } catch (err) {
    throw new Error(`Failed to load ${globalName}: ${err.message}. For offline use, download to lib/ and use chrome.runtime.getURL().`);
  }
}

async function parseResumeFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'pdf') {
    await _loadLib(PDFJS_CDN, 'pdfjsLib');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(' '));
    }
    return pages.join('\n');
  }

  if (ext === 'docx' || ext === 'doc') {
    await _loadLib(MAMMOTH_CDN, 'mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  throw new Error('不支持的文件格式：' + ext);
}

// ── System Prompt ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a resume parsing assistant helping a user fill out job application forms.
The user has uploaded their resume. Your job is to extract structured data through a Socratic dialogue.

## Process
1. Analyze the resume text and extract all identifiable information.
2. If you are uncertain about any field, ask ONE clear, specific question in Chinese.
3. When all information is sufficiently clarified, output the final JSON.

## Output Format (final JSON only, when ready)
{
  "name": "姓名",
  "orderedData": [
    {"title": "基本信息", "buttonText": "姓名", "fillContent": "张三", "aliases": ["名字", "全名", "Name"]},
    {"title": "基本信息", "buttonText": "邮箱", "fillContent": "...", "aliases": ["Email", "电子邮箱"]},
    {"title": "基本信息", "buttonText": "手机", "fillContent": "...", "aliases": ["电话", "手机号", "Phone"]},
    {"title": "基本信息", "buttonText": "性别", "fillContent": "..."},
    {"title": "研究生教育", "buttonText": "学校", "fillContent": "..."},
    {"title": "研究生教育", "buttonText": "院系", "fillContent": "..."},
    {"title": "研究生教育", "buttonText": "专业", "fillContent": "..."},
    {"title": "研究生教育", "buttonText": "学历", "fillContent": "硕士"},
    {"title": "研究生教育", "buttonText": "时间", "fillContent": "2024.09 - 2027.01"},
    {"title": "本科教育", "buttonText": "学校", "fillContent": "..."},
    {"title": "本科教育", "buttonText": "院系", "fillContent": "..."},
    {"title": "本科教育", "buttonText": "专业", "fillContent": "..."},
    {"title": "本科教育", "buttonText": "学历", "fillContent": "本科"},
    {"title": "本科教育", "buttonText": "GPA", "fillContent": "..."},
    {"title": "本科教育", "buttonText": "专业排名", "fillContent": "..."},
    {"title": "本科教育", "buttonText": "时间", "fillContent": "..."},
    {"title": "[公司名]", "buttonText": "公司名称", "fillContent": "..."},
    {"title": "[公司名]", "buttonText": "岗位", "fillContent": "..."},
    {"title": "[公司名]", "buttonText": "时间", "fillContent": "..."},
    {"title": "[公司名]", "buttonText": "工作内容", "fillContent": "1. ...\\n2. ..."},
    {"title": "技能", "buttonText": "编程语言", "fillContent": "..."},
    {"title": "技能", "buttonText": "数据分析", "fillContent": "..."},
    {"title": "技能", "buttonText": "技能综合", "fillContent": "..."},
    {"title": "证书", "buttonText": "...", "fillContent": "..."},
    {"title": "自我评价", "buttonText": "简短介绍", "fillContent": "..."},
    {"title": "自我评价", "buttonText": "核心优势", "fillContent": "..."},
    {"title": "自我评价", "buttonText": "求职意向", "fillContent": "..."}
  ]
}

## Rules
- title uses the category names above. For each company/experience, use the company name as title.
- 工作内容 must use numbered format: "1. xxx\\n2. xxx".
- Add aliases (alternative labels) for fields that might have different names on different forms.
- If resume is in Chinese, respond in Chinese. If in English, respond in English.
- Ask at most 3-4 questions total. Be efficient.
- If you detect the resume is sparse on certain categories, skip them rather than asking.
- When ready to output JSON, prefix your response with "FINAL_JSON:" so the system can detect it.`;

// ── ResumeDialogue ──────────────────────────────────────────────

class ResumeDialogue {
  constructor(aiClient, assistant) {
    this._ai = aiClient;
    this._assistant = assistant; // FormFillAssistant instance
    this._messages = [];
    this._history = [];
    this._round = 0;
    this._maxRounds = 10;
  }

  async start(file) {
    // Parse file
    this._assistant._setStatus('正在解析文件…', true);
    let text;
    try {
      text = await parseResumeFile(file);
    } catch (err) {
      this._assistant._showToast('文件解析失败：' + err.message, true);
      this._assistant._setStatus('文件解析失败');
      return;
    }

    if (!text || text.trim().length < 20) {
      this._assistant._showToast('未能从文件中提取到有效文本', true);
      this._assistant._setStatus('文件内容为空');
      return;
    }

    // Truncate to control token usage
    const truncated = text.slice(0, 8000);

    // Build chat UI
    this._assistant._setStatus('AI 简历对话中…');
    this._assistant._showSearchBar(false);
    this._renderChatUI();

    // Add system message
    this._addMessage('system', `已解析 ${file.name}（${(text.length / 1024).toFixed(1)} KB），开始对话…`);

    // Initialize AI history
    this._history = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Here is my resume text:\n\n${truncated}\n\nPlease begin the Socratic dialogue. Ask your first question if needed, or output the final JSON if you have enough information.` }
    ];

    // Send initial message
    await this._sendToAI();
  }

  _renderChatUI() {
    this._assistant._setBodyContent(c => {
      const chat = document.createElement('div'); chat.className = 'ffa-chat';

      // Messages area
      this._msgContainer = document.createElement('div'); this._msgContainer.className = 'ffa-chat-messages';
      chat.appendChild(this._msgContainer);

      // Input area
      const inputWrap = document.createElement('div'); inputWrap.className = 'ffa-chat-input-wrap';
      this._chatInput = document.createElement('input');
      this._chatInput.type = 'text'; this._chatInput.className = 'ffa-chat-input';
      this._chatInput.placeholder = '输入你的回答…';
      this._chatInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') this._handleUserSend();
      });
      const sendBtn = document.createElement('button');
      sendBtn.className = 'ffa-chat-send'; sendBtn.textContent = '发送';
      sendBtn.addEventListener('click', () => this._handleUserSend());
      inputWrap.append(this._chatInput, sendBtn);
      chat.appendChild(inputWrap);

      // Action buttons
      const actions = document.createElement('div'); actions.className = 'ffa-chat-actions';
      const finishBtn = document.createElement('button');
      finishBtn.className = 'ffa-chat-finish'; finishBtn.textContent = '完成 · 生成数据';
      finishBtn.addEventListener('click', () => this._forceFinish());
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ffa-chat-cancel'; cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', () => {
        this._assistant._showSearchBar(true);
        this._assistant._setStatus(this._assistant.profile ? `上次同步：${this._assistant._timeAgo(this._assistant.profile.fetchedAt)}${this._assistant.profile.modified ? ' · 已修改' : ''}` : '');
        this._assistant._renderButtons();
      });
      actions.append(finishBtn, cancelBtn);
      chat.appendChild(actions);

      c.appendChild(chat);
    });
    setTimeout(() => this._chatInput?.focus(), 150);
  }

  _addMessage(role, content) {
    this._messages.push({ role, content });
    if (!this._msgContainer) return;

    const msg = document.createElement('div');
    msg.className = 'ffa-chat-msg ' + role;
    msg.textContent = content;
    this._msgContainer.appendChild(msg);
    this._msgContainer.scrollTop = this._msgContainer.scrollHeight;
  }

  _setLoading(loading) {
    if (!this._chatInput) return;
    this._chatInput.disabled = loading;
    const sendBtn = this._msgContainer?.parentElement?.querySelector('.ffa-chat-send');
    if (sendBtn) sendBtn.disabled = loading;
  }

  async _handleUserSend() {
    const text = this._chatInput?.value?.trim();
    if (!text) return;

    this._addMessage('user', text);
    this._chatInput.value = '';
    this._setLoading(true);

    this._history.push({ role: 'user', content: text });
    await this._sendToAI();
  }

  async _sendToAI() {
    try {
      this._assistant._setStatus('AI 思考中…', true);
      const result = await this._ai.chat(this._history, { temperature: 0.5, maxTokens: 3000 });
      const content = result.content;

      this._history.push({ role: 'assistant', content });

      // Check if it's the final JSON
      if (content.includes('FINAL_JSON:')) {
        await this._handleFinalJSON(content);
        return;
      }

      // Try to parse as JSON directly (some models skip FINAL_JSON prefix)
      try {
        const trimmed = content.trim();
        if (trimmed.startsWith('{') && trimmed.includes('"orderedData"')) {
          const json = JSON.parse(trimmed);
          await this._finish(json);
          return;
        }
      } catch (_) {}

      // Regular message - display it
      this._addMessage('ai', content);
      this._round++;
      this._assistant._setStatus(`对话中 · 第 ${this._round} 轮`);
      this._setLoading(false);
      this._chatInput?.focus();

    } catch (err) {
      console.error('[OAA] AI 对话错误:', err);
      this._addMessage('system', 'AI 响应失败：' + err.message + '。请重试。');
      this._assistant._setStatus('AI 响应失败');
      this._setLoading(false);
    }
  }

  async _handleFinalJSON(content) {
    const jsonStr = content.split('FINAL_JSON:')[1]?.trim() || content;
    try {
      // Extract JSON block (handle markdown code fences)
      let clean = jsonStr;
      const match = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) clean = match[1];
      clean = clean.trim();

      const json = JSON.parse(clean);
      await this._finish(json);
    } catch (err) {
      console.error('[OAA] JSON 解析失败:', err);
      this._addMessage('ai', jsonStr);
      this._addMessage('system', '数据解析失败，请点击「完成·生成数据」重试，或继续对话让 AI 重新生成。');
      this._setLoading(false);
    }
  }

  async _finish(json) {
    this._addMessage('system', '数据生成完毕，正在导入…');
    await this._assistant._importAIResumeData(json);
    this._assistant._showSearchBar(true);
    // The _importAIResumeData will re-render buttons
  }

  async _forceFinish() {
    this._setLoading(true);
    this._addMessage('system', '正在生成最终数据…');
    this._history.push({ role: 'user', content: 'Please output the FINAL_JSON now. Do not ask more questions.' });
    await this._sendToAI();
  }
}