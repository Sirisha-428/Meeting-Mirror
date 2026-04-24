/**
 * Content script for meet.google.com
 * - Writes meetingId to chrome.storage for the side panel.
 * - Renders coaching toasts (queue, max 2 visible, 3s dismiss, fade) via chrome.runtime.onMessage.
 */
const MEET_MIRROR_MESSAGE = {
  TOAST: 'MEETINGMIRROR_TOAST',
  TOAST_BATCH: 'MEETINGMIRROR_TOAST_BATCH',
  CLEAR: 'MEETINGMIRROR_TOAST_CLEAR',
  SHOW_TOAST: 'SHOW_TOAST',
};

const MAX_VISIBLE = 2;
const DEFAULT_DURATION_MS = 3000;
const THROTTLE_SAME_MS = 1400;

function extractMeetingId() {
  const path = window.location.pathname.replace(/^\/+/, '');
  const match = path.match(/^([a-z]+(?:-[a-z]+)*)/i);
  return match ? match[1] : null;
}

function updateMeetingId() {
  const meetingId = extractMeetingId();
  chrome.storage.local.set({ meetingId });
}

let stackContainer = null;
let styleNode = null;

/** @type {{ el: HTMLElement, timer: ReturnType<typeof setTimeout> }[]} */
const visibleToasts = [];
/** @type {{ message: string, variant: string, durationMs: number }[]} */
const pendingQueue = [];

let lastToastText = '';
let lastToastAt = 0;

function ensureToastUi() {
  if (stackContainer?.isConnected) return stackContainer;

  if (!styleNode?.isConnected) {
    styleNode = document.createElement('style');
    styleNode.id = 'meetingmirror-toast-style';
    styleNode.textContent = `
      #mm-toast-root {
        position: fixed;
        top: 20px;
        right: 20px;
        left: auto;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
        pointer-events: none;
        max-width: min(340px, calc(100vw - 40px));
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      #mm-toast-root .mm-toast {
        margin: 0;
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.4;
        color: #ffffff;
        background: #1f2937;
        border: 1px solid rgba(148, 163, 184, 0.45);
        box-shadow: 0 10px 35px rgba(0, 0, 0, 0.35);
        opacity: 0;
        transform: translateY(-10px);
        transition: opacity 220ms ease, transform 220ms ease;
        box-sizing: border-box;
        width: max-content;
        max-width: min(300px, calc(100vw - 40px));
        word-wrap: break-word;
        pointer-events: auto;
      }
      #mm-toast-root .mm-toast.mm-visible {
        opacity: 1;
        transform: translateY(0);
      }
      #mm-toast-root .mm-toast.mm-out {
        opacity: 0;
        transform: translateY(-6px);
      }
      #mm-toast-root .mm-toast.mm-warning {
        border-color: rgba(251, 191, 36, 0.55);
        background: rgba(69, 47, 20, 0.96);
      }
      #mm-toast-root .mm-toast.mm-suggestion {
        border-color: rgba(56, 189, 248, 0.5);
        background: rgba(22, 40, 58, 0.96);
      }
    `;
    document.head.appendChild(styleNode);
  }

  stackContainer = document.getElementById('mm-toast-root');
  if (!stackContainer) {
    stackContainer = document.createElement('div');
    stackContainer.id = 'mm-toast-root';
    stackContainer.setAttribute('aria-live', 'polite');
    document.body.appendChild(stackContainer);
    console.log('Toast container injected');
  }
  return stackContainer;
}

function fadeOutRemove(el, onDone) {
  el.classList.remove('mm-visible');
  el.classList.add('mm-out');
  const done = () => {
    el.removeEventListener('transitionend', done);
    el.remove();
    if (typeof onDone === 'function') onDone();
  };
  el.addEventListener('transitionend', done);
  setTimeout(done, 280);
}

function removeVisibleEntry(el) {
  const i = visibleToasts.findIndex((x) => x.el === el);
  if (i >= 0) {
    clearTimeout(visibleToasts[i].timer);
    visibleToasts.splice(i, 1);
  }
  fadeOutRemove(el, () => pumpQueue());
}

function pumpQueue() {
  const container = ensureToastUi();
  while (visibleToasts.length < MAX_VISIBLE && pendingQueue.length > 0) {
    const item = pendingQueue.shift();
    if (!item?.message?.trim()) continue;

    const text = item.message.trim();
    const now = Date.now();
    if (text === lastToastText && now - lastToastAt < THROTTLE_SAME_MS) {
      continue;
    }
    lastToastText = text;
    lastToastAt = now;

    const el = document.createElement('div');
    el.className = 'mm-toast';
    const v = item.variant;
    if (v === 'warning') el.classList.add('mm-warning');
    else if (v === 'suggestion') el.classList.add('mm-suggestion');
    el.setAttribute('role', 'status');
    el.textContent = text;
    container.appendChild(el);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('mm-visible'));
    });

    const durationMs = typeof item.durationMs === 'number' ? item.durationMs : DEFAULT_DURATION_MS;
    const timer = setTimeout(() => {
      removeVisibleEntry(el);
    }, durationMs);

    visibleToasts.push({ el, timer });
  }
}

function enqueueToast(message, variant, durationMs) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return;
  pendingQueue.push({
    message: text,
    variant: variant === 'warning' || variant === 'suggestion' ? variant : 'default',
    durationMs: typeof durationMs === 'number' ? durationMs : DEFAULT_DURATION_MS,
  });
  pumpQueue();
}

function clearAllToasts() {
  lastToastText = '';
  lastToastAt = 0;
  pendingQueue.length = 0;
  const copy = [...visibleToasts];
  visibleToasts.length = 0;
  for (const item of copy) {
    clearTimeout(item.timer);
    fadeOutRemove(item.el, () => {});
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === MEET_MIRROR_MESSAGE.CLEAR) {
    clearAllToasts();
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === MEET_MIRROR_MESSAGE.TOAST) {
    const duration = typeof msg.durationMs === 'number' ? msg.durationMs : DEFAULT_DURATION_MS;
    const variant = msg.variant === 'warning' || msg.variant === 'suggestion' ? msg.variant : 'default';
    enqueueToast(msg.message, variant, duration);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === MEET_MIRROR_MESSAGE.SHOW_TOAST) {
    const duration = typeof msg.durationMs === 'number' ? msg.durationMs : DEFAULT_DURATION_MS;
    const variant = msg.variant === 'warning' || msg.variant === 'suggestion' ? msg.variant : 'default';
    enqueueToast(msg.message, variant, duration);
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === MEET_MIRROR_MESSAGE.TOAST_BATCH) {
    const items = Array.isArray(msg.items) ? msg.items : [];
    const duration = typeof msg.durationMs === 'number' ? msg.durationMs : DEFAULT_DURATION_MS;
    for (const it of items) {
      if (!it || typeof it.message !== 'string') continue;
      const variant = it.variant === 'warning' || it.variant === 'suggestion' ? it.variant : 'default';
      const d = typeof it.durationMs === 'number' ? it.durationMs : duration;
      enqueueToast(it.message, variant, d);
    }
    sendResponse({ ok: true });
    return;
  }
});

updateMeetingId();

let lastPath = location.pathname;
const observer = new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    updateMeetingId();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('popstate', updateMeetingId);
