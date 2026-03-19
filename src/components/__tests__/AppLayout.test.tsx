
import { render, screen } from '../../test/testUtils';
import { describe, it, expect, vi } from 'vitest';
import { AppLayout } from '../AppLayout';

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
    TimelineView: () => <div data-testid="timeline-view" />
}));
vi.mock('../../features/library/components/VirtualGrid', () => ({
    VirtualGrid: () => <div data-testid="virtual-grid" />
}));
vi.mock('../../features/library/components/GridItem', () => ({
    GridItem: () => <div data-testid="grid-item" />
}));
vi.mock('../ui/ErrorBoundary', () => ({
    ErrorBoundary: ({ children }: any) => <div data-testid="error-boundary">{children}</div>
}));
vi.mock('../../contexts/SearchContext', () => ({
    useSearch: () => ({ images: [{id: '1', filename: 'test.png', timestamp: 123}], filters: {} })
}));

describe('AppLayout', () => {
    const defaultProps: any = {
        collections: [],
        smartCollections: [],
        filters: {} as any,
        setFilters: vi.fn(),
        isFilterPanelOpen: false,
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

    it('renders TimelineView when viewMode is timeline', () => {
        render(<AppLayout {...defaultProps} viewMode="timeline" images={[{ id: '1' } as any]} />);
        expect(screen.getByTestId('timeline-view')).toBeTruthy();
    });

    it('renders MaintenanceView when viewMode is maintenance', () => {
        render(<AppLayout {...defaultProps} viewMode="maintenance" />);
        expect(screen.getByTestId('maintenance-view')).toBeTruthy();
    });
});
