import * as React from 'react';
import { createContext, useState, useContext, useEffect, useRef, ReactNode } from 'react';
import { AppSettings } from '../types';
import { appRepository } from '../services/repository';

interface SettingsContextType {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    settingsRef: React.MutableRefObject<AppSettings>;
    privacyEnabled: boolean;
    setPrivacyEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    isLoaded: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [isLoaded, setIsLoaded] = useState(false);
    const [privacyEnabled, setPrivacyEnabled] = useState(true);
    const [settings, setSettings] = useState<AppSettings>({
        theme: 'dark',
        thumbnailSize: 200,
        confirmDelete: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
        maskedKeywords: [],
        maskingMode: 'blur',
        enableAI: false,
        hasCompletedOnboarding: false,
        syncBoardsToCollections: false,
        importOrphans: true,
        starredAs: 'favorite'
    });

    const settingsRef = useRef<AppSettings>(settings);
    useEffect(() => { settingsRef.current = settings; }, [settings]);

    // Initial load
    useEffect(() => {
        const loadSettings = async () => {
            const state = await appRepository.load();
            if (state.settings) {
                // Ensure API key from env takes precedence if present
                const envKey = (process.env as any).API_KEY;
                const mergedSettings = { ...state.settings };
                if (envKey) mergedSettings.googleGeminiApiKey = envKey;
                setSettings(mergedSettings);
            }
            setIsLoaded(true);
        };
        loadSettings();
    }, []);

    // Save settings when they change (with debounce logic integrated into repository or here)
    // Actually, let's keep the debounce here to match original logic
    useEffect(() => {
        if (!isLoaded) return;
        const timeout = setTimeout(async () => {
            const state = await appRepository.load();
            await appRepository.save({
                ...state,
                settings
            });
        }, 1000);
        return () => clearTimeout(timeout);
    }, [settings, isLoaded]);

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
