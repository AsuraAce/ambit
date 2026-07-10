import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../repository';
import { GeneratorTool } from '../../types';

const fsMocks = vi.hoisted(() => ({
    exists: vi.fn(),
    mkdir: vi.fn(),
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: {
        AppLocalData: 11,
    },
    exists: fsMocks.exists,
    mkdir: fsMocks.mkdir,
    readTextFile: fsMocks.readTextFile,
    writeTextFile: fsMocks.writeTextFile,
}));

vi.mock('../runtime', () => ({
    isTauriRuntime: () => false,
}));

const stateFixture = (): AppState => ({
    images: [{
        id: 'image-a',
        url: '',
        thumbnailUrl: '',
        filename: 'image-a.png',
        timestamp: 1,
        width: 100,
        height: 100,
        isFavorite: false,
        metadata: {
            tool: GeneratorTool.UNKNOWN,
            model: 'Unknown',
            steps: 0,
            cfg: 0,
            sampler: 'Unknown',
            positivePrompt: '',
            negativePrompt: '',
        },
    }],
    collections: [],
    smartCollections: [],
    settings: {
        hasCompletedOnboarding: true,
        theme: 'dark',
        thumbnailSize: 200,
        confirmDelete: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
        maskedKeywords: [],
        maskingMode: 'blur',
        enableAI: false,
    },
    recentSearches: ['portrait'],
});

describe('LocalStorageRepository', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
    });

    it('loads defaults when browser storage is empty', async () => {
        const { LocalStorageRepository } = await import('../repository');

        const state = await new LocalStorageRepository().load();

        expect(state.images).toHaveLength(155);
        expect(state.collections).toEqual([]);
        expect(state.settings.monitoredFolders).toHaveLength(2);
        expect(state.recentSearches).toEqual([]);
    });

    it('merges stored settings with current defaults during browser load', async () => {
        localStorage.setItem('aigallery_state_v1', JSON.stringify({
            images: [],
            collections: [],
            smartCollections: [],
            settings: {
                theme: 'light',
                maskedKeywords: ['private'],
            },
            recentSearches: ['flux'],
        }));
        const { LocalStorageRepository } = await import('../repository');

        const state = await new LocalStorageRepository().load();

        expect(state.settings.theme).toBe('light');
        expect(state.settings.hasCompletedOnboarding).toBe(true);
        expect(state.settings.maskedKeywords).toEqual(['private']);
        expect(state.settings.resourceFolders).toEqual([]);
        expect(state.recentSearches).toEqual(['flux']);
    });

    it('saves browser state to the expected localStorage key', async () => {
        const { LocalStorageRepository } = await import('../repository');
        const state = stateFixture();

        await new LocalStorageRepository().save(state);

        expect(JSON.parse(localStorage.getItem('aigallery_state_v1') ?? '{}')).toEqual(state);
    });
});

describe('TauriFsRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fsMocks.mkdir.mockResolvedValue(undefined);
        fsMocks.exists.mockResolvedValue(false);
        fsMocks.readTextFile.mockResolvedValue('{}');
        fsMocks.writeTextFile.mockResolvedValue(undefined);
    });

    it('returns a fresh SQLite-backed app state when library.json does not exist', async () => {
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const state = await new TauriFsRepository().load();

        expect(fsMocks.mkdir).toHaveBeenCalledWith('', { baseDir: 11, recursive: true });
        expect(fsMocks.exists).toHaveBeenCalledWith('library.json', { baseDir: 11 });
        expect(state.images).toEqual([]);
        expect(state.collections).toEqual([]);
        expect(state.recentSearches).toEqual([]);
    });

    it('loads library.json settings but strips legacy image rows from persisted JSON state', async () => {
        fsMocks.exists.mockResolvedValue(true);
        fsMocks.readTextFile.mockResolvedValue(JSON.stringify({
            ...stateFixture(),
            settings: {
                theme: 'light',
            },
        }));
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const state = await new TauriFsRepository().load();
        await Promise.resolve();

        expect(state.images).toEqual([]);
        expect(state.settings.theme).toBe('light');
        expect(state.settings.hasCompletedOnboarding).toBe(true);
        expect(state.settings.resourceFolders).toEqual([]);
        expect(fsMocks.writeTextFile).toHaveBeenCalled();
        const [, serialized] = fsMocks.writeTextFile.mock.calls[0] as [string, string, unknown];
        expect(JSON.parse(serialized).images).toEqual([]);
    });

    it('never writes image rows to library.json saves because SQLite owns image data', async () => {
        const { TauriFsRepository } = await import('../TauriFsRepository');

        await new TauriFsRepository().save(stateFixture());

        const [fileName, serialized, options] = fsMocks.writeTextFile.mock.calls[0] as [string, string, unknown];
        expect(fileName).toBe('library.json');
        expect(options).toEqual({ baseDir: 11 });
        expect(JSON.parse(serialized).images).toEqual([]);
    });
});
