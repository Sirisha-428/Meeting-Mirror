/**
 * Opens the side panel when the extension icon is clicked.
 * Forwards coaching toasts from the side panel to Meet content scripts.
 */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const TYPES = {
  TOAST: 'MEETINGMIRROR_TOAST',
  TOAST_BATCH: 'MEETINGMIRROR_TOAST_BATCH',
  CLEAR: 'MEETINGMIRROR_TOAST_CLEAR',
  SHOW_TOAST: 'SHOW_TOAST',
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === TYPES.CLEAR) {
    chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id != null) {
          chrome.tabs.sendMessage(tab.id, { type: TYPES.CLEAR }).catch(() => {});
        }
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === TYPES.TOAST) {
    const payload = {
      type: TYPES.SHOW_TOAST,
      message: msg.message,
      variant: msg.variant === 'warning' || msg.variant === 'suggestion' ? msg.variant : 'default',
      durationMs: typeof msg.durationMs === 'number' ? msg.durationMs : 3000,
    };
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id != null && activeTab.url?.startsWith('https://meet.google.com/')) {
        chrome.tabs.sendMessage(activeTab.id, payload).catch(() => {});
      } else {
        chrome.tabs.query({ url: 'https://meet.google.com/*' }, (meetTabs) => {
          const firstMeetTab = meetTabs[0];
          if (firstMeetTab?.id != null) {
            chrome.tabs.sendMessage(firstMeetTab.id, payload).catch(() => {});
          }
        });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === TYPES.TOAST_BATCH) {
    const payload = {
      type: TYPES.TOAST_BATCH,
      items: Array.isArray(msg.items) ? msg.items : [],
      durationMs: typeof msg.durationMs === 'number' ? msg.durationMs : 3000,
    };
    chrome.tabs.query({ url: 'https://meet.google.com/*' }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id != null) {
          chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
        }
      }
      sendResponse({ ok: true });
    });
    return true;
  }
});
