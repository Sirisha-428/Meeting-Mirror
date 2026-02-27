/**
 * Real-time speech-to-text using the Web Speech API (built into Chrome).
 * Provides live interim results as you speak, and fires onFinal when a phrase completes.
 * No API calls, no thresholds — Chrome handles voice activity detection internally.
 *
 * Infinite recording strategy:
 *   Chrome hard-stops every ~60 s even with continuous=true.
 *   On every onend we create a BRAND-NEW SpeechRecognition instance (instead of calling
 *   rec.start() on a dead object) after a 300 ms gap that lets Chrome release the mic.
 *   Reusing a dead instance is what causes the "stuck on 'and'" freeze.
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
  // Keep latest values in refs so event handlers never go stale
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const langRef = useRef(recognitionLang);
  langRef.current = recognitionLang;

  // Stable ref to the session-launch function so onend can call it recursively
  const launchSessionRef = useRef<() => void>(() => {});

  const isSupported =
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  /**
   * Create a fresh SpeechRecognition instance and start it.
   * Called both on initial start and on every automatic restart.
   * Using a fresh instance (instead of rec.start() on a finished object) is
   * the only reliable way to prevent Chrome from freezing on a partial word.
   */
  const launchSession = useCallback(() => {
    if (!enabledRef.current) return;
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) return;

    // Always clear stale interim before starting a new segment so a frozen
    // partial word (e.g. "and") never lingers on screen.
    setInterim('');

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = langRef.current || 'en-US';
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
      // Benign — emitted during normal pauses and between 60 s segments
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      // Recoverable blip — Chrome will fire onend next; the restart handler below takes over
      if ((event.error === 'network' || event.error === 'audio-capture') && enabledRef.current) {
        console.warn('[SpeechTranscription] recoverable error:', event.error, '— restarting via onend');
        return;
      }
      console.error('[SpeechTranscription] unrecoverable error:', event.error);
      setError(`Transcription error: ${event.error}`);
      setIsListening(false);
    };

    /**
     * Chrome fires onend on every session boundary (~60 s, silence, or error).
     * We create a FRESH instance after a 300 ms gap — never call rec.start() again
     * on a finished object, as that is what causes the "stuck word" freeze.
     */
    rec.onend = () => {
      if (enabledRef.current && recognitionRef.current === rec) {
        setTimeout(() => {
          if (!enabledRef.current || recognitionRef.current !== rec) return;
          console.log('[SpeechTranscription] segment ended — launching fresh session');
          launchSessionRef.current();
        }, 300);
      } else if (recognitionRef.current === rec) {
        // onend fired because the user pressed Stop (enabled became false)
        recognitionRef.current = null;
        setIsListening(false);
        setInterim('');
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setIsListening(true);
      console.log('[SpeechTranscription] new session started (lang=%s)', rec.lang);
    } catch (e) {
      console.error('[SpeechTranscription] start failed:', e);
      setError('Failed to start speech recognition.');
      setIsListening(false);
    }
  }, []); // No deps — reads everything via refs

  // Keep the ref current so the recursive onend → launchSessionRef() call
  // always invokes the latest stable function reference.
  launchSessionRef.current = launchSession;

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      rec.onend = null; // detach before abort so the restart branch never runs
      rec.abort();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setInterim('');
  }, []);

  /** Public start — checks mic permission once, then hands off to launchSession. */
  const start = useCallback(async (): Promise<boolean> => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) {
      setError('Speech recognition not available in this browser. Use Chrome.');
      return false;
    }
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('Microphone access denied. Allow microphone in Chrome settings.');
      return false;
    }
    setError(null);
    launchSession();
    return true;
  }, [launchSession]);

  useEffect(() => {
    if (!enabled) stop();
    return () => stop();
  }, [enabled, stop]);

  return { start, stop, interim, isListening, error, isSupported };
}
