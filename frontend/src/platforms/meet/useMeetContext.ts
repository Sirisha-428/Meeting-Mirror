import { useEffect, useState } from 'react';

export interface MeetContext {
  isInMeeting: boolean;
  meetingId: string | null;
}

/**
 * Gets meeting context for Google Meet via Chrome extension.
 * Meeting ID is extracted from meet.google.com URL by the content script
 * and stored in chrome.storage.
 */
export function useMeetContext(): MeetContext {
  const [context, setContext] = useState<MeetContext>({
    isInMeeting: false,
    meetingId: null,
  });

  useEffect(() => {
    // URL param fallback (e.g. when opened with ?platform=meet&meetingId=xxx)
    const params = new URLSearchParams(window.location.search);
    const urlMeetingId = params.get('meetingId');

    if (urlMeetingId) {
      setContext({ isInMeeting: true, meetingId: urlMeetingId });
      return;
    }

    // Chrome extension: read from storage (set by content script)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(['meetingId'], (result: { meetingId?: string }) => {
        const meetingId = typeof result.meetingId === 'string' ? result.meetingId : null;
        setContext({
          isInMeeting: !!meetingId,
          meetingId,
        });
      });

      // Listen for updates when user navigates to a different Meet
      const handler = (
        changes: { [key: string]: chrome.storage.StorageChange },
        areaName: string
      ) => {
        if (areaName === 'local' && changes.meetingId) {
          const meetingId = typeof changes.meetingId.newValue === 'string' ? changes.meetingId.newValue : null;
          setContext({ isInMeeting: !!meetingId, meetingId });
        }
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    }

    setContext({ isInMeeting: false, meetingId: null });
  }, []);

  return context;
}
