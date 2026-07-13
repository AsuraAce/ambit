import type { Dispatch, SetStateAction } from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import type { FilterState } from '../../../../types';
import { ArchitectureSection } from '../ArchitectureSection';

const filters: FilterState = {
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
    dateRange: 'all',
    favoritesOnly: false,
    collectionId: null,
};

describe('ArchitectureSection model search disclosure', () => {
    it('reports whether the conditional search field is expanded without toggle semantics', () => {
        render(
            <ArchitectureSection
                filters={filters}
                setFilters={vi.fn() as Dispatch<SetStateAction<FilterState>>}
                models={['SDXL']}
                isOpen
                onToggle={vi.fn()}
            />
        );

        const openSearch = screen.getByRole('button', { name: 'Search Models' });
        expect(openSearch.getAttribute('aria-expanded')).toBe('false');
        expect(openSearch.hasAttribute('aria-pressed')).toBe(false);
        expect(screen.queryByPlaceholderText('Search models...')).toBeNull();

        fireEvent.click(openSearch);

        const closeSearch = screen.getByRole('button', { name: 'Hide Model Search' });
        expect(closeSearch.getAttribute('aria-expanded')).toBe('true');
        expect(closeSearch.hasAttribute('aria-pressed')).toBe(false);
        expect(screen.getByPlaceholderText('Search models...')).toBeTruthy();
    });
});
