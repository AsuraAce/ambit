import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';
import { useParameterRangesQuery } from '../useParameterRangesQuery';

const state = vi.hoisted(() => ({ browser: false, facetCacheVersion: 3 }));
const mocks = vi.hoisted(() => ({ getParameterRanges: vi.fn(), buildSql: vi.fn(), getImages: vi.fn() }));
vi.mock('../../services/runtime', () => ({ isBrowserMockMode: () => state.browser }));
vi.mock('../../bindings', () => ({ commands: { getParameterRanges: mocks.getParameterRanges } }));
vi.mock('../../utils/sqlHelpers', () => ({ buildSqlWhereClause: mocks.buildSql }));
vi.mock('../../services/browserMockData', () => ({ getBrowserMockImages: mocks.getImages }));
vi.mock('../../contexts/SettingsContext', () => ({ useSettings: () => ({ settings: { maskingMode: 'blur', maskedKeywords: ['secret'] }, privacyEnabled: true }) }));
vi.mock('../../contexts/CollectionContext', () => ({ useCollections: () => ({ collections: [] }) }));
vi.mock('../../stores/libraryStore', () => ({ useLibraryStore: (selector: (value: typeof state) => unknown) => selector(state) }));
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (value: { privacyMaskIndexStatus: 'ready' }) => unknown) => selector({ privacyMaskIndexStatus: 'ready' })
}));
vi.mock('../useDebouncedSideQueryFilters', () => ({ useDebouncedSideQueryFilters: (filters: unknown) => filters }));

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useParameterRangesQuery additional paths', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.browser = false;
        mocks.buildSql.mockReturnValue({ where: 'WHERE model = ?', params: ['flux'], collectionId: 'c1', loraName: 'detail' });
    });

    it('derives browser ranges and unique facets from mock images', async () => {
        state.browser = true;
        mocks.getImages.mockReturnValue([
            { metadata: { steps: 10, cfg: 4, sampler: 'Euler', generationType: undefined, controlNets: ['depth'], ipAdapters: [] } },
            { metadata: { steps: 30, cfg: 8, sampler: 'Euler', generationType: 'img2img', controlNets: undefined, ipAdapters: ['face'] } },
            { metadata: { steps: 20, cfg: 6, sampler: 'DPM', generationType: 'img2img', controlNets: ['depth'], ipAdapters: undefined } },
        ]);
        const { result } = renderHook(() => useParameterRangesQuery(createDefaultFilters()), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toMatchObject({
            steps: { min: 10, max: 30 }, cfg: { min: 4, max: 8 },
            samplers: ['Euler', 'DPM'], generationTypes: ['unknown', 'img2img'], controlNets: ['depth'], ipAdapters: ['face'],
        });
    });

    it('passes disjunctive exclusions and unwraps native success', async () => {
        const data = { steps: null, cfg: null, denoisingStrength: null, samplers: [], generationTypes: [], controlNets: [], ipAdapters: [], guidanceSubtypes: {} };
        mocks.getParameterRanges.mockResolvedValue({ status: 'ok', data });
        const filters = createDefaultFilters({ searchQuery: '  portrait  ', tools: [GeneratorTool.COMFYUI] });
        const { result } = renderHook(() => useParameterRangesQuery(filters), { wrapper });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mocks.buildSql).toHaveBeenCalledWith(filters, true, 'blur', ['secret'], [], false, ['samplers', 'generationTypes', 'controlNets', 'ipAdapters']);
        expect(mocks.getParameterRanges).toHaveBeenCalledWith('WHERE model = ?', '["flux"]', 'c1', 'detail');
        expect(result.current.data).toBe(data);
    });

    it('uses null optional identifiers and exposes native errors', async () => {
        mocks.buildSql.mockReturnValue({ where: '', params: [], collectionId: undefined, loraName: undefined });
        mocks.getParameterRanges.mockResolvedValue({ status: 'error', error: 'query failed' });
        const { result } = renderHook(() => useParameterRangesQuery(createDefaultFilters()), { wrapper });
        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(mocks.getParameterRanges).toHaveBeenCalledWith('', '[]', null, null);
        expect(result.current.error).toEqual(new Error('query failed'));
    });
});
