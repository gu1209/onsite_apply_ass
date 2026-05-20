'use strict';

// Onsite Apply Assistant — Shared AI Client
// Routes all API calls through the background service worker to bypass CORS.
// Supports any OpenAI-compatible API (OpenAI, Azure, Groq, DeepSeek, Ollama, MiMo, etc.)

const OAA_AI = {
  _endpoint: 'https://api.openai.com/v1',
  _key: null,
  _model: 'gpt-4o-mini',

  async init() {
    try {
      const settings = (await chrome.storage.local.get('oaa_settings'))?.oaa_settings;
      if (settings?.aiEndpoint) {
        // Normalize: strip trailing slash and common subpaths
        this._endpoint = settings.aiEndpoint
          .replace(/\/+$/, '')
          .replace(/\/chat\/completions\/?$/, '')
          .replace(/\/v1\/?$/, match => match.replace(/\/+$/, ''));
        // Ensure /v1 is present if it looks like a bare domain
        if (!/\/v\d+$/.test(this._endpoint) && !/\/v\d+\/?$/.test(this._endpoint)) {
          this._endpoint = this._endpoint.replace(/\/+$/, '') + '/v1';
        }
      }
      if (settings?.aiKey) this._key = settings.aiKey;
      if (settings?.aiModel) this._model = settings.aiModel;
    } catch (_) {}
  },

  isConfigured() {
    return !!this._key;
  },

  getConfig() {
    return { endpoint: this._endpoint, model: this._model, hasKey: !!this._key };
  },

  // Core fetch via background service worker (bypasses page CORS)
  async _fetch(url, body) {
    const res = await chrome.runtime.sendMessage({
      action: 'oaa-fetch',
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this._key}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      let errMsg;
      try {
        const err = JSON.parse(res.body);
        errMsg = err.error?.message || err.message || err.msg || JSON.stringify(err);
      } catch (_) {
        errMsg = (res.body || '').slice(0, 200) || `HTTP ${res.status}`;
      }
      if (res.status === 429) throw new Error('请求过于频繁，请稍后重试');
      if (res.status === 401 || res.status === 403) throw new Error('API Key 无效，请检查设置');
      throw new Error(errMsg || `API 错误 (${res.status})`);
    }

    const data = JSON.parse(res.body);
    return {
      content: data.choices?.[0]?.message?.content || '',
      usage: data.usage || null
    };
  },

  async chat(messages, opts = {}) {
    if (!this._key) throw new Error('API key not configured');

    const model = opts.model || this._model;
    const url = `${this._endpoint}/chat/completions`;

    const body = {
      model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_completion_tokens: opts.maxTokens ?? 2000
    };

    const extraBody = opts.extraBody || this._getExtraBody();
    if (extraBody) Object.assign(body, extraBody);

    if (opts.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    return this._fetch(url, body);
  },

  async testConnection() {
    const res = await this.chat([
      { role: 'user', content: 'Reply with just "OK".' }
    ], { maxTokens: 10, temperature: 0 });
    return res.content.includes('OK');
  },

  _getExtraBody() {
    if (/mimo/i.test(this._endpoint)) {
      return { thinking: { type: 'disabled' } };
    }
    return null;
  }
};