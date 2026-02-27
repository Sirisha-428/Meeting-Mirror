import { useEffect, useState } from 'react';
import { app } from '@microsoft/teams-js';

export interface MeetingContext {
  isInMeeting: boolean;
  meetingId: string | null;
  chatId?: string | null;
}

/**
 * Detects if the app is running inside a Teams meeting using app.getContext().
 * Returns meeting ID when in meeting context.
 */
export function useMeetingContext(): MeetingContext {
  const [context, setContext] = useState<MeetingContext>({
    isInMeeting: false,
    meetingId: null,
  });

  useEffect(() => {
    const fetchContext = async () => {
      try {
        const ctx = await app.getContext();
        
        // Check if we're in a meeting context
        // frameContext: 'sidePanel' when in meeting side panel
        // meetingId is present when in a meeting
        const meetingId = ctx.meeting?.id ?? null;
        const isInMeeting = 
          ctx.page?.frameContext === 'sidePanel' ||
          ctx.app?.host?.name === 'Teams' ||
          meetingId != null;

        setContext({
          isInMeeting: isInMeeting || !!meetingId,
          meetingId,
          chatId: ctx.chat?.id,
        });
      } catch (err) {
        console.error('Failed to get Teams context:', err);
        setContext({ isInMeeting: false, meetingId: null });
      }
    };

    fetchContext();
  }, []);

  return context;
}
