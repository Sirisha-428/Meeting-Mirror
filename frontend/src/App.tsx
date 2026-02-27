import { lazy, Suspense } from 'react';
import { detectPlatform } from './utils/platform';

// Lazy load to avoid loading Teams SDK when in Google Meet
const MeetApp = lazy(() => import('./platforms/meet/MeetApp').then((m) => ({ default: m.MeetApp })));
const TeamsApp = lazy(() => import('./platforms/teams/TeamsApp').then((m) => ({ default: m.TeamsApp })));

function App() {
  const platform = detectPlatform();

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
          <div className="animate-pulse">Loading...</div>
        </div>
      }
    >
      {platform === 'meet' ? <MeetApp /> : <TeamsApp />}
    </Suspense>
  );
}

export default App;
