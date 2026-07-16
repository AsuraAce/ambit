import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BrowserMockRepository,
    addBrowserMockImagesToCollection,
    deleteBrowserMockCollection,
    getBrowserMockCollections,
    getBrowserMockKeywordStats,
    getBrowserMockStats,
    getBrowserMockStatsSummary,
    getBrowserMockValidFacetNames,
    getBrowserMockFacets,
    getBrowserMockImages,
    removeBrowserMockImagesFromCollection,
    searchBrowserMockImages,
    updateBrowserMockImage,
    upsertBrowserMockCollection,
} from '../browserMockData';
import { createDefaultFilters } from '../../utils/filterState';
import { createDefaultAppSettings } from '../../constants/defaultSettings';
import type { AppState } from '../repository';
import { GeneratorTool } from '../../types';

describe('browserMockData filtering', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('honors Match All for multi-valued asset filters', () => {
        const anyResult = searchBrowserMockImages(createDefaultFilters({
            loras: ['detail_tweaker_v1', 'soft_portrait'],
            matchModes: { loras: 'any' }
        }), 'date_desc', 1000);
        const allResult = searchBrowserMockImages(createDefaultFilters({
            loras: ['detail_tweaker_v1', 'soft_portrait'],
            matchModes: { loras: 'all' }
        }), 'date_desc', 1000);

        expect(anyResult.totalCount).toBeGreaterThan(0);
        expect(allResult.totalCount).toBe(0);
    });

    it('keeps checkpoints Any-only even if stale matchModes requests ALL', () => {
        const result = searchBrowserMockImages(createDefaultFilters({
            models: ['Flux.1 Dev', 'SDXL 1.0 Base'],
            matchModes: { models: 'all' }
        }), 'date_desc', 1000);

        expect(result.totalCount).toBeGreaterThan(0);
    });

    it('keeps same-category alternatives visible in Match Any mock facets', () => {
        const facets = getBrowserMockFacets(createDefaultFilters({
            loras: ['detail_tweaker_v1'],
            matchModes: { loras: 'any' }
        }));
        const loraNames = facets.loras.map((item) => item.name);

        expect(loraNames).toContain('detail_tweaker_v1');
        expect(loraNames).toContain('soft_portrait');
    });

    it('supports prompt OR groups and negative terms in browser-mode search', () => {
        const orResult = searchBrowserMockImages(createDefaultFilters({
            searchQuery: 'neon OR solarpunk'
        }), 'date_desc', 1000);
        const excludedResult = searchBrowserMockImages(createDefaultFilters({
            searchQuery: 'neon -rain'
        }), 'date_desc', 1000);

        expect(orResult.totalCount).toBeGreaterThan(0);
        expect(excludedResult.totalCount).toBe(0);
    });

    it('supports scoped search tokens used by the main search box', () => {
        const searchableTerms = [
            'steps:>18',
            'cfg:<4.5',
            'w:832',
            'h:1216',
            'model:flux',
            'seed:101337',
            'neg:watermark',
            'file:0002',
            'all:detail',
            'sampler:euler',
            'tool:comfy',
            'lora:detail',
            'cn:canny',
            'ip:faceid',
        ];

        searchableTerms.forEach((searchQuery) => {
            const result = searchBrowserMockImages(createDefaultFilters({ searchQuery }), 'date_desc', 1000);
            expect(result.totalCount, searchQuery).toBeGreaterThan(0);
        });
    });

    it('sorts browser mock results and pages from the cursor image', () => {
        const firstPage = searchBrowserMockImages(createDefaultFilters(), 'name_asc', 3);
        const secondPage = searchBrowserMockImages(createDefaultFilters(), 'name_asc', 3, firstPage.images[1].id);

        expect(firstPage.images.every((image) => image.isPinned)).toBe(true);
        expect(firstPage.images.map((image) => image.filename)).toEqual([
            'mock_generation_0020.png',
            'mock_generation_0039.png',
            'mock_generation_0058.png',
        ]);
        expect(secondPage.images[0].id).toBe(firstPage.images[2].id);
        expect(firstPage.globalCount).toBeGreaterThanOrEqual(firstPage.totalCount);
    });

    it('builds stats, keywords, and valid facet names from the filtered mock library', () => {
        const filters = createDefaultFilters({ models: ['Flux.1 Dev'] });
        const summary = getBrowserMockStatsSummary(filters);
        const keywords = getBrowserMockKeywordStats(filters);
        const stats = getBrowserMockStats(filters);
        const validNames = getBrowserMockValidFacetNames(filters);

        expect(summary.totalImages).toBeGreaterThan(0);
        expect(summary.avgSteps).toBeGreaterThan(0);
        expect(summary.modelStats[0].name).toBe('Flux.1 Dev');
        expect(keywords.length).toBeGreaterThan(0);
        expect(stats.keywordStats).toEqual(keywords);
        expect(validNames.checkpoints).toContain('Flux.1 Dev');
        expect(validNames.tools.length).toBeGreaterThan(0);
    });

    it('excludes zero and negative step values from browser mock averages', () => {
        const collectionId = 'test_recorded_steps_average';
        const imageIds = ['mock_2', 'mock_3', 'mock_4', 'mock_5'];
        const selectedImages = imageIds.map((id) => {
            const image = getBrowserMockImages().find((candidate) => candidate.id === id);
            if (!image) throw new Error(`Missing browser mock image ${id}`);
            return image;
        });
        const originalSteps = selectedImages.map((image) => image.metadata.steps);

        try {
            [20, 0, -10, 30].forEach((steps, index) => {
                selectedImages[index].metadata.steps = steps;
            });
            upsertBrowserMockCollection({
                id: collectionId,
                name: 'Recorded Steps Average',
                imageIds,
            });

            const summary = getBrowserMockStatsSummary(createDefaultFilters({
                collectionId,
                showIntermediates: true,
                showGrids: true,
            }));

            expect(summary.totalImages).toBe(4);
            expect(summary.avgSteps).toBe(25);
        } finally {
            originalSteps.forEach((steps, index) => {
                selectedImages[index].metadata.steps = steps;
            });
            deleteBrowserMockCollection(collectionId);
        }
    });

    it('returns zero when filtered browser mock images have no recorded positive steps', () => {
        const collectionId = 'test_unknown_steps_average';
        const imageIds = ['mock_6', 'mock_7', 'mock_8'];
        const selectedImages = imageIds.map((id) => {
            const image = getBrowserMockImages().find((candidate) => candidate.id === id);
            if (!image) throw new Error(`Missing browser mock image ${id}`);
            return image;
        });
        const originalSteps = selectedImages.map((image) => image.metadata.steps);

        try {
            [0, -1, 0].forEach((steps, index) => {
                selectedImages[index].metadata.steps = steps;
            });
            upsertBrowserMockCollection({
                id: collectionId,
                name: 'Unknown Steps Average',
                imageIds,
            });

            const summary = getBrowserMockStatsSummary(createDefaultFilters({
                collectionId,
                showIntermediates: true,
                showGrids: true,
            }));

            expect(summary.totalImages).toBe(3);
            expect(summary.avgSteps).toBe(0);
        } finally {
            originalSteps.forEach((steps, index) => {
                selectedImages[index].metadata.steps = steps;
            });
            deleteBrowserMockCollection(collectionId);
        }
    });

    it('creates, updates, and deletes browser mock collections without duplicate image IDs', () => {
        const collectionId = 'test_collection_browser_mock';

        upsertBrowserMockCollection({
            id: collectionId,
            name: 'Browser Mock Test',
            imageIds: ['mock_1'],
            customThumbnail: 'mock_1',
        });
        addBrowserMockImagesToCollection(collectionId, ['mock_1', 'mock_2']);
        removeBrowserMockImagesFromCollection(collectionId, ['mock_1']);

        const collection = getBrowserMockCollections().find((item) => item.id === collectionId);
        expect(collection?.imageIds).toEqual(['mock_2']);
        expect(collection?.count).toBe(1);
        expect(collection?.thumbnail).toBeTruthy();

        deleteBrowserMockCollection(collectionId);
        expect(getBrowserMockCollections().some((item) => item.id === collectionId)).toBe(false);
    });

    it('updates mock image rows in place for browser-mode maintenance flows', () => {
        updateBrowserMockImage('mock_2', { isMissing: true, notes: 'Updated in test' });

        const result = searchBrowserMockImages(createDefaultFilters({
            searchQuery: 'file:0002'
        }), 'date_desc', 1);

        expect(result.images[0].isMissing).toBe(true);
        expect(result.images[0].notes).toBe('Updated in test');
    });

    it('loads and saves repository state while preserving generated images and default settings', async () => {
        const repository = new BrowserMockRepository();
        const before = await repository.load();
        const next: AppState = {
            ...before,
            images: [],
            settings: { ...createDefaultAppSettings(), thumbnailSize: 333 },
            recentSearches: ['saved-search']
        };

        await repository.save(next);
        const loaded = await repository.load();

        expect(loaded.images).toHaveLength(180);
        expect(loaded.settings.thumbnailSize).toBe(333);
        expect(loaded.settings.hasCompletedOnboarding).toBe(false);
        expect(loaded.recentSearches).toEqual(['saved-search']);
        expect(getBrowserMockImages()).toHaveLength(180);
    });

    it('updates persisted mock state without replacing unrelated settings', async () => {
        const repository = new BrowserMockRepository();
        await repository.update(current => ({
            ...current,
            settings: { ...current.settings, maskedKeywords: ['durable'] }
        }));
        await repository.update(current => ({
            ...current,
            recentSearches: ['latest-search']
        }));

        const loaded = await repository.load();
        expect(loaded.settings.maskedKeywords).toEqual(['durable']);
        expect(loaded.recentSearches).toEqual(['latest-search']);
    });

    it('recovers from malformed storage and storage API failures', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        localStorage.setItem('ambit_browser_mock_state_v1', '{broken-json');
        expect(getBrowserMockImages()).toHaveLength(180);
        expect(errorSpy).toHaveBeenCalledWith('[BrowserMock] Failed to load mock state', expect.any(Error));

        const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('read failed'); });
        expect(getBrowserMockImages()).toHaveLength(180);
        getSpy.mockRestore();

        const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('write failed'); });
        await expect(new BrowserMockRepository().save(await new BrowserMockRepository().load()))
            .rejects.toThrow('write failed');
        expect(errorSpy).toHaveBeenCalledWith('[BrowserMock] Failed to persist mock state', expect.any(Error));
        setSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('filters every browser mock facet and numeric range independently', () => {
        const cases = [
            createDefaultFilters({ tools: [GeneratorTool.INVOKEAI] }),
            createDefaultFilters({ embeddings: ['easynegative'] }),
            createDefaultFilters({ controlNets: ['control_v11p_sd15_canny'] }),
            createDefaultFilters({ ipAdapters: ['ip-adapter-faceid_sd15'] }),
            createDefaultFilters({ samplers: ['Euler a'] }),
            createDefaultFilters({ generationTypes: ['img2img'] }),
            createDefaultFilters({ minSteps: 40 }),
            createDefaultFilters({ maxSteps: 18 }),
            createDefaultFilters({ minCfg: 7 }),
            createDefaultFilters({ maxCfg: 4 }),
            createDefaultFilters({ favoritesOnly: true }),
            createDefaultFilters({ pinnedOnly: true }),
        ];

        cases.forEach(filters => {
            expect(searchBrowserMockImages(filters, 'date_desc', 1000).totalCount).toBeGreaterThan(0);
        });
        expect(searchBrowserMockImages(createDefaultFilters({ hypernetworks: ['missing'] }), 'date_desc', 1000).totalCount).toBe(0);
    });

    it('controls intermediate, grid, deleted, date, and collection visibility', () => {
        updateBrowserMockImage('mock_2', { isDeleted: true });
        expect(searchBrowserMockImages(createDefaultFilters({ searchQuery: 'file:0002' }), 'date_desc', 10).totalCount).toBe(0);

        const hiddenGenerated = searchBrowserMockImages(createDefaultFilters({ searchQuery: 'file:0001' }), 'date_desc', 10);
        const shownGenerated = searchBrowserMockImages(createDefaultFilters({
            searchQuery: 'file:0001', showIntermediates: true, showGrids: true
        }), 'date_desc', 10);
        expect(hiddenGenerated.totalCount).toBe(0);
        expect(shownGenerated.totalCount).toBe(1);

        const collectionResult = searchBrowserMockImages(createDefaultFilters({
            collectionId: 'mock_showcase', showIntermediates: true, showGrids: true
        }), 'date_desc', 1000);
        expect(collectionResult.totalCount).toBeGreaterThan(0);
        expect(collectionResult.images.every(image => Number(image.id.slice(5)) <= 18)).toBe(true);

        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        expect(searchBrowserMockImages(createDefaultFilters({
            dateRange: 'custom', dateFrom: future, dateTo: future
        }), 'date_desc', 1000).totalCount).toBe(0);
    });

    it('supports quoted, bang-negative, date, upscaled, and unknown scoped search tokens', () => {
        const positiveQueries = ['"neon rain"', 'neon !solarpunk', 'upscaled:false'];
        positiveQueries.forEach(searchQuery => {
            expect(searchBrowserMockImages(createDefaultFilters({ searchQuery }), 'date_desc', 1000).totalCount).toBeGreaterThan(0);
        });
        expect(searchBrowserMockImages(createDefaultFilters({ searchQuery: 'upscaled:true' }), 'date_desc', 1000).totalCount).toBe(0);
        expect(searchBrowserMockImages(createDefaultFilters({ searchQuery: 'unknown:value' }), 'date_desc', 1000).totalCount).toBe(0);
        expect(searchBrowserMockImages(createDefaultFilters({ searchQuery: ':neon' }), 'date_desc', 1000).totalCount).toBe(0);
    });

    it.each(['date_asc', 'name_desc', 'size_asc', 'size_desc', 'date_desc'] as const)(
        'sorts browser mock images with %s',
        (sortOption) => {
            const result = searchBrowserMockImages(createDefaultFilters(), sortOption, 1000);
            expect(result.images.length).toBeGreaterThan(1);
            expect(result.images[0].isPinned).toBe(true);
        }
    );

    it('builds every facet source with Any and All match modes and handles empty stats', () => {
        const cases = [
            ['models', 'Flux.1 Dev'], ['tools', 'comfyui'], ['loras', 'detail_tweaker_v1'],
            ['embeddings', 'easynegative'], ['hypernetworks', 'missing'],
            ['controlNets', 'control_v11p_sd15_canny'], ['ipAdapters', 'ip-adapter-faceid_sd15']
        ] as const;
        cases.forEach(([field, value]) => {
            const anyFacets = getBrowserMockFacets(createDefaultFilters({
                [field]: [value],
                matchModes: { [field]: 'any' }
            }));
            const allFacets = getBrowserMockFacets(createDefaultFilters({
                [field]: [value],
                matchModes: { [field]: 'all' }
            }));
            expect(anyFacets).toBeTruthy();
            expect(allFacets).toBeTruthy();
        });
        expect(getBrowserMockFacets(createDefaultFilters({ models: ['Flux.1 Dev'] })).checkpoints.length).toBeGreaterThan(1);
        expect(getBrowserMockFacets().checkpoints.length).toBeGreaterThan(0);

        const empty = getBrowserMockStatsSummary(createDefaultFilters({ models: ['does-not-exist'] }));
        expect(empty).toMatchObject({ totalImages: 0, avgSteps: 0, estSizeMB: '0.0' });
    });

    it('updates smart collections and safely ignores missing collection mutations', () => {
        const id = 'smart-browser-test';
        upsertBrowserMockCollection({
            id,
            name: 'Smart Browser Test',
            filters: createDefaultFilters({ favoritesOnly: true }),
            imageIds: []
        });
        upsertBrowserMockCollection({ id, name: 'Renamed Smart Browser Test' });
        const smart = getBrowserMockCollections().find(collection => collection.id === id);
        expect(smart?.name).toBe('Renamed Smart Browser Test');
        expect(smart?.count).toBeGreaterThan(0);

        addBrowserMockImagesToCollection('missing-collection', ['mock_1']);
        removeBrowserMockImagesFromCollection('missing-collection', ['mock_1']);
        updateBrowserMockImage('missing-image', { notes: 'ignored' });
        deleteBrowserMockCollection(id);
    });

    it('covers storage-free operation, smart recursion, advanced tokens, and sparse metadata', () => {
        const originalStorage = globalThis.localStorage;
        vi.stubGlobal('localStorage', undefined);
        expect(getBrowserMockImages()).toHaveLength(180);
        upsertBrowserMockCollection({ id: 'memory-only', name: 'Memory Only' });
        vi.stubGlobal('localStorage', originalStorage);

        const source = getBrowserMockImages().find(image => image.id === 'mock_3')!;
        updateBrowserMockImage('mock_3', {
            width: undefined as unknown as number,
            metadata: {
                ...source.metadata,
                model: undefined as unknown as string,
                hypernetworks: ['browser-hypernetwork']
            }
        });

        expect(searchBrowserMockImages(createDefaultFilters({ searchQuery: 'w:832' }), 'date_desc', 1000).totalCount).toBeGreaterThan(0);
        expect(searchBrowserMockImages(createDefaultFilters({ searchQuery: 'before:2999-01-01' }), 'date_desc', 1000).totalCount).toBeGreaterThan(0);
        expect(searchBrowserMockImages(createDefaultFilters({ searchQuery: 'OR neon' }), 'date_desc', 1000).totalCount).toBeGreaterThan(0);

        const smart = searchBrowserMockImages(createDefaultFilters({
            collectionId: 'mock_favorites', showIntermediates: true, showGrids: true
        }), 'date_desc', 1000);
        expect(smart.totalCount).toBeGreaterThan(0);
        expect(smart.images.every(image => image.isFavorite)).toBe(true);

        expect(getBrowserMockFacets().checkpoints.every(item => Boolean(item.name))).toBe(true);
        expect(getBrowserMockStatsSummary(createDefaultFilters()).modelStats.length).toBeGreaterThan(1);
        expect(getBrowserMockValidFacetNames(createDefaultFilters()).hypernetworks).toContain('browser-hypernetwork');
        deleteBrowserMockCollection('memory-only');
        vi.unstubAllGlobals();
    });

    it('covers persisted defaults, sparse resources, negative scopes, and sort tie-breakers', () => {
        localStorage.setItem('ambit_browser_mock_state_v1', JSON.stringify({
            collections: [],
            settings: { thumbnailSize: 222 }
        }));
        expect(getBrowserMockImages()).toHaveLength(180);

        const image3 = getBrowserMockImages().find(image => image.id === 'mock_3')!;
        const image4 = getBrowserMockImages().find(image => image.id === 'mock_4')!;
        updateBrowserMockImage('mock_3', {
            timestamp: 12345,
            fileSize: undefined,
            metadata: {
                ...image3.metadata,
                loras: undefined,
                controlNets: undefined,
                ipAdapters: undefined,
                generationType: undefined
            }
        });
        updateBrowserMockImage('mock_4', {
            timestamp: 12345,
            fileSize: undefined,
            metadata: { ...image4.metadata, generationType: undefined }
        });

        for (const searchQuery of ['lora:missing', 'cn:missing', 'ip:missing']) {
            expect(searchBrowserMockImages(createDefaultFilters({ searchQuery, showIntermediates: true, showGrids: true }), 'date_desc', 1000).totalCount).toBe(0);
        }
        expect(searchBrowserMockImages(createDefaultFilters({ searchQuery: '-model:flux' }), 'date_desc', 1000).totalCount).toBeGreaterThan(0);
        expect(searchBrowserMockImages(createDefaultFilters({ generationTypes: ['unknown'] }), 'date_desc', 1000).totalCount).toBeGreaterThan(0);

        upsertBrowserMockCollection({
            id: 'dated-smart', name: 'Dated Smart', imageIds: [],
            filters: createDefaultFilters({ favoritesOnly: true })
        });
        const smartWithDate = searchBrowserMockImages(createDefaultFilters({
            collectionId: 'dated-smart', dateRange: 'today', showIntermediates: true, showGrids: true
        }), 'date_desc', 1000);
        expect(smartWithDate.images.every(image => image.isFavorite)).toBe(true);
        deleteBrowserMockCollection('dated-smart');

        for (const sortOption of ['date_asc', 'date_desc', 'size_asc', 'size_desc'] as const) {
            const result = searchBrowserMockImages(createDefaultFilters({ showIntermediates: true, showGrids: true }), sortOption, 1000);
            expect(result.images).toHaveLength(179);
        }
        expect(getBrowserMockStatsSummary(createDefaultFilters({ showIntermediates: true, showGrids: true })).estSizeMB).toMatch(/^\d+\.\d$/);
    });
});
