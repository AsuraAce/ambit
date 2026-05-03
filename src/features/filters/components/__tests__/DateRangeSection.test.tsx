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

const dateButtonLabel = (value: string): string => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });
};

const monthLabel = (value: string): string => {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric'
    }).format(new Date(year, month - 1, day));
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

    it('opens the calendar from the custom range control', () => {
        const harness = createHarness(createFilters());
        render(
            <DateRangeSection
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
            />
        );

        expect(screen.queryByLabelText('Filter from date')).toBeNull();
        expect(screen.queryByRole('dialog', { name: /custom date range/i })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /custom range/i }));

        expect(screen.getByRole('dialog', { name: /custom date range/i })).toBeTruthy();
        expect(screen.getByRole('group', { name: /calendar dates/i })).toBeTruthy();
    });

    it('selects dates from the calendar and commits only after Apply', () => {
        const harness = createHarness(createFilters({
            dateRange: 'custom',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-30'
        }));
        const { rerender } = render(
            <DateRangeSection
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /apr 1, 2026 to apr 30, 2026/i }));
        fireEvent.click(screen.getByRole('button', { name: dateButtonLabel('2026-04-10') }));
        fireEvent.click(screen.getByRole('button', { name: dateButtonLabel('2026-04-15') }));

        expect(harness.setFilters).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /apply/i }));

        expect(harness.getCurrentFilters()).toMatchObject({
            dateRange: 'custom',
            dateFrom: '2026-04-10',
            dateTo: '2026-04-15'
        });

        rerender(
            <DateRangeSection
                filters={harness.getCurrentFilters()}
                setFilters={harness.setFilters}
            />
        );

        expect(screen.getByRole('button', { name: /apr 10, 2026 to apr 15, 2026/i })).toBeTruthy();
        expect(screen.queryByRole('dialog', { name: /custom date range/i })).toBeNull();
    });

    it('normalizes an inverted calendar selection', () => {
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

        fireEvent.click(screen.getByRole('button', { name: /apr 1, 2026 to apr 30, 2026/i }));
        fireEvent.click(screen.getByRole('button', { name: dateButtonLabel('2026-04-30') }));
        fireEvent.click(screen.getByRole('button', { name: dateButtonLabel('2026-04-01') }));
        fireEvent.click(screen.getByRole('button', { name: /apply/i }));

        expect(harness.getCurrentFilters()).toMatchObject({
            dateRange: 'custom',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-30'
        });
    });

    it('navigates months without committing draft state', () => {
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

        fireEvent.click(screen.getByRole('button', { name: /apr 1, 2026 to apr 30, 2026/i }));
        const currentMonth = screen.getByLabelText('Current calendar month');
        expect(currentMonth.textContent).toBe(monthLabel('2026-04-01'));

        fireEvent.click(screen.getByRole('button', { name: /next month/i }));

        expect(currentMonth.textContent).toBe(monthLabel('2026-05-01'));
        expect(harness.setFilters).not.toHaveBeenCalled();
    });

    it('clears a custom range from the popover', () => {
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

        fireEvent.click(screen.getByRole('button', { name: /apr 1, 2026 to apr 30, 2026/i }));
        fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

        expect(harness.getCurrentFilters()).toMatchObject({
            dateRange: 'all',
            dateFrom: undefined,
            dateTo: undefined
        });
    });

    it('closes the popover with Escape without applying draft edits', () => {
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

        fireEvent.click(screen.getByRole('button', { name: /apr 1, 2026 to apr 30, 2026/i }));
        fireEvent.click(screen.getByRole('button', { name: dateButtonLabel('2026-04-15') }));
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog', { name: /custom date range/i })).toBeNull();
        expect(harness.setFilters).not.toHaveBeenCalled();
        expect(harness.getCurrentFilters()).toMatchObject({
            dateRange: 'custom',
            dateFrom: '2026-04-01',
            dateTo: '2026-04-30'
        });
    });
});
