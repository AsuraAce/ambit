import * as React from 'react';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppHeader } from '../AppHeader';
import { createInitialLiveWatchSessionState, useLibraryStore } from '../../../stores/libraryStore';
import { ToastContext } from '../../../contexts/ToastContext';

const mocks = vi.hoisted(() => ({
    browserMode: false,
    setSettings: vi.fn(),
}));

vi.mock('../../../hooks/useLibraryContext', () => ({
    useLibraryContext: () => ({
        settings: { thumbnailSize: 200 },
        setSettings: mocks.setSettings,
        recentSearches: [],
        setRecentSearches: vi.fn()
    })
}));

vi.mock('../../../features/filters/components/SearchBar', () => ({
    SearchBar: () => <div data-testid="search-bar" />
}));

vi.mock('../../../features/library/components/ViewControls', () => ({
    ViewControls: ({ setThumbnailSize, setLayoutMode, setSortOption, onSlideshow, showLayoutSwitcher, showSlideshowButton }: {
        setThumbnailSize: (size: number) => void;
        setLayoutMode: (mode: 'masonry') => void;
        setSortOption: (option: 'date_desc') => void;
        onSlideshow: () => void;
        showLayoutSwitcher: boolean;
        showSlideshowButton: boolean;
    }) => (
        <div
            data-testid="view-controls"
            data-layout={String(showLayoutSwitcher)}
            data-slideshow={String(showSlideshowButton)}
        >
            <button onClick={() => setThumbnailSize(320)}>Resize Thumbnails</button>
            <button onClick={() => setLayoutMode('masonry')}>Set Layout</button>
            <button onClick={() => setSortOption('date_desc')}>Set Sort</button>
            <button onClick={onSlideshow}>Start Slideshow</button>
        </div>
    )
}));

vi.mock('../../../features/filters/components/ActiveFilters', () => ({
    ActiveFilters: () => <div data-testid="active-filters" />
}));

vi.mock('../../../services/runtime', () => ({
    isBrowserMockMode: () => mocks.browserMode,
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
        mocks.browserMode = false;
        resetLibraryStore();
    });

    it('uses calm Live Watch enabled styling without constant header activity', () => {
        useLibraryStore.getState().setIsLiveWatching(true);

        const { container } = render(<AppHeader {...defaultProps} />);
        const liveWatchButton = screen.getByRole('button', { name: 'Disable Live Watch' });
        const importButton = screen.getByRole('button', { name: 'Import Images' });

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
        const importButton = screen.getByRole('button', { name: 'Import Images' });
        const liveWatchButton = screen.getByRole('button', { name: 'Disable Live Watch' });

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
        const importButton = screen.getByRole('button', { name: 'Import Images' });
        const liveWatchButton = screen.getByRole('button', { name: 'Disable Live Watch' });

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
        const importButton = screen.getByRole('button', { name: 'Import Images' });

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
        expect(screen.getByRole('button', { name: 'Import Images' }).className).toContain('bg-sage-500/20');

        useLibraryStore.setState({
            isImporting: false,
            importProgress: null,
            isScanningDiscovery: true,
            discoveryScanProgress: { current: 0, total: 0, message: 'Scanning resources...', mode: 'indeterminate' }
        });
        rerender(<AppHeader {...defaultProps} />);

        expect(screen.getByTestId('app-header-progress-rail')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Import Images' }).className).toContain('bg-sage-500/20');
    });

    it('opens the import flow from the header import button', () => {
        const onImport = vi.fn();

        render(<AppHeader {...defaultProps} onImport={onImport} />);
        fireEvent.click(screen.getByRole('button', { name: 'Import Images' }));

        expect(onImport).toHaveBeenCalledTimes(1);
    });

    it('toggles Live Watch and forwards view-control commands', () => {
        const setLayoutMode = vi.fn();
        const setSortOption = vi.fn();
        const onSlideshow = vi.fn();
        render(
            <AppHeader
                {...defaultProps}
                setLayoutMode={setLayoutMode}
                setSortOption={setSortOption}
                onSlideshow={onSlideshow}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Enable Live Watch' }));
        expect(useLibraryStore.getState().isLiveWatching).toBe(true);
        fireEvent.click(screen.getByText('Resize Thumbnails'));
        const updateSettings = mocks.setSettings.mock.calls[0][0] as (settings: { thumbnailSize: number }) => { thumbnailSize: number };
        expect(updateSettings({ thumbnailSize: 200 })).toEqual({ thumbnailSize: 320 });
        fireEvent.click(screen.getByText('Set Layout'));
        fireEvent.click(screen.getByText('Set Sort'));
        fireEvent.click(screen.getByText('Start Slideshow'));
        expect(setLayoutMode).toHaveBeenCalledWith('masonry');
        expect(setSortOption).toHaveBeenCalledWith('date_desc');
        expect(onSlideshow).toHaveBeenCalledTimes(1);
    });

    it('blocks Live Watch in browser mode and shows the mock-mode indicator', () => {
        mocks.browserMode = true;
        const addToast = vi.fn();
        render(
            <ToastContext.Provider value={{ addToast, removeToast: vi.fn() }}>
                <AppHeader {...defaultProps} />
            </ToastContext.Provider>
        );

        expect(screen.getByText('Browser Mock')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Enable Live Watch' }));

        expect(addToast).toHaveBeenCalledWith('Unavailable in browser mock mode.', 'info');
        expect(useLibraryStore.getState().isLiveWatching).toBe(false);
    });

    it('falls back to console messaging in browser mode without a toast provider', () => {
        mocks.browserMode = true;
        const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        render(<AppHeader {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: 'Enable Live Watch' }));

        expect(info).toHaveBeenCalledWith('Unavailable in browser mock mode.');
        info.mockRestore();
    });

    it('shows model resolution and background healing progress with the correct priority and color', () => {
        useLibraryStore.setState({
            isResolvingModels: true,
            modelResolutionProgress: { current: 1, total: 2, message: 'Resolving...' }
        });
        const { container, rerender } = render(<AppHeader {...defaultProps} />);
        expect(container.querySelector('.bg-sage-500')).toBeTruthy();

        useLibraryStore.setState({
            isResolvingModels: false,
            modelResolutionProgress: null,
            isBackgroundHealingActive: true,
            backgroundHealingProgress: { current: 0, total: 0, message: 'Healing...' }
        });
        rerender(<AppHeader {...defaultProps} />);

        expect(container.querySelector('.bg-violet-500')).toBeTruthy();
        expect(screen.getByTestId('app-header-progress-rail').firstElementChild?.getAttribute('style'))
            .toContain('width: 100%');
    });

    it('hides grid-only controls outside grid and timeline views', () => {
        const { rerender } = render(<AppHeader {...defaultProps} viewMode="timeline" />);
        expect(screen.getByTestId('view-controls').getAttribute('data-layout')).toBe('false');
        expect(screen.getByTestId('view-controls').getAttribute('data-slideshow')).toBe('true');

        rerender(<AppHeader {...defaultProps} viewMode="dashboard" />);
        expect(screen.getByTestId('view-controls').getAttribute('data-slideshow')).toBe('false');
    });
});
