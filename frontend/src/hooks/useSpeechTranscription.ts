/**
 * Real-time speech-to-text using the Web Speech API (built into Chrome).
 * Provides live interim results as you speak, and fires onFinal when a phrase completes.
 * No API calls, no thresholds — Chrome handles voice activity detection internally.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal type declarations for Web Speech API (not in all TS DOM libs)
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

export function useSpeechTranscription(
  onFinal: (text: string) => void,
  enabled: boolean,
  recognitionLang: string = 'en-US'
) {
  const [interim, setInterim] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Keep latest callback in a ref so the onresult handler never goes stale
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const isSupported =
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      rec.onend = null; // prevent auto-restart
      rec.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterim('');
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      setError('Speech recognition not available in this browser. Use Chrome.');
      return false;
    }

    // Ensure mic permission is granted before starting
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access denied. Allow microphone in Chrome settings.');
      return false;
    }

    setError(null);
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = recognitionLang || 'en-US';
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0].transcript.trim();
          if (text) {
            onFinalRef.current(text);
            setInterim('');
          }
        } else {
          interimText += result[0].transcript;
        }
      }
      if (interimText) setInterim(interimText);
    };

    rec.onerror = (event) => {
      // no-speech / aborted are normal — don't surface as errors
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('[SpeechTranscription] error:', event.error);
      setError(`Transcription error: ${event.error}`);
      setIsListening(false);
    };

    // Auto-restart when the browser ends the session (happens every ~60s in Chrome)
    rec.onend = () => {
      if (enabledRef.current && recognitionRef.current === rec) {
        try {
          rec.start();
        } catch {
          // If start() throws the session is already restarting
        }
      } else {
        setIsListening(false);
        setInterim('');
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setIsListening(true);
      console.log('[SpeechTranscription] started');
      return true;
    } catch (e) {
      setError('Failed to start speech recognition.');
      console.error('[SpeechTranscription] start failed:', e);
      return false;
    }
  }, [recognitionLang]);

  useEffect(() => {
    if (!enabled) stop();
    return () => stop();
  }, [enabled, stop]);

  return { start, stop, interim, isListening, error, isSupported };
}
