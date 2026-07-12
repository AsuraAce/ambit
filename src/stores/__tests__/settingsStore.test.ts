import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from '../settingsStore';
import { appRepository } from '../../services/repository';
import { commands } from '../../bindings';
import type { AppSettings } from '../../types';

// --- Mocks ---
vi.mock('../../services/repository', () => ({
    appRepository: {
        load: vi.fn(),
        save: vi.fn(),
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

describe('SettingsStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Reset Zustand store state before each test
        useSettingsStore.setState({
            isLoaded: false,
            geminiApiKey: null,
            settings: {
                hasCompletedOnboarding: false,
                theme: 'dark',
                thumbnailSize: 200,
                confirmDelete: true,
                defaultTheaterMode: false,
                monitoredFolders: [],
                maskedKeywords: ['nsfw', 'blood', 'gore'],
                maskingMode: 'blur',
                enableAI: false,
                libraryLayoutMode: 'masonry'
            }
        });
    });

    it('should initialize with default settings', async () => {
        (appRepository.load as any).mockResolvedValue({ settings: null });
        
        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().isLoaded).toBe(true);
        expect(useSettingsStore.getState().geminiApiKey).toBeNull();
    });

    it('should load API key from keyring on initialize', async () => {
        (appRepository.load as any).mockResolvedValue({ settings: {} });
        vi.mocked(commands.loadApiKey).mockResolvedValue({ status: 'ok', data: 'secure-key' });

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().geminiApiKey).toBe('secure-key');
    });

    it('should default high quality thumbnail upgrades to off', async () => {
        (appRepository.load as any).mockResolvedValue({ settings: {} });

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().settings.enableAutoThumbnailHealing).toBe(true);
        expect(useSettingsStore.getState().settings.enforceHighQualityThumbnails).toBe(false);
        expect(useSettingsStore.getState().settings.aiThinkingMode).toBe('default');
    });

    it('should default gallery layout mode to masonry', async () => {
        (appRepository.load as any).mockResolvedValue({ settings: {} });

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
        (appRepository.load as any).mockResolvedValue({ settings: { libraryLayoutMode: 'justified' } });

        await useSettingsStore.getState().initialize();

        expect(useSettingsStore.getState().settings.libraryLayoutMode).toBe('justified');
    });

    it('should migrate legacy API key from library.json to keyring', async () => {
        const legacySettings = {
            googleGeminiApiKey: 'legacy-key',
            theme: 'light',
            monitoredFolders: []
        };
        (appRepository.load as any).mockResolvedValue({ settings: legacySettings });
        vi.mocked(commands.loadApiKey).mockResolvedValue({ status: 'ok', data: null });

        await useSettingsStore.getState().initialize();

        // Should have called saveApiKey with the legacy key
        expect(commands.saveApiKey).toHaveBeenCalledWith('legacy-key');
        
        // Should have cleared legacy key from settings
        expect(useSettingsStore.getState().settings.googleGeminiApiKey).toBeUndefined();
        expect(useSettingsStore.getState().geminiApiKey).toBe('legacy-key');

        // Should have triggered a save to cleanup library.json
        expect(appRepository.save).toHaveBeenCalled();
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
});
