import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../../../bindings';
import { createInvokeImagePathResolver } from '../pathResolver';
import { reconcileInvokeSourceFacts } from '../sourceReconciliation';

const reconcileInvokeImageSources = vi.hoisted(() => vi.fn());

vi.mock('../../../bindings', () => ({
    commands: { reconcileInvokeImageSources },
}));

const root = 'D:/InvokeAI';

const createDb = (rows: Array<{
    image_name: string;
    image_subfolder?: string | null;
    image_category?: string | null;
    image_origin?: string | null;
}>) => ({
    select: vi.fn(async (query: string) => {
        if (query.includes('SELECT count(*) as count FROM images')) {
            return [{ count: rows.length }];
        }
        if (query.includes('FROM images i')) {
            return rows;
        }
        return [];
    }),
});

describe('reconcileInvokeSourceFacts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        reconcileInvokeImageSources.mockImplementation(async (updates: unknown[]) => ({
            status: 'ok',
            data: { activeUpdated: updates.length, removedUpdated: 1 },
        }));
    });

    it('lets canonical paths win and only emits an unclaimed unique legacy alias', async () => {
        const db = createDb([
            {
                image_name: 'shared.png',
                image_subfolder: null,
                image_category: 'general',
                image_origin: 'internal',
            },
            {
                image_name: 'shared.png',
                image_subfolder: 'references',
                image_category: 'control',
                image_origin: 'external',
            },
            {
                image_name: 'pose.png',
                image_subfolder: 'references',
                image_category: 'control',
                image_origin: 'external',
            },
        ]);
        const pathResolver = createInvokeImagePathResolver(root, async () => [
            'outputs/images/shared.png',
            'outputs/images/references/shared.png',
            'outputs/images/references/pose.png',
        ]);

        const updated = await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(['image_subfolder', 'image_category', 'image_origin']),
            pathResolver,
            onProgress: vi.fn(),
        });

        expect(commands.reconcileInvokeImageSources).toHaveBeenCalledOnce();
        const updates = reconcileInvokeImageSources.mock.calls[0][0];
        expect(updates).toEqual(expect.arrayContaining([
            {
                id: `${root}/outputs/images/shared.png`,
                invokeImageName: 'shared.png',
                invokeImageCategory: 'general',
                invokeImageOrigin: 'internal',
            },
            {
                id: `${root}/outputs/images/references/shared.png`,
                invokeImageName: 'shared.png',
                invokeImageCategory: 'control',
                invokeImageOrigin: 'external',
            },
            {
                id: `${root}/outputs/images/references/pose.png`,
                invokeImageName: 'pose.png',
                invokeImageCategory: 'control',
                invokeImageOrigin: 'external',
            },
            {
                id: `${root}/outputs/images/pose.png`,
                invokeImageName: 'pose.png',
                invokeImageCategory: 'control',
                invokeImageOrigin: 'external',
            },
        ]));
        expect(updates).toHaveLength(4);
        expect(updated).toBe(5);
    });

    it('clears stale optional source facts when the InvokeAI columns are absent', async () => {
        const db = createDb([{ image_name: 'asset.png' }]);
        const pathResolver = createInvokeImagePathResolver(root, async () => [
            'outputs/images/asset.png',
        ]);

        await reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(),
            pathResolver,
            onProgress: vi.fn(),
        });

        expect(reconcileInvokeImageSources).toHaveBeenCalledWith([{
            id: `${root}/outputs/images/asset.png`,
            invokeImageName: 'asset.png',
            invokeImageCategory: null,
            invokeImageOrigin: null,
        }]);
        const factQuery = db.select.mock.calls
            .map(call => call[0])
            .find(query => query.includes('NULL AS image_category'));
        expect(factQuery).toContain('NULL AS image_origin');
    });

    it('stops before writing when cancelled', async () => {
        const db = createDb([{ image_name: 'asset.png' }]);
        const controller = new AbortController();
        controller.abort();

        await expect(reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(),
            pathResolver: createInvokeImagePathResolver(root, async () => []),
            onProgress: vi.fn(),
            signal: controller.signal,
        })).rejects.toThrow('Aborted');
        expect(reconcileInvokeImageSources).not.toHaveBeenCalled();
    });

    it('propagates native reconciliation failures', async () => {
        reconcileInvokeImageSources.mockResolvedValueOnce({
            status: 'error',
            error: 'database unavailable',
        });
        const db = createDb([{ image_name: 'asset.png' }]);

        await expect(reconcileInvokeSourceFacts({
            db: db as never,
            columns: new Set(),
            pathResolver: createInvokeImagePathResolver(root, async () => [
                'outputs/images/asset.png',
            ]),
            onProgress: vi.fn(),
        })).rejects.toBe('database unavailable');
    });
});
