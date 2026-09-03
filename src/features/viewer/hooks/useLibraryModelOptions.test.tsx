import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryModelOptions } from './useLibraryModelOptions';

const mocks = vi.hoisted(() => ({
    getFacets: vi.fn(),
}));

vi.mock('../../../services/runtime', () => ({ isBrowserMockMode: () => false }));
vi.mock('../../../services/db/searchRepo', () => ({ getFacets: mocks.getFacets }));

describe('useLibraryModelOptions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getFacets.mockResolvedValue({
            checkpoints: [
                { name: '  Zebra Model  ', count: 1 },
                { name: 'alpha model', count: 2 },
                { name: 'ALPHA MODEL', count: 3 },
                { name: 'Unknown', count: 4 },
            ],
        });
    });

    it('loads global checkpoint choices and normalizes them for the shared editor', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result } = renderHook(() => useLibraryModelOptions(), { wrapper });

        await waitFor(() => expect(result.current).toEqual(['alpha model', 'Zebra Model']));
        expect(mocks.getFacets).toHaveBeenCalledWith('', [], ['checkpoints'], { assetScope: 'all' });
    });
});
