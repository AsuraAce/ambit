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

    it('uses calm Live Watch enabled styling without constant header activity', () => {
        useLibraryStore.getState().setIsLiveWatching(true);

        const { container } = render(<AppHeader {...defaultProps} />);
        const liveWatchButton = screen.getByTitle(/Live Watch enabled/);
        const importButton = screen.getByTitle(/Import images\./);

        expect(liveWatchButton.className).toContain('bg-sage-500/10');
        expect(liveWatchButton.className).toContain('text-sage-600');
        expect(liveWatchButton.className).not.toContain('signal');
        expect(liveWatchButton.className).not.toContain('violet');
        expect(liveWatchButton.className).not.toContain('amethyst');
        expect(liveWatchButton.className).not.toContain('bg-red-500');
        expect(liveWatchButton.className).not.toContain('animate-pulse');
        expect(importButton.className).not.toContain('bg-sage-500/20');
        expect(screen.queryByTestId('app-header-progress-rail')).toBeNull();
        expect(container.querySelector('.bg-violet-500')).toBeNull();
    });

    it('keeps Live Watch work out of the header progress rail while adding only a calm button ring', () => {
        useLibraryStore.getState().setIsLiveWatching(true);
        useLibraryStore.getState().startLiveWatchSession('invoke', {
            phase: 'syncing',
            message: 'Syncing completed InvokeAI images...',
            progress: { current: 0, total: 0, message: undefined }
        });

        const { container } = render(<AppHeader {...defaultProps} />);
        const importButton = screen.getByTitle(/Import images\./);
        const liveWatchButton = screen.getByTitle(/Live Watch enabled/);

        expect(screen.queryByTestId('app-header-progress-rail')).toBeNull();
        expect(container.querySelector('.bg-violet-500')).toBeNull();
        expect(liveWatchButton.className).toContain('ring-sage-500/20');
        expect(liveWatchButton.className).not.toContain('animate-pulse');
        expect(liveWatchButton.className).not.toContain('signal');
        expect(liveWatchButton.className).not.toContain('violet');
        expect(liveWatchButton.className).not.toContain('amethyst');
        expect(liveWatchButton.className).not.toContain('bg-red-500');
        expect(importButton.className).not.toContain('bg-sage-500/20');
        expect(importButton.className).toContain('bg-gray-100');
    });

    it('also keeps Live Watch importing work out of the header progress rail', () => {
        useLibraryStore.getState().setIsLiveWatching(true);
        useLibraryStore.getState().startLiveWatchSession('generic', {
            phase: 'importing',
            message: 'Importing new images...',
            progress: { current: 1, total: 3, message: undefined }
        });

        render(<AppHeader {...defaultProps} />);
        const importButton = screen.getByTitle(/Import images\./);
        const liveWatchButton = screen.getByTitle(/Live Watch enabled/);

        expect(screen.queryByTestId('app-header-progress-rail')).toBeNull();
        expect(liveWatchButton.className).toContain('ring-sage-500/20');
        expect(liveWatchButton.className).not.toContain('signal');
        expect(importButton.className).not.toContain('bg-sage-500/20');
    });

    it('keeps manual sync on the existing non-live-watch styling', () => {
        useLibraryStore.setState({
            syncStatus: 'syncing',
            syncProgress: { current: 1, total: 2, message: 'Syncing...' }
        });

        const { container } = render(<AppHeader {...defaultProps} />);
        const importButton = screen.getByTitle(/Import images\./);

        expect(screen.getByTestId('app-header-progress-rail')).toBeTruthy();
        expect(container.querySelector('.bg-sage-500')).toBeTruthy();
        expect(importButton.className).toContain('bg-sage-500/20');
    });

    it('keeps import and discovery scans on the header progress rail', () => {
        useLibraryStore.setState({
            isImporting: true,
            importProgress: { current: 1, total: 4, message: 'Importing...' }
        });

        const { rerender } = render(<AppHeader {...defaultProps} />);

        expect(screen.getByTestId('app-header-progress-rail')).toBeTruthy();
        expect(screen.getByTitle(/Import images\./).className).toContain('bg-sage-500/20');

        useLibraryStore.setState({
            isImporting: false,
            importProgress: null,
            isScanningDiscovery: true,
            discoveryScanProgress: { current: 0, total: 0, message: 'Scanning resources...', mode: 'indeterminate' }
        });
        rerender(<AppHeader {...defaultProps} />);

        expect(screen.getByTestId('app-header-progress-rail')).toBeTruthy();
        expect(screen.getByTitle(/Import images\./).className).toContain('bg-sage-500/20');
    });

    it('opens the import flow from the header import button', () => {
        const onImport = vi.fn();

        render(<AppHeader {...defaultProps} onImport={onImport} />);
        fireEvent.click(screen.getByTitle(/Import images\./));

        expect(onImport).toHaveBeenCalledTimes(1);
    });
});
