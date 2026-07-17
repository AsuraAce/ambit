
import { act, fireEvent, render, screen } from '../../test/testUtils';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { AppLayout } from '../AppLayout';
import { useSettingsStore } from '../../stores/settingsStore';
import type { AIImage } from '../../types';

const searchState = vi.hoisted(() => ({
    value: {
        images: [{ id: '1', filename: 'test.png', timestamp: 123 }] as unknown as AIImage[],
        totalImages: 1,
        globalTotal: 1,
        isFiltering: false,
        clearAllFilters: vi.fn(),
        toggleFavorite: vi.fn(),
        hasMoreImages: true,
        isLoadingMore: false,
        loadMoreImages: vi.fn()
    }
}));
const capturedProps = vi.hoisted(() => ({
    sidebar: null as Record<string, unknown> | null,
    header: null as Record<string, unknown> | null,
    selectionBar: null as Record<string, unknown> | null,
    filterPanel: null as Record<string, unknown> | null,
    maintenance: null as Record<string, unknown> | null,
    pinnedShelf: null as Record<string, unknown> | null,
    timeline: null as Record<string, unknown> | null,
    virtualGrid: null as Record<string, unknown> | null,
    gridItem: null as Record<string, unknown> | null,
}));

// Mock child components to verify layout structure
vi.mock('../../features/collections/components/AppSidebar', () => ({
    AppSidebar: (props: Record<string, unknown>) => {
        capturedProps.sidebar = props;
        return <div data-testid="app-sidebar" />;
    }
}));
vi.mock('../ui/AppHeader', () => ({
    AppHeader: (props: Record<string, unknown>) => {
        capturedProps.header = props;
        return (
            <div data-testid="app-header">
                <button
                    data-testid="search-draft-pending"
                    onClick={() => (props.onSearchDraftPendingChange as (isPending: boolean) => void)(true)}
                >
                    Start Search Draft
                </button>
            </div>
        );
    }
}));
vi.mock('../../features/library/components/SelectionBar', () => ({
    SelectionBar: (props: Record<string, unknown>) => {
        capturedProps.selectionBar = props;
        return <div data-testid="selection-bar" />;
    }
}));
vi.mock('../../features/filters/components/FilterPanel', () => ({
    FilterPanel: (props: Record<string, unknown>) => {
        capturedProps.filterPanel = props;
        return <div data-testid="filter-panel" />;
    }
}));
vi.mock('../ui/Charts', () => ({
    StatsDashboard: ({ onFilter }: { onFilter: (type: string, value: string) => void }) => (
        <div>
            <button data-testid="stats-dashboard" onClick={() => onFilter('model', 'Flux')}>dashboard</button>
            <button data-testid="stats-dashboard-other" onClick={() => onFilter('tool', 'Invoke')}>other</button>
        </div>
    )
}));
vi.mock('../../features/maintenance/components/MaintenanceView', () => ({
    MaintenanceView: (props: Record<string, unknown>) => {
        capturedProps.maintenance = props;
        return <div data-testid="maintenance-view" />;
    }
}));
vi.mock('../../features/library/components/GridSkeleton', () => ({
    GridSkeleton: () => <div data-testid="grid-skeleton" />
}));
vi.mock('../../features/library/components/PinnedShelf', () => ({
    PinnedShelf: (props: Record<string, unknown>) => {
        capturedProps.pinnedShelf = props;
        return <div data-testid="pinned-shelf" />;
    }
}));
vi.mock('../../features/library/components/TimelineView', () => ({
    TimelineView: (props: { hasMoreImages?: boolean; isLoadingMore?: boolean; onLoadMore?: () => void }) => (
        capturedProps.timeline = props as unknown as Record<string, unknown>,
        <div data-testid="timeline-view" data-has-more-images={String(props.hasMoreImages)} data-is-loading-more={String(props.isLoadingMore)} data-has-load-more={String(typeof props.onLoadMore === 'function')} />
    )
}));
vi.mock('../../features/library/components/VirtualGrid', () => ({
    VirtualGrid: (props: {
        transitionKey?: string;
        suspendResizeLayout?: boolean;
        items?: Array<{ id: string }>;
        renderItem?: (item: { id: string }, style: React.CSSProperties, index: number) => React.ReactNode;
    }) => {
        capturedProps.virtualGrid = props as unknown as Record<string, unknown>;
        return <>
            {props.items?.[0] && props.renderItem?.(props.items[0], { width: 10 }, 0)}
            <div data-testid="virtual-grid" data-transition-key={props.transitionKey ?? ''} data-suspend-resize-layout={String(Boolean(props.suspendResizeLayout))} />
        </>;
    }
}));
vi.mock('../../features/library/components/GridItem', () => ({
    GridItem: (props: Record<string, unknown>) => {
        capturedProps.gridItem = props;
        return <div data-testid="grid-item" />;
    }
}));
vi.mock('../ui/ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: any) => <div data-testid="error-boundary">{children}</div>
}));
vi.mock('../../contexts/SearchContext', () => ({
    useSearch: () => searchState.value
}));

describe('AppLayout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useSettingsStore.setState({
            privacyEnabled: true,
            privacyMaskIndexStatus: 'ready',
            privacyMaskIndexError: null,
        });
        Object.keys(capturedProps).forEach(key => {
            capturedProps[key as keyof typeof capturedProps] = null;
        });
        searchState.value = {
            images: [{ id: '1', filename: 'test.png', timestamp: 123 }] as unknown as AIImage[],
            totalImages: 1,
            globalTotal: 1,
            isFiltering: false,
            clearAllFilters: vi.fn(),
            toggleFavorite: vi.fn(),
            hasMoreImages: true,
            isLoadingMore: false,
            loadMoreImages: vi.fn()
        };
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    const defaultProps: any = {
        collections: [],
        smartCollections: [],
        filters: {} as any,
        setFilters: vi.fn(),
        isFilterPanelOpen: false,
        setIsFilterPanelOpen: vi.fn(),
        onRefreshCollections: vi.fn(),
        colOps: {} as any,
        setExportIds: vi.fn(),
        modals: {} as any,
        addToast: vi.fn(),
        viewMode: 'grid',
        changeViewMode: vi.fn(),
        searchProps: { inputRef: { current: null } } as any,
        layoutMode: 'masonry',
        setLayoutMode: vi.fn(),
        sortOption: 'date-desc',
        setSortOption: vi.fn(),
        totalImages: 0,
        scopeTotal: 0,
        scopeName: 'All Photos',
        isFiltering: false,
        fileOps: {} as any,
        onOpenImportModal: vi.fn(),
        clearAllFilters: vi.fn(),
        scrollContainerRef: { current: null },
        images: [],
        handlers: {} as any,
        setViewingImageId: vi.fn(),
        onMaintenanceViewerOpenChange: vi.fn(),
        isViewerShortcutBlocked: false,
        settings: {} as any,
        privacyEnabled: false,
        toggleFavorite: vi.fn(),
        actions: {} as any,
        availableTags: [],
        selectedIds: new Set(),
        handleImageClick: vi.fn(),
        setSelectedImageIndex: vi.fn(),
        handleSelectionToggle: vi.fn(),
        activeCollection: null,
        activeSmartCollection: null,
        handleRangeSelection: vi.fn(),
        clearSelection: vi.fn(),
        gridRef: { current: null },
        loadMoreImages: vi.fn(),
        handleLayoutChange: vi.fn(),
        isSearchFocused: false,
        setIsSearchFocused: vi.fn(),
        lastSelectedId: null,
        handleRemoveFromCollection: vi.fn(),
        handleOpenCollectionModal: vi.fn(),
        onSetCollectionMembership: vi.fn().mockResolvedValue(true),
    };

    it('renders the main structures: Sidebar, Header, Content Area', () => {
        render(<AppLayout {...defaultProps} />);

        expect(screen.getByTestId('app-sidebar')).toBeTruthy();
        expect(screen.getByTestId('app-header')).toBeTruthy();
        expect(screen.getByTestId('error-boundary')).toBeTruthy();
    });

    it('unmounts library surfaces while privacy protection is stale', () => {
        useSettingsStore.setState({ privacyMaskIndexStatus: 'failed' });

        const view = render(<AppLayout {...defaultProps} viewMode="grid" />);

        expect(screen.getByTestId('privacy-protection-gate')).toBeTruthy();
        expect(screen.queryByTestId('virtual-grid')).toBeNull();
        expect(screen.queryByTestId('selection-bar')).toBeNull();

        view.rerender(<AppLayout {...defaultProps} viewMode="maintenance" />);
        expect(screen.queryByTestId('maintenance-view')).toBeNull();
    });

    it('renders VirtualGrid when viewMode is grid', () => {
        render(<AppLayout {...defaultProps} viewMode="grid" images={[{ id: '1' } as any]} />);
        expect(screen.getByTestId('virtual-grid')).toBeTruthy();
    });

    it('passes a gallery transition key to VirtualGrid', () => {
        const thumbnailSize = useSettingsStore.getState().settings.thumbnailSize;

        render(
            <AppLayout
                {...defaultProps}
                viewMode="grid"
                layoutMode="justified"
                sortOption="name_asc"
                filters={{
                    collectionId: 'collection-1',
                    favoritesOnly: true,
                    pinnedOnly: false,
                    showGrids: true,
                    showIntermediates: false
                }}
            />
        );

        expect(screen.getByTestId('virtual-grid').getAttribute('data-transition-key')).toBe(
            `justified|${thumbnailSize}|name_asc|collection-1|favorites|unpinned-scope|show-grids|hide-intermediates`
        );
    });

    it('does not suspend VirtualGrid resize layout on initial render', () => {
        const closed = render(<AppLayout {...defaultProps} isFilterPanelOpen={false} />);

        expect(screen.getByTestId('virtual-grid').getAttribute('data-suspend-resize-layout')).toBe('false');

        closed.unmount();

        render(<AppLayout {...defaultProps} isFilterPanelOpen />);

        expect(screen.getByTestId('virtual-grid').getAttribute('data-suspend-resize-layout')).toBe('false');
    });

    it('suspends VirtualGrid resize layout while the filter panel is transitioning', () => {
        vi.useFakeTimers();

        const { rerender } = render(<AppLayout {...defaultProps} isFilterPanelOpen={false} />);

        expect(screen.getByTestId('virtual-grid').getAttribute('data-suspend-resize-layout')).toBe('false');

        rerender(<AppLayout {...defaultProps} isFilterPanelOpen />);

        expect(screen.getByTestId('virtual-grid').getAttribute('data-suspend-resize-layout')).toBe('true');

        act(() => {
            vi.advanceTimersByTime(539);
        });

        expect(screen.getByTestId('virtual-grid').getAttribute('data-suspend-resize-layout')).toBe('true');

        act(() => {
            vi.advanceTimersByTime(1);
        });

        expect(screen.getByTestId('virtual-grid').getAttribute('data-suspend-resize-layout')).toBe('false');
    });

    it('renders TimelineView when viewMode is timeline', () => {
        render(<AppLayout {...defaultProps} viewMode="timeline" images={[{ id: '1' } as any]} />);
        expect(screen.getByTestId('timeline-view')).toBeTruthy();
    });

    it('passes pagination state to TimelineView', () => {
        render(<AppLayout {...defaultProps} viewMode="timeline" />);

        const timeline = screen.getByTestId('timeline-view');
        expect(timeline.getAttribute('data-has-more-images')).toBe('true');
        expect(timeline.getAttribute('data-is-loading-more')).toBe('false');
        expect(timeline.getAttribute('data-has-load-more')).toBe('true');
    });

    it('renders MaintenanceView when viewMode is maintenance', async () => {
        render(<AppLayout {...defaultProps} viewMode="maintenance" isViewerShortcutBlocked={true} />);
        expect(await screen.findByTestId('maintenance-view')).toBeTruthy();
        expect(capturedProps.maintenance?.onViewerOpenChange).toBe(defaultProps.onMaintenanceViewerOpenChange);
        expect(capturedProps.maintenance?.isShortcutBlocked).toBe(true);
    });

    it('forwards collection persistence to MaintenanceView', async () => {
        const onSetCollectionMembership = vi.fn().mockResolvedValue(true);
        render(
            <AppLayout
                {...defaultProps}
                viewMode="maintenance"
                onSetCollectionMembership={onSetCollectionMembership}
            />
        );
        expect(await screen.findByTestId('maintenance-view')).toBeTruthy();
        expect(capturedProps.maintenance?.onSetCollectionMembership).toBe(onSetCollectionMembership);
    });

    it('filters by a dashboard model and returns to the grid', async () => {
        const setFilters = vi.fn();
        const changeViewMode = vi.fn();
        render(<AppLayout {...defaultProps} viewMode="dashboard" setFilters={setFilters} changeViewMode={changeViewMode} />);

        fireEvent.click(await screen.findByTestId('stats-dashboard'));

        const updater = setFilters.mock.calls[0][0] as (filters: { models: string[] }) => { models: string[] };
        expect(updater({ models: [] }).models).toEqual(['Flux']);
        expect(updater({ models: ['Flux'] }).models).toEqual(['Flux']);
        fireEvent.click(screen.getByTestId('stats-dashboard-other'));
        expect(changeViewMode).toHaveBeenCalledWith('grid');
    });

    it('renders a skeleton while filtered images are loading', () => {
        searchState.value.isFiltering = true;
        render(<AppLayout {...defaultProps} />);
        expect(screen.getByTestId('grid-skeleton')).toBeTruthy();
        expect(screen.queryByTestId('virtual-grid')).toBeNull();
    });

    it('shows loading instead of a false empty state while a valid search draft is pending', () => {
        searchState.value.images = [];
        searchState.value.totalImages = 0;
        searchState.value.globalTotal = 4;
        render(<AppLayout {...defaultProps} />);
        expect(screen.getByText('No Matches Found')).toBeTruthy();

        fireEvent.click(screen.getByTestId('search-draft-pending'));

        expect(screen.getByTestId('grid-skeleton')).toBeTruthy();
        expect(screen.queryByText('No Matches Found')).toBeNull();
        expect(capturedProps.header?.isFiltering).toBe(true);
    });

    it('preserves existing results while a valid search draft is pending', () => {
        render(<AppLayout {...defaultProps} />);
        expect(screen.getByTestId('virtual-grid')).toBeTruthy();

        fireEvent.click(screen.getByTestId('search-draft-pending'));

        expect(screen.getByTestId('virtual-grid')).toBeTruthy();
        expect(screen.queryByTestId('grid-skeleton')).toBeNull();
        expect(capturedProps.header?.isFiltering).toBe(true);
    });

    it('opens import from an empty library', () => {
        const onOpenImportModal = vi.fn();
        searchState.value.images = [];
        searchState.value.totalImages = 0;
        searchState.value.globalTotal = 0;
        render(<AppLayout {...defaultProps} onOpenImportModal={onOpenImportModal} />);

        fireEvent.click(screen.getByRole('button', { name: 'Import Images' }));
        expect(onOpenImportModal).toHaveBeenCalled();
    });

    it('clears filters from the no-matches state', () => {
        const clearAllFilters = vi.fn();
        searchState.value.images = [];
        searchState.value.totalImages = 0;
        searchState.value.globalTotal = 4;
        searchState.value.clearAllFilters = clearAllFilters;
        render(<AppLayout {...defaultProps} />);

        fireEvent.click(screen.getByRole('button', { name: 'Clear All Filters' }));
        expect(clearAllFilters).toHaveBeenCalled();
    });

    it('dismisses the search-focus overlay', () => {
        const setIsSearchFocused = vi.fn();
        const blur = vi.fn();
        const { container } = render(
            <AppLayout
                {...defaultProps}
                isSearchFocused
                setIsSearchFocused={setIsSearchFocused}
                searchProps={{ inputRef: { current: { blur } } } as any}
            />
        );

        const overlay = container.querySelector('.bg-black\\/60');
        expect(overlay).toBeTruthy();
        fireEvent.click(overlay as Element);
        expect(blur).toHaveBeenCalledOnce();
        expect(setIsSearchFocused).toHaveBeenCalledWith(false);
    });

    it('orchestrates sidebar, header, and filter-panel commands', async () => {
        const setFilters = vi.fn();
        const modals = {
            setInitialSettingsTab: vi.fn(), openModal: vi.fn(), setShortcutsModalTab: vi.fn(),
            setSlideshowShuffle: vi.fn(), isPinnedShelfCollapsed: false, setIsPinnedShelfCollapsed: vi.fn()
        };
        const colOps = {
            createCollection: vi.fn(), saveSmartCollection: vi.fn(), deleteSmartCollection: vi.fn(),
            addImagesToCollection: vi.fn().mockResolvedValue(undefined), renameCollection: vi.fn(),
            deleteCollection: vi.fn(), toggleArchiveCollection: vi.fn(), togglePinCollection: vi.fn(),
            setCollectionColor: vi.fn(), resetCollectionThumbnail: vi.fn(), updateCollectionFilters: vi.fn()
        };
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(<AppLayout {...defaultProps} setFilters={setFilters} modals={modals} colOps={colOps} />);

        const sidebar = capturedProps.sidebar as {
            onOpenSettings: () => void; onOpenShortcuts: () => void; onOpenDonation: () => void;
        };
        sidebar.onOpenSettings();
        sidebar.onOpenShortcuts();
        sidebar.onOpenDonation();
        expect(modals.setInitialSettingsTab).toHaveBeenCalledWith('general');
        expect(modals.setShortcutsModalTab).toHaveBeenCalledWith('shortcuts');
        expect(modals.openModal).toHaveBeenCalledWith('donation');

        const header = capturedProps.header as { onSlideshow: () => void };
        header.onSlideshow();
        expect(modals.setSlideshowShuffle).toHaveBeenCalledWith(false);
        expect(modals.openModal).toHaveBeenCalledWith('slideshow');

        const panel = capturedProps.filterPanel as {
            onDropOnCollection: (id: string, data: string) => Promise<void>;
            onPlayCollection: (id: string) => void;
            onExportCollection: (id: string) => void;
            onOpenResourceFolders: () => void;
        };
        await act(() => panel.onDropOnCollection('collection-1', '["a","b"]'));
        await act(() => panel.onDropOnCollection('collection-1', '{"id":"not-an-array"}'));
        await act(() => panel.onDropOnCollection('collection-1', 'not-json'));
        expect(colOps.addImagesToCollection).toHaveBeenCalledWith(['a', 'b'], 'collection-1');
        expect(errorSpy).toHaveBeenCalled();

        panel.onPlayCollection('collection-2');
        panel.onExportCollection('collection-3');
        panel.onOpenResourceFolders();
        const playUpdater = setFilters.mock.calls[0][0] as (value: Record<string, unknown>) => Record<string, unknown>;
        const exportUpdater = setFilters.mock.calls[1][0] as (value: Record<string, unknown>) => Record<string, unknown>;
        expect(playUpdater({ keep: true })).toEqual({ keep: true, collectionId: 'collection-2' });
        expect(exportUpdater({ keep: true })).toEqual({ keep: true, collectionId: 'collection-3' });
        expect(modals.setInitialSettingsTab).toHaveBeenCalledWith('folders');
        errorSpy.mockRestore();
    });

    it('wires pinned shelf and grid item interactions with global indices', () => {
        const pinned = { id: 'pinned', filename: 'p.png', timestamp: 1, width: 0, height: 0, isPinned: true } as AIImage;
        const regular = { id: 'regular', filename: 'r.png', timestamp: 2, width: 0, height: 0, isPinned: false } as AIImage;
        searchState.value.images = [pinned, regular];
        const handleImageClick = vi.fn();
        const handleRangeSelection = vi.fn();
        const handlePinImage = vi.fn();
        const setContextMenu = vi.fn();
        const setIsPinnedShelfCollapsed = vi.fn();
        render(<AppLayout
            {...defaultProps}
            filters={{ collectionId: 'collection-1', pinnedOnly: false }}
            handleImageClick={handleImageClick}
            handleRangeSelection={handleRangeSelection}
            actions={{ handlePinImage }}
            handlers={{ setImages: vi.fn(), setContextMenu }}
            modals={{ isPinnedShelfCollapsed: false, setIsPinnedShelfCollapsed }}
        />);

        expect(screen.getByTestId('pinned-shelf')).toBeTruthy();
        expect(screen.getByTestId('grid-item')).toBeTruthy();
        const grid = capturedProps.virtualGrid as {
            getItemRatio: (image: AIImage) => number;
            onRangeSelection: (indices: number[], additive: boolean) => void;
        };
        expect(grid.getItemRatio(regular)).toBe(1);
        grid.onRangeSelection([0, 2], true);
        expect(handleRangeSelection).toHaveBeenCalledWith([1, 3], true);

        const item = capturedProps.gridItem as {
            index: number;
            onClick: (event: React.MouseEvent, id: string, index: number) => void;
            onToggleFavorite: (event: React.MouseEvent, id: string) => void;
            onTogglePin: (event: React.MouseEvent, id: string) => void;
            onContextMenu: (event: { clientX: number; clientY: number }, id: string) => void;
        };
        expect(item.index).toBe(1);
        item.onClick({} as React.MouseEvent, 'regular', 1);
        item.onToggleFavorite({} as React.MouseEvent, 'regular');
        item.onTogglePin({} as React.MouseEvent, 'regular');
        item.onTogglePin({} as React.MouseEvent, 'missing');
        item.onContextMenu({ clientX: 7, clientY: 9 }, 'regular');
        expect(handleImageClick).toHaveBeenCalledWith(expect.anything(), 'regular', 1, defaultProps.setSelectedImageIndex);
        expect(searchState.value.toggleFavorite).toHaveBeenCalledWith('regular');
        expect(handlePinImage).toHaveBeenCalledWith('regular', true);
        expect(setContextMenu).toHaveBeenCalledWith({ x: 7, y: 9, imageId: 'regular' });

        const shelf = capturedProps.pinnedShelf as {
            onToggleCollapse: () => void;
            onTogglePin: (event: React.MouseEvent, id: string) => void;
        };
        shelf.onToggleCollapse();
        const collapseUpdater = setIsPinnedShelfCollapsed.mock.calls[0][0] as (value: boolean) => boolean;
        expect(collapseUpdater(false)).toBe(true);
        shelf.onTogglePin({} as React.MouseEvent, 'pinned');
        shelf.onTogglePin({} as React.MouseEvent, 'missing');
        expect(handlePinImage).toHaveBeenCalledWith('pinned', false);
    });

    it('clears support and filter-transition timers at the right lifecycle points', () => {
        vi.useFakeTimers();
        const { rerender, unmount } = render(<AppLayout {...defaultProps} isFilterPanelOpen={false} />);

        act(() => vi.advanceTimersByTime(30000));
        expect((capturedProps.sidebar as { showSupportPulse: boolean }).showSupportPulse).toBe(false);

        rerender(<AppLayout {...defaultProps} isFilterPanelOpen />);
        rerender(<AppLayout {...defaultProps} isFilterPanelOpen={false} />);
        expect(screen.getByTestId('virtual-grid').getAttribute('data-suspend-resize-layout')).toBe('true');
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('routes maintenance actions and gates AI recovery on configuration', async () => {
        const originalStore = useSettingsStore.getState();
        const addToast = vi.fn();
        const setViewingImageId = vi.fn();
        const toggleFavorite = vi.fn();
        const handleUpdateNotes = vi.fn();
        const modals = { setInitialSettingsTab: vi.fn(), openModal: vi.fn() };
        useSettingsStore.setState({
            settings: { ...originalStore.settings, enableAI: false },
            geminiApiKey: null
        });
        const { rerender } = render(<AppLayout
            {...defaultProps}
            viewMode="maintenance"
            addToast={addToast}
            setViewingImageId={setViewingImageId}
            handlers={{ handleUpdateNotes }}
            modals={modals}
        />);
        await screen.findByTestId('maintenance-view');
        let maintenance = capturedProps.maintenance as {
            onViewImage: (id: string) => void;
            onUpdateNotes: (id: string, notes: string) => void;
            onRecoverMetadata: () => void;
            onToggleFavorite: (id: string) => void;
        };
        maintenance.onViewImage('image-1');
        maintenance.onUpdateNotes('image-1', 'note');
        maintenance.onRecoverMetadata();
        maintenance.onToggleFavorite('image-1');
        expect(setViewingImageId).toHaveBeenCalledWith('image-1');
        expect(handleUpdateNotes).toHaveBeenCalledWith('image-1', 'note');
        expect(addToast).toHaveBeenCalledWith('Enable AI features and configure a Gemini API key first', 'error');
        expect(modals.setInitialSettingsTab).toHaveBeenCalledWith('intelligence');
        expect(searchState.value.toggleFavorite).toHaveBeenCalledWith('image-1');

        useSettingsStore.setState({
            settings: { ...originalStore.settings, enableAI: true },
            geminiApiKey: 'configured-key'
        });
        rerender(<AppLayout {...defaultProps} viewMode="maintenance" addToast={addToast} modals={modals} />);
        maintenance = capturedProps.maintenance as typeof maintenance;
        maintenance.onRecoverMetadata();
        expect(modals.openModal).toHaveBeenCalledWith('recovery');
        useSettingsStore.setState({ settings: originalStore.settings, geminiApiKey: originalStore.geminiApiKey });
    });

    it('wires timeline and pinned-shelf image interactions', () => {
        const pinned = { id: 'pinned', filename: 'p.png', timestamp: 1, isPinned: true } as AIImage;
        const regular = { id: 'regular', filename: 'r.png', timestamp: 2, isPinned: false } as AIImage;
        searchState.value.images = [pinned, regular];
        const handleImageClick = vi.fn();
        const handlePinImage = vi.fn();
        const setContextMenu = vi.fn();
        const gridView = render(<AppLayout
            {...defaultProps}
            filters={{ collectionId: 'collection-1', pinnedOnly: false }}
            handleImageClick={handleImageClick}
            actions={{ handlePinImage }}
            handlers={{ setImages: vi.fn(), setContextMenu }}
            modals={{ isPinnedShelfCollapsed: false, setIsPinnedShelfCollapsed: vi.fn() }}
        />);
        const shelf = capturedProps.pinnedShelf as {
            onImageClick: (event: React.MouseEvent, id: string, index: number) => void;
            onToggleFavorite: (event: React.MouseEvent, id: string) => void;
            onContextMenu: (event: { clientX: number; clientY: number }, id: string) => void;
        };
        shelf.onImageClick({} as React.MouseEvent, 'pinned', 0);
        shelf.onToggleFavorite({} as React.MouseEvent, 'pinned');
        shelf.onContextMenu({ clientX: 2, clientY: 3 }, 'pinned');
        expect(handleImageClick).toHaveBeenCalled();
        expect(searchState.value.toggleFavorite).toHaveBeenCalledWith('pinned');
        expect(setContextMenu).toHaveBeenCalledWith({ x: 2, y: 3, imageId: 'pinned' });
        gridView.unmount();

        render(<AppLayout
            {...defaultProps}
            viewMode="timeline"
            handleImageClick={handleImageClick}
            actions={{ handlePinImage }}
            handlers={{ setContextMenu }}
        />);
        const timeline = capturedProps.timeline as {
            onImageClick: (event: React.MouseEvent, id: string, index: number) => void;
            onToggleFavorite: (event: React.MouseEvent, id: string) => void;
            onTogglePin: (event: React.MouseEvent, id: string) => void;
            onContextMenu: (event: { clientX: number; clientY: number }, id: string) => void;
        };
        timeline.onImageClick({} as React.MouseEvent, 'regular', 1);
        timeline.onToggleFavorite({} as React.MouseEvent, 'regular');
        timeline.onTogglePin({} as React.MouseEvent, 'regular');
        timeline.onTogglePin({} as React.MouseEvent, 'missing');
        timeline.onContextMenu({ clientX: 4, clientY: 5 }, 'regular');
        expect(handlePinImage).toHaveBeenCalledWith('regular', true);
        expect(setContextMenu).toHaveBeenCalledWith({ x: 4, y: 5, imageId: 'regular' });
    });

    it('routes selection-bar commands according to confirmation settings', () => {
        const openModal = vi.fn();
        const executeDelete = vi.fn();
        const handleOpenCollectionModal = vi.fn();
        const modals = { openModal };
        const actions = {
            executeDelete,
            handleBulkFavorite: vi.fn(), handleBulkPin: vi.fn(), handleBulkMask: vi.fn()
        };
        render(<AppLayout {...defaultProps} modals={modals} actions={actions} handleOpenCollectionModal={handleOpenCollectionModal} />);
        const selection = capturedProps.selectionBar as {
            onDelete: () => void; onExport: () => void; onAddToCollection: () => void; onCompare: () => void;
        };
        selection.onDelete();
        selection.onExport();
        selection.onAddToCollection();
        selection.onCompare();
        expect(openModal).toHaveBeenCalledWith('deleteConfirm');
        expect(openModal).toHaveBeenCalledWith('export');
        expect(openModal).toHaveBeenCalledWith('compare');
        expect(handleOpenCollectionModal).toHaveBeenCalledWith('add');
        expect(executeDelete).not.toHaveBeenCalled();
    });

    it('covers fallback layout keys, smart thumbnails, loading, and immediate deletion', () => {
        const originalStore = useSettingsStore.getState();
        useSettingsStore.setState({
            settings: { ...originalStore.settings, thumbnailSize: undefined as unknown as number, confirmDelete: false }
        });
        searchState.value.images = [{
            id: 'smart-image', filename: 'smart.png', timestamp: 1, isPinned: false
        } as AIImage];
        searchState.value.isLoadingMore = true;
        const executeDelete = vi.fn();
        render(<AppLayout
            {...defaultProps}
            filters={{ collectionId: 'collection-1', pinnedOnly: true, showIntermediates: true }}
            activeCollection={null}
            activeSmartCollection={{ id: 'smart-1', thumbnail: 'smart-image' }}
            actions={{ executeDelete }}
        />);

        expect(screen.getByTestId('virtual-grid').getAttribute('data-transition-key')).toContain('default-size');
        expect(screen.getByTestId('virtual-grid').getAttribute('data-transition-key')).toContain('pinned-only');
        expect(screen.getByTestId('virtual-grid').getAttribute('data-transition-key')).toContain('show-intermediates');
        expect(document.querySelector('.animate-spin')).toBeTruthy();
        const item = capturedProps.gridItem as { isThumbnail: boolean };
        expect(item.isThumbnail).toBe(true);
        const selection = capturedProps.selectionBar as { onDelete: () => void };
        selection.onDelete();
        expect(executeDelete).toHaveBeenCalled();
        useSettingsStore.setState({ settings: originalStore.settings });
    });
});
