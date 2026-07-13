import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countTouchedFacetResources, refreshStartupFacetCache } from '../startupFacetRefresh';

const mocks = vi.hoisted(() => ({
    rebuildFacetCacheStrict: vi.fn(),
    refreshFacetCacheForResourcesStrict: vi.fn()
}));

vi.mock('../../services/db/imageRepo', () => ({
    rebuildFacetCacheStrict: mocks.rebuildFacetCacheStrict,
    refreshFacetCacheForResourcesStrict: mocks.refreshFacetCacheForResourcesStrict
}));

vi.mock('../liveWatchPerf', () => ({
    elapsedMs: vi.fn(() => 1),
    liveWatchNow: vi.fn(() => 1000)
}));

const touchedResources = {
    checkpoints: ['Flux Base'],
    loras: ['CinematicDetail'],
    embeddings: [],
    hypernetworks: [],
    controlNets: [],
    ipAdapters: [],
    tools: ['InvokeAI']
};

describe('refreshStartupFacetCache', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.rebuildFacetCacheStrict.mockResolvedValue(99);
        mocks.refreshFacetCacheForResourcesStrict.mockResolvedValue(3);
    });

    it('uses resource-incremental refresh for small known startup deltas', async () => {
        const onRefreshApplied = vi.fn();

        const result = await refreshStartupFacetCache({
            source: 'invoke',
            totalProcessed: 2,
            touchedFacetTypes: ['checkpoints', 'loras', 'tools'],
            touchedFacetResources: touchedResources,
            orphanScanEnabled: false,
            onRefreshApplied
        });

        expect(result.strategy).toBe('resource-incremental');
        expect(result.reason).toBe('small-known-delta');
        expect(mocks.refreshFacetCacheForResourcesStrict).toHaveBeenCalledWith(touchedResources);
        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        expect(onRefreshApplied).toHaveBeenCalledTimes(1);
    });

    it('skips refresh when startup processed no changes', async () => {
        const onRefreshApplied = vi.fn();

        const result = await refreshStartupFacetCache({
            source: 'invoke',
            totalProcessed: 0,
            touchedFacetTypes: [],
            touchedFacetResources: {
                checkpoints: [],
                loras: [],
                embeddings: [],
                hypernetworks: [],
                controlNets: [],
                ipAdapters: [],
                tools: []
            },
            orphanScanEnabled: false,
            onRefreshApplied
        });

        expect(result.strategy).toBe('skipped');
        expect(result.reason).toBe('no-changes');
        expect(mocks.refreshFacetCacheForResourcesStrict).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCacheStrict).not.toHaveBeenCalled();
        expect(onRefreshApplied).not.toHaveBeenCalled();
    });

    it('keeps the full rebuild path when the startup delta is too large', async () => {
        const onRefreshApplied = vi.fn();

        const result = await refreshStartupFacetCache({
            source: 'invoke',
            totalProcessed: 501,
            touchedFacetTypes: ['checkpoints'],
            touchedFacetResources: touchedResources,
            orphanScanEnabled: false,
            onRefreshApplied
        });

        expect(result.strategy).toBe('full');
        expect(result.reason).toBe('delta-too-large');
        expect(mocks.refreshFacetCacheForResourcesStrict).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCacheStrict).toHaveBeenCalledTimes(1);
        expect(onRefreshApplied).toHaveBeenCalledTimes(1);
    });

    it('keeps the full rebuild path when orphan scanning ran', async () => {
        const onRefreshApplied = vi.fn();

        const result = await refreshStartupFacetCache({
            source: 'invoke',
            totalProcessed: 1,
            touchedFacetTypes: ['checkpoints'],
            touchedFacetResources: touchedResources,
            orphanScanEnabled: true,
            onRefreshApplied
        });

        expect(result.strategy).toBe('full');
        expect(result.reason).toBe('orphan-scan-enabled');
        expect(mocks.refreshFacetCacheForResourcesStrict).not.toHaveBeenCalled();
        expect(mocks.rebuildFacetCacheStrict).toHaveBeenCalledTimes(1);
    });

    it('falls back to a full rebuild when resource-incremental refresh fails', async () => {
        const onRefreshApplied = vi.fn();
        mocks.refreshFacetCacheForResourcesStrict.mockRejectedValueOnce(new Error('boom'));

        const result = await refreshStartupFacetCache({
            source: 'folder',
            totalProcessed: 1,
            touchedFacetTypes: ['loras'],
            touchedFacetResources: touchedResources,
            orphanScanEnabled: false,
            onRefreshApplied
        });

        expect(result.strategy).toBe('fallback-full');
        expect(result.reason).toBe('incremental-failure');
        expect(mocks.refreshFacetCacheForResourcesStrict).toHaveBeenCalledTimes(1);
        expect(mocks.rebuildFacetCacheStrict).toHaveBeenCalledTimes(1);
        expect(onRefreshApplied).toHaveBeenCalledTimes(1);
    });

    it('uses a full rebuild when touched resource details are missing or empty', async () => {
        const empty = {
            checkpoints: [], loras: [], embeddings: [], hypernetworks: [],
            controlNets: [], ipAdapters: [], tools: [],
        };

        const missing = await refreshStartupFacetCache({
            source: 'folder',
            totalProcessed: 1,
            touchedFacetTypes: ['tools'],
            onRefreshApplied: vi.fn(),
        });
        const emptyResult = await refreshStartupFacetCache({
            source: 'folder',
            totalProcessed: 1,
            touchedFacetTypes: ['tools'],
            touchedFacetResources: empty,
            onRefreshApplied: vi.fn(),
        });

        expect(missing.reason).toBe('missing-touched-resources');
        expect(emptyResult.reason).toBe('missing-touched-resources');
        expect(countTouchedFacetResources()).toBe(0);
        expect(countTouchedFacetResources(touchedResources)).toBe(3);
    });

    it('uses a full rebuild when resource cardinality exceeds the configured limit', async () => {
        const result = await refreshStartupFacetCache({
            source: 'invoke',
            totalProcessed: 1,
            touchedFacetTypes: [],
            touchedFacetResources: touchedResources,
            maxProcessed: 1,
            maxTouchedResources: 2,
            onRefreshApplied: vi.fn(),
        });

        expect(result.strategy).toBe('full');
        expect(result.reason).toBe('too-many-touched-resources');
    });

    it('formats non-Error incremental failures before falling back', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.refreshFacetCacheForResourcesStrict.mockRejectedValueOnce('offline');

        const result = await refreshStartupFacetCache({
            source: 'folder',
            totalProcessed: 1,
            touchedFacetTypes: [],
            touchedFacetResources: touchedResources,
            onRefreshApplied: vi.fn(),
        });

        expect(result.strategy).toBe('fallback-full');
        expect(warn).toHaveBeenCalledWith(
            '[Startup Facets] Incremental refresh failed; falling back to full rebuild.',
            expect.objectContaining({ error: 'offline' })
        );
        warn.mockRestore();
    });
});
