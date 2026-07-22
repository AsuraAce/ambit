import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { MaintenanceTabs } from './MaintenanceTabs';

describe('MaintenanceTabs', () => {
    it('shows Thumbnails after Missing in the maintenance tab list', () => {
        render(<MaintenanceTabs activeTab="missing" onTabChange={vi.fn()} />);

        const missing = screen.getByRole('tab', { name: /missing/i });
        const thumbnails = screen.getByRole('tab', { name: /thumbnails/i });

        expect(missing.compareDocumentPosition(thumbnails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows and selects intermediates when cleanup candidates exist', () => {
        const onTabChange = vi.fn();
        render(<MaintenanceTabs activeTab="intermediates" onTabChange={onTabChange} intermediatesCount={2} />);

        fireEvent.click(screen.getByRole('tab', { name: /missing/i }));
        expect(screen.getByRole('tab', { name: /intermediates/i })).toBeTruthy();
        expect(onTabChange).toHaveBeenCalledWith('missing');
    });

    it('keeps the active intermediates tab available when its count reaches zero', () => {
        render(<MaintenanceTabs activeTab="intermediates" onTabChange={vi.fn()} intermediatesCount={0} />);

        expect(screen.getByRole('tab', { name: /intermediates/i }).getAttribute('aria-selected')).toBe('true');
    });

    it('does not emit a tab change when the active tab is clicked again', () => {
        const onTabChange = vi.fn();
        render(<MaintenanceTabs activeTab="missing" onTabChange={onTabChange} />);

        fireEvent.click(screen.getByRole('tab', { name: /missing/i }));

        expect(onTabChange).not.toHaveBeenCalled();
    });

    it('exposes tab relationships and roving keyboard focus', () => {
        const onTabChange = vi.fn();
        render(<MaintenanceTabs activeTab="missing" onTabChange={onTabChange} />);
        const missing = screen.getByRole('tab', { name: /missing/i });
        const thumbnails = screen.getByRole('tab', { name: /thumbnails/i });

        expect(missing.getAttribute('aria-controls')).toBe('maintenance-panel-missing');
        expect(missing.getAttribute('tabindex')).toBe('0');
        expect(thumbnails.getAttribute('tabindex')).toBe('-1');

        fireEvent.keyDown(missing, { key: 'ArrowRight' });
        expect(onTabChange).toHaveBeenLastCalledWith('thumbnails');
        expect(document.activeElement).toBe(thumbnails);

        fireEvent.keyDown(missing, { key: 'ArrowLeft' });
        expect(onTabChange).toHaveBeenLastCalledWith('trash');
        expect(screen.queryByRole('tab', { name: /intermediates/i })).toBeNull();
    });

    it('uses Home and End to reach the visible tab boundaries', () => {
        const onTabChange = vi.fn();
        render(<MaintenanceTabs activeTab="duplicates" onTabChange={onTabChange} intermediatesCount={1} />);
        const duplicates = screen.getByRole('tab', { name: /duplicates/i });

        fireEvent.keyDown(duplicates, { key: 'Home' });
        expect(onTabChange).toHaveBeenLastCalledWith('missing');

        fireEvent.keyDown(duplicates, { key: 'End' });
        expect(onTabChange).toHaveBeenLastCalledWith('trash');
    });

    it('lays out every visible tab in the responsive grid', () => {
        render(<MaintenanceTabs activeTab="missing" onTabChange={vi.fn()} intermediatesCount={1} />);

        const tablist = screen.getByRole('tablist', { name: /maintenance sections/i });
        expect(tablist.classList.contains('grid')).toBe(true);
        expect(tablist.classList.contains('overflow-x-auto')).toBe(false);
        expect(screen.getAllByRole('tab')).toHaveLength(6);
    });
});
