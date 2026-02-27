import { useEffect, useState } from 'react';
import { app } from '@microsoft/teams-js';
import { useMeetingContext } from '../../hooks/useMeetingContext';
import { ConsentView } from '../../views/ConsentView';
import { LiveCoachingView } from '../../views/LiveCoachingView';
import { ConfigView } from '../../views/ConfigView';

export function TeamsApp() {
  const [isInitialized, setIsInitialized] = useState(false);
  const { isInMeeting, meetingId } = useMeetingContext();
  const [hasConsent, setHasConsent] = useState(() => {
    return localStorage.getItem('meetingmirror-consent') === 'true';
  });

  const isConfigPage =
    window.location.pathname === '/config' ||
    window.location.pathname.endsWith('/config');

  useEffect(() => {
    const initTeams = async () => {
      try {
        await app.initialize();
        await app.notifySuccess();
        setIsInitialized(true);
      } catch (err) {
        console.error('Teams initialization failed:', err);
        setIsInitialized(true); // Allow app to render for local dev
      }
    };

    initTeams();
  }, []);

  const handleConsent = () => {
    localStorage.setItem('meetingmirror-consent', 'true');
    setHasConsent(true);
  };

  if (isConfigPage) {
    return <ConfigView isInitialized={isInitialized} />;
  }

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-teams-dark text-white">
        <div className="animate-pulse">Initializing MeetingMirror...</div>
      </div>
    );
  }

  if (!hasConsent) {
    return (
      <ConsentView onAllow={handleConsent} isInMeeting={isInMeeting} />
    );
  }

  return (
    <LiveCoachingView meetingId={meetingId} isInMeeting={isInMeeting} />
  );
}
