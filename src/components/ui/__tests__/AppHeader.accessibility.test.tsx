import * as React from 'react';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHeader } from '../AppHeader';
import { createInitialLiveWatchSessionState, useLibraryStore } from '../../../stores/libraryStore';

vi.mock('../../../hooks/useLibraryContext', () => ({
    useLibraryContext: () => ({
        settings: { thumbnailSize: 200 },
        setSettings: vi.fn(),
        recentSearches: [],
        setRecentSearches: vi.fn()
    })
}));

vi.mock('../../../features/filters/components/SearchBar', () => ({
    SearchBar: () => <div data-testid="search-bar" />
}));

vi.mock('../../../features/library/components/ViewControls', () => ({
    ViewControls: () => <div data-testid="view-controls" />
}));

vi.mock('../../../features/filters/components/ActiveFilters', () => ({
    ActiveFilters: () => <div data-testid="active-filters" />
}));

const resetLibraryStore = () => {
    useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    useLibraryStore.setState({
        liveWatchSession: createInitialLiveWatchSessionState(),
        syncStatus: 'idle',
        syncProgress: { current: 0, total: 0, message: '' },
        isImporting: false,
        importProgress: null,
        isResolvingModels: false,
        modelResolutionProgress: null,
        isScanningDiscovery: false,
        discoveryScanProgress: null,
        isBackgroundHealingActive: false,
        backgroundHealingProgress: null
    });
};

const defaultProps = {
    viewMode: 'grid' as const,
    filters: {
        searchQuery: '',
        models: [],
        tools: [],
        loras: [],
        embeddings: [],
        hypernetworks: [],
        samplers: [],
        generationTypes: [],
        controlNets: [],
        ipAdapters: [],
        dateRange: 'all' as const,
        favoritesOnly: false,
        collectionId: null,
        showIntermediates: false,
        showGrids: false
    },
    setFilters: vi.fn(),
    searchProps: {
        isAiSearchEnabled: false,
        isSearchingAi: false,
        inputRef: { current: null },
        toggleAiSearch: vi.fn(),
        submitSearch: vi.fn(),
        isFocused: false,
        onFocus: vi.fn(),
        onBlur: vi.fn(),
        onOpenSearchHelp: vi.fn()
    },
    layoutMode: 'masonry' as const,
    setLayoutMode: vi.fn(),
    sortOption: 'date_desc' as const,
    setSortOption: vi.fn(),
    displayedCount: 10,
    totalCount: 10,
    scopeName: 'Library',
    onImport: vi.fn(),
    onSlideshow: vi.fn(),
    clearAllFilters: vi.fn(),
    isFiltering: false,
    onSearchDraftPendingChange: vi.fn(),
};

describe('AppHeader', () => {
    it('exposes dynamic Live Watch state and keyboard-discoverable help', () => {
        const { rerender } = render(<AppHeader {...defaultProps} />);
        const enableButton = screen.getByRole('button', { name: 'Enable Live Watch' });

        expect(enableButton.getAttribute('aria-pressed')).toBe('false');
        expect(enableButton.getAttribute('title')).toBeNull();
        fireEvent.focus(enableButton);
        expect(screen.getByRole('tooltip').textContent).toContain('Automatically detect and import');

        useLibraryStore.getState().setIsLiveWatching(true);
        rerender(<AppHeader {...defaultProps} />);

        expect(screen.getByRole('button', { name: 'Disable Live Watch' }).getAttribute('aria-pressed')).toBe('true');
    });
});
