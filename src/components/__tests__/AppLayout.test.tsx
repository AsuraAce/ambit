
import { act, render, screen } from '../../test/testUtils';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { AppLayout } from '../AppLayout';
import { useSettingsStore } from '../../stores/settingsStore';

// Mock child components to verify layout structure
vi.mock('../../features/collections/components/AppSidebar', () => ({
    AppSidebar: () => <div data-testid="app-sidebar" />
}));
vi.mock('../ui/AppHeader', () => ({
    AppHeader: () => <div data-testid="app-header" />
}));
vi.mock('../../features/library/components/SelectionBar', () => ({
    SelectionBar: () => <div data-testid="selection-bar" />
}));
vi.mock('../../features/filters/components/FilterPanel', () => ({
    FilterPanel: () => <div data-testid="filter-panel" />
}));
vi.mock('../ui/Charts', () => ({
    StatsDashboard: () => <div data-testid="stats-dashboard" />
}));
vi.mock('../../features/maintenance/components/MaintenanceView', () => ({
    MaintenanceView: () => <div data-testid="maintenance-view" />
}));
vi.mock('../../features/library/components/GridSkeleton', () => ({
    GridSkeleton: () => <div data-testid="grid-skeleton" />
}));
vi.mock('../../features/library/components/PinnedShelf', () => ({
    PinnedShelf: () => <div data-testid="pinned-shelf" />
}));
vi.mock('../../features/library/components/TimelineView', () => ({
    TimelineView: (props: { hasMoreImages?: boolean; isLoadingMore?: boolean; onLoadMore?: () => void }) => (
        <div
            data-testid="timeline-view"
            data-has-more-images={String(props.hasMoreImages)}
            data-is-loading-more={String(props.isLoadingMore)}
            data-has-load-more={String(typeof props.onLoadMore === 'function')}
        />
    )
}));
vi.mock('../../features/library/components/VirtualGrid', () => ({
    VirtualGrid: ({
        transitionKey,
        suspendResizeLayout
    }: {
        transitionKey?: string;
        suspendResizeLayout?: boolean;
    }) => (
        <div
            data-testid="virtual-grid"
            data-transition-key={transitionKey ?? ''}
            data-suspend-resize-layout={String(Boolean(suspendResizeLayout))}
        />
    )
}));
vi.mock('../../features/library/components/GridItem', () => ({
    GridItem: () => <div data-testid="grid-item" />
}));
vi.mock('../ui/ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: any) => <div data-testid="error-boundary">{children}</div>
}));
vi.mock('../../contexts/SearchContext', () => ({
    useSearch: () => ({
        images: [{ id: '1', filename: 'test.png', timestamp: 123 }],
        filters: {},
        hasMoreImages: true,
        isLoadingMore: false,
        loadMoreImages: vi.fn()
    })
}));

describe('AppLayout', () => {
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
        searchProps: {} as any,
        layoutMode: 'masonry',
        setLayoutMode: vi.fn(),
        sortOption: 'date-desc',
        setSortOption: vi.fn(),
        totalImages: 0,
        scopeTotal: 0,
        scopeName: 'All Photos',
        isFiltering: false,
        fileOps: {} as any,
        clearAllFilters: vi.fn(),
        scrollContainerRef: { current: null },
        images: [],
        handlers: {} as any,
        setViewingImageId: vi.fn(),
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
    };

    it('renders the main structures: Sidebar, Header, Content Area', () => {
        render(<AppLayout {...defaultProps} />);

        expect(screen.getByTestId('app-sidebar')).toBeTruthy();
        expect(screen.getByTestId('app-header')).toBeTruthy();
        expect(screen.getByTestId('error-boundary')).toBeTruthy();
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
        render(<AppLayout {...defaultProps} viewMode="maintenance" />);
        expect(await screen.findByTestId('maintenance-view')).toBeTruthy();
    });
});
