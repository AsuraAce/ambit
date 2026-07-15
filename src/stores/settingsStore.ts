import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { AppSettings, AppSettingsUpdate } from '../types';
import { appRepository } from '../services/repository';
import { commands } from '../bindings';
import { ensureAssetPathAccessible, ensureConfiguredAssetPathsAccessible } from '../services/assetScope';
import { normalizeInvokeRoot } from '../utils/pathUtils';
import { isBrowserMockMode } from '../services/runtime';
import { createDefaultAppSettings } from '../constants/defaultSettings';
import {
    settingsPersistenceCoordinator,
    type SettingsPersistencePermit,
} from '../utils/settingsPersistenceCoordinator';

type SettingsInitializationStatus = 'loading' | 'ready' | 'failed';

interface SettingsState {
    settings: AppSettings;
    privacyEnabled: boolean;
    initializationStatus: SettingsInitializationStatus;
    isLoaded: boolean;
    geminiApiKey: string | null;

    // Actions
    setSettings: (settings: AppSettingsUpdate) => void;
    rollbackSettings: (
        permit: SettingsPersistencePermit,
        settings: AppSettingsUpdate
    ) => AppSettings | null;
    setGeminiApiKey: (key: string | null) => Promise<void>;
    setPrivacyEnabled: (enabled: boolean) => void;
    flushSettings: (settingsOverride?: AppSettings) => Promise<void>;
    cancelPendingSave: () => void;
    updateFolderLastScanned: (id: string, timestamp: number) => void;
    initialize: () => Promise<void>;
}

const DEFAULT_SETTINGS = createDefaultAppSettings();

// Debounce timer for auto-save
let saveTimeout: NodeJS.Timeout | null = null;
let initializePromise: Promise<void> | null = null;

const persistSettings = async (settings: AppSettings): Promise<void> => {
    await appRepository.update((appState) => ({
        ...appState,
        settings
    }));
};

export const useSettingsStore = create<SettingsState>()(
    devtools(
        (set, get) => ({
            settings: DEFAULT_SETTINGS,
            privacyEnabled: true,
            initializationStatus: 'loading',
            isLoaded: false,
            geminiApiKey: null,

            setGeminiApiKey: async (key: string | null) => {
                if (isBrowserMockMode()) {
                    set({ geminiApiKey: key });
                    return;
                }

                try {
                    if (key) {
                        const result = await commands.saveApiKey(key);
                        if (result.status === 'error') throw new Error(result.error);
                        set({ geminiApiKey: key });
                    } else {
                        const result = await commands.deleteApiKey();
                        if (result.status === 'error') throw new Error(result.error);
                        set({ geminiApiKey: null });
                    }
                } catch (e) {
                    console.error('[SettingsStore] Failed to save/delete API key:', e);
                    throw e;
                }
            },

            setSettings: (update) => {
                if (!settingsPersistenceCoordinator.isAccepting()) return;

                const previousSettings = get().settings;
                let nextSettings = previousSettings;

                set((state) => {
                    const newSettings = typeof update === 'function'
                        ? { ...state.settings, ...update(state.settings) }
                        : { ...state.settings, ...update };
                    nextSettings = newSettings;

                    // Register new folders with Tauri scope immediately if they changed.
                    // Never persist defaults before initialization has loaded the user's state.
                    if (state.initializationStatus === 'ready') {
                        if (saveTimeout) clearTimeout(saveTimeout);
                        saveTimeout = setTimeout(async () => {
                            saveTimeout = null;
                            if (get().initializationStatus !== 'ready') return;
                            try {
                                await settingsPersistenceCoordinator.run(() => persistSettings(get().settings));
                            } catch (e) {
                                console.error('[SettingsStore] Failed to auto-save settings', e);
                            }
                        }, 1000);
                    }

                    return { settings: newSettings };
                });

                const oldFolders = new Set(previousSettings.monitoredFolders.map((folder) => folder.path));

                nextSettings.monitoredFolders.forEach((folder) => {
                    if (!isBrowserMockMode() && !oldFolders.has(folder.path)) {
                        void ensureAssetPathAccessible(folder.path, { assumeDirectory: true }).catch((error) =>
                            console.error('[SettingsStore] Failed to register new folder scope:', error)
                        );
                    }
                });

                const oldResourceFolders = new Set(previousSettings.resourceFolders || []);
                nextSettings.resourceFolders?.forEach((folder) => {
                    if (!isBrowserMockMode() && !oldResourceFolders.has(folder)) {
                        void ensureAssetPathAccessible(folder, { assumeDirectory: true }).catch((error) =>
                            console.error('[SettingsStore] Failed to register resource folder scope:', error)
                        );
                    }
                });

                const previousInvokeRoot = normalizeInvokeRoot(previousSettings.invokeAiPath);
                const nextInvokeRoot = normalizeInvokeRoot(nextSettings.invokeAiPath);
                if (!isBrowserMockMode() && nextInvokeRoot && nextInvokeRoot !== previousInvokeRoot) {
                    void ensureAssetPathAccessible(nextInvokeRoot, { assumeDirectory: true }).catch((error) =>
                        console.error('[SettingsStore] Failed to register InvokeAI scope:', error)
                    );
                }
            },

            rollbackSettings: (permit, update) => {
                if (!settingsPersistenceCoordinator.ownsPermit(permit)) return null;

                let restoredSettings: AppSettings | null = null;
                set((state) => {
                    restoredSettings = typeof update === 'function'
                        ? { ...state.settings, ...update(state.settings) }
                        : { ...state.settings, ...update };
                    return { settings: restoredSettings };
                });
                return restoredSettings;
            },

            setPrivacyEnabled: (enabled) => set({ privacyEnabled: enabled }),


            flushSettings: async (settingsOverride) => {
                if (saveTimeout) {
                    clearTimeout(saveTimeout);
                    saveTimeout = null;
                }
                if (get().initializationStatus !== 'ready') return;
                await persistSettings(settingsOverride ?? get().settings);
            },

            cancelPendingSave: () => {
                if (!saveTimeout) return;
                clearTimeout(saveTimeout);
                saveTimeout = null;
            },

            updateFolderLastScanned: (id: string, timestamp: number) => {
                get().setSettings((prev) => ({
                    monitoredFolders: prev.monitoredFolders.map(f =>
                        f.id === id
                            ? { ...f, lastScanned: timestamp, initialScanPending: false, initialScanCancelled: false }
                            : f
                    )
                }));
            },

            initialize: () => {
                if (get().initializationStatus === 'ready') return Promise.resolve();
                if (initializePromise) return initializePromise;

                set({ initializationStatus: 'loading', isLoaded: false });

                initializePromise = (async () => {
                    try {
                        const state = await appRepository.load();
                        let apiKey: string | null = null;

                        // 1. Try to load from secure keyring first
                        if (!isBrowserMockMode()) {
                            try {
                                const keyResult = await commands.loadApiKey();
                                if (keyResult.status === 'ok') {
                                    apiKey = keyResult.data;
                                }
                            } catch (e) {
                                console.error('[SettingsStore] Failed to load API key from keyring:', e);
                            }
                        }

                        if (state.settings) {
                            // Merge with defaults to ensure new settings have defined values
                            // even if user's saved settings file is from an older version
                            const mergedSettings = createDefaultAppSettings(state.settings);

                            // 2. Handle Migration: If legacy key exists in JSON but not in keyring
                            if (!isBrowserMockMode() && mergedSettings.googleGeminiApiKey && !apiKey) {
                                console.log('[SettingsStore] Migrating API key to secure keyring...');
                                try {
                                    await commands.saveApiKey(mergedSettings.googleGeminiApiKey);
                                    apiKey = mergedSettings.googleGeminiApiKey;
                                } catch (e) {
                                    console.error('[SettingsStore] Migration failed:', e);
                                }
                            }

                            // 3. Clear legacy key from settings object (always, if it exists)
                            if (mergedSettings.googleGeminiApiKey) {
                                delete mergedSettings.googleGeminiApiKey;
                                // Trigger a save to cleanup library.json
                                try {
                                    await settingsPersistenceCoordinator.run(() => appRepository.update((currentState) => ({
                                        ...currentState,
                                        settings: mergedSettings
                                    })));
                                } catch (e) {
                                    console.error('[SettingsStore] Failed to remove legacy API key from persisted settings:', e);
                                }
                            }

                            // Ensure API key from env takes precedence if present
                            const envKey = process.env.API_KEY;
                            if (envKey && envKey !== 'undefined') apiKey = envKey;

                            // NEW: Enable devMode by default in development environment if not already set
                            if (import.meta.env.DEV && mergedSettings.devMode === undefined) {
                                mergedSettings.devMode = true;
                            }

                            if (!isBrowserMockMode()) {
                                await ensureConfiguredAssetPathsAccessible(mergedSettings);
                            }

                            set({
                                settings: mergedSettings,
                                geminiApiKey: apiKey ?? null,
                                initializationStatus: 'ready',
                                isLoaded: true
                            });
                        } else {
                            set({
                                geminiApiKey: apiKey ?? null,
                                initializationStatus: 'ready',
                                isLoaded: true
                            });
                        }
                    } catch (e) {
                        console.error('[SettingsStore] Failed to load settings', e);
                        set({ initializationStatus: 'failed', isLoaded: false });
                    }
                })().finally(() => {
                    initializePromise = null;
                });

                return initializePromise;
            }
        }),
        { name: 'SettingsStore' }
    )
);
