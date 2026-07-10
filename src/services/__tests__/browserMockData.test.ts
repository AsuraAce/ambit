import { beforeEach, describe, expect, it } from 'vitest';
import {
    addBrowserMockImagesToCollection,
    deleteBrowserMockCollection,
    getBrowserMockCollections,
    getBrowserMockKeywordStats,
    getBrowserMockStats,
    getBrowserMockStatsSummary,
    getBrowserMockValidFacetNames,
    getBrowserMockFacets,
    removeBrowserMockImagesFromCollection,
    searchBrowserMockImages,
    updateBrowserMockImage,
    upsertBrowserMockCollection,
} from '../browserMockData';
import { createDefaultFilters } from '../../utils/filterState';

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
});
