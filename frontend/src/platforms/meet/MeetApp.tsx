import { useEffect, useState } from 'react';
import { useMeetContext } from './useMeetContext';
import { ConsentView } from '../../views/ConsentView';
import { LiveCoachingView } from '../../views/LiveCoachingView';

function getConsentKey(meetingId: string) {
  return `meetingmirror-consent-meet-${meetingId}`;
}

export function MeetApp() {
  const { isInMeeting, meetingId } = useMeetContext();
  const [hasConsent, setHasConsent] = useState(false);

  const [declined, setDeclined] = useState(false);
  useEffect(() => {
    if (!meetingId) {
      setHasConsent(false);
      setDeclined(false);
      return;
    }
    setHasConsent(sessionStorage.getItem(getConsentKey(meetingId)) === 'true');
    setDeclined(false); // Reset when meeting changes
  }, [meetingId]);

  const handleAllow = () => {
    if (meetingId) {
      sessionStorage.setItem(getConsentKey(meetingId), 'true');
      setHasConsent(true);
    }
  };

  const handleDecline = () => {
    setDeclined(true);
  };
  const handleAllowFromPaused = () => {
    handleAllow();
    setDeclined(false);
  };

  // Not in a Google Meet: prompt to join first
  if (!isInMeeting) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <h1 className="text-2xl font-bold text-teams-purple">MeetingMirror</h1>
          <p className="text-slate-400 text-sm">
            Open a Google Meet and join or start a meeting, then click the
            MeetingMirror icon to activate live coaching.
          </p>
          <div className="p-4 rounded-lg bg-slate-800/50 text-slate-300 text-xs text-left">
            <p className="font-medium text-slate-200 mb-2">Steps:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to meet.google.com</li>
              <li>Join or start a meeting</li>
              <li>Click the MeetingMirror extension icon</li>
              <li>Allow access when prompted</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  // User declined: show paused view with option to enable
  if (declined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-white p-6">
        <div className="max-w-md w-full text-center space-y-6">
          <h1 className="text-2xl font-bold text-teams-purple">MeetingMirror</h1>
          <p className="text-slate-400 text-sm">Coaching is paused for this meeting.</p>
          <button
            onClick={handleAllowFromPaused}
            className="w-full py-3 px-6 bg-teams-purple hover:bg-purple-600 rounded-lg font-medium"
          >
            Enable coaching
          </button>
        </div>
      </div>
    );
  }

  // In a meeting but no consent: show Allow prompt (per-meeting choice)
  if (!hasConsent) {
    return (
      <ConsentView
        onAllow={handleAllow}
        onDecline={handleDecline}
        isInMeeting={true}
      />
    );
  }

  // Consent given: show live coaching
  return (
    <LiveCoachingView meetingId={meetingId} isInMeeting={true} />
  );
}
