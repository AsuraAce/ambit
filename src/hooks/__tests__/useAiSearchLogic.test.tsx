
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAiSearchLogic } from '../useAiSearchLogic';
import { AppSettings, FilterState } from '../../types';

// --- Mocks ---
const mockAddToast = vi.fn();
vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

const mockGenerateFilters = vi.fn();
vi.mock('../../services/geminiService', () => ({
    generateFiltersFromQuery: (...args: any[]) => mockGenerateFilters(...args),
}));

describe('useAiSearchLogic', () => {
    const mockSetFilters = vi.fn();
    const mockSetRecentSearches = vi.fn();
    const mockOnOpenSettings = vi.fn();

    const mockSettings: AppSettings = {
        enableAI: true,
        googleGeminiApiKey: 'test-key',
        confirmDelete: true,
        thumbnailSize: 200,
        theme: 'dark',
        hasCompletedOnboarding: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
        maskedKeywords: [],
        maskingMode: 'blur'
    };

    const mockFilters: FilterState = {
        searchQuery: '',
        models: [],
        tools: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        dateRange: 'all',
        favoritesOnly: false,
        collectionId: null
    };

    const props = {
        filters: mockFilters,
        setFilters: mockSetFilters,
        settings: mockSettings,
        setRecentSearches: mockSetRecentSearches,
        availableTags: ['tag1'],
        onOpenSettings: mockOnOpenSettings,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should toggle AI search enabled state', () => {
        const { result } = renderHook(() => useAiSearchLogic(props));

        act(() => {
            result.current.toggleAiSearch();
        });

        expect(result.current.isAiSearchEnabled).toBe(true);
    });

    it('should prompt to enable AI if settings are off', () => {
        const disabledSettings = { ...mockSettings, enableAI: false };
        const { result } = renderHook(() => useAiSearchLogic({ ...props, settings: disabledSettings }));

        act(() => {
            result.current.toggleAiSearch();
        });

        expect(mockOnOpenSettings).toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Enable AI'), 'info');
    });

    it('should submit search and update recent searches', async () => {
        const { result } = renderHook(() => useAiSearchLogic(props));

        await act(async () => {
            await result.current.submitSearch('sunset');
        });

        expect(mockSetFilters).toHaveBeenCalledWith(expect.any(Function));
        expect(mockSetRecentSearches).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should call Gemini if AI search is enabled', async () => {
        const { result } = renderHook(() => useAiSearchLogic(props));

        // Turn it on first
        act(() => {
            result.current.toggleAiSearch();
        });

        mockGenerateFilters.mockResolvedValue({
            models: ['SDXL'],
            searchQuery: 'sunset'
        });

        await act(async () => {
            await result.current.submitSearch('find sunsets');
        });

        expect(mockGenerateFilters).toHaveBeenCalledWith('find sunsets', 'test-key');
        expect(mockSetFilters).toHaveBeenCalledTimes(2); // Local set + AI results set
        expect(mockAddToast).toHaveBeenCalledWith('Filters updated by AI', 'success');
    });

    it('should handle AI search failure gracefully', async () => {
        const { result } = renderHook(() => useAiSearchLogic(props));

        act(() => {
            result.current.toggleAiSearch();
        });

        mockGenerateFilters.mockRejectedValue(new Error('API fail'));

        await act(async () => {
            await result.current.submitSearch('broken search');
        });

        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('failed'), 'error');
    });
});
