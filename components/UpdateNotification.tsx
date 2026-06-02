'use client';

import { novumFetch } from '@/lib/api';

import { useState, useEffect } from 'react';

interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  updateInstructions: {
    method: 'github-sync' | 'git-pull' | 'manual';
    steps: string[];
    autoSyncUrl?: string;
  };
}

export default function UpdateNotification() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    checkForUpdates();
    
    // Keep the update hint fresh during long admin sessions.
    const interval = setInterval(checkForUpdates, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const checkForUpdates = async () => {
    try {
      const response = await novumFetch('/ycode/api/updates/check');
      if (response.ok) {
        const data = await response.json();
        setUpdateInfo(data);
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('ycode-update-dismissed', Date.now().toString());
  };

  if (loading || !updateInfo?.available || dismissed) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-[#111] text-white shadow-lg">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg
              className="w-6 h-6 animate-pulse" fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <p className="font-semibold">
                Update für Studio verfügbar
              </p>
              <p className="text-sm text-blue-100">
                Version {updateInfo.latestVersion} ist verfügbar. Installiert ist {updateInfo.currentVersion}.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {updateInfo.updateInstructions.autoSyncUrl ? (
              <a
                href={updateInfo.updateInstructions.autoSyncUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white text-blue-600 hover:bg-blue-50 font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
              >
                <svg
                  className="w-5 h-5" fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 9.293a1 1 0 00-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 10.586V7z"
                    clipRule="evenodd"
                  />
                </svg>
                Upgrade-Check öffnen
              </a>
            ) : null}
            
            <button
              onClick={() => setShowInstructions(!showInstructions)}
              className="text-white hover:text-blue-100 font-medium px-4 py-2 transition-colors whitespace-nowrap"
            >
              {showInstructions ? 'Ausblenden' : 'Aktualisierung'}
            </button>

            <button
              onClick={handleDismiss}
              className="text-white hover:text-blue-100 p-2 transition-colors"
              aria-label="Hinweis schließen"
            >
              <svg
                className="w-5 h-5" fill="none"
                stroke="currentColor" viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeWidth={2} d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {showInstructions && (
          <div className="mt-4 pt-4 border-t border-blue-400">
            <h3 className="font-semibold mb-2">Aktualisierungsschritte</h3>
            <ol className="space-y-2 text-sm text-blue-50">
              {updateInfo.updateInstructions.steps.map((step, index) => (
                <li key={index} className="flex gap-2">
                  <span className="font-semibold">{index + 1}.</span>
                  <span dangerouslySetInnerHTML={{ __html: step }} />
                </li>
              ))}
            </ol>
            
            {updateInfo.releaseUrl && (
              <div className="mt-3">
                <a
                  href={updateInfo.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-blue-100 hover:text-white underline"
                >
                  Release Notes öffnen
                  <svg
                    className="w-4 h-4" fill="none"
                    stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round" strokeLinejoin="round"
                      strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
