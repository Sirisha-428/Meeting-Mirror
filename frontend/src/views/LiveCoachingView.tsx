import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useCoachingWebSocket,
} from '../hooks/useCoachingWebSocket';
import { useSpeechTranscription } from '../hooks/useSpeechTranscription';
import {
  sendMeetCoachToast,
  type MeetToastVariant,
} from '../utils/meetPageToastBridge';

const MIC_DEVICE_KEY = 'meetingmirror-mic-device';
const RECOGNITION_LANG_KEY = 'meetingmirror-recognition-lang';
const TOAST_DURATION_MS = 3200;
const FEEDBACK_COOLDOWN_MS = 9000;
const LOW_VOICE_THRESHOLD = 0.018;
const LOW_VOICE_STREAK_MS = 3500;
const LONG_PAUSE_MS = 2600;
const HIGH_FILLERS_PER_MIN = 3.2;
const LOW_FILLERS_PER_MIN = 0.8;
const FAST_WPM = 160;
const SLOW_WPM = 90;

const FILLER_PHRASES = [
  'you know',
  'i mean',
  'let me think',
  'kind of',
  'sort of',
  'you see',
];
const FILLER_WORD_SET = new Set([
  'um',
  'uh',
  'ah',
  'er',
  'hmm',
  'like',
  'actually',
  'basically',
  'literally',
  'so',
  'well',
  'right',
  'okay',
]);
const FILLER_REGEX_PATTERNS = [
  /\b(?:u+h+|u+m+|h+m+|a+h+|e+r+)\b/gi,
  /\b([a-z])\1{2,}\b/gi,
] as const;

type LiveSummaryReport = {
  duration: string;
  wpm: number;
  filler_count: number;
  top_fillers: string[];
  feedback: string[];
};

type TranscriptLine = {
  id: string;
  text: string;
  fillers: string[];
};

type LiveToast = {
  id: string;
  message: string;
  variant: MeetToastVariant;
};

const RECOGNITION_LANGUAGES: { value: string; label: string }[] = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'es-419', label: 'Spanish (Latin America)' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'bn-IN', label: 'Bengali' },
  { value: 'ta-IN', label: 'Tamil' },
  { value: 'te-IN', label: 'Telugu' },
  { value: 'mr-IN', label: 'Marathi' },
];

interface LiveCoachingViewProps {
  meetingId: string | null;
  isInMeeting: boolean;
}

function nowMs() {
  return Date.now();
}

function splitWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) ?? []).filter(Boolean);
}

function detectFillers(text: string): string[] {
  const normalized = text.toLowerCase();
  const words = splitWords(normalized);
  const found: string[] = [];

  for (const p of FILLER_PHRASES) {
    const regex = new RegExp(`\\b${p.replace(' ', '\\s+')}\\b`, 'g');
    const matches = normalized.match(regex);
    if (matches) {
      for (let i = 0; i < matches.length; i += 1) found.push(p);
    }
  }
  for (const w of words) {
    if (FILLER_WORD_SET.has(w)) found.push(w);
  }
  for (const pattern of FILLER_REGEX_PATTERNS) {
    const matches = normalized.match(pattern);
    if (matches) found.push(...matches.map((m) => m.toLowerCase()));
  }
  return found;
}

function highlightLineParts(text: string) {
  const parts: { text: string; filler: boolean }[] = [];
  const regex = /\b(?:you\s+know|i\s+mean|let\s+me\s+think|kind\s+of|sort\s+of|you\s+see|um+|uh+|ah+|er+|hmm+|like|actually|basically|literally|so|well|right|okay|([a-z])\1{2,})\b/gi;
  let last = 0;
  let match = regex.exec(text);
  while (match) {
    if (match.index > last) {
      parts.push({ text: text.slice(last, match.index), filler: false });
    }
    parts.push({ text: match[0], filler: true });
    last = regex.lastIndex;
    match = regex.exec(text);
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), filler: false });
  }
  return parts.length ? parts : [{ text, filler: false }];
}

export function LiveCoachingView({ meetingId, isInMeeting }: LiveCoachingViewProps) {
  const { status, sendTranscript } = useCoachingWebSocket(meetingId);

  const clearMeetToasts = useCallback(() => {
    sendMeetCoachToast({ message: null });
  }, []);

  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [sessionPhraseCount, setSessionPhraseCount] = useState(0);
  const [summary, setSummary] = useState<LiveSummaryReport | null>(null);
  const [liveToasts, setLiveToasts] = useState<LiveToast[]>([]);
  const [audioRms, setAudioRms] = useState(0);
  const [silenceMs, setSilenceMs] = useState(0);
  const [speechMs, setSpeechMs] = useState(0);
  const [totalWords, setTotalWords] = useState(0);
  const [fillerTotal, setFillerTotal] = useState(0);
  const [fillerCounts, setFillerCounts] = useState<Record<string, number>>({});
  const [sessionStartAt, setSessionStartAt] = useState<number | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const feedbackCooldownRef = useRef<Record<string, number>>({});
  const lowVoiceStreakRef = useRef(0);
  const analyserCleanupRef = useRef<(() => void) | null>(null);
  const speechMsRef = useRef(0);
  const silenceMsRef = useRef(0);
  const fillerTotalRef = useRef(0);
  const totalWordsRef = useRef(0);

  useEffect(() => {
    setTranscriptLines([]);
    setSessionPhraseCount(0);
    setSummary(null);
    setLiveToasts([]);
    setAudioRms(0);
    setSilenceMs(0);
    setSpeechMs(0);
    setTotalWords(0);
    setFillerTotal(0);
    setFillerCounts({});
    setSessionStartAt(null);
    feedbackCooldownRef.current = {};
    lowVoiceStreakRef.current = 0;
    speechMsRef.current = 0;
    silenceMsRef.current = 0;
    fillerTotalRef.current = 0;
    totalWordsRef.current = 0;
  }, [meetingId]);

  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(
    () => localStorage.getItem(MIC_DEVICE_KEY) ?? ''
  );
  const [recognitionLang, setRecognitionLang] = useState<string>(
    () => localStorage.getItem(RECOGNITION_LANG_KEY) ?? 'en-US'
  );

  const enumerateDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const mics = all.filter((d) => d.kind === 'audioinput');
    setMicDevices(mics);
    if (!localStorage.getItem(MIC_DEVICE_KEY) && mics.length > 0) {
      setSelectedDeviceId(mics[0].deviceId);
    }
  }, []);

  useEffect(() => {
    enumerateDevices();
  }, [enumerateDevices]);

  const handleDeviceChange = (id: string) => {
    setSelectedDeviceId(id);
    localStorage.setItem(MIC_DEVICE_KEY, id);
  };
  const handleRecognitionLangChange = (lang: string) => {
    setRecognitionLang(lang);
    localStorage.setItem(RECOGNITION_LANG_KEY, lang);
  };

  const handleFinalTranscript = useCallback(
    (text: string) => {
      const line = text.trim();
      if (!line) return;
      const fillers = detectFillers(line);
      setTranscriptLines((prev) => [...prev, { id: crypto.randomUUID(), text: line, fillers }]);
      setSessionPhraseCount((c) => c + 1);
      const wordsInLine = splitWords(line).length;
      setTotalWords((prev) => {
        const next = prev + wordsInLine;
        totalWordsRef.current = next;
        return next;
      });
      if (fillers.length > 0) {
        setFillerTotal((prev) => {
          const next = prev + fillers.length;
          fillerTotalRef.current = next;
          return next;
        });
        setFillerCounts((prev) => {
          const next = { ...prev };
          for (const filler of fillers) {
            next[filler] = (next[filler] ?? 0) + 1;
          }
          return next;
        });
      }
      sendTranscript(line);
    },
    [sendTranscript]
  );

  const {
    start: startListening,
    stop: stopListening,
    isSupported: speechSupported,
    isListening,
    interim,
    error: recognitionError,
  } = useSpeechTranscription(handleFinalTranscript, isInMeeting, recognitionLang);

  const [listening, setListening] = useState(false);
  const addToast = useCallback((message: string, variant: MeetToastVariant = 'default') => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const toast: LiveToast = { id: crypto.randomUUID(), message: trimmed, variant };
    setLiveToasts((prev) => [toast, ...prev].slice(0, 4));
    setTimeout(() => {
      setLiveToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, TOAST_DURATION_MS);
    sendMeetCoachToast({ message: trimmed, variant, durationMs: TOAST_DURATION_MS });
  }, []);

  const triggerFeedback = useCallback((key: string, message: string, variant: MeetToastVariant = 'warning') => {
    const now = nowMs();
    const last = feedbackCooldownRef.current[key] ?? 0;
    if (now - last < FEEDBACK_COOLDOWN_MS) return;
    feedbackCooldownRef.current[key] = now;
    addToast(message, variant);
  }, [addToast]);

  const handleStartListening = async () => {
    if (!speechSupported) return;
    clearMeetToasts();
    setTranscriptLines([]);
    setSessionPhraseCount(0);
    setSummary(null);
    setLiveToasts([]);
    setAudioRms(0);
    setSilenceMs(0);
    setSpeechMs(0);
    setTotalWords(0);
    setFillerTotal(0);
    setFillerCounts({});
    feedbackCooldownRef.current = {};
    lowVoiceStreakRef.current = 0;
    speechMsRef.current = 0;
    silenceMsRef.current = 0;
    fillerTotalRef.current = 0;
    totalWordsRef.current = 0;
    setSessionStartAt(nowMs());
    const ok = await startListening();
    if (ok) await enumerateDevices();
    setListening(ok);
  };

  const handleStopListening = () => {
    stopListening();
    setListening(false);
    const end = nowMs();
    const durationMs = sessionStartAt ? Math.max(1000, end - sessionStartAt) : 1000;
    const minutes = durationMs / 60000;
    const wpm = Math.round(totalWordsRef.current / minutes);
    const topFillers = Object.entries(fillerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
    const feedback: string[] = [];
    if (wpm > FAST_WPM) feedback.push('You spoke quickly overall. Slow down slightly.');
    else if (wpm < SLOW_WPM) feedback.push('Your pace was a bit slow. Keep a steadier tempo.');
    else feedback.push('Moderate speaking pace');
    if (fillerTotalRef.current > 0) feedback.push('Reduce filler usage');
    else feedback.push('Great clarity! Very low filler usage.');
    if (audioRms < LOW_VOICE_THRESHOLD) feedback.push('Try speaking louder for better presence.');
    if (silenceMsRef.current > LONG_PAUSE_MS) feedback.push('Avoid long pauses where possible.');
    setSummary({
      duration: `${Math.max(1, Math.round(durationMs / 60000))} min`,
      wpm: Number.isFinite(wpm) ? wpm : 0,
      filler_count: fillerTotalRef.current,
      top_fillers: topFillers,
      feedback,
    });
  };

  useEffect(() => {
    setListening(isListening);
  }, [isListening]);

  useEffect(() => {
    if (status !== 'connected') {
      setListening(false);
      clearMeetToasts();
    }
    return () => stopListening();
  }, [status, stopListening, clearMeetToasts]);

  useEffect(() => {
    if (!listening) return;
    if (!sessionStartAt) return;
    const tick = setInterval(() => {
      const elapsedMinutes = Math.max(1 / 60, (nowMs() - sessionStartAt) / 60000);
      const wpm = totalWordsRef.current / elapsedMinutes;
      const fpm = fillerTotalRef.current / elapsedMinutes;

      if (fpm > HIGH_FILLERS_PER_MIN) {
        triggerFeedback('high-fillers', 'Too many filler words. Try pausing instead.', 'warning');
      } else if (totalWordsRef.current > 45 && fpm < LOW_FILLERS_PER_MIN) {
        triggerFeedback('low-fillers', 'Great clarity! Keep it up.', 'suggestion');
      }
      if (wpm > FAST_WPM) {
        triggerFeedback('fast', "You're speaking too fast. Slow down.", 'warning');
      } else if (totalWordsRef.current > 20 && wpm < SLOW_WPM) {
        triggerFeedback('slow', 'Try to maintain a steady pace.', 'warning');
      }
      if (silenceMsRef.current > LONG_PAUSE_MS) {
        triggerFeedback('long-pause', 'Try to avoid long pauses.', 'warning');
      }
      if (lowVoiceStreakRef.current > LOW_VOICE_STREAK_MS) {
        triggerFeedback('low-voice', 'Your voice is too low. Speak louder.', 'warning');
      }
    }, 1500);
    return () => clearInterval(tick);
  }, [listening, sessionStartAt, triggerFeedback]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptLines, interim]);

  useEffect(() => {
    return () => {
      sendMeetCoachToast({ message: null });
    };
  }, []);

  useEffect(() => {
    if (!listening) {
      analyserCleanupRef.current?.();
      analyserCleanupRef.current = null;
      return;
    }
    let disposed = false;
    let intervalId: number | undefined;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: selectedDeviceId ? { deviceId: { ideal: selectedDeviceId } } : true,
        });
        if (disposed) return;
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let last = nowMs();
        intervalId = window.setInterval(() => {
          const t = nowMs();
          const delta = t - last;
          last = t;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) {
            const v = data[i] / 128 - 1;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          setAudioRms(rms);
          if (rms < LOW_VOICE_THRESHOLD) {
            lowVoiceStreakRef.current += delta;
            silenceMsRef.current += delta;
            setSilenceMs(silenceMsRef.current);
          } else {
            lowVoiceStreakRef.current = 0;
            silenceMsRef.current = 0;
            setSilenceMs(0);
            speechMsRef.current += delta;
            setSpeechMs(speechMsRef.current);
          }
        }, 220);
      } catch {
        // Non-blocking: transcript can still run without RMS metrics.
      }
    })();

    const cleanup = () => {
      disposed = true;
      if (intervalId) window.clearInterval(intervalId);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
    };
    analyserCleanupRef.current = cleanup;
    return cleanup;
  }, [listening, selectedDeviceId]);

  const statusLabel =
    status === 'connected' ? 'Live' : status === 'failed' ? 'Connection failed' : 'Connecting...';
  const statusStyle =
    status === 'connected'
      ? 'bg-emerald-500/20 text-emerald-400'
      : status === 'failed'
        ? 'bg-red-500/20 text-red-400'
        : 'bg-amber-500/20 text-amber-400';

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-teams-purple">MeetingMirror</h1>
          <div className="flex items-center gap-2">
            {listening && interim && (
              <span className="flex items-center gap-1 text-xs text-emerald-400 animate-pulse font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                Speaking
              </span>
            )}
            {listening && !interim && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <span className="w-2 h-2 rounded-full bg-slate-500 inline-block" />
                Listening
              </span>
            )}
            <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${statusStyle}`}>{statusLabel}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-auto">
        {status === 'failed' && (
          <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
            <p className="font-medium">Could not connect to coaching service</p>
            <p className="mt-2 text-red-300/80 text-xs">
              Make sure the backend is running with HTTPS:{' '}
              <code className="bg-slate-800 px-1 rounded">cd backend && python run_dev.py</code>
            </p>
          </div>
        )}
        {!isInMeeting && (
          <div className="mb-4 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm">
            Join a meeting to receive live coaching feedback.
          </div>
        )}

        {isInMeeting && !listening && speechSupported && (
          <div className="mb-4 p-4 rounded-lg bg-teams-purple/20 border border-teams-purple/50 space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium">🎤 Microphone</label>
              {micDevices.length > 0 ? (
                <select
                  value={selectedDeviceId}
                  onChange={(e) => handleDeviceChange(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-teams-purple"
                >
                  {micDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone (${d.deviceId.slice(0, 8)}…)`}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-xs text-slate-500 italic">
                  Device labels appear after granting microphone permission.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium">🌐 Recognition language</label>
              <select
                value={recognitionLang}
                onChange={(e) => handleRecognitionLangChange(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-teams-purple"
              >
                {RECOGNITION_LANGUAGES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-0.5">
                Speech is analysed in the background. Only short coaching tips appear on Meet — never your words.
              </p>
            </div>
            <button
              onClick={handleStartListening}
              className="w-full py-3 px-6 bg-teams-purple hover:bg-purple-600 rounded-lg font-medium text-white"
            >
              Start listening
            </button>
          </div>
        )}

        {isInMeeting && !speechSupported && (
          <p className="mb-4 text-amber-400 text-sm">
            Microphone not supported in this browser. Use Chrome for speech capture.
          </p>
        )}

        {recognitionError && (
          <div className="mb-4 p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-200 text-sm">
            <p className="font-medium">{recognitionError}</p>
          </div>
        )}

        {isInMeeting && listening && (
          <div className="mb-4 rounded-lg border border-slate-600 overflow-hidden">
            <p className="text-xs text-slate-400 px-3 pt-2 pb-1 bg-slate-800/70 border-b border-slate-700/80">
              Coaching tips appear on Meet (top-right) and in this panel. Live transcript is shown below.
            </p>
            <div className="px-3 pt-3 pb-1 bg-slate-800/70">
              <VoiceLevelBars deviceId={selectedDeviceId || undefined} active={listening} />
            </div>
            <div className="bg-slate-900/60 max-h-72 overflow-y-auto px-3 py-3">
              {transcriptLines.length === 0 && !interim ? (
                <p className="text-sm text-slate-500">Listening — keep speaking naturally.</p>
              ) : (
                <div className="space-y-2 text-sm leading-relaxed">
                  {transcriptLines.map((line) => (
                    <p key={line.id} className="text-slate-200 whitespace-pre-wrap">
                      {highlightLineParts(line.text).map((part, index) => (
                        <span key={`${line.id}-${index}`} className={part.filler ? 'text-red-300 font-medium' : ''}>
                          {part.text}
                        </span>
                      ))}
                    </p>
                  ))}
                  {interim && (
                    <p className="text-emerald-300 italic whitespace-pre-wrap">
                      {interim}
                      <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-emerald-400 animate-pulse align-middle" />
                    </p>
                  )}
                </div>
              )}
              <div ref={transcriptEndRef} className="h-0" aria-hidden />
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-slate-700 bg-slate-900/50 px-3 py-2 text-xs text-slate-300">
              <div>WPM: {sessionStartAt ? Math.round(totalWords / Math.max((nowMs() - sessionStartAt) / 60000, 1 / 60)) : 0}</div>
              <div>Fillers/min: {sessionStartAt ? (fillerTotal / Math.max((nowMs() - sessionStartAt) / 60000, 1 / 60)).toFixed(1) : '0.0'}</div>
              <div>Total fillers: {fillerTotal}</div>
              <div>Voice RMS: {audioRms.toFixed(3)}</div>
              <div>Current pause: {(silenceMs / 1000).toFixed(1)}s</div>
              <div>Speech duration: {(speechMs / 1000).toFixed(1)}s</div>
            </div>
            <div className="border-t border-slate-700 px-3 py-2 bg-slate-800/70">
              <button
                type="button"
                onClick={handleStopListening}
                className="w-full py-2 px-4 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm font-medium border border-red-500/40"
              >
                Stop mic &amp; show summary
              </button>
            </div>
          </div>
        )}

        {isInMeeting && !listening && sessionPhraseCount > 0 && (
          <div className="mb-4 rounded-lg border border-slate-600 overflow-hidden p-3 bg-slate-800/60 text-sm text-slate-300">
            Session has {sessionPhraseCount} phrase{sessionPhraseCount === 1 ? '' : 's'} captured.
          </div>
        )}
      </main>

      {liveToasts.length > 0 && (
        <div className="fixed right-4 top-16 z-40 space-y-2 max-w-sm">
          {liveToasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-lg border px-3 py-2 text-sm shadow-lg ${
                toast.variant === 'warning'
                  ? 'bg-amber-500/15 border-amber-400/40 text-amber-100'
                  : toast.variant === 'suggestion'
                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-100'
                    : 'bg-slate-800/90 border-slate-600 text-slate-100'
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}

      {summary && <SummaryModal summary={summary} onClose={() => setSummary(null)} />}
    </div>
  );
}

function SummaryModal({
  summary,
  onClose,
}: {
  summary: LiveSummaryReport;
  onClose: () => void;
}) {
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meetingmirror-summary.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="summary-title"
    >
      <div className="bg-slate-900 border border-slate-600 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-slate-900/95 border-b border-slate-700 px-4 py-3 flex items-center justify-between gap-2">
          <h2 id="summary-title" className="text-lg font-semibold text-white">
            Meeting summary
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={downloadJson}
              className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200"
            >
              Download JSON
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-lg bg-teams-purple hover:bg-purple-600 text-white"
            >
              Close
            </button>
          </div>
        </div>
        <div className="p-4 space-y-5 text-sm text-slate-200">
          <section>
            <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wide mb-2">
              1. Filler words
            </h3>
            <p>Total detected: {summary.filler_count}</p>
            {summary.top_fillers?.length > 0 && (
              <p className="mt-1 text-slate-300">
                Most used: {summary.top_fillers.join(', ')}
              </p>
            )}
          </section>
          <section>
            <h3 className="text-xs font-semibold text-sky-400 uppercase tracking-wide mb-2">
              2. Speaking pace
            </h3>
            <p>{summary.wpm} words/minute</p>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-wide mb-2">
              3. Session duration
            </h3>
            <p>{summary.duration}</p>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">
              4. Actionable feedback
            </h3>
            {summary.feedback?.length ? (
              <ul className="list-disc list-inside space-y-1">
                {summary.feedback.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">No major issues recorded.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function VoiceLevelBars({ deviceId, active }: { deviceId?: string; active: boolean }) {
  const BAR_COUNT = 12;
  const [levels, setLevels] = useState<number[]>(Array(BAR_COUNT).fill(0));
  const cleanupRef = useRef<() => void>();

  useEffect(() => {
    if (!active) {
      cleanupRef.current?.();
      setLevels(Array(BAR_COUNT).fill(0));
      return;
    }

    let cancelled = false;
    let rafId: number;
    let audioCtx: AudioContext;
    let stream: MediaStream;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { ideal: deviceId } } : true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);

        const timeDomain = new Uint8Array(analyser.fftSize);

        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(timeDomain);
          let sum = 0;
          for (let i = 0; i < timeDomain.length; i++) {
            const v = timeDomain[i] / 128 - 1;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / timeDomain.length);
          const now = Date.now();
          const newLevels = Array.from({ length: BAR_COUNT }, (_, i) => {
            const phase = Math.sin(now / 180 + i * 0.55) * 0.4 + 0.6;
            return Math.min(1, rms * 9 * phase);
          });
          setLevels(newLevels);
          rafId = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // visualizer is best-effort
      }
    })();

    cleanupRef.current = () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close();
    };
    return () => cleanupRef.current?.();
  }, [active, deviceId]);

  const bellCurve = Array.from({ length: BAR_COUNT }, (_, i) => {
    const x = (i / (BAR_COUNT - 1)) * 2 - 1;
    return Math.exp(-x * x * 1.8);
  });

  return (
    <div className="flex items-end justify-center gap-[3px] h-8 px-1">
      {levels.map((level, i) => {
        const height = Math.max(0.08, level * bellCurve[i]);
        const speaking = level > 0.04;
        return (
          <div
            key={i}
            className="rounded-full transition-all duration-75"
            style={{
              width: '5px',
              height: `${height * 100}%`,
              backgroundColor: speaking
                ? `rgba(168,85,247,${0.5 + height * 0.5})`
                : 'rgba(100,116,139,0.35)',
            }}
          />
        );
      })}
    </div>
  );
}
