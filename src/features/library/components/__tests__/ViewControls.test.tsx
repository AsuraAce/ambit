import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewControls } from '../ViewControls';

const setSortOption = vi.fn();
let initialFilters = { showIntermediates: false, showGrids: false };

vi.mock('../../../../contexts/SearchContext', () => ({
    useSearch: () => {
        const [filters, setFilters] = React.useState(initialFilters);

        return {
            availableHiddenContent: { hasIntermediates: true, hasGrids: true },
            filters,
            setFilters,
            sortOption: 'date_desc',
            setSortOption
        };
    }
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
    beforeEach(() => {
        initialFilters = { showIntermediates: false, showGrids: false };
    });

    it('selects the requested gallery layout mode', () => {
        const setLayoutMode = renderViewControls();

        const layoutButton = screen.getByRole('button', { name: 'Use Justified Layout' });
        expect(layoutButton.getAttribute('title')).toBeNull();
        expect(layoutButton.getAttribute('aria-pressed')).toBe('false');
        fireEvent.focus(layoutButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Use Justified Layout');
        fireEvent.click(layoutButton);

        expect(setLayoutMode).toHaveBeenCalledWith('justified');
    });

    it('reports custom sort and view popups as disclosures without claiming menu behavior', () => {
        renderViewControls();

        const sortButton = screen.getByRole('button', { name: 'Newest' });
        expect(sortButton.getAttribute('aria-expanded')).toBe('false');
        expect(sortButton.getAttribute('aria-haspopup')).toBeNull();
        fireEvent.click(sortButton);
        expect(sortButton.getAttribute('aria-expanded')).toBe('true');

        const viewButton = screen.getByRole('button', { name: 'View' });
        expect(viewButton.getAttribute('aria-expanded')).toBe('false');
        expect(viewButton.getAttribute('aria-haspopup')).toBeNull();
        fireEvent.click(viewButton);
        expect(viewButton.getAttribute('aria-expanded')).toBe('true');
    });

    it('exposes and updates the pressed state of hidden-content toggles', () => {
        renderViewControls();
        fireEvent.click(screen.getByRole('button', { name: 'View' }));

        const intermediatesButton = screen.getByRole('button', { name: /Show Intermediates/ });
        const gridsButton = screen.getByRole('button', { name: /Show Image Grids/ });
        expect(intermediatesButton.getAttribute('aria-pressed')).toBe('false');
        expect(gridsButton.getAttribute('aria-pressed')).toBe('false');

        fireEvent.click(intermediatesButton);
        fireEvent.click(gridsButton);

        expect(intermediatesButton.getAttribute('aria-pressed')).toBe('true');
        expect(gridsButton.getAttribute('aria-pressed')).toBe('true');
    });

    it('reports initially enabled hidden-content toggles and allows disabling them', () => {
        initialFilters = { showIntermediates: true, showGrids: true };
        renderViewControls();
        fireEvent.click(screen.getByRole('button', { name: 'View' }));

        const intermediatesButton = screen.getByRole('button', { name: /Show Intermediates/ });
        const gridsButton = screen.getByRole('button', { name: /Show Image Grids/ });
        expect(intermediatesButton.getAttribute('aria-pressed')).toBe('true');
        expect(gridsButton.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(intermediatesButton);
        fireEvent.click(gridsButton);

        expect(intermediatesButton.getAttribute('aria-pressed')).toBe('false');
        expect(gridsButton.getAttribute('aria-pressed')).toBe('false');
    });
});
