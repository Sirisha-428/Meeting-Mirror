interface ConsentViewProps {
  onAllow: () => void;
  onDecline?: () => void;
  isInMeeting: boolean;
}

export function ConsentView({ onAllow, onDecline, isInMeeting }: ConsentViewProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-teams-purple">
            MeetingMirror
          </h1>
          <p className="text-slate-300 text-sm">
            Enable coaching for this meeting?
          </p>
        </div>

        <p className="text-slate-400 text-sm leading-relaxed">
          MeetingMirror will listen to your speech and provide real-time tips.
          Your data stays confidential — only you see the feedback.
        </p>

        <div className="space-y-3">
          <button
            onClick={onAllow}
            className="w-full py-3 px-6 bg-teams-purple hover:bg-purple-600 
              rounded-lg font-medium transition-colors focus:outline-none 
              focus:ring-2 focus:ring-teams-purple focus:ring-offset-2 
              focus:ring-offset-slate-900"
          >
            Allow
          </button>
          {onDecline && (
            <button
              onClick={onDecline}
              className="w-full py-2 px-4 text-slate-400 hover:text-slate-300 text-sm"
            >
              Not now
            </button>
          )}
          {isInMeeting && (
            <p className="text-emerald-400/80 text-xs">
              Click Allow to start listening — or Not now to skip for this meeting
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
