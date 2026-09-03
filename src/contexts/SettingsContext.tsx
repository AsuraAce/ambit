import * as React from 'react';
import { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import { AppSettings, AppSettingsUpdate } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { isTauriRuntime } from '../services/runtime';
import { settingsPersistenceCoordinator } from '../utils/settingsPersistenceCoordinator';
import { exit } from '@tauri-apps/plugin-process';

interface SettingsContextType {
    settings: AppSettings;
    setSettings: (settings: AppSettingsUpdate) => void;
    settingsRef: React.MutableRefObject<AppSettings>;
    privacyEnabled: boolean;
    setPrivacyEnabled: (enabled: boolean) => void;
    isLoaded: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Connect to Store
    const settings = useSettingsStore(s => s.settings);
    const isLoaded = useSettingsStore(s => s.isLoaded);
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    const setSettings = useSettingsStore(s => s.setSettings);
    const setPrivacyEnabled = useSettingsStore(s => s.setPrivacyEnabled);
    const flushSettings = useSettingsStore(s => s.flushSettings);
    const initialize = useSettingsStore(s => s.initialize);

    // Initialize Store
    useEffect(() => {
        initialize();
    }, [initialize]);

    useEffect(() => {
        if (!isTauriRuntime()) return;

        let disposed = false;
        let unlisten: (() => void) | undefined;
        let closePending = false;

        const registerCloseHandler = async () => {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            const appWindow = getCurrentWindow();
            const disposeListener = await appWindow.onCloseRequested(async (event) => {
                event.preventDefault();
                if (closePending) return;
                closePending = true;
                const closeAdmission = settingsPersistenceCoordinator.closeAdmission();

                try {
                    await closeAdmission.drain();
                } catch (error) {
                    console.error('[SettingsStore] Settings transaction drain failed before close', error);
                }

                try {
                    await flushSettings();
                } catch (error) {
                    console.error('[SettingsStore] Failed to flush settings before close', error);
                }

                try {
                    await exit(0);
                } catch (error) {
                    closePending = false;
                    closeAdmission.restore();
                    console.error('[SettingsStore] Failed to exit app process', error);
                }
            });

            if (disposed) {
                disposeListener();
            } else {
                unlisten = disposeListener;
            }
        };

        void registerCloseHandler().catch((error) => {
            console.error('[SettingsStore] Failed to register close handler', error);
        });

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [flushSettings]);

    // Maintain ref for backward compat
    const settingsRef = useRef<AppSettings>(settings);
    settingsRef.current = settings;

    // Note: Auto-save logic is now inside the Store.

    return (
        <SettingsContext.Provider value={{
            settings,
            setSettings,
            settingsRef,
            privacyEnabled,
            setPrivacyEnabled,
            isLoaded
        }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (!context) throw new Error('useSettings must be used within SettingsProvider');
    return context;
};
