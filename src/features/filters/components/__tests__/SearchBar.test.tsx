import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../../../../test/testUtils';
import { SearchBar } from '../SearchBar';
import { FilterState } from '../../../../types';
import { createDefaultFilters } from '../../../../utils/filterState';

const searchContextMocks = vi.hoisted(() => ({
    useSearch: vi.fn(),
}));

vi.mock('../../../../contexts/SearchContext', () => ({
    useSearch: searchContextMocks.useSearch,
}));

const createSearchProps = (overrides: Partial<React.ComponentProps<typeof SearchBar>['searchProps']> = {}) => ({
    isAiSearchEnabled: false,
    isSearchingAi: false,
    inputRef: React.createRef<HTMLInputElement>(),
    toggleAiSearch: vi.fn(),
    submitSearch: vi.fn(),
    isFocused: true,
    onFocus: vi.fn(),
    onBlur: vi.fn(),
    ...overrides,
});

interface SearchHarnessOptions {
    searchProps?: Partial<React.ComponentProps<typeof SearchBar>['searchProps']>;
    recentSearches?: string[];
    setRecentSearches?: React.Dispatch<React.SetStateAction<string[]>>;
}

const renderSearchBar = (initialFilters: FilterState = createDefaultFilters(), options: SearchHarnessOptions = {}) => {
    let currentFilters = initialFilters;
    const setFilters = vi.fn((update: React.SetStateAction<FilterState>) => {
        currentFilters = typeof update === 'function'
            ? update(currentFilters)
            : update;
    });
    const searchProps = createSearchProps(options.searchProps);
    const setRecentSearches = options.setRecentSearches ?? vi.fn();

    searchContextMocks.useSearch.mockImplementation(() => ({
        filters: currentFilters,
        setFilters,
    }));

    const view = render(
        <SearchBar
            filters={currentFilters}
            setFilters={setFilters}
            searchProps={searchProps}
            recentSearches={options.recentSearches ?? []}
            setRecentSearches={setRecentSearches}
        />
    );

    return {
        ...view,
        getCurrentFilters: () => currentFilters,
        searchProps,
        setFilters,
        setRecentSearches,
        setExternalFilters: (filters: FilterState) => { currentFilters = filters; },
    };
};

describe('SearchBar advanced date syntax guard', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps incomplete date syntax local and shows a hint', () => {
        const harness = renderSearchBar();

        fireEvent.change(screen.getByPlaceholderText('Search prompt...'), {
            target: { value: 'date:2026-' },
        });

        act(() => {
            vi.advanceTimersByTime(600);
        });

        expect(harness.setFilters).not.toHaveBeenCalled();
        expect(screen.getByRole('status').textContent).toBe('Use ISO dates like date:2026-04 or before:2025');
    });

    it('commits valid date syntax after the main debounce', () => {
        const harness = renderSearchBar();

        fireEvent.change(screen.getByPlaceholderText('Search prompt...'), {
            target: { value: 'date:2026-04' },
        });

        act(() => {
            vi.advanceTimersByTime(500);
        });

        expect(harness.setFilters).toHaveBeenCalledTimes(1);
        expect(harness.getCurrentFilters().searchQuery).toBe('date:2026-04');
    });

    it('does not submit invalid date syntax on Enter', () => {
        const harness = renderSearchBar();
        const input = screen.getByPlaceholderText('Search prompt...');

        fireEvent.change(input, {
            target: { value: 'before:june-2024' },
        });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(harness.setFilters).not.toHaveBeenCalled();
        expect(harness.searchProps.submitSearch).not.toHaveBeenCalled();
    });

    it('does not commit a date operator suggestion before a value exists', () => {
        const harness = renderSearchBar();

        fireEvent.change(screen.getByPlaceholderText('Search prompt...'), {
            target: { value: 'dat' },
        });
        fireEvent.mouseDown(screen.getByRole('button', { name: 'date:' }));

        expect(harness.setFilters).not.toHaveBeenCalled();
    });

    it('replaces a pending debounce and commits only the latest query', () => {
        const harness = renderSearchBar();
        const input = screen.getByPlaceholderText('Search prompt...');
        fireEvent.change(input, { target: { value: 'first' } });
        fireEvent.change(input, { target: { value: 'second' } });
        act(() => vi.advanceTimersByTime(500));
        expect(harness.setFilters).toHaveBeenCalledOnce();
        expect(harness.getCurrentFilters().searchQuery).toBe('second');
    });

    it('syncs local input when the context query changes externally', () => {
        const harness = renderSearchBar(createDefaultFilters({ searchQuery: 'initial' }));
        harness.setExternalFilters(createDefaultFilters({ searchQuery: 'external' }));
        harness.rerender(
            <SearchBar
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
                searchProps={harness.searchProps}
                recentSearches={[]}
                setRecentSearches={harness.setRecentSearches}
            />
        );
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('external');
    });

    it('navigates suggestions with arrows and selects with Enter and Tab', () => {
        const harness = renderSearchBar();
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'to' } });
        expect(screen.getByRole('button', { name: 'tool:' })).not.toBeNull();
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect((input as HTMLInputElement).value).toBe('tool: ');
        expect(harness.getCurrentFilters().searchQuery).toBe('tool: ');

        fireEvent.change(input, { target: { value: 'model: x fi' } });
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Tab' });
        expect((input as HTMLInputElement).value).toBe('model: x file: ');
    });

    it('falls through unrelated keys and submits when no suggestion is active', () => {
        const harness = renderSearchBar();
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'to' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(harness.searchProps.submitSearch).toHaveBeenCalledWith('to');

        fireEvent.change(input, { target: { value: 'portrait' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(harness.searchProps.submitSearch).toHaveBeenCalledTimes(1);
    });

    it('selects suggestions with the pointer and clears suggestions for blank tokens', () => {
        renderSearchBar();
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'lo' } });
        fireEvent.mouseDown(screen.getByRole('button', { name: 'lora:' }));
        expect((input as HTMLInputElement).value).toBe('lora: ');
        fireEvent.change(input, { target: { value: ' ' } });
        expect(screen.queryByText('Suggestions')).toBeNull();
    });

    it('submits ordinary searches on Enter', () => {
        const harness = renderSearchBar();
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'portrait' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(harness.getCurrentFilters().searchQuery).toBe('portrait');
        expect(harness.searchProps.submitSearch).toHaveBeenCalledWith('portrait');
    });

    it('clears the query, suggestions, and focuses the input', () => {
        const inputRef = React.createRef<HTMLInputElement>();
        const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');
        const harness = renderSearchBar(createDefaultFilters({ searchQuery: 'portrait' }), { searchProps: { inputRef } });
        fireEvent.click(screen.getAllByRole('button')[0]);
        expect(harness.getCurrentFilters().searchQuery).toBe('');
        expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
        expect(focus).toHaveBeenCalled();
        focus.mockRestore();
    });

    it('clears and runs recent searches without blurring', () => {
        const setRecentSearches = vi.fn();
        const harness = renderSearchBar(createDefaultFilters(), { recentSearches: ['sunset'], setRecentSearches });
        const clear = screen.getByRole('button', { name: 'Clear' });
        fireEvent.mouseDown(clear);
        expect(setRecentSearches).toHaveBeenCalledWith([]);
        fireEvent.mouseDown(screen.getByRole('button', { name: /sunset/i }));
        act(() => vi.runOnlyPendingTimers());
        expect(harness.getCurrentFilters().searchQuery).toBe('sunset');
        expect(harness.searchProps.submitSearch).toHaveBeenCalledWith('sunset');
    });

    it('forwards focus, blur, and AI toggle behavior in enabled and searching states', () => {
        const harness = renderSearchBar(createDefaultFilters(), {
            searchProps: { isAiSearchEnabled: true, isSearchingAi: true, isFocused: false },
        });
        const input = screen.getByPlaceholderText('Ask Ambit...');
        fireEvent.focus(input);
        fireEvent.blur(input);
        fireEvent.click(screen.getByTitle('Disable AI Search'));
        expect(harness.searchProps.onFocus).toHaveBeenCalledOnce();
        expect(harness.searchProps.onBlur).toHaveBeenCalledOnce();
        expect(harness.searchProps.toggleAiSearch).toHaveBeenCalledOnce();
    });
});
