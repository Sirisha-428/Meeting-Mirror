/**
 * Sends coaching toasts: side panel → background → Meet content script (`extension/content.js`).
 */

export const MEET_MIRROR_MESSAGE = {
  TOAST: 'MEETINGMIRROR_TOAST',
  TOAST_BATCH: 'MEETINGMIRROR_TOAST_BATCH',
  CLEAR: 'MEETINGMIRROR_TOAST_CLEAR',
} as const;

export type MeetToastVariant = 'default' | 'warning' | 'suggestion';

export type MeetToastItem = {
  message: string;
  variant?: MeetToastVariant;
  durationMs?: number;
};

function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && typeof chrome.runtime.sendMessage === 'function';
}

const clampDuration = (ms: number | undefined, fallback: number) =>
  Math.min(8000, Math.max(2000, ms ?? fallback));

/** Push a toast on all open Meet tabs, or clear all toasts when message is null/empty. */
export function sendMeetCoachToast(options: {
  message: string | null;
  variant?: MeetToastVariant;
  durationMs?: number;
}): void {
  if (!isExtensionContext()) return;

  if (!options.message?.trim()) {
    chrome.runtime
      .sendMessage({ type: MEET_MIRROR_MESSAGE.CLEAR })
      .catch(() => {});
    return;
  }

  chrome.runtime
    .sendMessage({
      type: MEET_MIRROR_MESSAGE.TOAST,
      message: options.message.trim(),
      variant: options.variant ?? 'default',
      durationMs: clampDuration(options.durationMs, 3000),
    })
    .catch(() => {});
}

/** Enqueue multiple toasts on Meet (content script queues beyond max visible). */
export function sendMeetCoachToastBatch(items: MeetToastItem[], defaultDurationMs = 3000): void {
  if (!isExtensionContext() || !items.length) return;

  const payloadItems = items
    .filter((i) => i.message?.trim())
    .map((i) => ({
      message: i.message.trim(),
      variant: i.variant === 'warning' || i.variant === 'suggestion' ? i.variant : 'default',
      durationMs: clampDuration(i.durationMs, defaultDurationMs),
    }));

  if (!payloadItems.length) return;

  chrome.runtime
    .sendMessage({
      type: MEET_MIRROR_MESSAGE.TOAST_BATCH,
      items: payloadItems,
      durationMs: clampDuration(undefined, defaultDurationMs),
    })
    .catch(() => {});
}
