import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    load: vi.fn(),
    listInvokeaiImages: vi.fn(),
    refreshInvokeOwnerScope: vi.fn(),
    reconcileInvokeSourceFacts: vi.fn(),
    fetchBoards: vi.fn(),
    upsertInvokeBoardCollections: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: mocks.load } }));
vi.mock('../../../bindings', () => ({
    commands: {
        listInvokeaiImages: mocks.listInvokeaiImages,
        refreshInvokeOwnerScope: mocks.refreshInvokeOwnerScope,
    },
}));
vi.mock('../sourceReconciliation', () => ({
    reconcileInvokeSourceFacts: mocks.reconcileInvokeSourceFacts,
}));
vi.mock('../connection', () => ({
    fetchBoards: mocks.fetchBoards,
}));
vi.mock('../../db/collectionRepo', () => ({
    upsertInvokeBoardCollections: mocks.upsertInvokeBoardCollections,
}));

const discovery = {
    schemaMode: 'multi_user' as const,
    dbPath: 'D:/Invoke/databases/invokeai.db',
    imagesRoot: 'D:/Invoke',
    owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 2 }],
    unassignedImageCount: 0,
};

const restoredCacheResult = {
    cacheStatus: {
        state: 'ready' as const,
        generation: 0,
        builtGeneration: 0,
        facetCount: 10,
        collectionCount: 2,
    },
    cacheRepair: {
        action: 'restored' as const,
        resources: {
            checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
            controlNets: [], ipAdapters: [], tools: [],
        },
        facetTypes: [],
        collectionsDirty: false,
    },
};

describe('applyInvokeOwnerScope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.load.mockResolvedValue({
            select: vi.fn().mockResolvedValue([{ name: 'image_name' }, { name: 'user_id' }]),
        });
        mocks.reconcileInvokeSourceFacts.mockResolvedValue(3);
        mocks.fetchBoards.mockResolvedValue({ boards: new Map(), isAuthoritative: true });
        mocks.upsertInvokeBoardCollections.mockResolvedValue(0);
        mocks.refreshInvokeOwnerScope.mockResolvedValue({
            status: 'ok',
            data: { changed: true, activeUpdated: 2, removedUpdated: 1, ...restoredCacheResult },
        });
    });

    it('reconciles authoritative source facts before applying durable owner visibility', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        const onProgress = vi.fn();
        const result = await applyInvokeOwnerScope({
            discovery,
            selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            reconcileSourceFacts: true,
            onProgress,
        });

        expect(mocks.reconcileInvokeSourceFacts).toHaveBeenCalledOnce();
        expect(mocks.refreshInvokeOwnerScope).toHaveBeenCalledWith({
            dbPath: discovery.dbPath,
            imagesRoot: discovery.imagesRoot,
            mode: 'owner',
            ownerId: 'owner-a',
            forceRefresh: true,
        });
        expect(mocks.reconcileInvokeSourceFacts.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.refreshInvokeOwnerScope.mock.invocationCallOrder[0]);
        const reconciliationProgress = mocks.reconcileInvokeSourceFacts.mock.calls[0][0].onProgress;
        reconciliationProgress(1, 2, 'Reconciling sources: 1 / 2');
        expect(onProgress).toHaveBeenCalledWith(1, 2, 'Reconciling sources: 1 / 2');
        expect(onProgress).toHaveBeenCalledWith(0, 0, 'Applying InvokeAI visibility...');
        expect(result).toEqual({
            changed: true,
            sourceFactsUpdated: 3,
            activeVisibilityUpdated: 2,
            removedVisibilityUpdated: 1,
            boardCollectionsUpdated: 0,
            boardScopeWarning: undefined,
            mode: 'owner',
            ...restoredCacheResult,
        });
    });

    it('repairs board owner metadata even when no image rows need syncing', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        mocks.fetchBoards.mockResolvedValueOnce({
            isAuthoritative: true,
            boards: new Map([[
                'board-a',
                { name: 'Board A', createdAt: 123, ownerId: 'owner-a' },
            ]]),
        });
        mocks.upsertInvokeBoardCollections.mockResolvedValueOnce(1);
        mocks.refreshInvokeOwnerScope.mockResolvedValueOnce({
            status: 'ok',
            data: { changed: false, activeUpdated: 0, removedUpdated: 0, ...restoredCacheResult },
        });

        const result = await applyInvokeOwnerScope({
            discovery,
            selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            reconcileBoardOwners: true,
        });

        expect(mocks.reconcileInvokeSourceFacts).not.toHaveBeenCalled();
        expect(mocks.upsertInvokeBoardCollections).toHaveBeenCalledWith([{
            id: 'board-a',
            name: 'Board A',
            createdAt: 123,
            invokeOwnerId: 'owner-a',
            invokeSourceId: discovery.dbPath,
        }]);
        expect(result.changed).toBe(true);
        expect(result.boardCollectionsUpdated).toBe(1);
    });

    it('keeps owner-scoped boards fail-closed when board ownership is unavailable', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        mocks.fetchBoards.mockResolvedValueOnce({
            isAuthoritative: false,
            boards: new Map(),
        });

        const result = await applyInvokeOwnerScope({
            discovery,
            selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            reconcileBoardOwners: true,
        });

        expect(mocks.upsertInvokeBoardCollections).not.toHaveBeenCalled();
        expect(result.boardScopeWarning).toMatch(/remain hidden/i);
        expect(result.boardCollectionsUpdated).toBe(0);
    });

    it('uses fail-closed unselected mode and preserves legacy unscoped behavior', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');

        await applyInvokeOwnerScope({ discovery });
        expect(mocks.reconcileInvokeSourceFacts).not.toHaveBeenCalled();
        expect(mocks.refreshInvokeOwnerScope).toHaveBeenLastCalledWith(expect.objectContaining({
            mode: 'unselected',
            ownerId: null,
        }));

        await applyInvokeOwnerScope({
            discovery: { ...discovery, schemaMode: 'legacy', owners: [] },
            reconcileSourceFacts: true,
        });
        expect(mocks.reconcileInvokeSourceFacts).toHaveBeenCalledOnce();
        expect(mocks.refreshInvokeOwnerScope).toHaveBeenLastCalledWith(expect.objectContaining({
            mode: 'legacy',
            ownerId: null,
            forceRefresh: true,
        }));
    });

    it('revalidates visibility after reconciliation even when source facts were already repaired', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        mocks.reconcileInvokeSourceFacts.mockResolvedValueOnce(0);
        mocks.refreshInvokeOwnerScope.mockResolvedValueOnce({
            status: 'ok',
            data: { changed: false, activeUpdated: 0, removedUpdated: 0, ...restoredCacheResult },
        });

        await applyInvokeOwnerScope({
            discovery,
            selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            reconcileSourceFacts: true,
        });

        expect(mocks.refreshInvokeOwnerScope).toHaveBeenCalledWith(expect.objectContaining({
            forceRefresh: true,
        }));
    });

    it('rejects a selection bound to a different Invoke database before opening either database', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');

        await expect(applyInvokeOwnerScope({
            discovery,
            selection: { dbPath: 'D:/Other/invokeai.db', mode: 'all' },
        })).rejects.toThrow('different database');
        expect(mocks.load).not.toHaveBeenCalled();
        expect(mocks.refreshInvokeOwnerScope).not.toHaveBeenCalled();
    });
});
