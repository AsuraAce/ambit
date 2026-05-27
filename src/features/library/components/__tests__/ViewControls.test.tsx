import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewControls } from '../ViewControls';

const setFilters = vi.fn();
const setSortOption = vi.fn();

vi.mock('../../../../contexts/SearchContext', () => ({
    useSearch: () => ({
        availableHiddenContent: { hasIntermediates: false, hasGrids: false },
        filters: { showIntermediates: false, showGrids: false },
        setFilters,
        sortOption: 'date_desc',
        setSortOption
    })
}));

const renderViewControls = (setLayoutMode = vi.fn()) => {
    render(
        <ViewControls
            showLayoutSwitcher
            layoutMode="masonry"
            setLayoutMode={setLayoutMode}
            showSlideshowButton={false}
            onSlideshow={vi.fn()}
            sortOption="date_desc"
            setSortOption={vi.fn()}
            thumbnailSize={200}
            setThumbnailSize={vi.fn()}
            displayedCount={10}
            totalCount={10}
            scopeName="Library"
        />
    );
    return setLayoutMode;
};

describe('ViewControls', () => {
    it('selects the requested gallery layout mode', () => {
        const setLayoutMode = renderViewControls();

        fireEvent.click(screen.getByTitle('Justified Layout'));

        expect(setLayoutMode).toHaveBeenCalledWith('justified');
    });
});
