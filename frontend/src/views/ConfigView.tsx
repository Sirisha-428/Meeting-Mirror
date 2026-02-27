import { useEffect } from 'react';
import { pages } from '@microsoft/teams-js';

interface ConfigViewProps {
  isInitialized: boolean;
}

/**
 * Configuration page for the meeting side panel.
 * Called when user adds the app - sets contentUrl so Teams loads our main app.
 */
export function ConfigView({ isInitialized }: ConfigViewProps) {
  useEffect(() => {
    if (!isInitialized) return;

    const saveConfig = async () => {
      try {
        const contentUrl = `${window.location.origin}/`;
        await pages.config.setConfig({
          contentUrl,
          websiteUrl: contentUrl,
          entityId: 'meetingmirror-sidepanel',
          suggestedDisplayName: 'MeetingMirror',
        });
        await pages.config.setValidityState(true);
      } catch (err) {
        console.error('Config save failed:', err);
        await pages.config.setValidityState(false);
      }
    };

    saveConfig();
  }, [isInitialized]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-teams-dark text-white p-6">
      <div className="text-center">
        <h1 className="text-xl font-semibold mb-2">MeetingMirror</h1>
        <p className="text-gray-400">Setting up your AI coaching panel...</p>
      </div>
    </div>
  );
}
