import { beforeEach, describe, expect, it } from 'vitest';
import { getBrowserMockFacets, searchBrowserMockImages } from '../browserMockData';
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
});
