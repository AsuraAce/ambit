import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type FilterState, type ViewMode } from '../../../../types';
import { AppSidebar } from '../AppSidebar';

const filters = (overrides: Partial<FilterState> = {}): FilterState => ({
    searchQuery: '',
    models: [],
    tools: [GeneratorTool.COMFYUI],
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
    showIntermediates: false,
    showGrids: false,
    ...overrides,
});

const button = (label: string) => screen.getByRole('button', { name: label });

describe('AppSidebar', () => {
    it('navigates, toggles filters, and opens utility dialogs', () => {
        let currentFilters = filters({ favoritesOnly: true, pinnedOnly: true });
        let panelOpen = false;
        const setViewMode = vi.fn<(mode: ViewMode) => void>();
        const setFilters = vi.fn((update: React.SetStateAction<FilterState>) => {
            currentFilters = typeof update === 'function' ? update(currentFilters) : update;
        });
        const setIsFilterPanelOpen = vi.fn((update: React.SetStateAction<boolean>) => {
            panelOpen = typeof update === 'function' ? update(panelOpen) : update;
        });
        const onOpenSettings = vi.fn();
        const onOpenShortcuts = vi.fn();
        const onOpenDonation = vi.fn();

        render(
            <AppSidebar
                viewMode="timeline"
                setViewMode={setViewMode}
                filters={currentFilters}
                setFilters={setFilters}
                isFilterPanelOpen={false}
                setIsFilterPanelOpen={setIsFilterPanelOpen}
                onOpenSettings={onOpenSettings}
                onOpenShortcuts={onOpenShortcuts}
                onOpenDonation={onOpenDonation}
                showSupportPulse
            />
        );

        for (const [label, mode] of [
            ['Grid View', 'grid'],
            ['Timeline View', 'timeline'],
            ['Statistics', 'dashboard'],
            ['Maintenance', 'maintenance'],
        ] as const) {
            fireEvent.click(button(label));
            expect(setViewMode).toHaveBeenCalledWith(mode);
        }
        fireEvent.click(button('Show Filters'));
        fireEvent.click(button('Disable Favorites Only'));
        fireEvent.click(button('Disable Pinned Only'));
        fireEvent.click(screen.getByRole('button', { name: 'Support Ambit' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open Help & Guide' }));
        fireEvent.click(button('Settings'));

        expect(panelOpen).toBe(true);
        expect(currentFilters.favoritesOnly).toBe(true);
        expect(currentFilters.pinnedOnly).toBe(false);
        expect(onOpenDonation).toHaveBeenCalledOnce();
        expect(onOpenShortcuts).toHaveBeenCalledOnce();
        expect(onOpenSettings).toHaveBeenCalledOnce();
    });

    it.each([
        ['grid', false, false],
        ['timeline', true, false],
        ['dashboard', true, false],
        ['maintenance', true, true],
    ] as const)('renders active states for %s mode', (viewMode, panelOpen, favoritesOnly) => {
        render(
            <AppSidebar
                viewMode={viewMode}
                setViewMode={vi.fn()}
                filters={filters({ favoritesOnly, pinnedOnly: false })}
                setFilters={vi.fn()}
                isFilterPanelOpen={panelOpen}
                setIsFilterPanelOpen={vi.fn()}
                onOpenSettings={vi.fn()}
                onOpenShortcuts={vi.fn()}
                onOpenDonation={vi.fn()}
                showSupportPulse={false}
            />
        );

        expect(button('Grid View').className).toContain(viewMode === 'grid' && !favoritesOnly ? 'bg-sage-500' : 'text-gray-400');
        expect(button(panelOpen ? 'Hide Filters' : 'Show Filters').className).toContain(
            panelOpen && viewMode !== 'maintenance' ? 'bg-sage-500' : 'text-gray-400'
        );
    });
});
