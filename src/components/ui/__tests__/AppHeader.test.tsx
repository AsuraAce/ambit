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
        onBlur: vi.fn()
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
    isFiltering: false
};

describe('AppHeader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetLibraryStore();
    });

    it('uses the purple header strip and leaves the import button neutral during live watch', () => {
        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Preparing live InvokeAI sync...',
            progress: { current: 0, total: 0, message: undefined }
        });

        const { container } = render(<AppHeader {...defaultProps} />);
        const importButton = screen.getByTitle(/Import images\./);

        expect(container.querySelector('.bg-violet-500')).toBeTruthy();
        expect(importButton.className).not.toContain('bg-sage-500/20');
        expect(importButton.className).toContain('bg-gray-100');
    });

    it('keeps manual sync on the existing non-live-watch styling', () => {
        useLibraryStore.setState({
            syncStatus: 'syncing',
            syncProgress: { current: 1, total: 2, message: 'Syncing...' }
        });

        const { container } = render(<AppHeader {...defaultProps} />);
        const importButton = screen.getByTitle(/Import images\./);

        expect(container.querySelector('.bg-sage-500')).toBeTruthy();
        expect(importButton.className).toContain('bg-sage-500/20');
    });

    it('opens the import flow from the header import button', () => {
        const onImport = vi.fn();

        render(<AppHeader {...defaultProps} onImport={onImport} />);
        fireEvent.click(screen.getByTitle(/Import images\./));

        expect(onImport).toHaveBeenCalledTimes(1);
    });
});
