import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { DateRangeSection } from '../DateRangeSection';
import { FilterState } from '../../../../types';

const createFilters = (overrides: Partial<FilterState> = {}): FilterState => ({
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
    ...overrides
});

const createHarness = (initialFilters: FilterState) => {
    let currentFilters = initialFilters;
    const setFilters = vi.fn((update: (prev: FilterState) => FilterState) => {
        currentFilters = update(currentFilters);
    });

    return {
        getCurrentFilters: () => currentFilters,
        setFilters
    };
};

describe('DateRangeSection', () => {
    it('selects presets and clears custom date fields', () => {
        const harness = createHarness(createFilters({
            dateRange: 'custom',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-30'
        }));

        render(
            <DateRangeSection
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /week/i }));

        expect(harness.getCurrentFilters()).toMatchObject({
            dateRange: 'week',
            dateFrom: undefined,
            dateTo: undefined
        });
    });

    it('sets custom dates and normalizes inverted ranges', () => {
        const harness = createHarness(createFilters());
        const { rerender } = render(
            <DateRangeSection
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
            />
        );

        fireEvent.change(screen.getByLabelText('Filter from date'), {
            target: { value: '2026-04-30' }
        });

        rerender(
            <DateRangeSection
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
            />
        );

        fireEvent.change(screen.getByLabelText('Filter to date'), {
            target: { value: '2026-04-01' }
        });

        expect(harness.getCurrentFilters()).toMatchObject({
            dateRange: 'custom',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-30'
        });
    });
});
