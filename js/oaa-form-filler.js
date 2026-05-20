'use strict';

// Onsite Apply Assistant — AI-Powered Form Filler
// Scans page DOM, sends field structure to LLM for semantic mapping, executes fill/click actions

const FIELD_SELECTOR = 'input:not([type=file]):not([type=button]):not([type=submit]):not([type=reset]),textarea,select,[contenteditable="true"],[role="textbox"]';

class AIFormFiller {
  constructor(aiClient, profile, deps) {
    this._ai = aiClient;
    this._profile = profile;
    this._getFieldLabel = deps.getFieldLabel;
    this._fillInputEl = deps.fillInputEl;
    this._findExactMatch = deps.findExactMatch;
    this._sidebar = deps.sidebar;
  }

  // ── Main entry ─────────────────────────────────────────────────

  async fillAll() {
    // Phase 1: Scan all fields
    const allFields = this._scanForm();
    if (!allFields.length) return { filled: 0, unmatched: 0, message: '页面未检测到表单字段' };

    // Phase 2: Exact match (existing logic, free)
    const remaining = [];
    let exactFilled = 0;
    for (const field of allFields) {
      const exact = this._findExactMatch(field.label);
      if (exact && this._isFieldEmpty(field.el)) {
        this._fillInputEl(field.el, exact.fillContent);
        exactFilled++;
      } else if (this._isFieldEmpty(field.el)) {
        remaining.push(field);
      }
    }

    if (!remaining.length) {
      return { filled: exactFilled, unmatched: 0, message: `全部 ${exactFilled} 个字段已填写` };
    }

    // Phase 3: LLM semantic mapping for unmatched fields
    const profileSummary = this._summarizeProfile();
    const fieldDescriptions = this._describeFields(remaining);

    const prompt = this._buildMappingPrompt(profileSummary, fieldDescriptions);

    let aiResult;
    try {
      const res = await this._ai.chat([
        { role: 'system', content: 'You are a form-filling assistant. Return ONLY valid JSON, no explanation.' },
        { role: 'user', content: prompt }
      ], { temperature: 0.1, maxTokens: 2000 });
      aiResult = this._parseAIResponse(res.content);
    } catch (err) {
      return { filled: exactFilled, unmatched: remaining.length, message: 'AI 分析失败：' + err.message };
    }

    // Phase 4: Execute actions
    const aiFilled = this._executeActions(aiResult.actions || [], remaining);

    return {
      filled: exactFilled + aiFilled,
      unmatched: remaining.length - aiFilled,
      message: null
    };
  }

  // ── Form scanning ──────────────────────────────────────────────

  _scanForm() {
    const fields = [];
    const seen = new Set();

    for (const el of document.querySelectorAll(FIELD_SELECTOR)) {
      if (this._sidebar?.contains(el)) continue;
      // Deduplicate by position (same rect = same field)
      const rect = el.getBoundingClientRect();
      const key = `${rect.left.toFixed(0)},${rect.top.toFixed(0)},${el.tagName}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const info = this._extractFieldInfo(el);
      if (info) fields.push(info);
    }
    return fields;
  }

  _extractFieldInfo(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const label = this._getFieldLabel(el) || '';
    const name = el.name || '';
    const id = el.id || '';
    const placeholder = el.placeholder || '';
    const isContentEditable = el.contentEditable === 'true' || el.getAttribute('role') === 'textbox';

    // Determine field type category
    let fieldType = type || (tag === 'textarea' ? 'textarea' : tag);
    if (isContentEditable) fieldType = 'richtext';

    // Extract options for select / radio / checkbox groups
    let options = null;
    if (tag === 'select') {
      options = Array.from(el.options).map(o => o.textContent.trim()).filter(Boolean);
    }
    // For radio/checkbox, find sibling options with same name
    if (type === 'radio' && name) {
      const radios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
      options = Array.from(radios).map(r => {
        const lbl = r.closest('label')?.textContent?.trim() || r.value || r.id;
        return lbl;
      }).filter(Boolean);
    }

    // Nearby text context (text in parent element that isn't the input itself)
    const parentText = el.closest('div,section,fieldset,li,td,p')?.textContent?.trim().slice(0, 100) || '';

    return {
      el,
      label,
      fieldType,
      name,
      id,
      placeholder,
      options,
      parentText: parentText.replace(/\s+/g, ' '),
      index: 0 // will be assigned
    };
  }

  _isFieldEmpty(el) {
    if (el.tagName === 'SELECT') return !el.value;
    return !(el.value || el.textContent?.trim() || '');
  }

  // ── Profile summarization ──────────────────────────────────────

  _summarizeProfile() {
    if (!this._profile?.orderedData) return '(no data)';
    return this._profile.orderedData
      .map(item => `${item.title} > ${item.buttonText}: ${item.fillContent.slice(0, 200)}`)
      .join('\n');
  }

  // ── Field description for LLM ──────────────────────────────────

  _describeFields(fields) {
    return fields.map((f, i) => {
      f.index = i;
      let desc = `${i}: type=${f.fieldType}, label="${f.label}"`;
      if (f.id) desc += `, id="${f.id}"`;
      if (f.name) desc += `, name="${f.name}"`;
      if (f.placeholder) desc += `, placeholder="${f.placeholder}"`;
      if (f.options) desc += `, options=[${f.options.join('|')}]`;
      if (f.parentText) desc += `, context="${f.parentText}"`;
      return desc;
    }).join('\n');
  }

  // ── LLM prompt ─────────────────────────────────────────────────

  _buildMappingPrompt(profileSummary, fieldDescriptions) {
    return `Match the user's profile data to the form fields below. Return a JSON object with an "actions" array.

## User Profile Data
${profileSummary}

## Form Fields (unfilled)
${fieldDescriptions}

## Instructions
For each field, determine the best matching value from the profile data.
- action "fill": for text inputs, textareas, contenteditable — set the value directly
- action "click": for select dropdowns, radio buttons — click the matching option
- action "skip": if no match found
- For select/radio types, the "value" should match one of the listed options exactly

## Response Format
{
  "actions": [
    {"index": 0, "action": "fill", "value": "张三"},
    {"index": 1, "action": "click", "value": "硕士"},
    {"index": 3, "action": "skip", "reason": "no match"}
  ]
}

Return ONLY the JSON object, no other text.`;
  }

  _parseAIResponse(content) {
    let clean = content.trim();
    // Remove markdown code fences
    const m = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) clean = m[1].trim();
    // Find first { ... } block
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start !== -1 && end > start) clean = clean.slice(start, end + 1);

    const parsed = JSON.parse(clean);
    if (!parsed.actions || !Array.isArray(parsed.actions)) {
      throw new Error('AI 返回格式无效：缺少 actions 数组');
    }
    return parsed;
  }

  // ── Action execution ───────────────────────────────────────────

  _executeActions(actions, fields) {
    let filled = 0;
    for (const action of actions) {
      if (action.action === 'skip') continue;
      const field = fields[action.index];
      if (!field) continue;

      try {
        if (action.action === 'fill') {
          this._fillInputEl(field.el, action.value);
          filled++;
        } else if (action.action === 'click') {
          this._executeClick(field, action.value);
          filled++;
        }
      } catch (err) {
        console.warn('[OAA] 操作执行失败:', field.label, err.message);
      }
    }
    return filled;
  }

  // ── Click strategies ───────────────────────────────────────────

  _executeClick(field, value) {
    const el = field.el;
    const tag = el.tagName.toLowerCase();

    // Native select — just set value, no click needed
    if (tag === 'select') {
      const option = Array.from(el.options).find(
        o => o.textContent.trim() === value || o.value === value ||
             o.textContent.includes(value) || value.includes(o.textContent.trim())
      );
      if (option) {
        el.value = option.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }

    // Radio buttons
    if (el.type === 'radio') {
      const name = el.name;
      if (!name) return;
      // Find the radio with matching label
      const allRadios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
      for (const r of allRadios) {
        const lbl = r.closest('label')?.textContent?.trim() || r.value;
        if (lbl === value || lbl.includes(value) || value.includes(lbl)) {
          r.click();
          r.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
      return;
    }

    // Checkbox
    if (el.type === 'checkbox') {
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Custom select / dropdown (div/ul/span based widget)
    // Step 1: Click the trigger element
    this._clickTrigger(el);

    // Step 2: Wait for dropdown to appear, then click the matching option
    this._waitAndClickOption(value, el);
  }

  _clickTrigger(el) {
    // Try clicking the element itself first
    el.focus();
    el.click();
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    // Also try parent if it looks like a trigger (has dropdown-related classes)
    const parent = el.closest('[class*="select"], [class*="dropdown"], [class*="picker"], [class*="combobox"], [role="combobox"], [role="listbox"]');
    if (parent && parent !== el) {
      parent.click();
      parent.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  }

  _waitAndClickOption(value, triggerEl) {
    // Strategy: watch for new DOM nodes, look for option-like elements
    const startTime = Date.now();
    const maxWait = 3000;
    const normalizedValue = value.toLowerCase().trim();

    const tryClick = () => {
      // Common option selectors for popular UI frameworks
      const optionSelectors = [
        '[class*="option"]', '[class*="item"]', '[class*="menu-item"]',
        '[role="option"]', '[role="menuitem"]', '[role="listitem"]',
        'li', '.el-select-dropdown__item', '.ant-select-item',
        '.rc-select-item', '[class*="select-option"]',
        '.dropdown-item', '.list-item'
      ];

      for (const sel of optionSelectors) {
        const candidates = document.querySelectorAll(sel);
        for (const c of candidates) {
          // Skip if inside sidebar
          if (this._sidebar?.contains(c)) continue;
          const text = c.textContent?.trim() || '';
          const textLower = text.toLowerCase();
          if (textLower === normalizedValue ||
              textLower.includes(normalizedValue) ||
              normalizedValue.includes(textLower)) {
            // Found it — click
            c.click();
            c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            c.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            c.dispatchEvent(new Event('change', { bubbles: true }));

            // If it was a select-like popup, try to close by pressing Escape
            setTimeout(() => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }, 100);
            return true;
          }
        }
      }
      return false;
    };

    // Try immediately first (sync dropdowns)
    if (tryClick()) return;

    // Set up MutationObserver for async dropdowns
    const observer = new MutationObserver(() => {
      if (tryClick()) {
        observer.disconnect();
        return;
      }
      if (Date.now() - startTime > maxWait) {
        observer.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Also try again after short delays (for animated dropdowns)
    const intervals = [150, 400, 800, 1500];
    for (const delay of intervals) {
      setTimeout(() => {
        if (Date.now() - startTime > maxWait) return;
        if (tryClick()) observer.disconnect();
      }, delay);
    }

    // Cleanup
    setTimeout(() => observer.disconnect(), maxWait + 100);
  }
}