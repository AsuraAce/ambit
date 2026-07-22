import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    load: vi.fn(),
    listInvokeaiImages: vi.fn(),
    refreshInvokeOwnerScope: vi.fn(),
    reconcileInvokeSourceFacts: vi.fn(),
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

const discovery = {
    schemaMode: 'multi_user' as const,
    dbPath: 'D:/Invoke/databases/invokeai.db',
    imagesRoot: 'D:/Invoke',
    owners: [{ ownerId: 'owner-a', displayName: 'Artemis', imageCount: 2 }],
    unassignedImageCount: 0,
};

describe('applyInvokeOwnerScope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.load.mockResolvedValue({
            select: vi.fn().mockResolvedValue([{ name: 'image_name' }, { name: 'user_id' }]),
        });
        mocks.reconcileInvokeSourceFacts.mockResolvedValue(3);
        mocks.refreshInvokeOwnerScope.mockResolvedValue({
            status: 'ok',
            data: { changed: true, activeUpdated: 2, removedUpdated: 1 },
        });
    });

    it('reconciles authoritative source facts before applying durable owner visibility', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');
        const result = await applyInvokeOwnerScope({
            discovery,
            selection: { dbPath: discovery.dbPath, mode: 'owner', ownerId: 'owner-a' },
        });

        expect(mocks.reconcileInvokeSourceFacts).toHaveBeenCalledOnce();
        expect(mocks.refreshInvokeOwnerScope).toHaveBeenCalledWith({
            dbPath: discovery.dbPath,
            imagesRoot: discovery.imagesRoot,
            mode: 'owner',
            ownerId: 'owner-a',
        });
        expect(mocks.reconcileInvokeSourceFacts.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.refreshInvokeOwnerScope.mock.invocationCallOrder[0]);
        expect(result).toEqual({
            changed: true,
            sourceFactsUpdated: 3,
            activeVisibilityUpdated: 2,
            removedVisibilityUpdated: 1,
            mode: 'owner',
        });
    });

    it('uses fail-closed unselected mode and preserves legacy unscoped behavior', async () => {
        const { applyInvokeOwnerScope } = await import('../ownerScope');

        await applyInvokeOwnerScope({ discovery });
        expect(mocks.refreshInvokeOwnerScope).toHaveBeenLastCalledWith(expect.objectContaining({
            mode: 'unselected',
            ownerId: null,
        }));

        await applyInvokeOwnerScope({
            discovery: { ...discovery, schemaMode: 'legacy', owners: [] },
        });
        expect(mocks.refreshInvokeOwnerScope).toHaveBeenLastCalledWith(expect.objectContaining({
            mode: 'legacy',
            ownerId: null,
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
