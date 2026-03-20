// Service worker — relay messages between content script and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Forward tts-state messages from content script to popup
  // (handled automatically by chrome.runtime.onMessage in popup)
  sendResponse({ ok: true });
});
