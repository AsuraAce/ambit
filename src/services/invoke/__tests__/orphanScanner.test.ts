import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from '@tauri-apps/plugin-sql';
import { commands } from '../../../bindings';
import { getDb } from '../../db/connection';
import { insertImagesBatch } from '../../db/imageRepo';
import { scanForOrphans } from '../orphanScanner';

vi.mock('@tauri-apps/plugin-sql', () => ({
    default: {
        load: vi.fn()
    }
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((path: string) => `asset://${path}`)
}));

vi.mock('../../../bindings', () => ({
    commands: {
        listInvokeaiImages: vi.fn(),
        scanImagesBulk: vi.fn()
    }
}));

vi.mock('../../db/connection', () => ({
    getDb: vi.fn()
}));

vi.mock('../../db/imageRepo', () => ({
    insertImagesBatch: vi.fn()
}));

const createDb = (rows: Array<{ image_name: string, image_subfolder?: string | null }> = [], columns: string[] = []) => ({
    select: vi.fn(async (query: string) => {
        if (query.includes('PRAGMA table_info(images)')) {
            return columns.map(name => ({ name }));
        }
        return rows;
    })
});

describe('scanForOrphans', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getDb).mockResolvedValue({
            select: vi.fn().mockResolvedValue([])
        } as never);
        vi.mocked(Database.load).mockResolvedValue(createDb() as never);
        vi.mocked(commands.scanImagesBulk).mockImplementation(async (paths: string[]) => ({
            status: 'ok',
            data: paths.map((path) => ({
                width: 512,
                height: 512,
                size: 123,
                modified: 1000,
                thumbnail: path,
                microThumbnail: null,
                thumbnailSource: null,
                chunks: {},
                metadata: {
                    tool: 'InvokeAI',
                    model: 'Model',
                    seed: 1,
                    steps: 20,
                    cfg: 7,
                    positivePrompt: 'prompt',
                    negativePrompt: '',
                    sampler: 'Euler',
                    loras: [],
                    controlNets: []
                },
                error: null
            }))
        }) as never);
        vi.mocked(insertImagesBatch).mockResolvedValue(undefined as never);
    });

    it('imports nested orphan files while skipping DB-synced and intermediate entries', async () => {
        vi.mocked(Database.load).mockResolvedValue(createDb([
            { image_name: 'intermediate.png' },
            { image_name: '' },
        ]) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: [
                'outputs/images/2026/05/25/new.png',
                'outputs/images/2026/05/25/already.png',
                'outputs/images/txt2img/intermediate.png'
            ]
        } as never);

        const imported = await scanForOrphans(
            'D:/Invoke',
            new Set(['outputs/images/2026/05/25/already.png']),
            vi.fn()
        );

        expect(imported).toBe(1);
        expect(commands.scanImagesBulk).toHaveBeenCalledWith(
            ['D:/Invoke/outputs/images/2026/05/25/new.png'],
            null,
            true,
            false,
            null,
            null
        );
        expect(vi.mocked(insertImagesBatch).mock.calls[0][0][0]).toEqual(expect.objectContaining({
            id: 'D:/Invoke/outputs/images/2026/05/25/new.png',
            filename: 'new.png'
        }));
    });

    it('uses the current time when an orphan has no modified timestamp', async () => {
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: ['outputs/images/new.png'],
        } as never);
        vi.mocked(commands.scanImagesBulk).mockResolvedValue({
            status: 'ok',
            data: [{
                width: 1,
                height: 1,
                size: 1,
                modified: 0,
                thumbnail: null,
                metadata: { model: 'Model' },
            }],
        } as never);

        await scanForOrphans('D:/Invoke', new Set(), vi.fn(), { importIntermediates: true });

        expect(vi.mocked(insertImagesBatch).mock.calls[0][0][0].timestamp).toBeGreaterThan(0);
    });

    it('matches intermediate rows by relative nested path', async () => {
        vi.mocked(Database.load).mockResolvedValue(createDb([{ image_name: '2026/05/25/intermediate.png' }]) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: ['outputs/images/2026/05/25/intermediate.png']
        } as never);

        const imported = await scanForOrphans('D:/Invoke', new Set(), vi.fn(), { importIntermediates: false });

        expect(imported).toBe(0);
        expect(commands.scanImagesBulk).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('matches intermediate rows by InvokeAI image_subfolder plus basename', async () => {
        vi.mocked(Database.load).mockResolvedValue(createDb(
            [{ image_name: 'intermediate.png', image_subfolder: '2026/05/25' }],
            ['image_subfolder']
        ) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: ['outputs/images/2026/05/25/intermediate.png']
        } as never);

        const imported = await scanForOrphans('D:/Invoke', new Set(), vi.fn(), { importIntermediates: false });

        expect(imported).toBe(0);
        expect(commands.scanImagesBulk).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('does not suppress nested orphan files just because another synced file shares the basename', async () => {
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: [
                'outputs/images/2026/05/25/foo.png',
                'outputs/images/txt2img/foo.png'
            ]
        } as never);

        const imported = await scanForOrphans(
            'D:/Invoke',
            new Set(['outputs/images/2026/05/25/foo.png']),
            vi.fn(),
            { importIntermediates: false }
        );

        expect(imported).toBe(1);
        expect(commands.scanImagesBulk).toHaveBeenCalledWith(
            ['D:/Invoke/outputs/images/txt2img/foo.png'],
            null,
            true,
            false,
            null,
            null
        );
        expect(vi.mocked(insertImagesBatch).mock.calls[0][0][0]).toEqual(expect.objectContaining({
            id: 'D:/Invoke/outputs/images/txt2img/foo.png',
            filename: 'foo.png'
        }));
    });

    it('does not suppress a different folder when the intermediate row has a path-specific nested name', async () => {
        vi.mocked(Database.load).mockResolvedValue(createDb([{ image_name: '2026/05/25/foo.png' }]) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: [
                'outputs/images/2026/05/25/foo.png',
                'outputs/images/txt2img/foo.png'
            ]
        } as never);

        const imported = await scanForOrphans('D:/Invoke', new Set(), vi.fn(), { importIntermediates: false });

        expect(imported).toBe(1);
        expect(commands.scanImagesBulk).toHaveBeenCalledWith(
            ['D:/Invoke/outputs/images/txt2img/foo.png'],
            null,
            true,
            false,
            null,
            null
        );
    });

    it('keeps basename-only matching for legacy intermediate rows without path truth', async () => {
        vi.mocked(Database.load).mockResolvedValue(createDb([{ image_name: 'legacy-intermediate.png' }]) as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: ['outputs/images/txt2img/legacy-intermediate.png']
        } as never);

        const imported = await scanForOrphans('D:/Invoke', new Set(), vi.fn(), { importIntermediates: false });

        expect(imported).toBe(0);
        expect(commands.scanImagesBulk).not.toHaveBeenCalled();
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('uses a database-file root and continues when intermediate lookup fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(Database.load).mockRejectedValue(new Error('database locked'));
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: ['outputs/images/new.png']
        } as never);

        const imported = await scanForOrphans(
            'D:\\Invoke\\databases\\invokeai.db',
            new Set(),
            vi.fn(),
            { importIntermediates: false }
        );

        expect(imported).toBe(1);
        expect(Database.load).toHaveBeenCalledWith('sqlite:D:/Invoke/databases/invokeai.db');
        expect(commands.listInvokeaiImages).toHaveBeenCalledWith('D:\\Invoke');
        expect(error).toHaveBeenCalledWith(
            '[Hybrid Sync] ERROR loading intermediates:',
            expect.any(Error)
        );
        error.mockRestore();
    });

    it('normalizes a databases directory and allows importing intermediates on request', async () => {
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: ['outputs/images/intermediate.png']
        } as never);
        vi.mocked(commands.scanImagesBulk).mockResolvedValue({
            status: 'ok',
            data: [{
                width: 64,
                height: 64,
                size: 10,
                modified: 0,
                thumbnail: null,
                metadata: { isIntermediate: true }
            }]
        } as never);

        const imported = await scanForOrphans(
            'D:/Invoke/databases',
            new Set(),
            vi.fn(),
            { importIntermediates: true }
        );

        expect(Database.load).not.toHaveBeenCalled();
        expect(commands.listInvokeaiImages).toHaveBeenCalledWith('D:/Invoke');
        expect(imported).toBe(1);
        expect(vi.mocked(insertImagesBatch).mock.calls[0][0][0]).toMatchObject({
            thumbnailUrl: 'D:/Invoke/outputs/images/intermediate.png',
            timestamp: expect.any(Number),
            metadata: {
                tool: 'InvokeAI',
                model: 'Unknown',
                seed: undefined,
                steps: 0,
                cfg: 0,
                positivePrompt: '',
                negativePrompt: '',
                sampler: '',
                loras: [],
                controlNets: [],
                workflowJson: undefined,
                rawParameters: undefined,
                isIntermediate: true
            }
        });
    });

    it('returns zero when disk listing fails or produces no files', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(commands.listInvokeaiImages)
            .mockRejectedValueOnce(new Error('scope denied'))
            .mockResolvedValueOnce({ status: 'ok', data: [] } as never);
        const progress = vi.fn();

        await expect(scanForOrphans('D:/Invoke/', new Set(), progress, { importIntermediates: true }))
            .resolves.toBe(0);
        await expect(scanForOrphans('D:/Invoke', new Set(), progress, { importIntermediates: true }))
            .resolves.toBe(0);

        expect(error).toHaveBeenCalledWith('[OrphanScan] Failed to list images on disk:', expect.any(Error));
        expect(commands.scanImagesBulk).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('skips malformed, intermediate, and concurrently inserted scan rows', async () => {
        vi.mocked(getDb).mockResolvedValue({
            select: vi.fn().mockResolvedValue([{ id: 'D:/Invoke/outputs/images/existing.png' }])
        } as never);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({
            status: 'ok',
            data: [
                'outputs/images/missing.png',
                'outputs/images/zero.png',
                'outputs/images/intermediate.png',
                'outputs/images/existing.png'
            ]
        } as never);
        vi.mocked(commands.scanImagesBulk).mockResolvedValue({
            status: 'ok',
            data: [
                null,
                { width: 0, metadata: null },
                { width: 10, metadata: { isIntermediate: true } },
                { width: 10, metadata: {} }
            ]
        } as never);

        await expect(scanForOrphans('D:/Invoke', new Set(), vi.fn(), { importIntermediates: false }))
            .resolves.toBe(0);
        expect(insertImagesBatch).not.toHaveBeenCalled();
    });

    it('continues after a failed chunk and reports progress for every chunk', async () => {
        const files = Array.from({ length: 101 }, (_, index) => `outputs/images/${index}.png`);
        vi.mocked(commands.listInvokeaiImages).mockResolvedValue({ status: 'ok', data: files } as never);
        vi.mocked(commands.scanImagesBulk)
            .mockRejectedValueOnce(new Error('batch failed'))
            .mockImplementationOnce(async (paths: string[]) => ({
                status: 'ok',
                data: paths.map(() => ({
                    width: 1,
                    height: 1,
                    size: 1,
                    modified: 1,
                    thumbnail: null,
                    metadata: null
                }))
            }) as never);
        const progress = vi.fn();

        await expect(scanForOrphans('D:/Invoke', new Set(), progress, { importIntermediates: true }))
            .resolves.toBe(1);
        expect(commands.scanImagesBulk).toHaveBeenCalledTimes(2);
        expect(progress).toHaveBeenCalledWith('Importing untracked files...', 0, 101);
        expect(progress).toHaveBeenLastCalledWith('Importing untracked files...', 1, 101);
    });
});
