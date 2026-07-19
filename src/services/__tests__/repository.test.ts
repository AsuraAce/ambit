import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState } from '../repository';
import { GeneratorTool } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';

const fsMocks = vi.hoisted(() => ({
    exists: vi.fn(),
    mkdir: vi.fn(),
    readTextFile: vi.fn(),
    remove: vi.fn(),
    writeTextFile: vi.fn(),
}));

const commandMocks = vi.hoisted(() => ({
    schedulePurgeTransaction: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    BaseDirectory: {
        AppLocalData: 11,
    },
    exists: fsMocks.exists,
    mkdir: fsMocks.mkdir,
    readTextFile: fsMocks.readTextFile,
    remove: fsMocks.remove,
    writeTextFile: fsMocks.writeTextFile,
}));

vi.mock('../../bindings', () => ({
    commands: {
        schedulePurgeTransaction: commandMocks.schedulePurgeTransaction,
    },
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
        promptMaskingEnabled: true,
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
        expect(state.settings.promptMaskingEnabled).toBe(true);
        expect(state.settings.maskedKeywords).toEqual(['private']);
        expect(state.settings.resourceFolders).toEqual([]);
        expect(state.recentSearches).toEqual(['flux']);
    });

    it('infers legacy prompt masking without overriding an explicit persisted switch', async () => {
        const { LocalStorageRepository } = await import('../repository');
        const repository = new LocalStorageRepository();
        const storedState = {
            images: [],
            collections: [],
            smartCollections: [],
            recentSearches: [],
        };

        localStorage.setItem('aigallery_state_v1', JSON.stringify({
            ...storedState,
            settings: { maskedKeywords: [] },
        }));
        await expect(repository.load()).resolves.toEqual(expect.objectContaining({
            settings: expect.objectContaining({ promptMaskingEnabled: false, maskedKeywords: [] }),
        }));

        localStorage.setItem('aigallery_state_v1', JSON.stringify({
            ...storedState,
            settings: { promptMaskingEnabled: false, maskedKeywords: ['retained'] },
        }));
        await expect(repository.load()).resolves.toEqual(expect.objectContaining({
            settings: expect.objectContaining({ promptMaskingEnabled: false, maskedKeywords: ['retained'] }),
        }));
    });

    it('saves browser state to the expected localStorage key', async () => {
        const { LocalStorageRepository } = await import('../repository');
        const state = stateFixture();

        await new LocalStorageRepository().save(state);

        expect(JSON.parse(localStorage.getItem('aigallery_state_v1') ?? '{}')).toEqual(state);
    });

    it('serializes concurrent browser updates so settings and recent searches are both preserved', async () => {
        const { LocalStorageRepository } = await import('../repository');
        const repository = new LocalStorageRepository();
        await repository.save(stateFixture());

        await Promise.all([
            repository.update(state => ({
                ...state,
                settings: { ...state.settings, maskedKeywords: ['durable'] }
            })),
            repository.update(state => ({ ...state, recentSearches: ['latest-search'] })),
        ]);

        await expect(repository.load()).resolves.toEqual(expect.objectContaining({
            settings: expect.objectContaining({ maskedKeywords: ['durable'] }),
            recentSearches: ['latest-search'],
        }));
    });

    it('falls back to defaults when browser storage cannot be read', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
            throw new Error('storage denied');
        });
        const { LocalStorageRepository } = await import('../repository');

        const state = await new LocalStorageRepository().load();

        expect(state.images).toHaveLength(155);
        expect(error).toHaveBeenCalledWith('Failed to load state', expect.any(Error));
        error.mockRestore();
    });

    it('contains browser storage write failures', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
            throw new Error('quota exceeded');
        });
        const { LocalStorageRepository } = await import('../repository');

        await expect(new LocalStorageRepository().save(stateFixture())).rejects.toThrow('quota exceeded');

        expect(error).toHaveBeenCalledWith('Failed to save state', expect.any(Error));
        error.mockRestore();
    });

});

describe('TauriFsRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fsMocks.mkdir.mockResolvedValue(undefined);
        fsMocks.exists.mockResolvedValue(false);
        fsMocks.readTextFile.mockResolvedValue('{}');
        fsMocks.remove.mockResolvedValue(undefined);
        fsMocks.writeTextFile.mockResolvedValue(undefined);
        commandMocks.schedulePurgeTransaction.mockResolvedValue({
            status: 'ok',
            data: 'Factory reset committed.',
        });
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

    it('schedules purge from one immutable snapshot without changing committed JSON', async () => {
        const current = stateFixture();
        fsMocks.exists.mockImplementation(async (fileName: string) => (
            fileName === 'library.json' || fileName === 'library.json.bak'
        ));
        fsMocks.readTextFile.mockResolvedValue(JSON.stringify(current));
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const result = await new TauriFsRepository().schedulePurge(state => ({
            ...state,
            recentSearches: [],
            settings: { ...state.settings, maskedKeywords: ['nsfw', 'blood', 'gore'] },
        }));

        expect(result.message).toBe('Factory reset committed.');
        expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
        const [transactionId, journalJson] = commandMocks.schedulePurgeTransaction.mock.calls[0];
        const journal = JSON.parse(journalJson);
        expect(journal).toEqual(expect.objectContaining({
            version: 1,
            transactionId,
            before: expect.objectContaining({ recentSearches: ['portrait'] }),
            after: expect.objectContaining({
                recentSearches: [],
                settings: expect.objectContaining({ maskedKeywords: ['nsfw', 'blood', 'gore'] }),
            }),
        }));
    });

    it('leaves committed JSON unchanged when native purge scheduling rejects', async () => {
        const current = stateFixture();
        fsMocks.exists.mockImplementation(async (fileName: string) => (
            fileName === 'library.json' || fileName === 'library.json.bak'
        ));
        fsMocks.readTextFile.mockResolvedValue(JSON.stringify(current));
        commandMocks.schedulePurgeTransaction.mockResolvedValueOnce({
            status: 'error',
            error: 'marker unavailable',
        });
        const { TauriFsRepository } = await import('../TauriFsRepository');

        await expect(new TauriFsRepository().schedulePurge(state => ({
            ...state,
            recentSearches: [],
        }))).rejects.toThrow('marker unavailable');

        expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
        expect(fsMocks.remove).not.toHaveBeenCalled();
    });

    it('materializes a completed native purge through the normal library commit protocol', async () => {
        const before = stateFixture();
        const after = {
            ...before,
            recentSearches: [],
            settings: { ...before.settings, maskedKeywords: ['nsfw', 'blood', 'gore'] },
        };
        const transactionId = 'purge-completed';
        fsMocks.exists.mockImplementation(async (fileName: string) => [
            'library.purge.json',
            'library.purge.completed',
            'library.json',
            'library.json.bak',
        ].includes(fileName));
        fsMocks.readTextFile.mockImplementation(async (fileName: string) => {
            if (fileName === 'library.purge.json') {
                return JSON.stringify({ version: 1, transactionId, before, after });
            }
            if (fileName === 'library.purge.completed') {
                return JSON.stringify({ version: 1, transactionId });
            }
            return JSON.stringify(before);
        });
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const recovered = await new TauriFsRepository().load();

        expect(recovered.settings.maskedKeywords).toEqual(['nsfw', 'blood', 'gore']);
        expect(recovered.recentSearches).toEqual([]);
        expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
            'library.json',
            expect.stringContaining('"maskedKeywords": [\n      "nsfw"'),
            { baseDir: 11 }
        );
        expect(fsMocks.remove.mock.calls.slice(-2).map(call => call[0])).toEqual([
            'library.purge.completed',
            'library.purge.json',
        ]);
    });

    it('fails closed when native purge recovery artifacts are incomplete', async () => {
        fsMocks.exists.mockImplementation(async (fileName: string) => fileName === 'library.purge.json');
        const { TauriFsRepository } = await import('../TauriFsRepository');

        await expect(new TauriFsRepository().load()).rejects.toThrow(
            'Factory reset recovery artifacts are incomplete'
        );
        expect(fsMocks.remove).not.toHaveBeenCalled();
        expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
    });

    it('retains completed purge artifacts when JSON materialization fails', async () => {
        const before = stateFixture();
        const after = { ...before, recentSearches: [] };
        const transactionId = 'purge-retry';
        fsMocks.exists.mockImplementation(async (fileName: string) => [
            'library.purge.json',
            'library.purge.completed',
            'library.json',
            'library.json.bak',
        ].includes(fileName));
        fsMocks.readTextFile.mockImplementation(async (fileName: string) => {
            if (fileName === 'library.purge.json') {
                return JSON.stringify({ version: 1, transactionId, before, after });
            }
            if (fileName === 'library.purge.completed') {
                return JSON.stringify({ version: 1, transactionId });
            }
            return JSON.stringify(before);
        });
        fsMocks.writeTextFile.mockImplementation(async (fileName: string) => {
            if (fileName === 'library.json') throw new Error('main unavailable');
        });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { TauriFsRepository } = await import('../TauriFsRepository');

        await expect(new TauriFsRepository().load()).rejects.toThrow('main unavailable');

        expect(fsMocks.remove).not.toHaveBeenCalledWith('library.purge.completed', expect.anything());
        expect(fsMocks.remove).not.toHaveBeenCalledWith('library.purge.json', expect.anything());
    });

    it('loads library.json settings but strips legacy image rows from persisted JSON state', async () => {
        fsMocks.exists.mockImplementation(async (fileName: string) => fileName === 'library.json');
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
        expect(state.settings.promptMaskingEnabled).toBe(false);
        expect(state.settings.resourceFolders).toEqual([]);
        expect(fsMocks.writeTextFile).toHaveBeenCalled();
        const [, serialized] = fsMocks.writeTextFile.mock.calls.find(([fileName]) => fileName === 'library.json') as [string, string, unknown];
        expect(JSON.parse(serialized).images).toEqual([]);
    });

    it('normalizes omitted legacy collection and smart-filter fields after validation', async () => {
        fsMocks.exists.mockImplementation(async (fileName: string) => fileName === 'library.json');
        fsMocks.readTextFile.mockResolvedValue(JSON.stringify({
            ...stateFixture(),
            images: [],
            collections: [{ id: 'legacy', name: 'Legacy' }],
            smartCollections: [{ id: 'legacy-smart', name: 'Legacy Smart', filters: { searchQuery: 'portrait' } }],
        }));
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const state = await new TauriFsRepository().load();

        expect(state.collections[0]).toEqual(expect.objectContaining({
            id: 'legacy',
            imageIds: [],
            createdAt: expect.any(Number),
        }));
        expect(state.smartCollections[0]).toEqual(expect.objectContaining({
            id: 'legacy-smart',
            imageIds: [],
            createdAt: expect.any(Number),
            filters: expect.objectContaining({
                searchQuery: 'portrait',
                loras: [],
                dateRange: 'all',
            }),
        }));
    });

    it('creates a recovery backup without rewriting clean main state', async () => {
        fsMocks.exists.mockImplementation(async (fileName: string) => fileName === 'library.json');
        fsMocks.readTextFile.mockResolvedValue(JSON.stringify({ ...stateFixture(), images: [] }));
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const state = await new TauriFsRepository().load();

        expect(state.images).toEqual([]);
        expect(fsMocks.writeTextFile).toHaveBeenCalledOnce();
        expect(fsMocks.writeTextFile).toHaveBeenCalledWith(
            'library.json.bak',
            expect.any(String),
            { baseDir: 11 }
        );
    });

    it('never writes image rows to library.json saves because SQLite owns image data', async () => {
        const { TauriFsRepository } = await import('../TauriFsRepository');

        await new TauriFsRepository().save(stateFixture());

        const [fileName, serialized, options] = fsMocks.writeTextFile.mock.calls.find(([name]) => name === 'library.json') as [string, string, unknown];
        expect(fileName).toBe('library.json');
        expect(options).toEqual({ baseDir: 11 });
        expect(JSON.parse(serialized).images).toEqual([]);
    });

    it('serializes concurrent filesystem updates so settings and recent searches are both preserved', async () => {
        const initial = { ...stateFixture(), images: [] };
        const files = new Map<string, string>([
            ['library.json', JSON.stringify(initial)],
            ['library.json.bak', JSON.stringify(initial)],
        ]);
        fsMocks.exists.mockImplementation(async (fileName: string) => files.has(fileName));
        fsMocks.readTextFile.mockImplementation(async (fileName: string) => files.get(fileName));
        fsMocks.writeTextFile.mockImplementation(async (fileName: string, content: string) => {
            files.set(fileName, content);
        });
        fsMocks.remove.mockImplementation(async (fileName: string) => {
            files.delete(fileName);
        });
        const { TauriFsRepository } = await import('../TauriFsRepository');
        const repository = new TauriFsRepository();

        await Promise.all([
            repository.update(state => ({
                ...state,
                settings: { ...state.settings, maskedKeywords: ['durable'] }
            })),
            repository.update(state => ({ ...state, recentSearches: ['latest-search'] })),
        ]);

        const persisted = await repository.load();
        expect(persisted.settings.maskedKeywords).toEqual(['durable']);
        expect(persisted.recentSearches).toEqual(['latest-search']);
    });

    it('logs directory creation failure once per repository and rejects reads and writes', async () => {
        fsMocks.mkdir.mockRejectedValue(new Error('permission denied'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { TauriFsRepository } = await import('../TauriFsRepository');
        const repository = new TauriFsRepository();

        await expect(repository.load()).rejects.toThrow('permission denied');
        await expect(repository.save(stateFixture())).rejects.toThrow('permission denied');

        expect(error).toHaveBeenCalledWith('Error ensuring directory:', expect.any(Error));
        expect(error.mock.calls.filter(([message]) => message === 'Error ensuring directory:')).toHaveLength(1);
        error.mockRestore();
    });

    it('rejects an update when an existing main file has a transient read failure without writing defaults', async () => {
        fsMocks.exists.mockImplementation(async (fileName: string) => fileName === 'library.json');
        fsMocks.readTextFile.mockRejectedValueOnce(new Error('transport unavailable'));
        const { TauriFsRepository } = await import('../TauriFsRepository');
        const repository = new TauriFsRepository();
        const updater = vi.fn((state: AppState) => ({
            ...state,
            recentSearches: ['must-not-overwrite']
        }));

        await expect(repository.update(updater)).rejects.toThrow('transport unavailable');

        expect(updater).not.toHaveBeenCalled();
        expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
        expect(fsMocks.exists).not.toHaveBeenCalledWith('library.json.bak', expect.anything());
    });

    it('treats a main file removed between existence check and read as absent', async () => {
        fsMocks.exists.mockImplementation(async (fileName: string) => fileName === 'library.json');
        fsMocks.readTextFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT: no such file or directory'), {
            code: 'ENOENT'
        }));
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const state = await new TauriFsRepository().load();

        expect(state.images).toEqual([]);
        expect(state.recentSearches).toEqual([]);
        expect(fsMocks.writeTextFile).not.toHaveBeenCalled();
    });

    it('returns defaults and logs malformed filesystem state', async () => {
        fsMocks.exists.mockImplementation(async (fileName: string) => fileName === 'library.json');
        fsMocks.readTextFile.mockResolvedValue('{invalid');
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const state = await new TauriFsRepository().load();

        expect(state.images).toEqual([]);
        expect(state.recentSearches).toEqual([]);
        expect(error).toHaveBeenCalledWith(
            '[TauriFsRepository] Failed to read library.json:',
            expect.any(Error)
        );
        error.mockRestore();
    });

    it('contains save failures and logs them', async () => {
        fsMocks.writeTextFile.mockRejectedValue(new Error('disk full'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { TauriFsRepository } = await import('../TauriFsRepository');

        await expect(new TauriFsRepository().save(stateFixture())).rejects.toThrow('disk full');

        expect(error).toHaveBeenCalledWith('Failed to save state to filesystem:', expect.any(Error));
        error.mockRestore();
    });

    it('restarts from the last committed state when the main write rejects', async () => {
        const previous = { ...stateFixture(), images: [], recentSearches: ['committed'] };
        const proposed = { ...previous, recentSearches: ['rejected'] };
        const files = new Map<string, string>([
            ['library.json', JSON.stringify(previous)],
            ['library.json.bak', JSON.stringify(previous)],
        ]);
        let rejectMain = true;
        fsMocks.exists.mockImplementation(async (fileName: string) => files.has(fileName));
        fsMocks.readTextFile.mockImplementation(async (fileName: string) => files.get(fileName));
        fsMocks.writeTextFile.mockImplementation(async (fileName: string, content: string) => {
            if (fileName === 'library.json' && rejectMain) {
                rejectMain = false;
                throw new Error('main unavailable');
            }
            files.set(fileName, content);
        });
        fsMocks.remove.mockImplementation(async (fileName: string) => {
            files.delete(fileName);
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { TauriFsRepository } = await import('../TauriFsRepository');

        await expect(new TauriFsRepository().save(proposed)).rejects.toThrow('main unavailable');
        expect(JSON.parse(files.get('library.json.pending') ?? '{}').phase).toBe('prepared');

        const restarted = await new TauriFsRepository().load();

        expect(restarted.recentSearches).toEqual(['committed']);
        expect(JSON.parse(files.get('library.json') ?? '{}').recentSearches).toEqual(['committed']);
        expect(files.has('library.json.pending')).toBe(false);
        error.mockRestore();
    });

    it('rolls back a materialized main write when the backup write rejects', async () => {
        const previous = { ...stateFixture(), images: [], recentSearches: ['committed'] };
        const proposed = { ...previous, recentSearches: ['rejected'] };
        const files = new Map<string, string>([
            ['library.json', JSON.stringify(previous)],
            ['library.json.bak', JSON.stringify(previous)],
        ]);
        let rejectBackup = true;
        fsMocks.exists.mockImplementation(async (fileName: string) => files.has(fileName));
        fsMocks.readTextFile.mockImplementation(async (fileName: string) => files.get(fileName));
        fsMocks.writeTextFile.mockImplementation(async (fileName: string, content: string) => {
            if (fileName === 'library.json.bak' && rejectBackup) {
                rejectBackup = false;
                throw new Error('backup unavailable');
            }
            files.set(fileName, content);
        });
        fsMocks.remove.mockImplementation(async (fileName: string) => {
            files.delete(fileName);
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { TauriFsRepository } = await import('../TauriFsRepository');

        await expect(new TauriFsRepository().save(proposed)).rejects.toThrow('backup unavailable');
        expect(JSON.parse(files.get('library.json') ?? '{}').recentSearches).toEqual(['rejected']);

        const restarted = await new TauriFsRepository().load();

        expect(restarted.recentSearches).toEqual(['committed']);
        expect(JSON.parse(files.get('library.json.bak') ?? '{}').recentSearches).toEqual(['committed']);
        expect(files.has('library.json.pending')).toBe(false);
        error.mockRestore();
    });

    it('rolls back both materialized copies when the commit marker rejects', async () => {
        const previous = { ...stateFixture(), images: [], recentSearches: ['committed'] };
        const proposed = { ...previous, recentSearches: ['rejected'] };
        const files = new Map<string, string>([
            ['library.json', JSON.stringify(previous)],
            ['library.json.bak', JSON.stringify(previous)],
        ]);
        let rejectCommit = true;
        fsMocks.exists.mockImplementation(async (fileName: string) => files.has(fileName));
        fsMocks.readTextFile.mockImplementation(async (fileName: string) => files.get(fileName));
        fsMocks.writeTextFile.mockImplementation(async (fileName: string, content: string) => {
            if (fileName === 'library.json.pending.commit' && rejectCommit) {
                rejectCommit = false;
                throw new Error('commit marker unavailable');
            }
            files.set(fileName, content);
        });
        fsMocks.remove.mockImplementation(async (fileName: string) => {
            files.delete(fileName);
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { TauriFsRepository } = await import('../TauriFsRepository');

        await expect(new TauriFsRepository().save(proposed)).rejects.toThrow('commit marker unavailable');
        expect(JSON.parse(files.get('library.json') ?? '{}').recentSearches).toEqual(['rejected']);
        expect(JSON.parse(files.get('library.json.bak') ?? '{}').recentSearches).toEqual(['rejected']);

        const restarted = await new TauriFsRepository().load();

        expect(restarted.recentSearches).toEqual(['committed']);
        expect(JSON.parse(files.get('library.json') ?? '{}').recentSearches).toEqual(['committed']);
        expect(JSON.parse(files.get('library.json.bak') ?? '{}').recentSearches).toEqual(['committed']);
        error.mockRestore();
    });

    it('recovers malformed main state from the last valid backup', async () => {
        const backup = { ...stateFixture(), images: [], settings: { ...stateFixture().settings, maskedKeywords: ['backup'] } };
        const files = new Map<string, string>([
            ['library.json', '{invalid'],
            ['library.json.bak', JSON.stringify(backup)],
        ]);
        fsMocks.exists.mockImplementation(async (fileName: string) => files.has(fileName));
        fsMocks.readTextFile.mockImplementation(async (fileName: string) => files.get(fileName));
        fsMocks.writeTextFile.mockImplementation(async (fileName: string, content: string) => {
            files.set(fileName, content);
        });
        fsMocks.remove.mockImplementation(async (fileName: string) => {
            files.delete(fileName);
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const state = await new TauriFsRepository().load();

        expect(state.settings.maskedKeywords).toEqual(['backup']);
        expect(JSON.parse(files.get('library.json') ?? '{}').settings.maskedKeywords).toEqual(['backup']);
        error.mockRestore();
    });

    it('ignores an invalid pending journal when the main file is recoverable', async () => {
        const main = {
            ...stateFixture(),
            images: [],
            settings: { ...stateFixture().settings, maskedKeywords: ['main'] }
        };
        const files = new Map<string, string>([
            ['library.json.pending', '{partial'],
            ['library.json', JSON.stringify(main)],
            ['library.json.bak', JSON.stringify(main)],
        ]);
        fsMocks.exists.mockImplementation(async (fileName: string) => files.has(fileName));
        fsMocks.readTextFile.mockImplementation(async (fileName: string) => files.get(fileName));
        fsMocks.remove.mockImplementation(async (fileName: string) => {
            files.delete(fileName);
        });
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { TauriFsRepository } = await import('../TauriFsRepository');

        const state = await new TauriFsRepository().load();

        expect(state.settings.maskedKeywords).toEqual(['main']);
        expect(files.has('library.json.pending')).toBe(false);
        expect(error).toHaveBeenCalledWith(
            '[TauriFsRepository] Ignoring invalid settings journal and trying committed state:',
            expect.any(Error)
        );
        error.mockRestore();
    });
});
