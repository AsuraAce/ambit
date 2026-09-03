import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDb: vi.fn(),
    isBrowserMockMode: vi.fn(),
}));

vi.mock('../connection', () => ({ getDb: mocks.getDb }));
vi.mock('../../runtime', () => ({ isBrowserMockMode: mocks.isBrowserMockMode }));

describe('invokeReferenceRepo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isBrowserMockMode.mockReturnValue(false);
    });

    it('queries both indexed directions and groups repeated images by ordered role', async () => {
        const select = vi.fn()
            .mockResolvedValueOnce([
                {
                    role: 'ip_adapter_image',
                    target_invoke_image_name: 'Source.PNG',
                    active_target_id: 'C:/invoke/source.png',
                },
                {
                    role: 'init_image',
                    target_invoke_image_name: 'Source.PNG',
                    active_target_id: 'C:/invoke/source.png',
                },
                {
                    role: 'controlnet_image',
                    target_invoke_image_name: 'Missing.PNG',
                    active_target_id: null,
                },
            ])
            .mockResolvedValueOnce([
                {
                    role: 'controlnet_processed_image',
                    source_image_id: 'C:/invoke/result.png',
                    source_invoke_image_name: 'Result.PNG',
                    active_source_id: 'C:/invoke/result.png',
                    removed_source_id: null,
                },
                {
                    role: 'controlnet_image',
                    source_image_id: 'C:/invoke/result.png',
                    source_invoke_image_name: 'Result.PNG',
                    active_source_id: 'C:/invoke/result.png',
                    removed_source_id: null,
                },
            ]);
        mocks.getDb.mockResolvedValue({ select });

        const { getInvokeReferenceGraph } = await import('../invokeReferenceRepo');
        const graph = await getInvokeReferenceGraph('C:/invoke/current.png');

        expect(select).toHaveBeenCalledTimes(2);
        expect(select.mock.calls[0][0]).toContain('WHERE r.source_image_id = ?');
        expect(select.mock.calls[1][0]).toContain('WHERE r.target_image_id = ?');
        expect(select.mock.calls[0][0]).toContain('visible_source.invoke_scope_hidden = 0');
        expect(select.mock.calls[0][0]).toContain('target.invoke_scope_hidden = 0');
        expect(select.mock.calls[1][0]).toContain('visible_target.invoke_scope_hidden = 0');
        expect(select.mock.calls[1][0]).toContain('removed_source.invoke_scope_hidden = 0');
        expect(select.mock.calls[0][1]).toEqual(['C:/invoke/current.png']);
        expect(select.mock.calls[1][1]).toEqual(['C:/invoke/current.png']);
        expect(graph).toEqual({
            sourceImages: [
                {
                    imageId: null,
                    invokeImageName: 'Missing.PNG',
                    availability: 'unresolved',
                    roles: ['controlnet_image'],
                },
                {
                    imageId: 'C:/invoke/source.png',
                    invokeImageName: 'Source.PNG',
                    availability: 'available',
                    roles: ['init_image', 'ip_adapter_image'],
                },
            ],
            usedBy: [{
                imageId: 'C:/invoke/result.png',
                invokeImageName: 'Result.PNG',
                availability: 'available',
                roles: ['controlnet_image', 'controlnet_processed_image'],
            }],
        });
    });

    it('keeps Removed backlinks disabled and falls back to the source basename', async () => {
        const select = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([
                {
                    role: 't2i_adapter_image',
                    source_image_id: 'C:\\Invoke\\removed-source.png',
                    source_invoke_image_name: null,
                    active_source_id: null,
                    removed_source_id: 'C:\\Invoke\\removed-source.png',
                },
            ]);
        mocks.getDb.mockResolvedValue({ select });

        const { getInvokeReferenceGraph } = await import('../invokeReferenceRepo');
        const graph = await getInvokeReferenceGraph('target');

        expect(graph.usedBy).toEqual([
            {
                imageId: null,
                invokeImageName: 'removed-source.png',
                availability: 'removed',
                roles: ['t2i_adapter_image'],
            },
        ]);
    });

    it('returns an empty graph in browser mock mode without opening SQLite', async () => {
        mocks.isBrowserMockMode.mockReturnValue(true);
        const { getInvokeReferenceGraph } = await import('../invokeReferenceRepo');

        await expect(getInvokeReferenceGraph('mock')).resolves.toEqual({ sourceImages: [], usedBy: [] });
        expect(mocks.getDb).not.toHaveBeenCalled();
    });
});
