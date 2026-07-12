import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterState, SortOption } from '../../../../types';
import { ViewControls } from '../ViewControls';

const mocks = vi.hoisted(() => ({
    availableHiddenContent: { hasIntermediates: false, hasGrids: false },
    filters: { showIntermediates: false, showGrids: false } as FilterState,
    sortOption: 'date_desc' as SortOption,
    setSortOption: vi.fn(),
    setFilters: vi.fn()
}));

vi.mock('../../../../contexts/SearchContext', () => ({
    useSearch: () => ({
        availableHiddenContent: mocks.availableHiddenContent,
        filters: mocks.filters,
        setFilters: mocks.setFilters,
        sortOption: mocks.sortOption,
        setSortOption: mocks.setSortOption
    })
}));

const baseFilters = (): FilterState => ({
    searchQuery: '', models: [], tools: [], loras: [], embeddings: [], hypernetworks: [], samplers: [], generationTypes: [],
    controlNets: [], ipAdapters: [], dateRange: 'all', favoritesOnly: false, collectionId: null, showIntermediates: false, showGrids: false
});

const setup = (overrides: Partial<React.ComponentProps<typeof ViewControls>> = {}) => {
    const props: React.ComponentProps<typeof ViewControls> = {
        showLayoutSwitcher: true, layoutMode: 'masonry', setLayoutMode: vi.fn(), showSlideshowButton: true, onSlideshow: vi.fn(),
        sortOption: 'date_desc', setSortOption: vi.fn(), thumbnailSize: 200, setThumbnailSize: vi.fn(), displayedCount: 10,
        totalCount: 10, scopeName: 'Library', ...overrides
    };
    const result = render(<ViewControls {...props} />);
    return { ...result, props };
};

describe('ViewControls', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.availableHiddenContent = { hasIntermediates: false, hasGrids: false };
        mocks.filters = baseFilters();
        mocks.sortOption = 'date_desc';
        mocks.setFilters.mockImplementation((update: (previous: FilterState) => FilterState) => { mocks.filters = update(mocks.filters); });
    });

    it('routes every layout, slideshow, and thumbnail-size control', () => {
        const { props } = setup();
        fireEvent.click(screen.getByTitle('Grid Layout'));
        fireEvent.click(screen.getByTitle('Masonry Layout'));
        fireEvent.click(screen.getByTitle('Justified Layout'));
        expect(vi.mocked(props.setLayoutMode).mock.calls.map(call => call[0])).toEqual(['grid', 'masonry', 'justified']);
        fireEvent.click(screen.getByTitle('Play Slideshow'));
        expect(props.onSlideshow).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByRole('slider'), { target: { value: '325' } });
        expect(props.setThumbnailSize).toHaveBeenCalledWith(325);
    });

    it('selects every sort option, closes after selection, and dismisses outside clicks', () => {
        setup();
        const options: Array<[SortOption, string]> = [
            ['date_desc', 'Newest'], ['date_asc', 'Oldest'], ['name_asc', 'Name (A-Z)'], ['name_desc', 'Name (Z-A)'],
            ['size_desc', 'Largest (Size)'], ['size_asc', 'Smallest (Size)']
        ];
        for (const [value, label] of options) {
            fireEvent.click(screen.getByText('Newest'));
            const matches = screen.getAllByText(label);
            fireEvent.click(matches[matches.length - 1]);
            expect(mocks.setSortOption).toHaveBeenLastCalledWith(value);
        }
        fireEvent.click(screen.getByText('Newest'));
        expect(screen.getAllByText('Oldest')).toHaveLength(1);
        fireEvent.mouseDown(screen.getAllByText('Newest')[0]);
        expect(screen.getAllByText('Oldest')).toHaveLength(1);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('Oldest')).toBeNull();
    });

    it('toggles both hidden-content controls and closes only on outside clicks', () => {
        mocks.availableHiddenContent = { hasIntermediates: true, hasGrids: true };
        const { rerender, props } = setup();
        fireEvent.click(screen.getByTitle('View Options'));
        fireEvent.click(screen.getByText('Show Intermediates'));
        fireEvent.click(screen.getByText('Show Image Grids'));
        expect(mocks.filters).toMatchObject({ showIntermediates: true, showGrids: true });

        rerender(<ViewControls {...props} />);
        fireEvent.mouseDown(screen.getByText('Display'));
        expect(screen.getByText('Show Intermediates')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('Show Intermediates')).toBeNull();

        fireEvent.click(screen.getByTitle('View Options'));
        fireEvent.click(screen.getByText('Show Intermediates'));
        fireEvent.click(screen.getByText('Show Image Grids'));
        expect(mocks.filters).toMatchObject({ showIntermediates: false, showGrids: false });
    });

    it('renders active layout, sort, and hidden-content variants', () => {
        mocks.availableHiddenContent = { hasIntermediates: true, hasGrids: false };
        mocks.filters = { ...baseFilters(), showIntermediates: true };
        mocks.sortOption = 'name_desc';
        const { container, rerender, props } = setup({ layoutMode: 'grid' });
        expect(screen.getByTitle('Grid Layout').className).toContain('bg-white');
        expect(screen.getByText('Name (Z-A)')).toBeTruthy();
        fireEvent.click(screen.getByTitle('View Options'));
        expect(container.querySelector('[class~="right-0.5"]')).toBeTruthy();

        mocks.availableHiddenContent = { hasIntermediates: false, hasGrids: true };
        mocks.filters = { ...baseFilters(), showGrids: true };
        mocks.sortOption = 'future' as SortOption;
        rerender(<ViewControls {...props} layoutMode="justified" showLayoutSwitcher={false} showSlideshowButton={false} />);
        expect(screen.getByText('Sort')).toBeTruthy();
        expect(screen.queryByTitle('Grid Layout')).toBeNull();
        expect(screen.queryByTitle('Play Slideshow')).toBeNull();

        rerender(<ViewControls {...props} layoutMode="justified" />);
        expect(screen.getByTitle('Justified Layout').className).toContain('bg-white');
    });

    it('formats match, search, loading, and total counters', () => {
        const { rerender, props } = setup({ displayedCount: 5, totalCount: 20 });
        expect(screen.getByText('MATCHES IN Library')).toBeTruthy();
        rerender(<ViewControls {...props} displayedCount={0} totalCount={0} isFiltering />);
        expect(screen.getByText('LOADING...')).toBeTruthy();
        expect(screen.getByText('...')).toBeTruthy();
        rerender(<ViewControls {...props} displayedCount={0} totalCount={20} isFiltering />);
        expect(screen.getByText('SEARCHING...')).toBeTruthy();
        expect(screen.getByText('20')).toBeTruthy();
        rerender(<ViewControls {...props} displayedCount={5} totalCount={0} isFiltering />);
        expect(screen.getByText('...')).toBeTruthy();
        rerender(<ViewControls {...props} displayedCount={10} totalCount={10} />);
        expect(screen.getByText('TOTAL Library')).toBeTruthy();
    });
});
