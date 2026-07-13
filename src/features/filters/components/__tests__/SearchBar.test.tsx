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

const renderSearchBar = (
    initialFilters: FilterState = createDefaultFilters(),
    searchOverrides: Partial<React.ComponentProps<typeof SearchBar>['searchProps']> = {},
) => {
    let currentFilters = initialFilters;
    const setFilters = vi.fn((update: React.SetStateAction<FilterState>) => {
        currentFilters = typeof update === 'function'
            ? update(currentFilters)
            : update;
    });
    const searchProps = createSearchProps(searchOverrides);

    searchContextMocks.useSearch.mockImplementation(() => ({
        filters: currentFilters,
        setFilters,
    }));

    const view = render(
        <SearchBar
            filters={currentFilters}
            setFilters={setFilters}
            searchProps={searchProps}
            recentSearches={[]}
            setRecentSearches={vi.fn()}
        />
    );

    return {
        ...view,
        getCurrentFilters: () => currentFilters,
        searchProps,
        setFilters,
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

    it('exposes AI search as a dynamic pressed action with accessible help', () => {
        const harness = renderSearchBar();
        const aiButton = screen.getByRole('button', { name: 'Enable AI Search' });

        expect(aiButton.getAttribute('aria-pressed')).toBe('false');
        expect(aiButton.getAttribute('title')).toBeNull();
        fireEvent.focus(aiButton);
        expect(screen.getByRole('tooltip').textContent).toContain('natural-language');
        fireEvent.click(aiButton);
        expect(harness.searchProps.toggleAiSearch).toHaveBeenCalledTimes(1);
    });
});
