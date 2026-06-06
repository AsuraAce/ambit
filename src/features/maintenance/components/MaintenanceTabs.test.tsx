import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../test/testUtils';
import { MaintenanceTabs } from './MaintenanceTabs';

describe('MaintenanceTabs', () => {
    it('shows Thumbnails after Missing in the maintenance tab list', () => {
        render(<MaintenanceTabs activeTab="missing" onTabChange={vi.fn()} />);

        const missing = screen.getByRole('button', { name: /missing/i });
        const thumbnails = screen.getByRole('button', { name: /thumbnails/i });

        expect(missing.compareDocumentPosition(thumbnails) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
