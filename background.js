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
