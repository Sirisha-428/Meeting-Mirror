export type Platform = 'teams' | 'meet';

/**
 * Detects whether the app is running in Teams or Google Meet (Chrome extension) context.
 */
export function detectPlatform(): Platform {
  // Chrome extension context (Google Meet)
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    return 'meet';
  }
  // URL param override (e.g. ?platform=meet for testing)
  const params = new URLSearchParams(window.location.search);
  if (params.get('platform') === 'meet') {
    return 'meet';
  }
  // Default: Microsoft Teams
  return 'teams';
}
