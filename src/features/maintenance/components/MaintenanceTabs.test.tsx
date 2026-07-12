import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { MaintenanceTabs } from './MaintenanceTabs';

describe('MaintenanceTabs', () => {
    it('shows Thumbnails after Missing in the maintenance tab list', () => {
        render(<MaintenanceTabs activeTab="missing" onTabChange={vi.fn()} />);

        const missing = screen.getByRole('button', { name: /missing/i });
        const thumbnails = screen.getByRole('button', { name: /thumbnails/i });

        expect(missing.compareDocumentPosition(thumbnails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows and selects intermediates when cleanup candidates exist', () => {
        const onTabChange = vi.fn();
        render(<MaintenanceTabs activeTab="intermediates" onTabChange={onTabChange} intermediatesCount={2} />);

        fireEvent.click(screen.getByRole('button', { name: /missing/i }));
        expect(screen.getByRole('button', { name: /intermediates/i })).toBeTruthy();
        expect(onTabChange).toHaveBeenCalledWith('missing');
    });
});
