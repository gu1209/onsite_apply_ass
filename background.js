// Onsite Apply Assistant — Service Worker

const BLOCKED = /^(chrome|edge|about|data|chrome-extension):/;

async function sendToTab(tabId, tabUrl, action) {
  if (!tabUrl || BLOCKED.test(tabUrl)) return;
  try {
    await chrome.tabs.sendMessage(tabId, { action });
  } catch (_) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise(r => setTimeout(r, 200));
      await chrome.tabs.sendMessage(tabId, { action });
    } catch (err) {
      console.error('[OAA] 注入失败:', err.message);
    }
  }
}

chrome.action.onClicked.addListener(tab => sendToTab(tab.id, tab.url, 'open'));

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-sidebar') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) sendToTab(tab.id, tab.url, 'toggle');
});

// ── AI API Proxy ──────────────────────────────────────────────────
// Content scripts are subject to page CORS restrictions. We proxy all
// AI API calls through the service worker, which has full extension
// privileges and is not CORS-limited.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== 'oaa-fetch') return false;

  const { url, method, headers, body } = msg;

  fetch(url, { method, headers, body })
    .then(async res => {
      const responseBody = await res.text();
      sendResponse({
        ok: res.ok,
        status: res.status,
        body: responseBody
      });
    })
    .catch(err => {
      sendResponse({
        ok: false,
        status: 0,
        error: err.message
      });
    });

  // Return true to keep the message channel open for async sendResponse
  return true;
});