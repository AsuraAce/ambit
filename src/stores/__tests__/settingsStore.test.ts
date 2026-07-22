import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from '../settingsStore';
import { appRepository } from '../../services/repository';
import { commands } from '../../bindings';
import type { AppSettings } from '../../types';
import type { AppState } from '../../services/repository';
import { settingsPersistenceCoordinator } from '../../utils/settingsPersistenceCoordinator';
import { createDefaultAppSettings } from '../../constants/defaultSettings';

const mocks = vi.hoisted(() => ({
    browserMockMode: false,
    ensureAssetPathAccessible: vi.fn(),
    ensureConfiguredAssetPathsAccessible: vi.fn()
}));

const appState = (settings: AppSettings): AppState => ({
    images: [],
    collections: [],
    smartCollections: [],
    settings,
    recentSearches: []
});

// --- Mocks ---
vi.mock('../../services/repository', () => ({
    appRepository: {
        load: vi.fn(),
        save: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../../bindings', () => ({
    commands: {
        saveApiKey: vi.fn().mockResolvedValue({ status: 'ok' }),
        loadApiKey: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
        deleteApiKey: vi.fn().mockResolvedValue({ status: 'ok' }),
        registerLibraryPath: vi.fn().mockResolvedValue({ status: 'ok' }),
    },
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => mocks.browserMockMode
}));

vi.mock('../../services/assetScope', () => ({
    ensureAssetPathAccessible: mocks.ensureAssetPathAccessible,
    ensureConfiguredAssetPathsAccessible: mocks.ensureConfiguredAssetPathsAccessible
}));

describe('SettingsStore', () => {
    beforeEach(() => {
        useSettingsStore.getState().cancelPendingSave();
        settingsPersistenceCoordinator.reopenAdmission();
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.browserMockMode = false;
        mocks.ensureAssetPathAccessible.mockResolvedValue(undefined);
        mocks.ensureConfiguredAssetPathsAccessible.mockResolvedValue(undefined);
        vi.mocked(commands.saveApiKey).mockResolvedValue({ status: 'ok', data: null });
        vi.mocked(commands.loadApiKey).mockResolvedValue({ status: 'ok', data: null });
        vi.mocked(commands.deleteApiKey).mockResolvedValue({ status: 'ok', data: null });
        vi.mocked(appRepository.load).mockResolvedValue({ settings: null } as unknown as AppState);
        vi.mocked(appRepository.save).mockResolvedValue(undefined);
        vi.mocked(appRepository.update).mockImplementation(async (updater) => updater(await appRepository.load()));
        vi.unstubAllEnvs();
        // Reset Zustand store state before each test
        useSettingsStore.setState({
            initializationStatus: 'loading',
            isLoaded: false,
            privacyEnabled: true,
            privacyMaskIndexStatus: 'pending',
            privacyMaskIndexError: null,
            privacyMaskIndexRetryToken: 0,
            geminiApiKey: null,
            settings: {
                hasCompletedOnboarding: false,
                theme: 'dark',
                thumbnailSize: 200,
                confirmDelete: true,
                defaultTheaterMode: false,
                monitoredFolders: [],
                promptMaskingEnabled: true,
                maskedKeywords: ['nsfw', 'blood', 'gore'],
                maskingMode: 'blur',
                enableAI: false,
                libraryLayoutMode: 'masonry'
            }
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('should initialize with default settings', async () => {
        vi.mocked(appRepository.load).mockResolvedValue({ settings: null } as unknown as AppState);
        
        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().isLoaded).toBe(true);
        expect(useSettingsStore.getState().geminiApiKey).toBeNull();
    });

    it('should load API key from keyring on initialize', async () => {
        vi.mocked(appRepository.load).mockResolvedValue(appState({} as AppSettings));
        vi.mocked(commands.loadApiKey).mockResolvedValue({ status: 'ok', data: 'secure-key' });

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().geminiApiKey).toBe('secure-key');
    });

    it('should default high quality thumbnail upgrades to off', async () => {
        vi.mocked(appRepository.load).mockResolvedValue(appState({} as AppSettings));

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().settings.enableAutoThumbnailHealing).toBe(true);
        expect(useSettingsStore.getState().settings.enforceHighQualityThumbnails).toBe(false);
        expect(useSettingsStore.getState().settings.aiThinkingMode).toBe('default');
    });

    it('should default gallery layout mode to masonry', async () => {
        vi.mocked(appRepository.load).mockResolvedValue(appState({} as AppSettings));

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().settings.libraryLayoutMode).toBe('masonry');
    });

    it('should default orphan recovery to off', async () => {
        vi.mocked(appRepository.load).mockResolvedValue({
            images: [],
            collections: [],
            smartCollections: [],
            settings: {} as AppSettings,
            recentSearches: []
        });

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().settings.importOrphans).toBe(false);
    });

    it('should merge base defaults into old saved settings without dropping user values', async () => {
        const savedFolder = {
            id: 'folder-1',
            path: 'D:/AmbitFixtures/Library',
            isActive: true,
            imageCount: 42,
        };

        vi.mocked(appRepository.load).mockResolvedValue({
            images: [],
            collections: [],
            smartCollections: [],
            settings: {
                theme: 'light',
                monitoredFolders: [savedFolder],
                invokeSyncBoards: false,
            } as AppSettings,
            recentSearches: []
        });

        await useSettingsStore.getState().initialize();

        const settings = useSettingsStore.getState().settings;
        expect(settings.theme).toBe('light');
        expect(settings.monitoredFolders).toEqual([savedFolder]);
        expect(settings.invokeSyncBoards).toBe(false);
        expect(settings.invokeSyncFavorites).toBe(true);
        expect(settings.autoCheckForUpdates).toBe(true);
        expect(settings.thumbnailOptimizationProfile).toBe('balanced');
    });

    it('should preserve persisted gallery layout mode on initialize', async () => {
        vi.mocked(appRepository.load).mockResolvedValue(appState({ libraryLayoutMode: 'justified' } as AppSettings));

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().settings.libraryLayoutMode).toBe('justified');
    });

    it('should migrate legacy API key from library.json to keyring', async () => {
        const legacySettings = {
            googleGeminiApiKey: 'legacy-key',
            theme: 'light',
            monitoredFolders: []
        };
        vi.mocked(appRepository.load).mockResolvedValue(appState(legacySettings as unknown as AppSettings));
        vi.mocked(commands.loadApiKey).mockResolvedValue({ status: 'ok', data: null });

        await useSettingsStore.getState().initialize();

        // Should have called saveApiKey with the legacy key
        expect(commands.saveApiKey).toHaveBeenCalledWith('legacy-key');
        
        // Should have cleared legacy key from settings
        expect(useSettingsStore.getState().settings.googleGeminiApiKey).toBeUndefined();
        expect(useSettingsStore.getState().geminiApiKey).toBe('legacy-key');

        // Should have triggered a save to cleanup library.json
        expect(appRepository.update).toHaveBeenCalled();
    });

    it('hydrates loaded settings when best-effort legacy API key cleanup fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(appRepository.load).mockResolvedValue(appState({
            googleGeminiApiKey: 'legacy-key',
            theme: 'light',
            monitoredFolders: [],
            maskedKeywords: ['private'],
        } as unknown as AppSettings));
        vi.mocked(commands.loadApiKey).mockResolvedValue({ status: 'ok', data: 'secure-key' });
        vi.mocked(appRepository.update).mockRejectedValueOnce(new Error('disk full'));

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState()).toEqual(expect.objectContaining({
            isLoaded: true,
            geminiApiKey: 'secure-key',
            settings: expect.objectContaining({
                theme: 'light',
                maskedKeywords: ['private'],
            }),
        }));
        expect(useSettingsStore.getState().settings.googleGeminiApiKey).toBeUndefined();
        expect(error).toHaveBeenCalledWith(
            '[SettingsStore] Failed to remove legacy API key from persisted settings:',
            expect.any(Error)
        );
        error.mockRestore();
    });

    it('should update API key via setGeminiApiKey', async () => {
        const store = useSettingsStore.getState();
        
        await store.setGeminiApiKey('new-key');

        expect(commands.saveApiKey).toHaveBeenCalledWith('new-key');
        expect(useSettingsStore.getState().geminiApiKey).toBe('new-key');
    });

    it('should delete API key via setGeminiApiKey(null)', async () => {
        const store = useSettingsStore.getState();
        
        await store.setGeminiApiKey(null);

        expect(commands.deleteApiKey).toHaveBeenCalled();
        expect(useSettingsStore.getState().geminiApiKey).toBeNull();
    });

    it('stores API keys in memory only in browser mock mode', async () => {
        mocks.browserMockMode = true;

        await useSettingsStore.getState().setGeminiApiKey('browser-key');
        expect(useSettingsStore.getState().geminiApiKey).toBe('browser-key');
        expect(commands.saveApiKey).not.toHaveBeenCalled();
    });

    it.each([
        ['save', 'key'],
        ['delete', null]
    ] as const)('rejects %s API key command errors', async (operation, key) => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        if (operation === 'save') {
            vi.mocked(commands.saveApiKey).mockResolvedValueOnce({ status: 'error', error: 'save failed' });
        } else {
            vi.mocked(commands.deleteApiKey).mockResolvedValueOnce({ status: 'error', error: 'delete failed' });
        }

        await expect(useSettingsStore.getState().setGeminiApiKey(key)).rejects.toThrow(`${operation} failed`);
        expect(error).toHaveBeenCalledWith('[SettingsStore] Failed to save/delete API key:', expect.any(Error));
        error.mockRestore();
    });

    it('applies object and functional settings updates and debounces repository persistence', async () => {
        vi.mocked(appRepository.load).mockResolvedValue({
            settings: useSettingsStore.getState().settings,
            images: [], collections: [], smartCollections: [], recentSearches: []
        });
        useSettingsStore.setState({ initializationStatus: 'ready', isLoaded: true });

        useSettingsStore.getState().setSettings({ theme: 'light' });
        useSettingsStore.getState().setSettings(previous => ({ thumbnailSize: previous.thumbnailSize + 25 }));
        expect(useSettingsStore.getState().settings.theme).toBe('light');
        expect(useSettingsStore.getState().settings.thumbnailSize).toBe(225);

        await vi.advanceTimersByTimeAsync(1000);
        expect(appRepository.update).toHaveBeenCalledTimes(1);
        const updater = vi.mocked(appRepository.update).mock.calls[0][0];
        expect(updater(appState(useSettingsStore.getState().settings)).settings).toEqual(
            expect.objectContaining({ theme: 'light', thumbnailSize: 225 })
        );
    });

    it('contains auto-save failures', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(appRepository.update).mockRejectedValueOnce(new Error('save failed'));
        useSettingsStore.setState({ initializationStatus: 'ready', isLoaded: true });

        useSettingsStore.getState().setSettings({ theme: 'light' });
        await vi.advanceTimersByTimeAsync(1000);

        expect(error).toHaveBeenCalledWith('[SettingsStore] Failed to auto-save settings', expect.any(Error));
        error.mockRestore();
    });

    it('flushes the latest settings immediately and cancels the debounced duplicate save', async () => {
        vi.mocked(appRepository.load).mockResolvedValue(appState(useSettingsStore.getState().settings));
        useSettingsStore.setState({ initializationStatus: 'ready', isLoaded: true });

        useSettingsStore.getState().setSettings({ maskedKeywords: ['private'] });
        await useSettingsStore.getState().flushSettings();
        await vi.advanceTimersByTimeAsync(1000);

        expect(appRepository.update).toHaveBeenCalledTimes(1);
        const updater = vi.mocked(appRepository.update).mock.calls[0][0];
        expect(updater(appState(useSettingsStore.getState().settings)).settings.maskedKeywords).toEqual(['private']);
    });

    it('flushes an explicit reset snapshot without publishing its privacy settings', async () => {
        useSettingsStore.setState({ initializationStatus: 'ready', isLoaded: true });
        const visibleSettings = useSettingsStore.getState().settings;
        const purgeSettings = {
            ...visibleSettings,
            maskedKeywords: ['reset-private'],
            maskingMode: 'blur' as const,
        };

        await useSettingsStore.getState().flushSettings(purgeSettings);

        expect(useSettingsStore.getState().settings).toBe(visibleSettings);
        const updater = vi.mocked(appRepository.update).mock.calls[0][0];
        expect(updater(appState(visibleSettings)).settings).toBe(purgeSettings);
    });

    it('does not persist pre-initialization default updates', async () => {
        useSettingsStore.getState().setSettings({ libraryShowGrids: false });
        await vi.advanceTimersByTimeAsync(1000);

        expect(appRepository.update).not.toHaveBeenCalled();
    });

    it('registers new monitored, resource, and InvokeAI paths', async () => {
        useSettingsStore.getState().setSettings({
            monitoredFolders: [{ id: 'folder', path: 'C:/images', isActive: true, imageCount: 0 }],
            resourceFolders: ['C:/models'],
            invokeAiPath: 'C:/invokeai'
        });
        await Promise.resolve();

        expect(mocks.ensureAssetPathAccessible).toHaveBeenCalledWith('C:/images', { assumeDirectory: true });
        expect(mocks.ensureAssetPathAccessible).toHaveBeenCalledWith('C:/models', { assumeDirectory: true });
        expect(mocks.ensureAssetPathAccessible).toHaveBeenCalledWith('C:/invokeai', { assumeDirectory: true });
    });

    it('skips existing and browser-mock asset paths', async () => {
        const folder = { id: 'folder', path: 'C:/images', isActive: true, imageCount: 0 };
        useSettingsStore.setState(state => ({
            settings: { ...state.settings, monitoredFolders: [folder], resourceFolders: ['C:/models'], invokeAiPath: 'C:/invokeai' }
        }));
        useSettingsStore.getState().setSettings({ theme: 'light' });
        expect(mocks.ensureAssetPathAccessible).not.toHaveBeenCalled();

        mocks.browserMockMode = true;
        useSettingsStore.getState().setSettings({
            monitoredFolders: [...useSettingsStore.getState().settings.monitoredFolders, { id: 'new', path: 'D:/new', isActive: true, imageCount: 0 }],
            resourceFolders: ['C:/models', 'D:/models'],
            invokeAiPath: 'D:/invokeai'
        });
        expect(mocks.ensureAssetPathAccessible).not.toHaveBeenCalled();
    });

    it('contains asynchronous scope registration failures', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.ensureAssetPathAccessible.mockRejectedValue(new Error('scope failed'));
        useSettingsStore.getState().setSettings({
            monitoredFolders: [{ id: 'folder', path: 'C:/images', isActive: true, imageCount: 0 }],
            resourceFolders: ['C:/models'],
            invokeAiPath: 'C:/invokeai'
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(error).toHaveBeenCalledWith('[SettingsStore] Failed to register new folder scope:', expect.any(Error));
        expect(error).toHaveBeenCalledWith('[SettingsStore] Failed to register resource folder scope:', expect.any(Error));
        expect(error).toHaveBeenCalledWith('[SettingsStore] Failed to register InvokeAI scope:', expect.any(Error));
        error.mockRestore();
    });

    it('updates privacy and only the matching folder scan cursor', () => {
        useSettingsStore.setState(state => ({
            settings: {
                ...state.settings,
                monitoredFolders: [
                    { id: 'one', path: 'C:/one', isActive: true, imageCount: 0, initialScanPending: true, initialScanCancelled: true },
                    { id: 'two', path: 'C:/two', isActive: true, imageCount: 0 }
                ]
            }
        }));

        useSettingsStore.getState().setPrivacyEnabled(false);
        useSettingsStore.getState().updateFolderLastScanned('one', 123);

        expect(useSettingsStore.getState().privacyEnabled).toBe(false);
        expect(useSettingsStore.getState().settings.monitoredFolders[0]).toEqual(expect.objectContaining({
            lastScanned: 123,
            initialScanPending: false,
            initialScanCancelled: false
        }));
        expect(useSettingsStore.getState().settings.monitoredFolders[1].lastScanned).toBeUndefined();
    });

    it('short-circuits repeated initialization', async () => {
        useSettingsStore.setState({ initializationStatus: 'ready', isLoaded: true });
        await useSettingsStore.getState().initialize();
        expect(appRepository.load).not.toHaveBeenCalled();
    });

    it('shares concurrent initialization so a stale second load cannot overwrite a later settings flush', async () => {
        let resolveScope!: () => void;
        mocks.ensureConfiguredAssetPathsAccessible.mockReturnValueOnce(new Promise<void>(resolve => {
            resolveScope = resolve;
        }));
        vi.mocked(appRepository.load).mockResolvedValue(appState({
            ...useSettingsStore.getState().settings,
            maskedKeywords: ['persisted-old']
        }));
        vi.mocked(appRepository.update).mockImplementation(async updater => (
            updater(appState(useSettingsStore.getState().settings))
        ));

        const first = useSettingsStore.getState().initialize();
        const concurrent = useSettingsStore.getState().initialize();
        await Promise.resolve();

        expect(concurrent).toBe(first);
        expect(appRepository.load).toHaveBeenCalledOnce();
        resolveScope();
        await Promise.all([first, concurrent]);

        useSettingsStore.getState().setSettings({ maskedKeywords: ['saved-new'] });
        await useSettingsStore.getState().flushSettings();

        expect(appRepository.load).toHaveBeenCalledOnce();
        const updater = vi.mocked(appRepository.update).mock.calls.at(-1)?.[0];
        expect(updater?.(appState(useSettingsStore.getState().settings)).settings.maskedKeywords).toEqual(['saved-new']);
    });

    it('contains keyring load and legacy migration failures', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(commands.loadApiKey).mockRejectedValueOnce(new Error('keyring failed'));
        vi.mocked(commands.saveApiKey).mockRejectedValueOnce(new Error('migration failed'));
        vi.mocked(appRepository.load).mockResolvedValue(appState({
            ...useSettingsStore.getState().settings,
            googleGeminiApiKey: 'legacy'
        }));

        await useSettingsStore.getState().initialize();

        expect(error).toHaveBeenCalledWith('[SettingsStore] Failed to load API key from keyring:', expect.any(Error));
        expect(error).toHaveBeenCalledWith('[SettingsStore] Migration failed:', expect.any(Error));
        expect(useSettingsStore.getState().geminiApiKey).toBeNull();
        error.mockRestore();
    });

    it('prefers the environment key and preserves an explicit development mode', async () => {
        vi.stubEnv('API_KEY', 'environment-key');
        vi.mocked(commands.loadApiKey).mockResolvedValueOnce({ status: 'error', error: 'unavailable' });
        vi.mocked(appRepository.load).mockResolvedValue(appState({
            ...useSettingsStore.getState().settings,
            devMode: false
        }));

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().geminiApiKey).toBe('environment-key');
        expect(useSettingsStore.getState().settings.devMode).toBe(false);
        expect(mocks.ensureConfiguredAssetPathsAccessible).toHaveBeenCalled();
    });

    it('initializes in browser mode without keyring or asset-scope access', async () => {
        mocks.browserMockMode = true;
        vi.mocked(appRepository.load).mockResolvedValue(appState({} as AppSettings));

        await useSettingsStore.getState().initialize();

        expect(commands.loadApiKey).not.toHaveBeenCalled();
        expect(mocks.ensureConfiguredAssetPathsAccessible).not.toHaveBeenCalled();
        expect(useSettingsStore.getState().isLoaded).toBe(true);
    });

    it('keeps failed repository initialization fail-closed', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(appRepository.load).mockRejectedValueOnce(new Error('repository failed'));

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState()).toEqual(expect.objectContaining({
            initializationStatus: 'failed',
            isLoaded: false,
        }));
        expect(error).toHaveBeenCalledWith('[SettingsStore] Failed to load settings', expect.any(Error));

        useSettingsStore.getState().setSettings({
            theme: 'light',
            maskedKeywords: ['fallback-edit'],
        });
        await useSettingsStore.getState().flushSettings();
        await vi.advanceTimersByTimeAsync(1000);
        expect(appRepository.update).not.toHaveBeenCalled();

        vi.mocked(appRepository.load).mockResolvedValueOnce(appState({
            ...createDefaultAppSettings(),
            theme: 'dark',
            maskedKeywords: ['retry-loaded']
        }));
        await useSettingsStore.getState().initialize();
        expect(useSettingsStore.getState()).toEqual(expect.objectContaining({
            initializationStatus: 'ready',
            isLoaded: true,
        }));
        expect(useSettingsStore.getState().settings.theme).toBe('dark');
        expect(useSettingsStore.getState().settings.maskedKeywords).toEqual(['retry-loaded']);
        error.mockRestore();
    });

    it('marks the privacy index stale synchronously when keywords change', () => {
        useSettingsStore.setState({
            initializationStatus: 'ready',
            isLoaded: true,
            privacyEnabled: true,
            privacyMaskIndexStatus: 'ready',
        });

        useSettingsStore.getState().setSettings({ maskedKeywords: ['different'] });

        expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('pending');
        expect(useSettingsStore.getState().privacyMaskIndexError).toBeNull();
    });

    it('does not stale the privacy index when only inactive saved keywords change', () => {
        useSettingsStore.setState(state => ({
            privacyEnabled: true,
            privacyMaskIndexStatus: 'ready',
            settings: {
                ...state.settings,
                promptMaskingEnabled: false,
                maskedKeywords: ['retained'],
            },
        }));

        useSettingsStore.getState().setSettings({ maskedKeywords: ['retained', 'prepared'] });

        expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('ready');
        expect(useSettingsStore.getState().settings.maskedKeywords).toEqual(['retained', 'prepared']);
    });

    it('marks the privacy index stale when prompt masking changes the effective list', () => {
        useSettingsStore.setState(state => ({
            privacyEnabled: true,
            privacyMaskIndexStatus: 'ready',
            settings: {
                ...state.settings,
                promptMaskingEnabled: true,
                maskedKeywords: ['retained'],
            },
        }));

        useSettingsStore.getState().setSettings({ promptMaskingEnabled: false });

        expect(useSettingsStore.getState().privacyMaskIndexStatus).toBe('pending');
        expect(useSettingsStore.getState().settings.maskedKeywords).toEqual(['retained']);
    });

    it('unblocks on explicit disable and requires a fresh refresh after re-enable', () => {
        useSettingsStore.setState({
            privacyEnabled: true,
            privacyMaskIndexStatus: 'failed',
            privacyMaskIndexError: 'failed',
        });

        useSettingsStore.getState().setPrivacyEnabled(false);
        expect(useSettingsStore.getState()).toEqual(expect.objectContaining({
            privacyEnabled: false,
            privacyMaskIndexStatus: 'ready',
            privacyMaskIndexError: null,
        }));

        useSettingsStore.getState().setPrivacyEnabled(true);
        expect(useSettingsStore.getState()).toEqual(expect.objectContaining({
            privacyEnabled: true,
            privacyMaskIndexStatus: 'pending',
            privacyMaskIndexError: null,
        }));
    });
});
