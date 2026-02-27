/**
 * VAD + audio capture for Groq Whisper transcription.
 * Based on swift-ai-voice-assistant: https://github.com/Sirisha-428/swift-ai-voice-assistant
 * Uses @ricky0123/vad-react for voice activity detection and encodes to WAV for Groq.
 */
import { useCallback, useEffect, useState } from 'react';
import { useMicVAD, utils } from '@ricky0123/vad-react';

/** Detect if we're running inside the Chrome extension (side panel). */
function isExtensionContext(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

/**
 * In the extension all assets must be served from the extension itself ('self').
 * - worker-src 'self': blocks CDN AudioWorklet addModule() calls.
 * - script-src 'self': blocks CDN dynamic import() of ort-wasm-simd-threaded.mjs.
 * All required files are bundled in extension/public/ and loaded from './'.
 */

export function useVADAudioCapture(
  onAudio: (base64Wav: string) => void,
  enabled: boolean,
  deviceId?: string
) {
  const [lastSegmentMs, setLastSegmentMs] = useState<number | null>(null);
  const [vadError, setVadError] = useState<string | null>(null);

  const handleSpeechStart = useCallback(() => {
    console.log('[MeetingMirror] VAD: speech START detected');
  }, []);

  const handleSpeechEnd = useCallback(
    (audio: Float32Array) => {
      console.log('[MeetingMirror] VAD: speech END — samples:', audio.length);
      const wav = utils.encodeWAV(audio);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        if (base64) {
          console.log('[MeetingMirror] VAD: sending audio blob, base64 length:', base64.length);
          onAudio(base64);
        }
      };
      reader.readAsDataURL(blob);
      setLastSegmentMs(Date.now());
    },
    [onAudio]
  );

  const vad = useMicVAD({
    startOnLoad: false,
    onSpeechStart: handleSpeechStart,
    onSpeechEnd: handleSpeechEnd,
    // Lower threshold so quieter/accented voices are caught.
    // 0.3 = VAD fires when Silero is ≥30% confident it's speech.
    positiveSpeechThreshold: 0.3,
    negativeSpeechThreshold: 0.15,
    minSpeechMs: 250,
    redemptionMs: 400,
    // Use 'ideal' (soft) instead of 'exact' (hard) — 'exact' throws a hard error
    // if the device ID is unavailable; 'ideal' falls back to default gracefully.
    ...(deviceId ? { userConstraints: { deviceId: { ideal: deviceId } } } : {}),
    // In extension: ALL assets served from extension itself ('self').
    // Use absolute chrome-extension:// URL so import() resolves correctly regardless of
    // which sub-folder the Vite bundle JS lives in (e.g. build/assets/ vs build/).
    // Files live in build/ (copied from extension/public/ by Vite).
    ...(isExtensionContext()
      ? {
          baseAssetPath: new URL('./', location.href).href,
          onnxWASMBasePath: new URL('./', location.href).href,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ortConfig: (ort: any) => {
            // Disable proxy worker — CSP worker-src 'self' forbids blob: worker URLs
            ort.env.wasm.proxy = false;
            ort.env.logLevel = 'error';
          },
        }
      : {}),
  });

  // Log VAD state to side-panel console for debugging
  useEffect(() => {
    if (vad.errored) {
      console.error('[MeetingMirror] VAD load failed:', vad.errored);
    } else if (!vad.loading) {
      console.log('[MeetingMirror] VAD ready (extension:', isExtensionContext(), ')');
    } else {
      console.log('[MeetingMirror] VAD loading...');
    }
  }, [vad.loading, vad.errored]);

  const start = useCallback(async (): Promise<boolean> => {
    if (!enabled) return false;
    setVadError(null);
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      await navigator.mediaDevices.getUserMedia(constraints);
    } catch {
      setVadError('Microphone access denied. Allow microphone in browser settings.');
      return false;
    }
    if (vad.errored) {
      const msg = typeof vad.errored === 'string' ? vad.errored : 'VAD failed to initialise';
      console.error('[MeetingMirror] VAD errored on start:', msg);
      setVadError(`Speech detection error: ${msg}`);
      return false;
    }
    // If still loading, wait up to 8 s then retry once loaded
    if (vad.loading) {
      console.log('[MeetingMirror] VAD still loading, waiting...');
      for (let i = 0; i < 16; i++) {
        await new Promise<void>((r) => setTimeout(r, 500));
        if (!vad.loading) break;
      }
      if (vad.loading) {
        setVadError('Speech detection took too long to load. Reload the page and try again.');
        return false;
      }
    }
    if (vad.errored) {
      const msg = typeof vad.errored === 'string' ? vad.errored : 'VAD failed after load';
      console.error('[MeetingMirror] VAD errored after wait:', msg);
      setVadError(`Speech detection error: ${msg}`);
      return false;
    }
    console.log('[MeetingMirror] VAD ready, starting with deviceId:', deviceId ?? '(default)');
    await vad.start();
    return true;
  }, [enabled, vad]);

  const stop = useCallback(() => {
    vad.pause();
  }, [vad]);

  useEffect(() => {
    if (!enabled) stop();
    return () => stop();
  }, [enabled, stop]);

  return {
    start,
    stop,
    isSupported: true,
    isLoading: vad.loading,
    isListening: vad.listening,
    isSpeaking: vad.userSpeaking,
    vadError: vad.errored
      ? `Speech detection error: ${typeof vad.errored === 'string' ? vad.errored : 'unknown'}`
      : vadError,
    lastSegmentMs,
  };
}
