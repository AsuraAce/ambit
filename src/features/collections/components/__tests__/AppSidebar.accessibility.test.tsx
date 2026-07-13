import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../../../../test/testUtils';
import { createDefaultFilters } from '../../../../utils/filterState';
import { DonationModal } from '../../../../components/ui/DonationModal';
import { ShortcutsModal } from '../../../../components/ui/ShortcutsModal';
import { AppSidebar } from '../AppSidebar';

const SidebarHarness = () => {
    const [viewMode, setViewMode] = React.useState<'grid' | 'timeline' | 'dashboard' | 'maintenance'>('grid');
    const [filters, setFilters] = React.useState(createDefaultFilters());
    const [isFilterPanelOpen, setIsFilterPanelOpen] = React.useState(false);

    return (
        <AppSidebar
            viewMode={viewMode}
            setViewMode={setViewMode}
            filters={filters}
            setFilters={setFilters}
            isFilterPanelOpen={isFilterPanelOpen}
            setIsFilterPanelOpen={setIsFilterPanelOpen}
            onOpenSettings={vi.fn()}
            onOpenShortcuts={vi.fn()}
            onOpenDonation={vi.fn()}
            showSupportPulse={false}
        />
    );
};

const SidebarModalHarness = () => {
    const [viewMode, setViewMode] = React.useState<'grid' | 'timeline' | 'dashboard' | 'maintenance'>('grid');
    const [filters, setFilters] = React.useState(createDefaultFilters());
    const [isFilterPanelOpen, setIsFilterPanelOpen] = React.useState(false);
    const [modal, setModal] = React.useState<'donation' | 'shortcuts' | null>(null);

    return (
        <>
            <AppSidebar
                viewMode={viewMode}
                setViewMode={setViewMode}
                filters={filters}
                setFilters={setFilters}
                isFilterPanelOpen={isFilterPanelOpen}
                setIsFilterPanelOpen={setIsFilterPanelOpen}
                onOpenSettings={vi.fn()}
                onOpenShortcuts={() => setModal('shortcuts')}
                onOpenDonation={() => setModal('donation')}
                showSupportPulse={false}
            />
            <DonationModal isOpen={modal === 'donation'} onClose={() => setModal(null)} />
            <ShortcutsModal isOpen={modal === 'shortcuts'} onClose={() => setModal(null)} />
        </>
    );
};

describe('AppSidebar tooltips', () => {
    it('replaces hover-only navigation help with keyboard-discoverable action labels', () => {
        render(<SidebarHarness />);

        const gridButton = screen.getByRole('button', { name: 'Grid View' });
        expect(gridButton.getAttribute('aria-current')).toBe('page');
        expect(gridButton.getAttribute('title')).toBeNull();

        fireEvent.focus(gridButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Grid View');
        fireEvent.blur(gridButton);

        fireEvent.click(screen.getByRole('button', { name: 'Show Favorites Only' }));
        const disableFavorites = screen.getByRole('button', { name: 'Disable Favorites Only' });
        expect(disableFavorites.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Grid View' }).getAttribute('aria-current')).toBe('page');
    });

    it('exposes filter visibility as a pressed toggle with a next-action label', () => {
        render(<SidebarHarness />);

        const showFilters = screen.getByRole('button', { name: 'Show Filters' });
        expect(showFilters.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(showFilters);

        const hideFilters = screen.getByRole('button', { name: 'Hide Filters' });
        expect(hideFilters.getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(screen.getByRole('button', { name: 'Maintenance' }));
        expect(screen.getByRole('button', { name: 'Hide Filters' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('hands focus from the Support tooltip into its modal and restores it on close', () => {
        render(<SidebarModalHarness />);

        const launcher = screen.getByRole('button', { name: 'Support Ambit' });
        act(() => launcher.focus());
        expect(screen.getByRole('tooltip')).toBeTruthy();
        fireEvent.click(launcher);

        const closeButton = screen.getByRole('button', { name: 'Close Support Dialog' });
        expect(document.activeElement).toBe(closeButton);
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.click(closeButton);
        expect(document.activeElement).toBe(launcher);
    });

    it('hands focus from the Shortcuts tooltip into its modal and restores it on close', () => {
        render(<SidebarModalHarness />);

        const launcher = screen.getByRole('button', { name: 'Open Keyboard Shortcuts' });
        act(() => launcher.focus());
        expect(screen.getByRole('tooltip')).toBeTruthy();
        fireEvent.click(launcher);

        const closeButton = screen.getByRole('button', { name: 'Close Keyboard Shortcuts' });
        expect(document.activeElement).toBe(closeButton);
        expect(screen.queryByRole('tooltip')).toBeNull();

        fireEvent.click(closeButton);
        expect(document.activeElement).toBe(launcher);
    });
});
