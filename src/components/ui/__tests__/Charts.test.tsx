import * as React from 'react';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsDashboard } from '../Charts';

const createLibraryContextState = () => ({
    stats: {
        totalImages: 2,
        totalGenerations: 2,
        avgSteps: 28,
        estSizeMB: '4.8',
        modelStats: [
            { name: 'Flux Super Long Model Name', fullName: 'Flux Super Long Model Name', count: 2 },
            { name: 'Flux Super Long Model Name XL', fullName: 'Flux Super Long Model Name XL', count: 1 }
        ],
        keywordStats: [{ text: 'aurora', value: 2 }]
    },
    setFilters: vi.fn(),
    isFiltering: false,
    globalTotal: 118000,
    isStatsSummaryLoading: false,
    isKeywordStatsLoading: false
});

const libraryContextMocks = vi.hoisted(() => ({
    stats: {
        totalImages: 2,
        totalGenerations: 2,
        avgSteps: 28,
        estSizeMB: '4.8',
        modelStats: [
            { name: 'Flux Super Long Model Name', fullName: 'Flux Super Long Model Name', count: 2 },
            { name: 'Flux Super Long Model Name XL', fullName: 'Flux Super Long Model Name XL', count: 1 }
        ],
        keywordStats: [{ text: 'aurora', value: 2 }]
    },
    setFilters: vi.fn(),
    isFiltering: false,
    globalTotal: 118000,
    isStatsSummaryLoading: false,
    isKeywordStatsLoading: false
}));

vi.mock('../../../hooks/useLibraryContext', () => ({
    useLibraryContext: () => libraryContextMocks
}));

describe('StatsDashboard', () => {
    beforeEach(() => {
        Object.assign(libraryContextMocks, createLibraryContextState());
        libraryContextMocks.setFilters = vi.fn();
        vi.clearAllMocks();
    });

    it('renders full model labels and filters by the full model name on click', () => {
        const onFilter = vi.fn();

        render(<StatsDashboard images={[]} onFilter={onFilter} />);

        expect(screen.getByText('Flux Super Long Model Name')).toBeTruthy();
        expect(screen.getByText('Flux Super Long Model Name XL')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Flux Super Long Model Name XL/i }));

        expect(onFilter).toHaveBeenCalledWith('model', 'Flux Super Long Model Name XL');
    });

    it('shows progressive loading placeholders before the summary query resolves', () => {
        libraryContextMocks.stats = {
            totalImages: 0,
            totalGenerations: 0,
            avgSteps: 0,
            estSizeMB: '0',
            modelStats: [],
            keywordStats: []
        };
        libraryContextMocks.isStatsSummaryLoading = true;

        render(<StatsDashboard images={[]} onFilter={vi.fn()} />);

        expect(screen.getAllByText('Analyzing 118,000 library images')).toHaveLength(2);
        expect(screen.getByText('Computing generation summary')).toBeTruthy();
        expect(screen.getByText('Estimating library footprint')).toBeTruthy();
        expect(screen.queryByText('No model stats found')).toBeNull();
        expect(screen.queryByText('No keywords found')).toBeNull();
        expect(screen.queryByText('0 MB')).toBeNull();
    });

    it('renders summary cards and model bars while keyword analysis is still running', () => {
        libraryContextMocks.stats.keywordStats = [];
        libraryContextMocks.isKeywordStatsLoading = true;

        render(<StatsDashboard images={[]} onFilter={vi.fn()} />);

        expect(screen.getByText('Total Images')).toBeTruthy();
        expect(screen.getByText('28')).toBeTruthy();
        expect(screen.getByText('4.8 MB')).toBeTruthy();
        expect(screen.getByText('Flux Super Long Model Name')).toBeTruthy();
        expect(screen.getByText('Analyzing Library')).toBeTruthy();
        expect(screen.queryByText('Computing generation summary')).toBeNull();
        expect(screen.queryByText('No keywords found')).toBeNull();
        expect(screen.queryByText('No model stats found')).toBeNull();
    });

    it('shows the analyzing state instead of keyword content during keyword refreshes', () => {
        libraryContextMocks.stats.keywordStats = [];
        libraryContextMocks.isKeywordStatsLoading = true;

        render(<StatsDashboard images={[]} onFilter={vi.fn()} />);

        expect(screen.getByText('Analyzing Library')).toBeTruthy();
        expect(screen.queryByText('aurora')).toBeNull();
        expect(screen.getByText('Flux Super Long Model Name')).toBeTruthy();
        expect(screen.getByText('4.8 MB')).toBeTruthy();
    });

    it('shows true empty states only after summary and keyword queries both settle empty', () => {
        libraryContextMocks.stats = {
            totalImages: 0,
            totalGenerations: 0,
            avgSteps: 0,
            estSizeMB: '0',
            modelStats: [],
            keywordStats: []
        };

        render(<StatsDashboard images={[]} onFilter={vi.fn()} />);

        expect(screen.getByText('Total Images')).toBeTruthy();
        expect(screen.getByText('0 MB')).toBeTruthy();
        expect(screen.getByText('No model stats found')).toBeTruthy();
        expect(screen.getByText('No keywords found')).toBeTruthy();
    });
});
