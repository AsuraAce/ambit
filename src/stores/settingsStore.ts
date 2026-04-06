import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { AppSettings } from '../types';
import { appRepository } from '../services/repository';

interface SettingsState {
    settings: AppSettings;
    privacyEnabled: boolean;
    isLoaded: boolean;
    devModeEnabled: boolean;

    // Actions
    setSettings: (settings: Partial<AppSettings> | ((prev: AppSettings) => Partial<AppSettings>)) => void;
    setPrivacyEnabled: (enabled: boolean) => void;
    updateFolderLastScanned: (id: string, timestamp: number) => void;
    toggleDevMode: () => void;
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
    hideImportModal: false,
    enableAutoThumbnailHealing: true,
    enforceHighQualityThumbnails: true,
    logLevel: 'info'
};

// Debounce timer for auto-save
let saveTimeout: NodeJS.Timeout | null = null;

export const useSettingsStore = create<SettingsState>()(
    devtools(
        (set, get) => ({
            settings: DEFAULT_SETTINGS,
            privacyEnabled: true,
            isLoaded: false,
            devModeEnabled: false,

            toggleDevMode: () => set(s => ({ devModeEnabled: !s.devModeEnabled })),

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

            updateFolderLastScanned: (id: string, timestamp: number) => {
                get().setSettings((prev) => ({
                    monitoredFolders: prev.monitoredFolders.map(f =>
                        f.id === id ? { ...f, lastScanned: timestamp } : f
                    )
                }));
            },

            initialize: async () => {
                if (get().isLoaded) return;
                try {
                    const state = await appRepository.load();
                    if (state.settings) {
                        // Merge with defaults to ensure new settings have defined values
                        // even if user's saved settings file is from an older version
                        const mergedSettings = { ...DEFAULT_SETTINGS, ...state.settings };

                        // Ensure API key from env takes precedence if present
                        const envKey = (process.env as any).API_KEY;
                        if (envKey) mergedSettings.googleGeminiApiKey = envKey;

                        // NEW: Enable devMode by default in development environment if not already set
                        if (import.meta.env.DEV && mergedSettings.devMode === undefined) {
                            mergedSettings.devMode = true;
                        }

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
