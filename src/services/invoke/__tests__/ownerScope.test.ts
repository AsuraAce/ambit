import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    recordStartupDiagnostic: vi.fn().mockResolvedValue(undefined),
    load: vi.fn(),
    listInvokeaiImages: vi.fn(),
    refreshInvokeOwnerScope: vi.fn(),
    setInvokeBoardVerification: vi.fn(),
    reconcileInvokeSourceFacts: vi.fn(),
    fetchBoards: vi.fn(),
    getInvokeSourceDatabase: vi.fn(),
    reconcileInvokeBoardSnapshot: vi.fn(),
    hasInvokeBoardCollectionsForSource: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: mocks.load } }));
vi.mock('../../../bindings', () => ({
    commands: {
        getStartupLaunch: vi.fn().mockResolvedValue({ launchId: 'a0', processElapsedMs: 0 }),
        recordStartupDiagnostic: mocks.recordStartupDiagnostic,
        listInvokeaiImages: mocks.listInvokeaiImages,
        refreshInvokeOwnerScope: mocks.refreshInvokeOwnerScope,
        setInvokeBoardVerification: mocks.setInvokeBoardVerification,
    },
}));
vi.mock('../../runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('../sourceReconciliation', () => ({
    reconcileInvokeSourceFacts: mocks.reconcileInvokeSourceFacts,
}));
vi.mock('../connection', () => ({
    fetchBoards: mocks.fetchBoards,
    getInvokeSourceDatabase: mocks.getInvokeSourceDatabase,
}));
vi.mock('../../db/collectionRepo', () => ({
    reconcileInvokeBoardSnapshot: mocks.reconcileInvokeBoardSnapshot,
    hasInvokeBoardCollectionsForSource: mocks.hasInvokeBoardCollectionsForSource,
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
    it.each(['failed', 'cancelled'] as const)('finishes the repair report as %s without masking the business rejection', async (status) => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        const { startupDiagnostics } = await import('../../../utils/startupDiagnostics');
        const { createStartupRepairCollector } = await import('../../../utils/startupRepairDiagnostics');
        const report = vi.fn();
        const collector = createStartupRepairCollector({ now: () => 0, stage: vi.fn(), report });
        const claim = vi.spyOn(startupDiagnostics, 'claimRepair').mockReturnValueOnce(collector);
        const controller = new AbortController();
        const failure = new Error('private repair failure');
        mocks.reconcileInvokeSourceFacts.mockImplementationOnce(async () => {
            if (status === 'cancelled') controller.abort();
            throw failure;
        });
        try {
            await expect(applyInvokeOwnerScope({
                discovery, selection: { dbPath: discovery.dbPath, mode: 'all' },
                reconcileSourceFacts: true, signal: controller.signal,
            })).rejects.toBe(failure);
            expect(report).toHaveBeenCalledTimes(1);
            expect(report.mock.calls[0][0].status).toBe(status);
            expect(JSON.stringify(report.mock.calls)).not.toContain('private');
            expect(mocks.refreshInvokeOwnerScope).not.toHaveBeenCalled();
        } finally { claim.mockRestore(); }
    });
    it('persists the failing native visibility stage without exposing owner data', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        mocks.refreshInvokeOwnerScope.mockResolvedValue({ status: 'error', error: 'database is locked' });
        await expect(applyInvokeOwnerScope({
            discovery, selection: { dbPath: discovery.dbPath, mode: 'all' },
        })).rejects.toBe('database is locked');
        expect(mocks.recordStartupDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
            phase: 'owner-visibility', status: 'failed', databaseRole: 'ambit', failureKind: 'database-busy',
        }));
        expect(JSON.stringify(mocks.recordStartupDiagnostic.mock.calls)).not.toMatch(/Artemis|Invoke\/databases|owner-a/);
    });
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.load.mockResolvedValue({
            select: vi.fn().mockResolvedValue([{ name: 'image_name' }, { name: 'user_id' }]),
        });
        mocks.getInvokeSourceDatabase.mockImplementation((path: string) => mocks.load(`sqlite:${path}`));
        mocks.setInvokeBoardVerification.mockResolvedValue({ status: 'ok', data: null });
        mocks.reconcileInvokeSourceFacts.mockResolvedValue(3);
        mocks.fetchBoards.mockResolvedValue({ boards: new Map(), isAuthoritative: true });
        mocks.hasInvokeBoardCollectionsForSource.mockResolvedValue(false);
        mocks.reconcileInvokeBoardSnapshot.mockResolvedValue({
            collectionsUpdated: 0,
            collectionsDeleted: 0,
            imagesUpdated: 0,
            membershipsDeleted: 0,
            membershipsInserted: 0,
        });
        mocks.refreshInvokeOwnerScope.mockResolvedValue({
            status: 'ok',
            data: { changed: true, activeUpdated: 2, removedUpdated: 1, ...restoredCacheResult },
        });
    });

    it('verifies saved collections hidden by owner gates without syncing their contents when boards are disabled', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        mocks.hasInvokeBoardCollectionsForSource.mockResolvedValue(true);
        mocks.fetchBoards.mockResolvedValue({ boards: new Map([
            ['board-a', { name: 'Source changed', createdAt: 123, ownerId: 'owner-a' }],
        ]), isAuthoritative: true });
        let settle!: () => void;
        mocks.reconcileInvokeBoardSnapshot.mockImplementationOnce(() => new Promise(resolve => {
            settle = () => resolve({ collectionsUpdated: 1, collectionsDeleted: 0 });
        }));
        const operation = applyInvokeOwnerScope({
            discovery, selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            reconcileBoardOwners: false,
        });
        await vi.waitFor(() => expect(mocks.reconcileInvokeBoardSnapshot).toHaveBeenCalledOnce());
        expect(mocks.hasInvokeBoardCollectionsForSource).toHaveBeenCalledWith(discovery.dbPath);
        expect(mocks.reconcileInvokeBoardSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            dbPath: discovery.dbPath, mode: 'all', ownerId: null, ownershipOnly: true,
            memberships: [], reconcileMemberships: false, deleteMissingCollections: false,
        }));
        expect(mocks.setInvokeBoardVerification).not.toHaveBeenCalled();
        settle();
        await operation;
        expect(mocks.setInvokeBoardVerification).toHaveBeenCalledWith(discovery.dbPath, 'owner-a', true);
    });

    it('does not admit disabled-sync collections when the ownership transaction fails', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        mocks.hasInvokeBoardCollectionsForSource.mockResolvedValue(true);
        mocks.reconcileInvokeBoardSnapshot.mockRejectedValueOnce(new Error('ownership write failed'));
        await expect(applyInvokeOwnerScope({
            discovery, selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            reconcileBoardOwners: false,
        })).rejects.toThrow('ownership write failed');
        expect(mocks.setInvokeBoardVerification).not.toHaveBeenCalled();
        expect(mocks.refreshInvokeOwnerScope).not.toHaveBeenCalled();
    });

    it('keeps disabled-sync collections guarded if the source cannot verify board ownership', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        mocks.hasInvokeBoardCollectionsForSource.mockResolvedValue(true);
        mocks.fetchBoards.mockResolvedValueOnce({ boards: new Map(), isAuthoritative: false });
        const result = await applyInvokeOwnerScope({
            discovery, selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            reconcileBoardOwners: false,
        });
        expect(mocks.reconcileInvokeBoardSnapshot).not.toHaveBeenCalled();
        expect(mocks.setInvokeBoardVerification).toHaveBeenCalledWith(discovery.dbPath, 'owner-a', false);
        expect(result.boardScopeWarning).toMatch(/remain hidden/i);
    });

    it('does not read board mappings with sync disabled when no saved collections need verification', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        await applyInvokeOwnerScope({
            discovery, selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
            reconcileBoardOwners: false,
        });
        expect(mocks.hasInvokeBoardCollectionsForSource).toHaveBeenCalledWith(discovery.dbPath);
        expect(mocks.fetchBoards).not.toHaveBeenCalled();
        expect(mocks.reconcileInvokeBoardSnapshot).not.toHaveBeenCalled();
        expect(mocks.setInvokeBoardVerification).not.toHaveBeenCalled();
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
        mocks.reconcileInvokeBoardSnapshot.mockResolvedValueOnce({
            collectionsUpdated: 1,
            collectionsDeleted: 0,
            imagesUpdated: 0,
            membershipsDeleted: 0,
            membershipsInserted: 0,
        });
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
        expect(mocks.reconcileInvokeBoardSnapshot).toHaveBeenCalledWith({
            dbPath: discovery.dbPath,
            mode: 'all',
            ownerId: null,
            boards: [{
                id: 'board-a',
                name: 'Board A',
                createdAt: 123,
                ownerId: 'owner-a',
            }],
            memberships: [],
            reconcileMemberships: false,
            deleteMissingCollections: false,
        });
        expect(mocks.setInvokeBoardVerification).toHaveBeenCalledWith(
            discovery.dbPath,
            'owner-a',
            true
        );
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

        expect(mocks.reconcileInvokeBoardSnapshot).not.toHaveBeenCalled();
        expect(mocks.setInvokeBoardVerification).toHaveBeenCalledWith(
            discovery.dbPath,
            'owner-a',
            false
        );
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

    it('does not begin preparation when cancellation was already requested', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        const controller = new AbortController();
        controller.abort();

        await expect(applyInvokeOwnerScope({
            discovery,
            selection: { dbPath: discovery.dbPath, mode: 'all' },
            reconcileSourceFacts: true,
            reconcileBoardOwners: true,
            signal: controller.signal,
        })).rejects.toThrow('Aborted');

        expect(mocks.getInvokeSourceDatabase).not.toHaveBeenCalled();
        expect(mocks.reconcileInvokeSourceFacts).not.toHaveBeenCalled();
        expect(mocks.refreshInvokeOwnerScope).not.toHaveBeenCalled();
    });

    it.each(['board-write', 'visibility', 'board-verification'] as const)(
        'waits for %s to settle on cancellation without starting a later preparation stage',
        async stage => {
            const { applyInvokeOwnerScope } = await import('../ownerScope');
            const controller = new AbortController();
            let releaseWrite!: () => void;
            const pendingWrite = new Promise<void>(resolve => { releaseWrite = resolve; });
            const writeStarted = vi.fn();
            const writeSettled = vi.fn();
            const completeWrite = async () => {
                writeStarted();
                await pendingWrite;
                writeSettled();
            };
            if (stage === 'board-write') {
                mocks.reconcileInvokeBoardSnapshot.mockImplementationOnce(async () => {
                    await completeWrite();
                    return { collectionsUpdated: 1, collectionsDeleted: 0 };
                });
            } else if (stage === 'visibility') {
                mocks.refreshInvokeOwnerScope.mockImplementationOnce(async () => {
                    await completeWrite();
                    return { status: 'ok', data: { changed: true, activeUpdated: 1, removedUpdated: 0, ...restoredCacheResult } };
                });
            } else {
                mocks.setInvokeBoardVerification.mockImplementationOnce(async () => {
                    await completeWrite();
                    return { status: 'ok', data: null };
                });
            }
            const settled = vi.fn();
            const operation = applyInvokeOwnerScope({
                discovery,
                selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
                reconcileBoardOwners: true,
                signal: controller.signal,
            }).finally(settled);
            const rejection = expect(operation).rejects.toThrow('Aborted');
            await vi.waitFor(() => expect(writeStarted).toHaveBeenCalledOnce());
            controller.abort();
            await Promise.resolve();
            expect(settled).not.toHaveBeenCalled();

            releaseWrite();
            await rejection;

            expect(writeSettled).toHaveBeenCalledOnce();
            if (stage === 'board-write') expect(mocks.refreshInvokeOwnerScope).not.toHaveBeenCalled();
            if (stage !== 'board-verification') expect(mocks.setInvokeBoardVerification).not.toHaveBeenCalled();
        }
    );
});
