import * as React from 'react';
import { createContext, useContext, useEffect, useRef, ReactNode } from 'react';
import { AppSettings, AppSettingsUpdate } from '../types';
import { useSettingsStore } from '../stores/settingsStore';

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
    const initialize = useSettingsStore(s => s.initialize);

    // Initialize Store
    useEffect(() => {
        initialize();
    }, [initialize]);

    // Maintain ref for backward compat
    const settingsRef = useRef<AppSettings>(settings);
    useEffect(() => { settingsRef.current = settings; }, [settings]);

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
