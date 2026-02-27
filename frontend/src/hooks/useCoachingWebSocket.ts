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

export type FeedbackMessage = {
  feedback: string;
  transcript?: string;
  fillers?: string;
  feedbackType?: 'engagement' | 'pace_volume' | 'suggested_sentence' | 'filler_words' | 'positive' | 'other_language';
  improved_sentence?: string;
  filler_breakdown?: string;
  pace?: string;
  volume?: string;
  engagement_alert?: string;
  suggestion?: string;
  language_detected?: string;
  non_english_message?: string;
};

export function useCoachingWebSocket(meetingId: string | null) {
  const [feedbackMessage, setFeedbackMessage] =
    useState<FeedbackMessage | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const wsRef = useRef<WebSocket | null>(null);

  const effectiveMeetingId = meetingId ?? 'local-dev';

  const sendTranscript = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && text.trim()) {
      wsRef.current.send(JSON.stringify({ type: 'transcript', text }));
    }
  }, []);

  /** Send full transcript for one-shot Gemini processing (e.g. after Stop recording). */
  const sendProcessTranscript = useCallback((fullText: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && fullText.trim()) {
      wsRef.current.send(JSON.stringify({ type: 'process_transcript', text: fullText }));
    }
  }, []);

  const sendAudio = useCallback((data: string, mime = 'audio/webm') => {
    if (wsRef.current?.readyState === WebSocket.OPEN && data) {
      wsRef.current.send(JSON.stringify({ type: 'audio', data, mime }));
    }
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
        const data = JSON.parse(event.data);
        if (data.heard) {
          setLastHeard(data.heard);
        } else if (data.feedback) {
          setFeedbackMessage({
            feedback: data.feedback,
            transcript: data.transcript ?? undefined,
            fillers: data.fillers ?? undefined,
            feedbackType: data.feedbackType ?? undefined,
            improved_sentence: data.improved_sentence ?? undefined,
            filler_breakdown: data.filler_breakdown ?? undefined,
            pace: data.pace ?? undefined,
            volume: data.volume ?? undefined,
            engagement_alert: data.engagement_alert ?? undefined,
            suggestion: data.suggestion ?? undefined,
            language_detected: data.language_detected ?? undefined,
            non_english_message: data.non_english_message ?? undefined,
          });
        }
      } catch {
        setFeedbackMessage(
          typeof event.data === 'string'
            ? { feedback: event.data }
            : null
        );
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [effectiveMeetingId]);

  return {
    feedback: feedbackMessage?.feedback ?? null,
    transcript: feedbackMessage?.transcript,
    feedbackMessage,
    lastHeard,
    isConnected: status === 'connected',
    status,
    sendTranscript,
    sendProcessTranscript,
    sendAudio,
  };
}
