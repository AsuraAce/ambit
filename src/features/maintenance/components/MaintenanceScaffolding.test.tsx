import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MaintenanceTab } from '../../../hooks/useMaintenanceData';
import { MaintenanceHeader } from './MaintenanceHeader';
import { ScanPlaceholder } from './ScanPlaceholder';

vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
    },
}));

describe('ScanPlaceholder', () => {
    it.each([
        ['thumbnails', 'Thumbnail Optimization'],
        ['untagged', 'Untagged Images'],
        ['intermediates', 'Intermediate Images'],
    ] as const)('starts filtered and global scans for %s', (tab, title) => {
        const onStartScan = vi.fn();
        render(<ScanPlaceholder tab={tab} onStartScan={onStartScan} />);
        expect(screen.getByText(title)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Current Filter' }));
        fireEvent.click(screen.getByRole('button', { name: 'Start Maintenance Scan' }));
        expect(onStartScan).toHaveBeenCalledWith(tab, 'filtered');

        fireEvent.click(screen.getByRole('button', { name: 'Global' }));
        fireEvent.click(screen.getByRole('button', { name: 'Start Maintenance Scan' }));
        expect(onStartScan).toHaveBeenLastCalledWith(tab, 'global');
    });

    it('runs exact duplicate detection globally without scope controls', () => {
        const onStartScan = vi.fn();
        render(<ScanPlaceholder tab="duplicates" onStartScan={onStartScan} />);
        expect(screen.getByText('Duplicate Finder')).toBeTruthy();
        expect(screen.getByText(/exact SHA-256 content matches/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Current Filter' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Start Maintenance Scan' }));
        expect(onStartScan).toHaveBeenCalledWith('duplicates', 'global');
    });

    it('runs the missing-file scan globally without scope controls', () => {
        const onStartScan = vi.fn();
        render(<ScanPlaceholder tab="missing" onStartScan={onStartScan} />);
        expect(screen.queryByRole('button', { name: 'Current Filter' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Start Maintenance Scan' }));
        expect(onStartScan).toHaveBeenCalledWith('missing', 'global');
    });

    it('renders nothing for tabs without scan metadata', () => {
        const { container } = render(<ScanPlaceholder tab={'trash' satisfies MaintenanceTab} onStartScan={vi.fn()} />);
        expect(container.firstChild).toBeNull();
    });
});

describe('MaintenanceHeader', () => {
    it.each(['sage', 'blue', 'orange', 'red'] as const)('renders the %s variant and optional content', (variant) => {
        render(
            <MaintenanceHeader
                title={`${variant} title`}
                description="Description"
                icon={<span>Icon</span>}
                count={1234}
                actions={<button>Action</button>}
                extraControls={<span>Extra</span>}
                variant={variant}
            />
        );
        expect(screen.getByText(`${variant} title`)).toBeTruthy();
        expect(screen.getByText('1,234')).toBeTruthy();
        expect(screen.getByText('Action')).toBeTruthy();
        expect(screen.getByText('Extra')).toBeTruthy();
    });

    it('selects and deselects all while honoring default props', () => {
        const onSelectAll = vi.fn();
        const onClearSelection = vi.fn();
        const { rerender } = render(
            <MaintenanceHeader
                title="Header"
                description="Description"
                icon={<span>Icon</span>}
                onSelectAll={onSelectAll}
                onClearSelection={onClearSelection}
            />
        );
        expect(screen.getByText('0')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Select All' }));
        expect(onSelectAll).toHaveBeenCalledOnce();

        rerender(
            <MaintenanceHeader
                title="Header"
                description="Description"
                icon={<span>Icon</span>}
                selectedCount={2}
                onSelectAll={onSelectAll}
                onClearSelection={onClearSelection}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Deselect All' }));
        expect(onClearSelection).toHaveBeenCalledOnce();
    });
});
