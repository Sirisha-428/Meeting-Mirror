import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useCoachingWebSocket,
  type CoachingInsights,
  type CoachingMessage,
  type MeetingSummaryReport,
} from '../hooks/useCoachingWebSocket';
import { useSpeechTranscription } from '../hooks/useSpeechTranscription';
import {
  sendMeetCoachToast,
  sendMeetCoachToastBatch,
  type MeetToastVariant,
} from '../utils/meetPageToastBridge';

const MIC_DEVICE_KEY = 'meetingmirror-mic-device';
const RECOGNITION_LANG_KEY = 'meetingmirror-recognition-lang';
const TOAST_DURATION_MS = 3000;

function toastVariantForMessage(line: string): MeetToastVariant {
  const l = line.toLowerCase();
  if (l.includes('filler')) return 'warning';
  if (l.includes('clearly') || l.includes('structure') || l.includes('concise')) return 'suggestion';
  return 'default';
}

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

export function LiveCoachingView({ meetingId, isInMeeting }: LiveCoachingViewProps) {
  const {
    coachingMessage,
    meetingSummary,
    setMeetingSummary,
    status,
    sendTranscript,
    sendProcessTranscript,
    requestSummary,
    resetSession,
  } = useCoachingWebSocket(meetingId);

  const clearMeetToasts = useCallback(() => {
    sendMeetCoachToast({ message: null });
  }, []);

  const [feedbackHistory, setFeedbackHistory] = useState<{ id: string; msg: CoachingMessage }[]>([]);
  const internalLinesRef = useRef<string[]>([]);
  const [transcriptLines, setTranscriptLines] = useState<string[]>([]);
  const [sessionPhraseCount, setSessionPhraseCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<CoachingMessage | null>(null);
  const processingResponsePendingRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    internalLinesRef.current = [];
    setTranscriptLines([]);
    setSessionPhraseCount(0);
    setFeedbackHistory([]);
    setProcessResult(null);
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
      internalLinesRef.current.push(line);
      setTranscriptLines((prev) => [...prev, line]);
      setSessionPhraseCount((c) => c + 1);
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
  } = useSpeechTranscription(handleFinalTranscript, status === 'connected', recognitionLang);

  const [listening, setListening] = useState(false);
  const handleStartListening = async () => {
    if (status === 'connected' && speechSupported) {
      resetSession();
      clearMeetToasts();
      internalLinesRef.current = [];
      setTranscriptLines([]);
      setSessionPhraseCount(0);
      setFeedbackHistory([]);
      setProcessResult(null);
      setMeetingSummary(null);
      const ok = await startListening();
      if (ok) await enumerateDevices();
      setListening(ok);
    }
  };

  const handleStopListening = () => {
    stopListening();
    setListening(false);
    requestSummary();
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
    if (!coachingMessage?.toastMessages?.length) return;

    sendMeetCoachToastBatch(
      coachingMessage.toastMessages.map((message) => ({
        message,
        variant: toastVariantForMessage(message),
        durationMs: TOAST_DURATION_MS,
      })),
      TOAST_DURATION_MS
    );

    if (coachingMessage.system) {
      if (processingResponsePendingRef.current) {
        processingResponsePendingRef.current = false;
        setProcessing(false);
      }
      return;
    }

    if (processingResponsePendingRef.current) {
      setProcessResult(coachingMessage);
      processingResponsePendingRef.current = false;
      setProcessing(false);
      return;
    }

    setFeedbackHistory((prev) => [
      { id: crypto.randomUUID(), msg: coachingMessage },
      ...prev.slice(0, 49),
    ]);
  }, [coachingMessage]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptLines, interim]);

  useEffect(() => {
    return () => {
      sendMeetCoachToast({ message: null });
    };
  }, []);

  useEffect(() => {
    if (!meetingSummary) return;
    const lines: string[] = [];
    lines.push('Summary report:');
    lines.push(
      `Filler words: ${meetingSummary.totalFillerWords}` +
        (meetingSummary.mostUsedFillerWords.length
          ? ` (${meetingSummary.mostUsedFillerWords.slice(0, 3).join(', ')})`
          : '')
    );
    lines.push(`Pace: ${meetingSummary.speakingPace}`);
    lines.push(`Volume: ${meetingSummary.volumeAnalysis}`);
    lines.push(`Clarity score: ${meetingSummary.clarityScore}/100`);
    if (meetingSummary.improvements.length) {
      lines.push(`Suggestion: ${meetingSummary.improvements[0]}`);
    }
    sendMeetCoachToastBatch(
      lines.map((message) => ({ message, durationMs: TOAST_DURATION_MS })),
      TOAST_DURATION_MS
    );
  }, [meetingSummary]);

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

        {isInMeeting && status === 'connected' && !listening && speechSupported && (
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

        {isInMeeting && status === 'connected' && !speechSupported && (
          <p className="mb-4 text-amber-400 text-sm">
            Microphone not supported in this browser. Use Chrome for speech capture.
          </p>
        )}

        {recognitionError && (
          <div className="mb-4 p-4 rounded-lg bg-red-500/20 border border-red-500/50 text-red-200 text-sm">
            <p className="font-medium">{recognitionError}</p>
          </div>
        )}

        {isInMeeting && status === 'connected' && listening && (
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
                <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {transcriptLines.join(' ')}
                  {interim && (
                    <>
                      {transcriptLines.length > 0 ? ' ' : ''}
                      <span className="text-emerald-300 italic">
                        {interim}
                        <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-emerald-400 animate-pulse align-middle" />
                      </span>
                    </>
                  )}
                </p>
              )}
              <div ref={transcriptEndRef} className="h-0" aria-hidden />
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

        {isInMeeting && status === 'connected' && !listening && sessionPhraseCount > 0 && (
          <div className="mb-4 rounded-lg border border-slate-600 overflow-hidden">
            <p className="text-xs text-slate-500 px-3 pt-2 pb-1 bg-slate-800/70 border-b border-slate-700">
              Session has {sessionPhraseCount} phrase{sessionPhraseCount === 1 ? '' : 's'} captured (text stays private).
            </p>
            <div className="border-t border-slate-700 px-3 py-2 bg-slate-800/70">
              <button
                type="button"
                onClick={() => {
                  setProcessResult(null);
                  processingResponsePendingRef.current = true;
                  setProcessing(true);
                  sendProcessTranscript(internalLinesRef.current.join(' '));
                }}
                disabled={processing}
                className="w-full py-2 px-4 rounded-lg bg-teams-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-medium"
              >
                {processing ? 'Processing…' : 'Run coaching on session (no transcript shown)'}
              </button>
            </div>
            {(processing || processResult) && (
              <div className="border-t border-slate-700 px-3 py-3 bg-slate-900/80">
                <p className="text-xs text-slate-500 mb-2 font-medium">Latest structured feedback</p>
                {processing ? (
                  <p className="text-sm text-slate-400 italic">Processing…</p>
                ) : processResult ? (
                  <InsightsCard insights={processResult.insights} />
                ) : null}
              </div>
            )}
          </div>
        )}

        {feedbackHistory.length > 0 && (
          <section className="mb-4">
            <h2 className="text-sm font-medium text-slate-400 mb-2">Session insights</h2>
            <ul className="space-y-3 list-none">
              {feedbackHistory.map(({ id, msg }) => (
                <li key={id}>
                  <InsightsCard insights={msg.insights} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {meetingSummary && (
        <SummaryModal summary={meetingSummary} onClose={() => setMeetingSummary(null)} />
      )}
    </div>
  );
}

function InsightsCard({ insights }: { insights: CoachingInsights }) {
  const cardClass =
    'rounded-xl shadow-lg p-4 transition-all duration-300 bg-slate-800/60 border border-slate-600';
  const fillers = insights.fillerWordsDetected?.length
    ? insights.fillerWordsDetected.join(', ')
    : null;

  return (
    <div className={cardClass}>
      {fillers && (
        <div className="mb-2">
          <p className="text-xs font-medium text-amber-400 uppercase tracking-wide mb-1">Filler words</p>
          <p className="text-sm text-amber-200">{fillers}</p>
        </div>
      )}
      <div className="mb-2 text-sm text-slate-200 space-y-1">
        <p>
          <span className="text-slate-400">Pace:</span> {insights.pace}
        </p>
        <p>
          <span className="text-slate-400">Volume:</span> {insights.volume}
        </p>
        <p>
          <span className="text-slate-400">Clarity:</span> {insights.clarity}
        </p>
      </div>
      {insights.suggestions?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-emerald-400 uppercase tracking-wide mb-1">Tips</p>
          <ul className="list-disc list-inside text-sm text-emerald-200 space-y-1">
            {insights.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SummaryModal({
  summary,
  onClose,
}: {
  summary: MeetingSummaryReport;
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

  const altEntries = Object.entries(summary.suggestedAlternatives ?? {});

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
            <p>Total detected: {summary.totalFillerWords}</p>
            {summary.mostUsedFillerWords?.length > 0 && (
              <p className="mt-1 text-slate-300">
                Most used: {summary.mostUsedFillerWords.join(', ')}
              </p>
            )}
          </section>
          <section>
            <h3 className="text-xs font-semibold text-sky-400 uppercase tracking-wide mb-2">
              2. Speaking pace
            </h3>
            <p className="capitalize">{summary.speakingPace.replace(/-/g, ' ')}</p>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-violet-400 uppercase tracking-wide mb-2">
              3. Volume &amp; clarity
            </h3>
            <p>Volume: {summary.volumeAnalysis}</p>
            <p>Clarity score: {summary.clarityScore}/100</p>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">
              4. Actionable improvements
            </h3>
            {summary.improvements?.length ? (
              <ul className="list-disc list-inside space-y-1">
                {summary.improvements.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">No major issues recorded.</p>
            )}
          </section>
          <section>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              5. Better word suggestions
            </h3>
            {altEntries.length === 0 ? (
              <p className="text-slate-500">No filler replacements suggested.</p>
            ) : (
              <ul className="space-y-2 list-none">
                {altEntries.map(([word, alts]) => (
                  <li key={word} className="text-slate-300">
                    <span className="text-amber-200 font-medium">{word}</span>
                    <span className="text-slate-500"> → </span>
                    {alts.join(', ')}
                  </li>
                ))}
              </ul>
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
