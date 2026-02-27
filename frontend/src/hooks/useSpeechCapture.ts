import { useCallback, useEffect, useRef, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionLike = any;

export function useSpeechCapture(
  onTranscript: (text: string) => void,
  enabled: boolean
) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [livePreview, setLivePreview] = useState<string | null>(null);
  const [recognitionError, setRecognitionError] = useState<string | null>(null);

  const start = useCallback(async (): Promise<boolean> => {
    const SR = typeof window !== 'undefined' && ((window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition);
    if (!SR || !enabled) return false;
    if (recognitionRef.current) return true;

    setRecognitionError(null);
    setLastHeard(null);
    setLivePreview(null);

    try {
      // Request mic permission first — ensures user sees browser prompt
      await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("media",navigator.mediaDevices)
    } catch (err) {
      setRecognitionError('Microphone access denied. Allow microphone in browser settings.');
      return false;
    }

    const recognition = new (SR as new () => SpeechRecognitionLike)();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: { resultIndex: number; results: SpeechRecognitionResultList }) => {
      let finalTranscript = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) {
          finalTranscript += text;
        } else {
          interim += text;
        }
      }
      setLivePreview(interim.trim() || null);
      if (finalTranscript.trim()) {
        setLastHeard(finalTranscript.trim());
        onTranscript(finalTranscript.trim());
      }
    };

    recognition.onerror = (event: { error: string }) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      const msg = event.error === 'not-allowed' ? 'Microphone access denied.' : `Recognition error: ${event.error}`;
      setRecognitionError(msg);
    };

    recognition.start();
    recognitionRef.current = recognition;
    return true;
  }, [enabled, onTranscript]);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore if already stopped
      }
      recognitionRef.current = null;
    }
    setLivePreview(null);
  }, []);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  const isSupported =
    typeof window !== 'undefined' &&
    !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  return { start, stop, isSupported, lastHeard, livePreview, recognitionError };
}
