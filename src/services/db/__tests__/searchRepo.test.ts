import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock('../connection', () => ({
    getDb: () => getDbMock(),
}));

describe('searchRepo getFacets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('marks disk-scanned resources as local disk assets', async () => {
        const db = {
            select: vi.fn(async () => [
                {
                    facet_type: 'loras',
                    resource_name: 'LocalLora',
                    resource_hash: 'file:C:/models/LocalLora.safetensors',
                    count: 0,
                    is_local_disk: 1
                },
                {
                    facet_type: 'loras',
                    resource_name: 'HarvestedLora',
                    resource_hash: 'lora_HarvestedLora',
                    count: 4,
                    is_local_disk: 0
                }
            ])
        };
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['loras']);

        expect(facets.loras.find(item => item.name === 'LocalLora')).toMatchObject({
            name: 'LocalLora',
            count: 0,
            isLocalDisk: true
        });
        expect(facets.loras.find(item => item.name === 'HarvestedLora')).toMatchObject({
            name: 'HarvestedLora',
            count: 4,
            isLocalDisk: false
        });
    });

    it('queries local source metadata and maps frontend resource type names to cache names', async () => {
        const db = {
            select: vi.fn(async () => [
                {
                    facet_type: 'control_nets',
                    resource_name: 'Canny',
                    resource_hash: 'cnet_Canny',
                    count: 2,
                    is_local_disk: 1
                },
                {
                    facet_type: 'ip_adapters',
                    resource_name: 'IP Plus',
                    resource_hash: 'ipad_IP Plus',
                    count: 1,
                    is_local_disk: 0
                }
            ])
        };
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['controlNets', 'ipAdapters']);

        const [sql, params] = db.select.mock.calls[0] as unknown as [string, string[]];
        expect(sql).toContain("m.lookup_source = 'disk_scan'");
        expect(params).toEqual(['control_nets', 'ip_adapters']);
        expect(facets.controlNets[0].isLocalDisk).toBe(true);
        expect(facets.ipAdapters[0].isLocalDisk).toBe(false);
    });

    it('merges disk and image-found assets by asset match key', async () => {
        const db = {
            select: vi.fn(async () => [
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Pony Diffusion V6 XL',
                    resource_hash: 'metadata-hash',
                    count: 8,
                    thumbnail_path: 'used.webp',
                    is_local_disk: 0
                },
                {
                    facet_type: 'checkpoints',
                    resource_name: 'ponyDiffusionV6XL',
                    resource_hash: 'file:C:/models/ponyDiffusionV6XL.safetensors',
                    count: 0,
                    thumbnail_path: 'local.webp',
                    is_local_disk: 1
                },
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Other Model',
                    resource_hash: 'other-hash',
                    count: 2,
                    is_local_disk: 0
                }
            ])
        };
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['checkpoints']);

        expect(facets.checkpoints).toHaveLength(2);
        expect(facets.checkpoints[0]).toMatchObject({
            name: 'Pony Diffusion V6 XL',
            count: 8,
            isLocalDisk: true,
            assetMatchKey: 'ponydiffusionv6xl',
            filterAliases: ['Pony Diffusion V6 XL']
        });
    });

    it('combines image-used aliases under one local-aware row', async () => {
        const db = {
            select: vi.fn(async () => [
                {
                    facet_type: 'loras',
                    resource_name: 'detailer style',
                    resource_hash: 'lora_detailer style',
                    count: 3,
                    is_local_disk: 0
                },
                {
                    facet_type: 'loras',
                    resource_name: 'Detailer-Style',
                    resource_hash: 'lora_Detailer-Style',
                    count: 4,
                    is_local_disk: 0
                },
                {
                    facet_type: 'loras',
                    resource_name: 'detailer_style',
                    resource_hash: 'file:C:/models/detailer_style.safetensors',
                    count: 0,
                    is_local_disk: 1
                }
            ])
        };
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['loras']);

        expect(facets.loras).toHaveLength(1);
        expect(facets.loras[0]).toMatchObject({
            name: 'Detailer-Style',
            count: 7,
            isLocalDisk: true,
            filterAliases: ['Detailer-Style', 'detailer style']
        });
    });
});
