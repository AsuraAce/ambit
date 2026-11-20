import { useLayoutEffect } from 'react';
import { renderHook, act } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAiSearchLogic } from '../useAiSearchLogic';
import { AppSettings, FilterState } from '../../types';
import { DEFAULT_AI_MODEL } from '../../constants/aiModels';

// --- Mocks ---
const mockAddToast = vi.fn();
vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

const mockGenerateFilters = vi.fn();
vi.mock('../../services/geminiService', () => ({
    generateFiltersFromQuery: (...args: unknown[]) => mockGenerateFilters(...args),
}));

// Mock useSettingsStore
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: {
        getState: () => ({ geminiApiKey: 'test-key' }),
    },
}));

describe('useAiSearchLogic', () => {
    const mockSetFilters = vi.fn();
    const mockSetRecentSearches = vi.fn();
    const mockOnOpenSettings = vi.fn();

    const mockSettings: AppSettings = {
        enableAI: true,
        confirmDelete: true,
        thumbnailSize: 200,
        theme: 'dark',
        hasCompletedOnboarding: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
        promptMaskingEnabled: true,
        maskedKeywords: [],
        maskingMode: 'blur',
    };

    const mockFilters: FilterState = {
        searchQuery: '',
        models: [],
        tools: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        controlNets: [],
        ipAdapters: [],
        samplers: [],
        generationTypes: [],
        dateRange: 'all',
        favoritesOnly: false,
        collectionId: null,
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

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
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
        const blur = vi.fn();
        result.current.inputRef.current = { blur } as unknown as HTMLInputElement;

        await act(async () => {
            await result.current.submitSearch('sunset');
        });

        expect(mockSetFilters).toHaveBeenCalledWith(expect.any(Function));
        expect(mockSetRecentSearches).toHaveBeenCalledWith(expect.any(Function));
        const updateFilters = mockSetFilters.mock.calls[0][0] as (filters: FilterState) => FilterState;
        expect(updateFilters(mockFilters).searchQuery).toBe('sunset');
        const updateRecent = mockSetRecentSearches.mock.calls[0][0] as (searches: string[]) => string[];
        expect(updateRecent(['older', 'sunset', 'third'])).toEqual(['sunset', 'older', 'third']);
        expect(blur).toHaveBeenCalledTimes(1);
    });

    it('should call Gemini if AI search is enabled', async () => {
        const { result } = renderHook(() => useAiSearchLogic(props));
        const blur = vi.fn();
        result.current.inputRef.current = { blur } as unknown as HTMLInputElement;

        // Turn it on first
        act(() => {
            result.current.toggleAiSearch();
        });

        mockGenerateFilters.mockResolvedValue({
            models: ['SDXL'],
            searchQuery: 'sunset',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-30',
        });

        await act(async () => {
            await result.current.submitSearch('find sunsets');
        });

        expect(mockGenerateFilters).toHaveBeenCalledWith('find sunsets', 'test-key', DEFAULT_AI_MODEL, undefined, 'default');
        expect(mockSetFilters).toHaveBeenCalledTimes(1);
        const aiUpdate = mockSetFilters.mock.calls[0][0] as (prev: FilterState) => FilterState;
        expect(aiUpdate(mockFilters)).toMatchObject({
            searchQuery: 'sunset',
            models: ['SDXL'],
            dateRange: 'custom',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-30',
        });
        expect(mockAddToast).toHaveBeenCalledWith('Filters updated by AI', 'success');
        expect(blur).toHaveBeenCalledOnce();
    });

    it('should forward the FILTERS prompt override when developer features are enabled', async () => {
        vi.stubEnv('DEV', true);
        const systemPrompts = {
            FILTERS: 'Custom filter instructions for {{query}} on {{today}}.',
        };
        const developerSettings: AppSettings = {
            ...mockSettings,
            devMode: true,
            systemPrompts,
        };
        const { result } = renderHook(() =>
            useAiSearchLogic({
                ...props,
                settings: developerSettings,
            })
        );

        act(() => {
            result.current.toggleAiSearch();
        });

        mockGenerateFilters.mockResolvedValue({});

        await act(async () => {
            await result.current.submitSearch('find portraits');
        });

        expect(mockGenerateFilters).toHaveBeenCalledWith('find portraits', 'test-key', DEFAULT_AI_MODEL, systemPrompts, 'default');
    });

    it('should handle AI search failure gracefully', async () => {
        const { result } = renderHook(() => useAiSearchLogic(props));
        const focus = vi.fn();
        const blur = vi.fn();
        result.current.inputRef.current = { focus, blur } as unknown as HTMLInputElement;

        act(() => {
            result.current.toggleAiSearch();
        });

        mockGenerateFilters.mockRejectedValue(new Error('API fail'));

        await act(async () => {
            await result.current.submitSearch('broken search');
        });

        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('failed'), 'error');
        expect(mockSetFilters).not.toHaveBeenCalled();
        expect(focus).toHaveBeenCalledOnce();
        expect(blur).not.toHaveBeenCalled();
    });

    it('activates pending AI search after Settings enables the feature and focuses the input', async () => {
        vi.useFakeTimers();
        const disabledSettings = { ...mockSettings, enableAI: false };
        const { result, rerender } = renderHook(({ settings }) => useAiSearchLogic({ ...props, settings }), {
            initialProps: { settings: disabledSettings },
        });
        const focus = vi.fn();
        result.current.inputRef.current = { focus } as unknown as HTMLInputElement;
        act(() => result.current.toggleAiSearch());

        rerender({ settings: mockSettings });
        await act(async () => vi.advanceTimersByTimeAsync(100));

        expect(result.current.isAiSearchEnabled).toBe(true);
        expect(focus).toHaveBeenCalledTimes(1);
        expect(mockAddToast).toHaveBeenCalledWith('AI Features Enabled & Ready', 'success');
    });

    // The toast and focus are side effects of the activation; a re-render or a later settings change must not repeat them.
    it('announces a pending activation exactly once, even across later re-renders', async () => {
        vi.useFakeTimers();
        const disabledSettings = { ...mockSettings, enableAI: false };
        const { result, rerender } = renderHook(({ settings }) => useAiSearchLogic({ ...props, settings }), {
            initialProps: { settings: disabledSettings },
        });
        const focus = vi.fn();
        result.current.inputRef.current = { focus } as unknown as HTMLInputElement;
        act(() => result.current.toggleAiSearch());

        rerender({ settings: mockSettings });
        rerender({ settings: { ...mockSettings } });
        await act(async () => vi.advanceTimersByTimeAsync(500));

        const readyToasts = mockAddToast.mock.calls.filter(([message]) => message === 'AI Features Enabled & Ready');
        expect(readyToasts).toEqual([['AI Features Enabled & Ready', 'success']]);
        expect(focus).toHaveBeenCalledTimes(1);
        expect(result.current.isAiSearchEnabled).toBe(true);
    });

    // The search box must not flash an AI-off frame between Settings enabling AI and the pending toggle taking effect.
    it('shows AI search on in the first committed frame once Settings enables a pending activation', async () => {
        vi.useFakeTimers();
        const frames: boolean[] = [];
        const disabledSettings = { ...mockSettings, enableAI: false };
        const { result, rerender } = renderHook(
            ({ settings }) => {
                const value = useAiSearchLogic({ ...props, settings });
                useLayoutEffect(() => {
                    frames.push(value.isAiSearchEnabled);
                });
                return value;
            },
            { initialProps: { settings: disabledSettings } }
        );
        act(() => result.current.toggleAiSearch());

        frames.length = 0;
        rerender({ settings: mockSettings });

        expect(frames).toEqual([true]);
        await act(async () => vi.advanceTimersByTimeAsync(100));
    });

    it('focuses the input only after the 100 ms timeout when activating a pending toggle', async () => {
        vi.useFakeTimers();
        const disabledSettings = { ...mockSettings, enableAI: false };
        const { result, rerender } = renderHook(({ settings }) => useAiSearchLogic({ ...props, settings }), {
            initialProps: { settings: disabledSettings },
        });
        const focus = vi.fn();
        result.current.inputRef.current = { focus } as unknown as HTMLInputElement;
        act(() => result.current.toggleAiSearch());

        rerender({ settings: mockSettings });
        await act(async () => vi.advanceTimersByTimeAsync(99));
        expect(focus).not.toHaveBeenCalled();

        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(focus).toHaveBeenCalledTimes(1);
    });

    // The hook reports `isAiSearchEnabled && settings.enableAI`, so the stored flag is only visible when the setting comes back.
    it('turns AI search off for good when the enableAI setting is disabled', () => {
        const { result, rerender } = renderHook(({ settings }) => useAiSearchLogic({ ...props, settings }), {
            initialProps: { settings: mockSettings },
        });
        act(() => result.current.toggleAiSearch());
        expect(result.current.isAiSearchEnabled).toBe(true);

        rerender({ settings: { ...mockSettings, enableAI: false } });
        expect(result.current.isAiSearchEnabled).toBe(false);

        rerender({ settings: mockSettings });
        expect(result.current.isAiSearchEnabled).toBe(false);
    });

    it('focuses when toggled on and can toggle back off', async () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useAiSearchLogic(props));
        const focus = vi.fn();
        result.current.inputRef.current = { focus } as unknown as HTMLInputElement;

        act(() => result.current.toggleAiSearch());
        await act(async () => vi.advanceTimersByTimeAsync(100));
        expect(focus).toHaveBeenCalledTimes(1);
        act(() => result.current.toggleAiSearch());
        expect(result.current.isAiSearchEnabled).toBe(false);
    });

    it('ignores blank search submissions', async () => {
        const { result } = renderHook(() => useAiSearchLogic(props));

        await act(async () => result.current.submitSearch('   '));

        expect(mockSetFilters).not.toHaveBeenCalled();
        expect(mockSetRecentSearches).not.toHaveBeenCalled();
    });

    it('applies neutral defaults when AI returns an empty filter object', async () => {
        const { result } = renderHook(() => useAiSearchLogic(props));
        act(() => result.current.toggleAiSearch());
        mockGenerateFilters.mockResolvedValue({});

        await act(async () => result.current.submitSearch('anything'));

        const update = mockSetFilters.mock.calls[0][0] as (filters: FilterState) => FilterState;
        expect(update({ ...mockFilters, favoritesOnly: true })).toMatchObject({
            searchQuery: '',
            models: [],
            tools: [],
            dateRange: 'all',
            favoritesOnly: false,
        });
    });

    it('ignores repeated AI submissions while the first request is active', async () => {
        let resolveFilters: ((value: Record<string, never>) => void) | undefined;
        const pendingFilters = new Promise<Record<string, never>>((resolve) => {
            resolveFilters = resolve;
        });
        const { result } = renderHook(() => useAiSearchLogic(props));
        act(() => result.current.toggleAiSearch());
        mockGenerateFilters.mockReturnValue(pendingFilters);

        let firstRequest: Promise<void> | undefined;
        await act(async () => {
            firstRequest = result.current.submitSearch('find portraits');
            await result.current.submitSearch('find portraits');
        });

        expect(mockGenerateFilters).toHaveBeenCalledOnce();
        expect(mockSetRecentSearches).toHaveBeenCalledOnce();

        await act(async () => {
            resolveFilters?.({});
            await firstRequest;
        });
    });
});
