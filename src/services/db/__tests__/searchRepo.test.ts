import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock('../connection', () => ({
    getDb: () => getDbMock(),
}));

const createFacetDb = (
    cacheRows: Record<string, unknown>[],
    diskRows: Record<string, unknown>[] = []
) => ({
    select: vi.fn(async (sql: string) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        return normalizedSql.startsWith('SELECT m.resource_type, m.name, m.hash,')
            ? diskRows
            : cacheRows;
    }),
});

describe('searchRepo getFacets', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('marks disk-scanned resources as local disk assets', async () => {
        const db = createFacetDb(
            [
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
            ],
            [
                {
                    resource_type: 'loras',
                    name: 'LocalLora',
                    hash: 'file:C:/models/LocalLora.safetensors'
                }
            ]
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['loras'], { assetScope: 'all' });

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
        const db = createFacetDb(
            [
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
            ],
            [
                {
                    resource_type: 'control_nets',
                    name: 'Canny',
                    hash: 'cnet_Canny'
                }
            ]
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['controlNets', 'ipAdapters'], { assetScope: 'all' });

        const [sql, params] = db.select.mock.calls[0] as unknown as [string, string[]];
        const [diskSql, diskParams] = db.select.mock.calls[1] as unknown as [string, string[]];
        expect(sql).not.toContain('EXISTS');
        expect(sql).not.toContain('FROM models m');
        expect(sql).not.toContain('LOWER(m.name)');
        expect(params).toEqual(['control_nets', 'ip_adapters']);
        expect(diskSql).toContain("lookup_source = 'disk_scan'");
        expect(diskParams).toEqual(['control_nets', 'ip_adapters']);
        expect(facets.controlNets[0].isLocalDisk).toBe(true);
        expect(facets.ipAdapters[0].isLocalDisk).toBe(false);
    });

    it('merges disk and image-found assets by asset match key', async () => {
        const db = createFacetDb(
            [
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
            ],
            [
                {
                    resource_type: 'checkpoint',
                    name: 'ponyDiffusionV6XL',
                    hash: 'file:C:/models/ponyDiffusionV6XL.safetensors'
                }
            ]
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['checkpoints'], { assetScope: 'all' });

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
        const db = createFacetDb(
            [
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
            ],
            [
                {
                    resource_type: 'loras',
                    name: 'detailer_style',
                    hash: 'file:C:/models/detailer_style.safetensors'
                }
            ]
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['loras'], { assetScope: 'all' });

        expect(facets.loras).toHaveLength(1);
        expect(facets.loras[0]).toMatchObject({
            name: 'Detailer-Style',
            count: 7,
            isLocalDisk: true,
            filterAliases: ['Detailer-Style', 'detailer style']
        });
    });

    it('excludes zero-count local-only assets from used scope', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'loras',
                    resource_name: 'UsedLora',
                    resource_hash: 'lora_UsedLora',
                    count: 2,
                    is_local_disk: 0
                },
                {
                    facet_type: 'loras',
                    resource_name: 'UnusedLocalLora',
                    resource_hash: 'file:C:/models/UnusedLocalLora.safetensors',
                    count: 0,
                    is_local_disk: 1
                }
            ],
            [
                {
                    resource_type: 'loras',
                    name: 'UnusedLocalLora',
                    hash: 'file:C:/models/UnusedLocalLora.safetensors'
                }
            ]
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['loras'], { assetScope: 'used' });

        const [sql] = db.select.mock.calls[0] as unknown as [string, string[]];
        expect(sql).toContain('fc.count > 0');
        expect(sql).not.toContain('EXISTS');
        expect(sql).not.toContain('FROM models m');
        expect(sql).not.toContain('LOWER(m.name)');
        expect(facets.loras.map(item => item.name)).toEqual(['UsedLora']);
    });

    it('marks a used asset as local in used scope when only a disk alias matches', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Pony Diffusion V6 XL',
                    resource_hash: 'metadata-hash',
                    count: 8,
                    is_local_disk: 0
                }
            ],
            [
                {
                    resource_type: 'checkpoint',
                    name: 'ponyDiffusionV6XL',
                    hash: 'file:C:/models/ponyDiffusionV6XL.safetensors'
                }
            ]
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['checkpoints'], { assetScope: 'used' });

        expect(facets.checkpoints).toHaveLength(1);
        expect(facets.checkpoints[0]).toMatchObject({
            name: 'Pony Diffusion V6 XL',
            count: 8,
            isLocalDisk: true
        });
    });

    it('includes unused disk assets in local scope', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'loras',
                    resource_name: 'UnusedLocalLora',
                    resource_hash: 'file:C:/models/UnusedLocalLora.safetensors',
                    count: 0,
                    is_local_disk: 1
                },
                {
                    facet_type: 'loras',
                    resource_name: 'UsedRemoteLora',
                    resource_hash: 'lora_UsedRemoteLora',
                    count: 5,
                    is_local_disk: 0
                },
                {
                    facet_type: 'loras',
                    resource_name: 'UnusedRemoteLora',
                    resource_hash: 'lora_UnusedRemoteLora',
                    count: 0,
                    is_local_disk: 0
                }
            ],
            [
                {
                    resource_type: 'loras',
                    name: 'UnusedLocalLora',
                    hash: 'file:C:/models/UnusedLocalLora.safetensors'
                }
            ]
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['loras'], { assetScope: 'local' });

        const [sql] = db.select.mock.calls[0] as unknown as [string, string[]];
        expect(sql).not.toContain('EXISTS');
        expect(sql).not.toContain('FROM models m');
        expect(facets.loras).toHaveLength(1);
        expect(facets.loras[0]).toMatchObject({
            name: 'UnusedLocalLora',
            count: 0,
            isLocalDisk: true
        });
    });

    it('normalizes disk file modified time onto unused local assets for newest sorting', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'loras',
                    resource_name: 'OlderLocalLora',
                    resource_hash: 'file:C:/models/OlderLocalLora.safetensors',
                    count: 0,
                    is_local_disk: 1
                },
                {
                    facet_type: 'loras',
                    resource_name: 'NewestLocalLora',
                    resource_hash: 'file:C:/models/NewestLocalLora.safetensors',
                    count: 0,
                    is_local_disk: 1
                },
                {
                    facet_type: 'loras',
                    resource_name: 'MillisecondLocalLora',
                    resource_hash: 'file:C:/models/MillisecondLocalLora.safetensors',
                    count: 0,
                    is_local_disk: 1
                }
            ],
            [
                {
                    resource_type: 'loras',
                    name: 'OlderLocalLora',
                    hash: 'file:C:/models/OlderLocalLora.safetensors',
                    local_modified_at: 1_700_000_000,
                    scanned_at: 1_700_000_300
                },
                {
                    resource_type: 'loras',
                    name: 'NewestLocalLora',
                    hash: 'file:C:/models/NewestLocalLora.safetensors',
                    local_modified_at: null,
                    scanned_at: 1_700_000_500
                },
                {
                    resource_type: 'loras',
                    name: 'MillisecondLocalLora',
                    hash: 'file:C:/models/MillisecondLocalLora.safetensors',
                    local_modified_at: 1_700_001_000_000,
                    scanned_at: 1_700_000_600
                }
            ]
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['loras'], { assetScope: 'local' });

        expect(facets.loras.find(item => item.name === 'NewestLocalLora')).toMatchObject({
            createdAt: 1_700_000_500_000,
            localModifiedAt: 1_700_000_500_000
        });
        expect(facets.loras.find(item => item.name === 'OlderLocalLora')).toMatchObject({
            createdAt: 1_700_000_000_000,
            localModifiedAt: 1_700_000_000_000
        });
        expect(facets.loras.find(item => item.name === 'MillisecondLocalLora')).toMatchObject({
            createdAt: 1_700_001_000_000,
            localModifiedAt: 1_700_001_000_000
        });
    });
});
