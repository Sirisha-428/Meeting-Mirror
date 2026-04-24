import { useCallback, useEffect, useRef, useState } from 'react';

const getWsUrl = () => {
  const port = 8000;
  const protocol = 'wss';
  const host =
    typeof chrome !== 'undefined' && chrome.runtime?.id
      ? 'localhost'
      : window.location.hostname;
  return `${protocol}://${host}:${port}`;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'failed';

export type CoachingInsights = {
  fillerWordsDetected: string[];
  pace: string;
  volume: string;
  clarity: string;
  suggestions: string[];
};

export type MeetingSummaryReport = {
  totalFillerWords: number;
  mostUsedFillerWords: string[];
  speakingPace: 'too fast' | 'too slow' | 'good';
  volumeAnalysis: 'low' | 'good';
  clarityScore: number;
  improvements: string[];
  suggestedAlternatives: Record<string, string[]>;
};

export type CoachingMessage = {
  toastMessages: string[];
  insights: CoachingInsights;
  system?: boolean;
};

/** Strip any server fields that could leak transcript or raw speech before UI / Meet toasts. */
export function filterFeedback(data: Record<string, unknown>): CoachingMessage | null {
  if (!data || data.type !== 'coaching') return null;
  const rawInsights = data.insights as Record<string, unknown> | undefined;
  if (!rawInsights || typeof rawInsights !== 'object') return null;

  const fillers = Array.isArray(rawInsights.fillerWordsDetected)
    ? (rawInsights.fillerWordsDetected as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  const pace = typeof rawInsights.pace === 'string' ? rawInsights.pace : 'good';
  const volume = typeof rawInsights.volume === 'string' ? rawInsights.volume : 'good';
  const clarity = typeof rawInsights.clarity === 'string' ? rawInsights.clarity : 'good';
  const suggestions = Array.isArray(rawInsights.suggestions)
    ? (rawInsights.suggestions as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  const toasts = Array.isArray(data.toastMessages)
    ? (data.toastMessages as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];

  const safeToasts = toasts.map((t) => scrubRawSpeechHint(t)).filter((t) => t.length > 0);

  return {
    toastMessages: safeToasts,
    insights: {
      fillerWordsDetected: fillers,
      pace,
      volume,
      clarity,
      suggestions: suggestions.map((s) => scrubRawSpeechHint(s)).filter(Boolean),
    },
    system: data.system === true,
  };
}

/** Remove lines that look like quoted dialogue or long stream-of-speech (extra guard). */
function scrubRawSpeechHint(text: string): string {
  let s = text.trim();
  if (s.length > 160) return '';
  if (/^[«»"“”].+[»«"“”]$/.test(s) && s.length > 40) return '';
  if (/\b(do you understand|as i was saying|what i mean is)\b/i.test(s) && s.length > 50) return '';
  return s;
}

export function useCoachingWebSocket(meetingId: string | null) {
  const [coachingMessage, setCoachingMessage] = useState<CoachingMessage | null>(null);
  const [meetingSummary, setMeetingSummary] = useState<MeetingSummaryReport | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

  const effectiveMeetingId = meetingId ?? 'local-dev';

  const sendTranscript = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && text.trim()) {
      wsRef.current.send(JSON.stringify({ type: 'transcript', text }));
    }
  }, []);

  const sendProcessTranscript = useCallback((fullText: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && fullText.trim()) {
      wsRef.current.send(JSON.stringify({ type: 'process_transcript', text: fullText }));
    }
  }, []);

  const requestSummary = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'request_summary' }));
    }
  }, []);

  const resetSession = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset_session' }));
    }
    setMeetingSummary(null);
  }, []);

  useEffect(() => {
    if (!effectiveMeetingId) {
      setStatus('failed');
      return;
    }

    setStatus('connecting');
    const wsUrl = `${getWsUrl()}/ws/coaching/${effectiveMeetingId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatus('connected');
    ws.onclose = () => {
      setStatus('failed');
      wsRef.current = null;
    };
    ws.onerror = () => setStatus('failed');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (data.type === 'meeting_summary' && data.summary && typeof data.summary === 'object') {
          setMeetingSummary(data.summary as MeetingSummaryReport);
          return;
        }
        if (data.type === 'session_reset') {
          setMeetingSummary(null);
          return;
        }
        const filtered = filterFeedback(data);
        if (filtered?.toastMessages.length) {
          setCoachingMessage(filtered);
        }
      } catch {
        // ignore malformed
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [effectiveMeetingId]);

  return {
    coachingMessage,
    meetingSummary,
    setMeetingSummary,
    status,
    sendTranscript,
    sendProcessTranscript,
    requestSummary,
    resetSession,
    isConnected: status === 'connected',
  };
}
