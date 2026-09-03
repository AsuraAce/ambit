import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { ViewerTabs } from '../ViewerTabs';

const tabs = [
    { id: 'details', label: 'Details' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'workflow', label: 'Workflow' },
] as const;

describe('ViewerTabs', () => {
    it('renders consistent text-only selected states and routes clicks', () => {
        const onTabChange = vi.fn();
        render(
            <ViewerTabs
                tabs={tabs}
                activeTab="details"
                onTabChange={onTabChange}
                ariaLabel="Viewer sections"
            />
        );

        expect(screen.getByRole('tablist', { name: 'Viewer sections' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByRole('tab', { name: 'Metadata' }).getAttribute('tabindex')).toBe('-1');
        expect(screen.getByRole('tab', { name: 'Workflow' }).querySelector('svg')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
        expect(onTabChange).toHaveBeenCalledWith('metadata');
    });

    it('supports arrow, Home, and End keyboard navigation', () => {
        const onTabChange = vi.fn();
        const onKeyDown = vi.fn();
        render(
            <div onKeyDown={onKeyDown}>
                <ViewerTabs
                    tabs={tabs}
                    activeTab="details"
                    onTabChange={onTabChange}
                    ariaLabel="Viewer sections"
                />
            </div>
        );

        const details = screen.getByRole('tab', { name: 'Details' });
        fireEvent.keyDown(details, { key: 'ArrowRight' });
        expect(onTabChange).toHaveBeenLastCalledWith('metadata');
        expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Metadata' }));
        expect(onKeyDown).not.toHaveBeenCalled();

        fireEvent.keyDown(details, { key: 'End' });
        expect(onTabChange).toHaveBeenLastCalledWith('workflow');
        expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Workflow' }));

        fireEvent.keyDown(screen.getByRole('tab', { name: 'Workflow' }), { key: 'Home' });
        expect(onTabChange).toHaveBeenLastCalledWith('details');
        expect(document.activeElement).toBe(details);
    });
});
