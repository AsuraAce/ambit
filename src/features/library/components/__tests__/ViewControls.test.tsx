import * as React from 'react';
import { act, fireEvent, render, screen, within } from '../../../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterState, SortOption } from '../../../../types';
import { ViewControls } from '../ViewControls';

const mocks = vi.hoisted(() => ({
    availableHiddenContent: { hasIntermediates: false, hasGrids: false, hasInvokeImageAssets: false },
    filters: { showIntermediates: false, showGrids: false, showInvokeImageAssets: false } as FilterState,
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
    controlNets: [], ipAdapters: [], dateRange: 'all', favoritesOnly: false, collectionId: null, showIntermediates: false, showGrids: false,
    showInvokeImageAssets: false
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
    it('separates layouts from thumbnail size and keeps Slideshow outside the View menu', () => {
        const { rerender, props } = setup();
        expect(screen.getByRole('button', { name: 'Start Slideshow' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'View' }));
        const layout = screen.getByRole('group', { name: 'Layout' });
        expect(within(layout).getAllByRole('button')).toHaveLength(3);
        expect(within(layout).queryByRole('slider')).toBeNull();
        expect(within(layout).queryByRole('button', { name: 'Start Slideshow' })).toBeNull();
        expect(screen.getByText('Thumbnail Size').className).not.toContain('sr-only');
        rerender(<ViewControls {...props} showLayoutSwitcher={false} showThumbnailSize={false} />);
        expect(screen.queryByRole('group', { name: 'Layout' })).toBeNull();
        expect(screen.queryByRole('slider')).toBeNull();
    });

    it('shows collection context below compact counts without hiding its full name', () => {
        setup({ displayedCount: 211000, totalCount: 1200000, scopeName: 'Artist - Study' });
        const scope = screen.getByText('Artist - Study');
        expect(scope.className).not.toContain('sr-only');
        expect(scope.getAttribute('title')).toBe('Artist - Study');
        expect(screen.getByTitle((211000).toLocaleString()).textContent).toBe('211k');
        expect(screen.getByTitle((1200000).toLocaleString()).textContent).toBe('1.2M');
    });

    it('preserves verified matches while the collection total is pending', () => {
        setup({ displayedCount: 7, totalCount: null, scopeName: 'Pending collection' });
        expect(screen.getByText('7')).toBeTruthy();
        expect(screen.getByLabelText('Collection total not available').textContent).toBe('\u2014');
        expect(screen.queryByText('0')).toBeNull();
    });
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.availableHiddenContent = { hasIntermediates: false, hasGrids: false, hasInvokeImageAssets: false };
        mocks.filters = baseFilters();
        mocks.sortOption = 'date_desc';
        mocks.setFilters.mockImplementation((update: (previous: FilterState) => FilterState) => { mocks.filters = update(mocks.filters); });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('routes every layout, slideshow, and thumbnail-size control', () => {
        const { props } = setup();
        fireEvent.click(screen.getByRole('button', { name: 'View' }));
        fireEvent.click(screen.getByRole('button', { name: 'Use Grid Layout' }));
        fireEvent.click(screen.getByRole('button', { name: 'Use Masonry Layout' }));
        fireEvent.click(screen.getByRole('button', { name: 'Use Justified Layout' }));
        expect(vi.mocked(props.setLayoutMode).mock.calls.map(call => call[0])).toEqual(['grid', 'masonry', 'justified']);
        fireEvent.click(screen.getByRole('button', { name: 'Start Slideshow' }));
        expect(props.onSlideshow).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByRole('slider'), { target: { value: '325' } });
        expect(props.setThumbnailSize).toHaveBeenCalledWith(325);
    });

    it('always exposes View controls, even with no hidden-content variants', () => {
        setup();
        expect(screen.getByRole('button', { name: 'View' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'View' }));
        expect(screen.getByRole('slider', { name: 'Thumbnail Size' })).toBeTruthy();
    });

    it('selects every sort option, closes after selection, and dismisses outside clicks', () => {
        const { props } = setup();
        const options: Array<[SortOption, string]> = [
            ['date_desc', 'Newest'], ['date_asc', 'Oldest'], ['name_asc', 'Name (A-Z)'], ['name_desc', 'Name (Z-A)'],
            ['size_desc', 'Largest (Size)'], ['size_asc', 'Smallest (Size)']
        ];
        for (const [value, label] of options) {
            fireEvent.click(screen.getByText('Newest'));
            const matches = screen.getAllByText(label);
            expect(matches[matches.length - 1].closest('button')?.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
            fireEvent.click(matches[matches.length - 1]);
            expect(props.setSortOption).toHaveBeenLastCalledWith(value);
        }
        fireEvent.click(screen.getByText('Newest'));
        expect(screen.getAllByText('Oldest')).toHaveLength(1);
        fireEvent.mouseDown(screen.getAllByText('Newest')[0]);
        expect(screen.getAllByText('Oldest')).toHaveLength(1);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('Oldest')).toBeNull();
    });

    it('toggles all hidden-content controls and closes only on outside clicks', () => {
        mocks.availableHiddenContent = { hasIntermediates: true, hasGrids: true, hasInvokeImageAssets: true };
        const { rerender, props } = setup();
        fireEvent.click(screen.getByTitle('View Options'));
        fireEvent.click(screen.getByText('Show Intermediates'));
        fireEvent.click(screen.getByText('Show Image Grids'));
        fireEvent.click(screen.getByText('Show InvokeAI Image Assets'));
        expect(mocks.filters).toMatchObject({ showIntermediates: true, showGrids: true, showInvokeImageAssets: true });

        rerender(<ViewControls {...props} />);
        fireEvent.mouseDown(screen.getByText('Visibility'));
        expect(screen.getByText('Show Intermediates')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByText('Show Intermediates')).toBeNull();

        fireEvent.click(screen.getByTitle('View Options'));
        fireEvent.click(screen.getByText('Show Intermediates'));
        fireEvent.click(screen.getByText('Show Image Grids'));
        fireEvent.click(screen.getByText('Show InvokeAI Image Assets'));
        expect(mocks.filters).toMatchObject({ showIntermediates: false, showGrids: false, showInvokeImageAssets: false });
    });

    it('renders active layout, sort, and hidden-content variants', () => {
        mocks.availableHiddenContent = { hasIntermediates: true, hasGrids: false, hasInvokeImageAssets: false };
        mocks.filters = { ...baseFilters(), showIntermediates: true };
        const { container, rerender, props } = setup({ layoutMode: 'grid', sortOption: 'name_desc' });
        fireEvent.click(screen.getByTitle('View Options'));
        expect(screen.getByRole('button', { name: 'Use Grid Layout' }).className).toContain('bg-white');
        expect(screen.getByText('Name (Z-A)')).toBeTruthy();
        expect(container.querySelector('[class~="right-0.5"]')).toBeTruthy();

        mocks.availableHiddenContent = { hasIntermediates: false, hasGrids: true, hasInvokeImageAssets: false };
        mocks.filters = { ...baseFilters(), showGrids: true };
        rerender(<ViewControls {...props} layoutMode="justified" sortOption={'future' as SortOption} showLayoutSwitcher={false} showSlideshowButton={false} />);
        expect(screen.getByText('Sort')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Use Grid Layout' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Start Slideshow' })).toBeNull();

        rerender(<ViewControls {...props} layoutMode="justified" />);
        expect(screen.getByRole('button', { name: 'Use Justified Layout' }).className).toContain('bg-white');
    });

    it('formats settled match and scope counters', () => {
        const { rerender, props } = setup({ displayedCount: 5, totalCount: 20 });
        const matchLabel = screen.getByText('MATCHES IN Library');
        expect(matchLabel.getAttribute('title')).toBe('MATCHES IN Library');
        expect(matchLabel.className).toContain('text-[10px]');
        expect(matchLabel.className).toContain('dark:text-gray-400');
        expect(matchLabel.className).toContain('truncate');
        expect(matchLabel.className).toContain('normal-case');
        expect(matchLabel.className).toContain('tracking-normal');
        expect(matchLabel.className).not.toContain('opacity-60');
        rerender(<ViewControls {...props} displayedCount={10} totalCount={10} scopeName="A Very Long Collection Name" />);
        const scopeLabel = screen.getByText('A Very Long Collection Name');
        expect(scopeLabel.getAttribute('title')).toBe('A Very Long Collection Name');
        expect(scopeLabel.className).toContain('w-full');
        expect(scopeLabel.className).toContain('normal-case');
        expect(screen.queryByText(/TOTAL A Very Long Collection Name/)).toBeNull();
    });

    it('switches fast board counts atomically without flashing a loading placeholder', () => {
        vi.useFakeTimers();
        const { rerender, props } = setup({
            displayedCount: 10,
            totalCount: 10,
            scopeName: 'Demo - Gallery',
            isFiltering: false
        });

        rerender(<ViewControls
            {...props}
            displayedCount={10}
            totalCount={84}
            scopeName="Demo - Assets"
            isFiltering
        />);

        expect(screen.getByText('10')).toBeTruthy();
        expect(screen.getByText('Demo - Gallery')).toBeTruthy();
        expect(screen.queryByText('...')).toBeNull();
        expect(screen.queryByText('LOADING Demo - Assets')).toBeNull();

        act(() => vi.advanceTimersByTime(179));
        expect(screen.getByText('Demo - Gallery')).toBeTruthy();
        expect(screen.queryByText('...')).toBeNull();

        rerender(<ViewControls
            {...props}
            displayedCount={84}
            totalCount={84}
            scopeName="Demo - Assets"
            isFiltering={false}
        />);

        expect(screen.getByText('84')).toBeTruthy();
        expect(screen.getByText('Demo - Assets')).toBeTruthy();
        expect(screen.queryByText('Demo - Gallery')).toBeNull();
        expect(screen.queryByText('...')).toBeNull();
    });

    it('keeps a newly mounted fast query visually empty until its first count settles', () => {
        vi.useFakeTimers();
        const { rerender, props } = setup({
            displayedCount: 0,
            totalCount: 0,
            scopeName: 'Library',
            isFiltering: true
        });

        expect(screen.queryByText('...')).toBeNull();
        expect(screen.queryByText('LOADING Library')).toBeNull();
        expect(screen.queryByText('0')).toBeNull();

        act(() => vi.advanceTimersByTime(179));
        expect(screen.queryByText('...')).toBeNull();

        rerender(<ViewControls
            {...props}
            displayedCount={84}
            totalCount={84}
            scopeName="Library"
            isFiltering={false}
        />);

        expect(screen.getByText('84')).toBeTruthy();
        expect(screen.getByText('Library')).toBeTruthy();
        expect(screen.queryByText('...')).toBeNull();
    });

    it('does not retain an All Users count while a different owner is loading', () => {
        vi.useFakeTimers();
        const { rerender, props } = setup({
            displayedCount: 150_000,
            totalCount: 150_000,
            scopeName: 'Library',
            ownerPresentationKey: 'all',
            isFiltering: false,
        });

        rerender(<ViewControls
            {...props}
            displayedCount={0}
            totalCount={0}
            scopeName="Library"
            ownerPresentationKey="owner:jupiter"
            isFiltering
        />);

        expect(screen.queryByText('150,000')).toBeNull();
        expect(screen.queryByText('0')).toBeNull();
    });

    it('shows a stable loading state only for a sustained board query', () => {
        vi.useFakeTimers();
        const { rerender, props } = setup({
            displayedCount: 10,
            totalCount: 10,
            scopeName: 'Demo - Gallery',
            isFiltering: false
        });

        rerender(<ViewControls
            {...props}
            displayedCount={10}
            totalCount={1254}
            scopeName="Reference Poses - Collection Part 1"
            isFiltering
        />);

        act(() => vi.advanceTimersByTime(180));
        const loadingLabel = screen.getByText('LOADING Reference Poses - Collection Part 1');
        expect(loadingLabel.getAttribute('title')).toBe('LOADING Reference Poses - Collection Part 1');
        expect(screen.getByText('...')).toBeTruthy();
        expect(screen.queryByText('10')).toBeNull();
        expect(screen.queryByText('1,254')).toBeNull();

        rerender(<ViewControls
            {...props}
            displayedCount={1254}
            totalCount={1254}
            scopeName="Reference Poses - Collection Part 1"
            isFiltering={false}
        />);
        act(() => vi.advanceTimersByTime(299));
        expect(screen.getByText('...')).toBeTruthy();

        act(() => vi.advanceTimersByTime(1));
        expect(screen.getByText('1.3k')).toBeTruthy();
        expect(screen.getByText('Reference Poses - Collection Part 1')).toBeTruthy();
        expect(screen.queryByText('...')).toBeNull();
    });
});
