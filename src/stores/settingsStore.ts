import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { AppSettings } from '../types';
import { appRepository } from '../services/repository';

interface SettingsState {
    settings: AppSettings;
    privacyEnabled: boolean;
    isLoaded: boolean;

    // Actions
    setSettings: (settings: Partial<AppSettings> | ((prev: AppSettings) => Partial<AppSettings>)) => void;
    setPrivacyEnabled: (enabled: boolean) => void;
    initialize: () => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
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
    starredAs: 'favorite',
    resourceViewModes: {},
    hideImportModal: false
};

// Debounce timer for auto-save
let saveTimeout: NodeJS.Timeout | null = null;

export const useSettingsStore = create<SettingsState>()(
    devtools(
        (set, get) => ({
            settings: DEFAULT_SETTINGS,
            privacyEnabled: true,
            isLoaded: false,

            setSettings: (update) => {
                set((state) => {
                    const newSettings = typeof update === 'function'
                        ? { ...state.settings, ...update(state.settings) }
                        : { ...state.settings, ...update };

                    // Trigger auto-save
                    if (saveTimeout) clearTimeout(saveTimeout);
                    saveTimeout = setTimeout(async () => {
                        const currentSettings = get().settings;
                        try {
                            const appState = await appRepository.load();
                            await appRepository.save({
                                ...appState,
                                settings: currentSettings
                            });
                        } catch (e) {
                            console.error('[SettingsStore] Failed to auto-save settings', e);
                        }
                    }, 1000);

                    return { settings: newSettings };
                });
            },

            setPrivacyEnabled: (enabled) => set({ privacyEnabled: enabled }),

            initialize: async () => {
                if (get().isLoaded) return;
                try {
                    const state = await appRepository.load();
                    if (state.settings) {
                        // Ensure API key from env takes precedence if present
                        // Note: process.env access might need specific Vite handling or standard node check
                        // Assuming process is available or handled by build
                        const envKey = (process.env as any).API_KEY;
                        const mergedSettings = { ...state.settings };
                        if (envKey) mergedSettings.googleGeminiApiKey = envKey;

                        set({ settings: mergedSettings, isLoaded: true });
                    } else {
                        set({ isLoaded: true });
                    }
                } catch (e) {
                    console.error('[SettingsStore] Failed to load settings', e);
                    set({ isLoaded: true }); // Mark loaded even if failed so app doesn't hang
                }
            }
        }),
        { name: 'SettingsStore' }
    )
);
