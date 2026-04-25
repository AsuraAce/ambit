import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { isBrowserMockMode } from '../services/runtime';

let cachedVersion: string | null = null;
let inflightVersionRequest: Promise<string | null> | null = null;

const loadVersion = async (): Promise<string | null> => {
  if (isBrowserMockMode()) {
    return import.meta.env.VITE_APP_VERSION ?? 'browser-dev';
  }

  if (cachedVersion) {
    return cachedVersion;
  }

  if (!inflightVersionRequest) {
    inflightVersionRequest = getVersion()
      .then((version) => {
        cachedVersion = version;
        return version;
      })
      .catch((error) => {
        console.error('[AppVersion] Failed to load runtime version:', error);
        return null;
      })
      .finally(() => {
        inflightVersionRequest = null;
      });
  }

  return inflightVersionRequest;
};

export const useAppVersion = () => {
  const [version, setVersion] = useState<string | null>(cachedVersion);

  useEffect(() => {
    let isMounted = true;

    if (cachedVersion) {
      setVersion(cachedVersion);
      return () => {
        isMounted = false;
      };
    }

    void loadVersion().then((loadedVersion) => {
      if (isMounted) {
        setVersion(loadedVersion);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return version;
};
