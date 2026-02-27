import { useCallback, useEffect, useRef, useState } from 'react';
import { useCoachingWebSocket, type FeedbackMessage } from '../hooks/useCoachingWebSocket';
import { useSpeechTranscription } from '../hooks/useSpeechTranscription';

const MIC_DEVICE_KEY = 'meetingmirror-mic-device';
const RECOGNITION_LANG_KEY = 'meetingmirror-recognition-lang';

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
  const { feedbackMessage, status, sendTranscript, sendProcessTranscript } = useCoachingWebSocket(meetingId);

  /** All feedback from this session — newest first (prepend on new feedback) */
  const [feedbackHistory, setFeedbackHistory] = useState<{ id: string; msg: FeedbackMessage }[]>([]);

  // Full transcript: one line per finalised phrase (persists for the session)
  const [transcriptLines, setTranscriptLines] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  /** Result from the last "Process" click — shown in Live feedback box below Process button */
  const [processResult, setProcessResult] = useState<FeedbackMessage | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // ── Microphone device picker ──────────────────────────────────────────
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

  useEffect(() => { enumerateDevices(); }, [enumerateDevices]);

  const handleDeviceChange = (id: string) => {
    setSelectedDeviceId(id);
    localStorage.setItem(MIC_DEVICE_KEY, id);
  };
  const handleRecognitionLangChange = (lang: string) => {
    setRecognitionLang(lang);
    localStorage.setItem(RECOGNITION_LANG_KEY, lang);
  };
  // ─────────────────────────────────────────────────────────────────────

  // When a phrase is finalised: append as a new line, send that line to backend for Gemini
  const handleFinalTranscript = useCallback(
    (text: string) => {
      const line = text.trim();
      if (!line) return;
      setTranscriptLines((prev) => [...prev, line]);
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

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcriptLines, interim]);

  useEffect(() => {
    if (feedbackMessage?.feedback) {
      if (processing) {
        setProcessResult(feedbackMessage);
      }
      setProcessing(false);
      setFeedbackHistory((prev) => [
        { id: crypto.randomUUID(), msg: feedbackMessage },
        ...prev.slice(0, 49),
      ]);
    }
  }, [feedbackMessage, processing]);

  // Chrome requires user gesture to start mic — user must click to start
  const [listening, setListening] = useState(false);
  const handleStartListening = async () => {
    if (status === 'connected' && speechSupported) {
      const ok = await startListening();
      if (ok) await enumerateDevices();
      setListening(ok);
    }
  };
  const handleStopListening = () => {
    stopListening();
    setListening(false);
  };
  useEffect(() => {
    setListening(isListening);
  }, [isListening]);
  useEffect(() => {
    if (status !== 'connected') setListening(false);
    return () => stopListening();
  }, [status, stopListening]);

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
      {/* Header */}
      <header className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold text-teams-purple">
            MeetingMirror
          </h1>
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
            <span className={`text-xs px-2 py-1 rounded-full shrink-0 ${statusStyle}`}>
              {statusLabel}
            </span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-4 overflow-auto">
        {status === 'failed' && (
          <div className="mb-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
            <p className="font-medium">Could not connect to coaching service</p>
            <p className="mt-2 text-red-300/80 text-xs">
              Make sure the backend is running with HTTPS: <code className="bg-slate-800 px-1 rounded">cd backend && python run_dev.py</code>
            </p>
            <p className="mt-1 text-red-300/80 text-xs">
              If using mkcert, generate certs first: <code className="bg-slate-800 px-1 rounded">mkcert -key-file frontend/certs/localhost-key.pem -cert-file frontend/certs/localhost.pem localhost</code>
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
            {/* Microphone device picker */}
            <div>
              <label className="block text-xs text-slate-400 mb-1 font-medium">
                🎤 Microphone
              </label>
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
              <label className="block text-xs text-slate-400 mb-1 font-medium">
                🌐 Recognition language
              </label>
              <select
                value={recognitionLang}
                onChange={(e) => handleRecognitionLangChange(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-teams-purple"
              >
                {RECOGNITION_LANGUAGES.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-0.5">
                Mic will transcribe in this language. For coaching tips in English, speak in English.
              </p>
            </div>
            <button
              onClick={handleStartListening}
              className="w-full py-3 px-6 bg-teams-purple hover:bg-purple-600 rounded-lg font-medium text-white"
            >
              Start listening
            </button>
            <p className="text-xs text-slate-400 text-center">
              Chrome transcribes live — Gemini gives coaching tips
            </p>
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
            <div className="mt-2 text-xs text-red-300/80 space-y-1">
              <p>Allow microphone in Chrome: click the lock icon → Microphone → Allow.</p>
            </div>
          </div>
        )}

        {isInMeeting && status === 'connected' && listening && (
          <div className="mb-4 rounded-lg border border-slate-600 overflow-hidden">
            {/* Voice level bars */}
            <div className="px-3 pt-3 pb-1 bg-slate-800/70">
              <VoiceLevelBars deviceId={selectedDeviceId || undefined} active={listening} />
            </div>

            {/*
              Unified live transcript — finalised sentences flow continuously as plain text,
              with the current interim phrase appended at the end (italic + cursor).
              This mirrors how the reference app renders: one growing text stream, no jump
              between an "interim box" and a "transcript box".
            */}
            <div className="bg-slate-900/60 max-h-72 overflow-y-auto px-3 py-3">
              {transcriptLines.length === 0 && !interim ? (
                <span className="text-xs text-slate-500">👂 Waiting for speech…</span>
              ) : (
                <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {transcriptLines.join(' ')}
                  {/* Interim appended inline — stays at the tail of the stream */}
                  {interim && (
                    <>
                      {transcriptLines.length > 0 ? ' ' : ''}
                      <span className="text-emerald-300 italic">
                        {interim}
                        <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-emerald-400 animate-pulse align-middle" />
                      </span>
                    </>
                  )}
                  {/* Cursor blink when listening but no interim yet */}
                  {!interim && transcriptLines.length > 0 && (
                    <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-slate-500 animate-pulse align-middle opacity-60" />
                  )}
                </p>
              )}
              <div ref={transcriptEndRef} className="h-0" aria-hidden />
            </div>

            {/* Stop mic — transcript above is kept after stopping */}
            <div className="border-t border-slate-700 px-3 py-2 bg-slate-800/70">
              <button
                type="button"
                onClick={handleStopListening}
                className="w-full py-2 px-4 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm font-medium border border-red-500/40"
              >
                Stop mic
              </button>
            </div>
          </div>
        )}

        {/* Persisted transcript when mic is stopped — entire speech stays visible + Process */}
        {isInMeeting && status === 'connected' && !listening && transcriptLines.length > 0 && (
          <div className="mb-4 rounded-lg border border-slate-600 overflow-hidden">
            <p className="text-xs text-slate-500 px-3 pt-2 pb-1 bg-slate-800/70 border-b border-slate-700">
              Transcript (stopped)
            </p>
            <div className="max-h-64 overflow-y-auto bg-slate-900/60 px-3 py-2">
              <ul className="space-y-1 list-none">
                {transcriptLines.map((line, i) => (
                  <li key={i} className="text-sm text-slate-200 leading-relaxed">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-slate-700 px-3 py-2 bg-slate-800/70">
              <button
                type="button"
                onClick={() => {
                  setProcessResult(null);
                  setProcessing(true);
                  sendProcessTranscript(transcriptLines.join(' '));
                }}
                disabled={processing}
                className="w-full py-2 px-4 rounded-lg bg-teams-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-medium"
              >
                {processing ? 'Processing…' : 'Process'}
              </button>
            </div>

            {/* Gemini result for this transcript — shown below Process */}
            {(processing || processResult) && (
              <div className="border-t border-slate-700 px-3 py-3 bg-slate-900/80">
                <p className="text-xs text-slate-500 mb-2 font-medium">Live feedback</p>
                {processing ? (
                  <p className="text-sm text-slate-400 italic">Processing with Gemini…</p>
                ) : processResult ? (
                  <div key={processResult.feedback?.slice(0, 50)} className="transition-opacity duration-300">
                    <FeedbackCard msg={processResult} />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* All feedback — newest first; each card shows full feedback (original + suggested, fillers, etc.) */}
        {feedbackHistory.length > 0 && (
          <section className="mb-4">
            <h2 className="text-sm font-medium text-slate-400 mb-2">All feedback</h2>
            <ul className="space-y-3 list-none">
              {feedbackHistory.map(({ id, msg }) => (
                <li key={id}>
                  <FeedbackCard msg={msg} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

/** Full feedback card — shows all sections that have content (what you said, fillers, suggested sentence, pace/volume, engagement, improvement tip, other language). */
function FeedbackCard({ msg }: { msg: FeedbackMessage }) {
  const cardClass = 'rounded-xl shadow-lg p-4 transition-all duration-300 bg-slate-800/60 border border-slate-600';
  const hasFiller = !!(msg.fillers && msg.fillers.trim());
  const hasSuggested = !!(msg.improved_sentence && msg.improved_sentence.trim());
  const hasPace = !!(msg.pace && msg.pace.trim());
  const hasVolume = !!(msg.volume && msg.volume.trim());
  const hasPaceVolumeIssue = (msg.pace && msg.pace !== 'good') || msg.volume === 'low';
  const hasEngagement = !!(msg.engagement_alert && msg.engagement_alert.trim());
  const hasSuggestion = !!(msg.suggestion && msg.suggestion.trim());
  const hasTranscript = !!(msg.transcript && msg.transcript.trim());
  const hasOtherLanguage = msg.language_detected === 'non_english';

  return (
    <div className={cardClass}>
      {/* What you said (original) — always show when we have transcript */}
      {hasTranscript && (
        <div className="mb-3">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">What you said</p>
          <p className="text-sm text-slate-300 leading-relaxed">&ldquo;{msg.transcript}&rdquo;</p>
        </div>
      )}

      {/* Suggested sentence — show both original (above) and improved */}
      {hasSuggested && (
        <div className="mb-3">
          <p className="text-xs font-medium text-blue-400 uppercase tracking-wide mb-1">Suggested sentence</p>
          <p className="text-base text-blue-100 leading-relaxed font-medium">{msg.improved_sentence}</p>
        </div>
      )}

      {/* Filler words */}
      {hasFiller && (
        <div className="mb-3">
          <p className="text-xs font-medium text-amber-400 uppercase tracking-wide mb-1">Filler words detected</p>
          <p className="text-sm text-amber-200">
            {msg.fillers}
            {msg.filler_breakdown && <span className="text-amber-300/80 ml-1">({msg.filler_breakdown})</span>}
          </p>
        </div>
      )}

      {/* Pace / Volume — always show when present (Speech pace + Volume) */}
      {(hasPace || hasVolume) && (
        <div className="mb-3">
          <p className="text-xs font-medium text-red-400 uppercase tracking-wide mb-1">Speech pace &amp; volume</p>
          <p className="text-sm text-slate-200">
            {hasPace && <span>Pace: {msg.pace}. </span>}
            {hasVolume && <span>Volume: {msg.volume}.</span>}
            {hasPaceVolumeIssue && (
              <span className="text-red-200 ml-0.5">
                {msg.volume === 'low' && ' Try speaking a bit louder.'}
                {msg.pace && msg.pace !== 'good' && ' Consider adjusting your speaking pace.'}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Other language detected — suggest English for better communication */}
      {hasOtherLanguage && (
        <div className="mb-3 p-3 rounded-lg bg-amber-500/15 border border-amber-500/40">
          <p className="text-xs font-medium text-amber-400 uppercase tracking-wide mb-1">Other language detected</p>
          <p className="text-sm text-amber-200">
            {msg.non_english_message?.trim() || 'Non-English speech was detected.'} For better coaching and transcription, try speaking in English.
          </p>
        </div>
      )}

      {/* Engagement */}
      {hasEngagement && (
        <div className="mb-3">
          <p className="text-xs font-medium text-violet-400 uppercase tracking-wide mb-1">Engagement</p>
          <p className="text-sm text-violet-200">{msg.engagement_alert}</p>
        </div>
      )}

      {/* Improvement for next speech / tip */}
      {hasSuggestion && (
        <div>
          <p className="text-xs font-medium text-emerald-400 uppercase tracking-wide mb-1">Improvement for next speech</p>
          <p className="text-sm text-emerald-200">{msg.suggestion}</p>
        </div>
      )}

      {/* Fallback when nothing parsed (e.g. welcome message) */}
      {!hasTranscript && !hasSuggested && !hasFiller && !hasPace && !hasVolume && !hasEngagement && !hasSuggestion && !hasOtherLanguage && (
        <p className="text-sm text-slate-300">{msg.feedback}</p>
      )}
    </div>
  );
}

/** Real-time microphone level visualizer — 12 animated bars driven by Web Audio AnalyserNode. */
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
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

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

          // RMS amplitude in 0..1
          let sum = 0;
          for (let i = 0; i < timeDomain.length; i++) {
            const v = timeDomain[i] / 128 - 1;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / timeDomain.length);

          // Each bar gets a phase-shifted sine multiplier so they ripple independently
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
        // mic already open by VAD — visualizer is best-effort
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

  // Bar heights: center bars are taller by design (bell-curve multiplier)
  const bellCurve = Array.from({ length: BAR_COUNT }, (_, i) => {
    const x = (i / (BAR_COUNT - 1)) * 2 - 1; // -1 to 1
    return Math.exp(-x * x * 1.8);            // gaussian envelope
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
                ? `rgba(168,85,247,${0.5 + height * 0.5})`  // purple, brighter when louder
                : 'rgba(100,116,139,0.35)',                   // slate when quiet
            }}
          />
        );
      })}
    </div>
  );
}
