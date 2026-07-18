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
    onOpenSearchHelp: vi.fn(),
    ...overrides,
});

const renderSearchBar = (
    initialFilters: FilterState = createDefaultFilters(),
    searchOverrides: Partial<React.ComponentProps<typeof SearchBar>['searchProps']> = {},
    recentSearches: string[] = [],
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
            recentSearches={recentSearches}
            setRecentSearches={vi.fn()}
            scopeName="Library"
            displayedCount={10}
            isFiltering={false}
            submitNavigatesToGrid={false}
            onDraftPendingChange={vi.fn()}
        />
    );

    return {
        ...view,
        getCurrentFilters: () => currentFilters,
        searchProps,
        setFilters,
    };
};

describe('SearchBar accessibility', () => {
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

    it('connects the combobox to its deferred listbox and exposes keyboard selection', async () => {
        const harness = renderSearchBar(createDefaultFilters(), {}, ['sunset']);
        const input = screen.getByRole('combobox', { name: 'Search in Library' });
        const listbox = await screen.findByRole('listbox', { name: 'Recent searches' });
        const option = screen.getByRole('option', { name: 'sunset' });

        expect(input.getAttribute('aria-controls')).toBe(listbox.id);
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        expect(input.getAttribute('aria-activedescendant')).toBe(option.id);
        expect(option.getAttribute('aria-selected')).toBe('true');

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(harness.searchProps.submitSearch).toHaveBeenCalledWith('sunset');
    });

    it('dismisses deferred suggestions and blurs the search with Escape', async () => {
        const harness = renderSearchBar();
        const input = screen.getByRole('combobox', { name: 'Search in Library' });
        act(() => input.focus());
        fireEvent.change(input, { target: { value: 'cn' } });
        expect(await screen.findByRole('listbox', { name: 'Search operator suggestions' })).toBeTruthy();

        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(harness.searchProps.onBlur).toHaveBeenCalledOnce();
    });

    it('opens search syntax help directly', async () => {
        const harness = renderSearchBar();
        expect(await screen.findByRole('button', { name: 'Search syntax' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Search syntax' }));
        expect(harness.searchProps.onOpenSearchHelp).toHaveBeenCalledOnce();
    });

    it('describes each trigger mode with its visible helper text', async () => {
        const standard = renderSearchBar();
        const standardInput = screen.getByRole('combobox', { name: 'Search in Library' });
        const standardHelper = await screen.findByText('Updates after you pause. Enter finishes.');
        expect(standardInput.getAttribute('aria-describedby')).toContain(standardHelper.id);

        standard.unmount();
        renderSearchBar(createDefaultFilters(), { isAiSearchEnabled: true });
        const aiInput = screen.getByRole('combobox', { name: 'Ask Ambit with AI' });
        const aiHelper = await screen.findByText('Press Enter to analyze with AI.');
        expect(aiInput.getAttribute('aria-describedby')).toContain(aiHelper.id);
    });

    it('does not duplicate Enter-only guidance after a prompt is entered', async () => {
        renderSearchBar(
            createDefaultFilters({ searchQuery: 'existing prompt' }),
            { isAiSearchEnabled: true }
        );
        const guidance = await screen.findAllByText('Press Enter to analyze with AI.');
        const helper = screen.getByText('Search syntax opens standard query operators.');
        const input = screen.getByRole('combobox', { name: 'Ask Ambit with AI' });

        expect(guidance).toHaveLength(1);
        expect(input.getAttribute('aria-describedby')).toContain(helper.id);
    });
});
