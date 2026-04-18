import { useCallback, useEffect, useRef, useState } from 'react';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

export type AppUpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'installing' | 'error';
type ToastType = 'success' | 'error' | 'info' | 'warning';

interface UseAppUpdaterOptions {
  addToast: (message: string, type?: ToastType) => void;
  autoCheckEnabled: boolean;
  isSettingsLoaded: boolean;
  isDevBuild?: boolean;
}

interface CheckForUpdatesOptions {
  manual?: boolean;
}

export const useAppUpdater = ({
  addToast,
  autoCheckEnabled,
  isSettingsLoaded,
  isDevBuild = import.meta.env.DEV,
}: UseAppUpdaterOptions) => {
  const [status, setStatus] = useState<AppUpdaterStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const hasAttemptedStartupCheck = useRef(false);
  const canCheckForUpdates = !isDevBuild;

  const checkForUpdates = useCallback(
    async ({ manual = false }: CheckForUpdatesOptions = {}) => {
      if (!canCheckForUpdates) {
        if (manual) {
          addToast('Auto-update checks are disabled in development builds.', 'info');
        }

        return null;
      }

      setStatus('checking');
      setErrorMessage(null);

      try {
        const pendingUpdate = await check();

        if (!pendingUpdate) {
          setUpdate(null);
          setIsDialogOpen(false);
          setStatus('idle');

          if (manual) {
            addToast('Ambit is already up to date.', 'success');
          }

          return null;
        }

        setUpdate(pendingUpdate);
        setIsDialogOpen(true);
        setStatus('available');
        return pendingUpdate;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected updater error';
        setUpdate(null);
        setStatus('error');
        setErrorMessage(message);

        if (manual) {
          addToast(`Failed to check for updates: ${message}`, 'error');
        } else {
          console.error('[Updater] Startup check failed:', error);
        }

        return null;
      }
    },
    [addToast, canCheckForUpdates]
  );

  const installUpdate = useCallback(async () => {
    if (!update) {
      return;
    }

    setErrorMessage(null);
    setStatus('downloading');

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Finished') {
          setStatus('installing');
          return;
        }

        setStatus('downloading');
      });

      setStatus('installing');
      setIsDialogOpen(false);
      setUpdate(null);
      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected updater error';
      setStatus('error');
      setErrorMessage(message);
      addToast(`Failed to install update: ${message}`, 'error');
    }
  }, [addToast, update]);

  const openUpdateDialog = useCallback(() => {
    if (update) {
      setIsDialogOpen(true);
    }
  }, [update]);

  const dismissUpdateDialog = useCallback(() => {
    if (status === 'downloading' || status === 'installing') {
      return;
    }

    setIsDialogOpen(false);
  }, [status]);

  useEffect(() => {
    if (!isSettingsLoaded || !autoCheckEnabled || hasAttemptedStartupCheck.current) {
      return;
    }

    hasAttemptedStartupCheck.current = true;
    void checkForUpdates();
  }, [autoCheckEnabled, checkForUpdates, isSettingsLoaded]);

  return {
    canCheckForUpdates,
    checkForUpdates,
    dismissUpdateDialog,
    errorMessage,
    installUpdate,
    isDialogOpen,
    openUpdateDialog,
    status,
    update,
  };
};
