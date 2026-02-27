/**
 * Content script for meet.google.com
 * Extracts meeting ID from URL and stores in chrome.storage for the side panel.
 * Google Meet URLs: https://meet.google.com/xxx-xxxx-xxx or meet.google.com/xxx
 */
function extractMeetingId() {
  const path = window.location.pathname.replace(/^\/+/, '');
  // Meet URLs: /abc-defg-hij or /abc (short form)
  const match = path.match(/^([a-z]+(?:-[a-z]+)*)/i);
  return match ? match[1] : null;
}

function updateMeetingId() {
  const meetingId = extractMeetingId();
  chrome.storage.local.set({ meetingId });
}

// Initial extract
updateMeetingId();

// Update when URL changes (SPA navigation)
let lastPath = location.pathname;
const observer = new MutationObserver(() => {
  if (location.pathname !== lastPath) {
    lastPath = location.pathname;
    updateMeetingId();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// Fallback: listen for popstate (back/forward)
window.addEventListener('popstate', updateMeetingId);
