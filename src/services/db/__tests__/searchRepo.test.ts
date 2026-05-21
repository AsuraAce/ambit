import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDbMock = vi.hoisted(() => vi.fn());

vi.mock('../connection', () => ({
    getDb: () => getDbMock(),
}));

const deriveScopedRows = (
    cacheRows: Record<string, unknown>[],
    facetType: string
) => cacheRows
    .filter((row) => row.facet_type === facetType && typeof row.resource_name === 'string')
    .map((row) => ({
        name: row.resource_name as string,
        count: Number(row.count ?? 0)
    }));

const createFacetDb = (
    cacheRows: Record<string, unknown>[],
    diskRows: Record<string, unknown>[] = [],
    scopedRows: Partial<Record<string, Record<string, unknown>[]>> = {}
) => ({
    select: vi.fn(async (sql: string) => {
        const normalizedSql = sql.replace(/\s+/g, ' ').trim();
        if (normalizedSql.startsWith('SELECT m.resource_type, m.name, m.hash,')) {
            return diskRows;
        }
        if (normalizedSql.includes('FROM scoped_images')) {
            if (normalizedSql.includes('JOIN image_loras')) return scopedRows.loras ?? deriveScopedRows(cacheRows, 'loras');
            if (normalizedSql.includes('JOIN image_embeddings')) return scopedRows.embeddings ?? deriveScopedRows(cacheRows, 'embeddings');
            if (normalizedSql.includes('JOIN image_hypernetworks')) return scopedRows.hypernetworks ?? deriveScopedRows(cacheRows, 'hypernetworks');
            if (normalizedSql.includes('JOIN image_controlnets')) return scopedRows.control_nets ?? deriveScopedRows(cacheRows, 'control_nets');
            if (normalizedSql.includes('JOIN image_ipadapters')) return scopedRows.ip_adapters ?? deriveScopedRows(cacheRows, 'ip_adapters');
            return scopedRows.checkpoints ?? deriveScopedRows(cacheRows, 'checkpoints');
        }
        return cacheRows;
    }),
});

const findSelectCall = (
    db: { select: ReturnType<typeof vi.fn> },
    predicate: (sql: string) => boolean
) => db.select.mock.calls.find(([sql]) => predicate(sql as string)) as [string, unknown[]] | undefined;

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

        const [sql, params] = findSelectCall(db, (value) => value.includes('FROM facet_cache fc')) as [string, string[]];
        const [diskSql, diskParams] = findSelectCall(db, (value) => value.includes('FROM models m')) as [string, string[]];
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
            filterAliases: ['Pony Diffusion V6 XL', 'ponyDiffusionV6XL']
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
            filterAliases: ['Detailer-Style', 'detailer style', 'detailer_style']
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

        const [sql] = findSelectCall(db, (value) => value.includes('FROM facet_cache fc')) as [string, string[]];
        expect(sql).not.toContain('fc.count > 0');
        expect(sql).not.toContain('EXISTS');
        expect(sql).not.toContain('FROM models m');
        expect(sql).not.toContain('LOWER(m.name)');
        expect(facets.loras.map(item => item.name)).toEqual(['UsedLora']);
    });

    it('skips scoped facet overlays for the default unfiltered used scope', async () => {
        const db = createFacetDb([
            {
                facet_type: 'checkpoints',
                resource_name: 'Model A',
                resource_hash: 'hash-a',
                count: 5
            },
            {
                facet_type: 'checkpoints',
                resource_name: 'Model B',
                resource_hash: 'hash-b',
                count: 2
            }
        ]);
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['checkpoints'], { assetScope: 'used' });

        expect(facets.checkpoints).toEqual([
            expect.objectContaining({ name: 'Model A', count: 5 }),
            expect.objectContaining({ name: 'Model B', count: 2 })
        ]);
        expect(db.select.mock.calls.some(([sql]) => (sql as string).includes('FROM scoped_images'))).toBe(false);
    });

    it('skips scoped facet overlays for the default unfiltered all scope', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Model A',
                    resource_hash: 'hash-a',
                    count: 5
                },
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Unused Local',
                    resource_hash: 'file:C:/models/Unused Local.safetensors',
                    count: 0,
                    is_local_disk: 1
                }
            ],
            [
                {
                    resource_type: 'checkpoint',
                    name: 'Unused Local',
                    hash: 'file:C:/models/Unused Local.safetensors'
                }
            ]
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('', [], ['checkpoints'], { assetScope: 'all' });

        expect(facets.checkpoints).toEqual([
            expect.objectContaining({ name: 'Model A', count: 5 }),
            expect.objectContaining({ name: 'Unused Local', count: 0, isLocalDisk: true })
        ]);
        expect(db.select.mock.calls.some(([sql]) => (sql as string).includes('FROM scoped_images'))).toBe(false);
    });

    it('preserves zero-count disk aliases for used assets in used scope', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Pony Diffusion V6 XL',
                    resource_hash: 'metadata-hash',
                    count: 8,
                    is_local_disk: 0
                },
                {
                    facet_type: 'checkpoints',
                    resource_name: 'ponyDiffusionV6XL',
                    resource_hash: 'file:C:/models/ponyDiffusionV6XL.safetensors',
                    count: 0,
                    is_local_disk: 1
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
            isLocalDisk: true,
            filterAliases: ['Pony Diffusion V6 XL', 'ponyDiffusionV6XL']
        });
    });

    it('uses filter-scoped counts for checkpoints in the used scope', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Model A',
                    resource_hash: 'hash-a',
                    count: 10
                },
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Model B',
                    resource_hash: 'hash-b',
                    count: 5
                }
            ],
            [],
            {
                checkpoints: [{ name: 'Model B', count: 1 }]
            }
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('WHERE resolved_model_name = ?', ['Model B'], ['checkpoints'], { assetScope: 'used' });

        expect(facets.checkpoints).toEqual([
            expect.objectContaining({
                name: 'Model B',
                count: 1
            })
        ]);
        expect(db.select.mock.calls.some(([sql]) => (sql as string).includes('FROM scoped_images'))).toBe(true);
    });

    it('normalizes scoped checkpoint counts across merged aliases in used scope', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Foo.safetensors',
                    resource_hash: 'hash-foo-a',
                    count: 1
                },
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Foo',
                    resource_hash: 'hash-foo-b',
                    count: 1
                },
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Bar',
                    resource_hash: 'hash-bar',
                    count: 100
                }
            ],
            [],
            {
                checkpoints: [
                    { name: 'Foo', count: 4 },
                    { name: 'Bar', count: 1 }
                ]
            }
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('WHERE resolved_model_name IN (?, ?)', ['Foo', 'Bar'], ['checkpoints'], { assetScope: 'used' });

        expect(facets.checkpoints).toEqual([
            expect.objectContaining({
                name: 'Foo.safetensors',
                count: 4,
                filterAliases: ['Foo.safetensors', 'Foo']
            }),
            expect.objectContaining({
                name: 'Bar',
                count: 1
            })
        ]);
    });

    it('keeps local inventory markers while applying scoped used counts in all scope', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Pony Diffusion V6 XL',
                    resource_hash: 'metadata-hash',
                    count: 8
                }
            ],
            [
                {
                    resource_type: 'checkpoint',
                    name: 'ponyDiffusionV6XL',
                    hash: 'file:C:/models/ponyDiffusionV6XL.safetensors'
                }
            ],
            {
                checkpoints: [{ name: 'Pony Diffusion V6 XL', count: 2 }]
            }
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('WHERE resolved_model_name = ?', ['Pony Diffusion V6 XL'], ['checkpoints'], { assetScope: 'all' });

        expect(facets.checkpoints).toEqual([
            expect.objectContaining({
                name: 'Pony Diffusion V6 XL',
                count: 2,
                isLocalDisk: true
            })
        ]);
    });

    it('keeps local disk markers while applying normalized scoped alias counts in all scope', async () => {
        const db = createFacetDb(
            [
                {
                    facet_type: 'checkpoints',
                    resource_name: 'Foo Model.safetensors',
                    resource_hash: 'metadata-hash',
                    count: 8
                }
            ],
            [
                {
                    resource_type: 'checkpoint',
                    name: 'foo_model',
                    hash: 'file:C:/models/Foo Model.safetensors'
                }
            ],
            {
                checkpoints: [{ name: 'Foo Model', count: 2 }]
            }
        );
        getDbMock.mockResolvedValue(db);

        const { getFacets } = await import('../searchRepo');
        const facets = await getFacets('WHERE resolved_model_name = ?', ['Foo Model'], ['checkpoints'], { assetScope: 'all' });

        expect(facets.checkpoints).toEqual([
            expect.objectContaining({
                name: 'Foo Model.safetensors',
                count: 2,
                isLocalDisk: true
            })
        ]);
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

describe('searchRepo scoped stats queries', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('binds collection and lora values instead of interpolating them into stats SQL', async () => {
        const collectionId = "col' OR 1=1 --";
        const loraName = "lora' OR 1=1 --";
        const db = {
            select: vi.fn(async (sql: string) => {
                const normalizedSql = sql.replace(/\s+/g, ' ').trim();
                if (normalizedSql.includes('count(*) as count')) {
                    return [{ count: 0 }];
                }
                return [];
            })
        };
        getDbMock.mockResolvedValue(db);

        const { clearLibraryStatsCache, getLibraryStats } = await import('../searchRepo');
        clearLibraryStatsCache();

        await getLibraryStats('WHERE is_deleted = ?', [0], collectionId, loraName);

        const [statsSql, statsParams] = findSelectCall(db, (value) => value.includes('count(*) as count')) as [string, unknown[]];
        const [keywordSql, keywordParams] = findSelectCall(db, (value) => value.includes('JOIN images_fts')) as [string, unknown[]];

        expect(statsSql).toContain('FROM collection_images ci');
        expect(statsSql).toContain('JOIN image_loras il ON il.image_id = ci.image_id');
        expect(statsSql).toContain('JOIN images ON images.id = ci.image_id');
        expect(statsSql).toContain('ci.collection_id = ?');
        expect(statsSql).toContain('il.lora_name = ?');
        expect(statsSql).not.toContain(collectionId);
        expect(statsSql).not.toContain(loraName);
        expect(statsParams).toEqual([collectionId, loraName, 0]);

        expect(keywordSql).toContain('FROM collection_images ci');
        expect(keywordSql).toContain('JOIN image_loras il ON il.image_id = ci.image_id');
        expect(keywordSql).toContain('JOIN images ON images.id = ci.image_id');
        expect(keywordSql).toContain('ci.collection_id = ?');
        expect(keywordSql).toContain('il.lora_name = ?');
        expect(keywordSql).toContain('images.rowid > ?');
        expect(keywordSql).not.toContain('WHERE si.rowid > ?');
        expect(keywordSql).not.toContain(collectionId);
        expect(keywordSql).not.toContain(loraName);
        expect(keywordParams).toEqual([collectionId, loraName, 0, 0]);
    });

    it('uses collection_images as the scoped source for collection-only summary stats', async () => {
        const db = {
            select: vi.fn(async (sql: string) => {
                const normalizedSql = sql.replace(/\s+/g, ' ').trim();
                if (normalizedSql.includes('count(*) as count')) return [{ count: 3 }];
                if (normalizedSql.includes('GROUP BY name')) return [];
                return [];
            })
        };
        getDbMock.mockResolvedValue(db);

        const { clearLibraryStatsCache, getLibraryStatsSummary } = await import('../searchRepo');
        clearLibraryStatsCache();

        await getLibraryStatsSummary('WHERE is_deleted = ?', [0], 'collection-1');

        const [statsSql, statsParams] = findSelectCall(db, (value) => value.includes('count(*) as count')) as [string, unknown[]];
        const [modelSql, modelParams] = findSelectCall(db, (value) => value.includes('GROUP BY name')) as [string, unknown[]];

        expect(statsSql).toContain('FROM collection_images ci');
        expect(statsSql).toContain('CROSS JOIN images ON images.id = ci.image_id');
        expect(statsSql).not.toContain('FROM images INDEXED BY');
        expect(statsParams).toEqual(['collection-1', 0]);

        expect(modelSql).toContain('FROM collection_images ci');
        expect(modelSql).toContain('CROSS JOIN images ON images.id = ci.image_id');
        expect(modelSql).not.toContain('FROM images INDEXED BY');
        expect(modelParams).toEqual(['collection-1', 0]);
    });

    it('uses image_loras as the scoped source for lora-only summary and keyword stats', async () => {
        const db = {
            select: vi.fn(async (sql: string) => {
                const normalizedSql = sql.replace(/\s+/g, ' ').trim();
                if (normalizedSql.includes('count(*) as count')) return [{ count: 2 }];
                if (normalizedSql.includes('GROUP BY name')) return [];
                if (normalizedSql.includes('JOIN images_fts')) return [];
                return [];
            })
        };
        getDbMock.mockResolvedValue(db);

        const { clearLibraryStatsCache, getLibraryStats } = await import('../searchRepo');
        clearLibraryStatsCache();

        await getLibraryStats('WHERE is_deleted = ?', [0], undefined, 'Detailer');

        const [statsSql, statsParams] = findSelectCall(db, (value) => value.includes('count(*) as count')) as [string, unknown[]];
        const [keywordSql, keywordParams] = findSelectCall(db, (value) => value.includes('JOIN images_fts')) as [string, unknown[]];

        expect(statsSql).toContain('FROM image_loras il');
        expect(statsSql).toContain('CROSS JOIN images ON images.id = il.image_id');
        expect(statsSql).not.toContain('FROM images INDEXED BY');
        expect(statsParams).toEqual(['Detailer', 0]);

        expect(keywordSql).toContain('FROM image_loras il');
        expect(keywordSql).toContain('CROSS JOIN images ON images.id = il.image_id');
        expect(keywordSql).toContain('images.rowid > ?');
        expect(keywordSql).not.toContain('WHERE si.rowid > ?');
        expect(keywordSql).not.toContain('FROM images INDEXED BY');
        expect(keywordParams).toEqual(['Detailer', 0, 0]);
    });

    it('returns full model names without a top-20 cap for scoped stats', async () => {
        const db = {
            select: vi.fn(async (sql: string) => {
                const normalizedSql = sql.replace(/\s+/g, ' ').trim();
                if (normalizedSql.includes('count(*) as total')) return [{ total: 22 }];
                if (normalizedSql.includes('GROUP BY name')) {
                    return Array.from({ length: 22 }, (_, index) => ({
                        name: `Flux Variant ${index + 1}`,
                        count: 22 - index
                    }));
                }
                if (normalizedSql.includes('JOIN images_fts')) return [];
                return [];
            })
        };
        getDbMock.mockResolvedValue(db);

        const { clearLibraryStatsCache, getLibraryStatsSummary } = await import('../searchRepo');
        clearLibraryStatsCache();

        const stats = await getLibraryStatsSummary('WHERE is_deleted = ?', [0], 'collection-1', 'Detailer');

        expect(stats.modelStats).toHaveLength(22);
        expect(stats.modelStats[0]).toEqual({
            name: 'Flux Variant 1',
            fullName: 'Flux Variant 1',
            count: 22
        });

        const [modelSql, modelParams] = findSelectCall(db, (value) => value.includes('GROUP BY name')) as [string, unknown[]];
        expect(modelSql).toContain('WITH scoped_images');
        expect(modelSql).toContain('ci.collection_id = ?');
        expect(modelSql).toContain('il.lora_name = ?');
        expect(modelSql).not.toContain('LIMIT 20');
        expect(modelParams).toEqual(['collection-1', 'Detailer', 0]);
    });

    it('uses the optimized model-stats indexes for unscoped summaries', async () => {
        const db = {
            select: vi.fn(async (sql: string) => {
                const normalizedSql = sql.replace(/\s+/g, ' ').trim();
                if (normalizedSql.includes('count(*) as count')) return [{ count: 1 }];
                if (normalizedSql.includes('GROUP BY name')) return [];
                return [];
            })
        };
        getDbMock.mockResolvedValue(db);

        const { clearLibraryStatsCache, getLibraryStatsSummary } = await import('../searchRepo');
        clearLibraryStatsCache();

        await getLibraryStatsSummary('WHERE is_deleted = 0 AND IFNULL(is_intermediate_gen, 0) = 0 AND IFNULL(is_grid_gen, 0) = 0', []);
        await getLibraryStatsSummary('WHERE is_deleted = 0 AND IFNULL(is_intermediate_gen, 0) = 0 AND IFNULL(is_grid_gen, 0) = 0 AND privacy_hidden = 0', []);

        const modelCalls = db.select.mock.calls.filter(([sql]) => (sql as string).includes('GROUP BY name'));

        expect(modelCalls).toHaveLength(2);
        expect(modelCalls[0]?.[0]).toContain('FROM images INDEXED BY idx_images_model_stats_v2');
        expect(modelCalls[1]?.[0]).toContain('FROM images INDEXED BY idx_images_privacy_model_stats_v1');
    });

    it('uses the restored fast count path for unscoped summary totals', async () => {
        const db = {
            select: vi.fn(async (sql: string) => {
                const normalizedSql = sql.replace(/\s+/g, ' ').trim();
                if (normalizedSql.includes('count(*) as count')) return [{ count: 3 }];
                if (normalizedSql.includes('GROUP BY name')) return [];
                return [];
            })
        };
        getDbMock.mockResolvedValue(db);

        const { clearLibraryStatsCache, getLibraryStatsSummary } = await import('../searchRepo');
        clearLibraryStatsCache();

        const summary = await getLibraryStatsSummary('', []);

        expect(summary.totalImages).toBe(3);
        const [countSql, countParams] = findSelectCall(db, (value) => value.includes('count(*) as count')) as [string, unknown[]];
        expect(countSql).toContain('FROM images');
        expect(countSql).not.toContain('FROM scoped_images');
        expect(countParams).toEqual([]);
        expect(findSelectCall(db, (value) => value.includes('count(*) as total'))).toBeUndefined();
    });

    it('includes prompts beyond the old 2000-row limit when building keyword stats', async () => {
        const promptBatches = [
            Array.from({ length: 500 }, (_, index) => ({ rowid: index + 1, positive_prompt: 'alpha alpha' })),
            Array.from({ length: 500 }, (_, index) => ({ rowid: index + 501, positive_prompt: 'alpha alpha' })),
            Array.from({ length: 500 }, (_, index) => ({ rowid: index + 1001, positive_prompt: 'alpha alpha' })),
            Array.from({ length: 500 }, (_, index) => ({ rowid: index + 1501, positive_prompt: 'alpha alpha' })),
            [{ rowid: 2001, positive_prompt: 'sentinelword alpha' }]
        ];
        let promptBatchIndex = 0;

        const db = {
            select: vi.fn(async (sql: string) => {
                const normalizedSql = sql.replace(/\s+/g, ' ').trim();
                if (normalizedSql.includes('JOIN images_fts')) {
                    const batch = promptBatches[promptBatchIndex] ?? [];
                    promptBatchIndex += 1;
                    return batch;
                }
                return [];
            })
        };
        getDbMock.mockResolvedValue(db);

        const { getKeywordStats } = await import('../searchRepo');
        const keywords = await getKeywordStats('WHERE is_deleted = ?', [0]);

        expect(keywords.some((item) => item.text === 'sentinelword')).toBe(true);
        const keywordCalls = db.select.mock.calls
            .filter(([sql]) => (sql as string).includes('JOIN images_fts'))
            .map((call) => [call[0] as string, ((call as unknown[])[1] ?? []) as unknown[]] as [string, unknown[]]);

        expect(keywordCalls).toHaveLength(5);
        expect(keywordCalls.map(([, params]) => params)).toEqual([
            [0, 0],
            [0, 500],
            [0, 1000],
            [0, 1500],
            [0, 2000]
        ]);
        keywordCalls.forEach(([sql]) => {
            expect(sql).toContain('images.rowid > ?');
            expect(sql).not.toContain('WHERE si.rowid > ?');
            expect(sql).not.toContain('OFFSET');
        });
    });
});
