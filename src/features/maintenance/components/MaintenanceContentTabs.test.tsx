import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../types';
import { MissingTab } from './MissingTab';
import { TrashTab } from './TrashTab';
import { UntaggedTab } from './UntaggedTab';
import { IntermediatesTab } from './IntermediatesTab';

vi.mock('../../library/components/VirtualGrid', () => ({
    VirtualGrid: ({ items, renderItem, onRangeSelection, onBackgroundClick }: {
        items: AIImage[];
        renderItem: (item: AIImage, style: React.CSSProperties, index: number) => React.ReactNode;
        onRangeSelection?: (indexes: number[], additive: boolean) => void;
        onBackgroundClick?: () => void;
    }) => (
        <div data-testid="virtual-grid">
            {items[0] ? renderItem(items[0], { width: 200 }, 0) : null}
            <button onClick={() => onRangeSelection?.([0], true)}>Range</button>
            <button onClick={onBackgroundClick}>Background</button>
        </div>
    ),
}));

vi.mock('./MaintenanceItem', () => ({
    MaintenanceItem: ({ img, isSelected, onClick, overlayActions, children, isMissing, imageClassName }: {
        img: AIImage;
        isSelected?: boolean;
        onClick: (event: React.MouseEvent) => void;
        overlayActions?: React.ReactNode;
        children?: React.ReactNode;
        isMissing?: boolean;
        imageClassName?: string;
    }) => (
        <div data-testid="maintenance-item" data-selected={isSelected} data-missing={isMissing} data-image-class={imageClassName}>
            <button onClick={onClick}>{img.filename}</button>
            {overlayActions}
            {children}
        </div>
    ),
}));

vi.mock('./MaintenanceHeader', () => ({
    MaintenanceHeader: ({ title, actions, extraControls, onSelectAll, onClearSelection }: {
        title: string;
        actions?: React.ReactNode;
        extraControls?: React.ReactNode;
        onSelectAll: () => void;
        onClearSelection: () => void;
    }) => (
        <header>
            <h2>{title}</h2>
            {actions}
            {extraControls}
            <button onClick={onSelectAll}>Select all</button>
            <button onClick={onClearSelection}>Clear all</button>
        </header>
    ),
}));

const image = (id = 'image-1'): AIImage => ({
    id,
    url: `asset://${id}`,
    thumbnailUrl: `asset://${id}-thumb`,
    filename: `${id}.png`,
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: '',
        steps: 20,
        cfg: 7,
        sampler: '',
        positivePrompt: '',
        negativePrompt: '',
    },
});

const common = () => ({
    selectedIds: new Set<string>(),
    onItemClick: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    scrollContainerRef: { current: document.createElement('div') },
    onRangeSelection: vi.fn(),
    onBackgroundClick: vi.fn(),
});

const exerciseGrid = (callbacks: ReturnType<typeof common>) => {
    fireEvent.click(screen.getByRole('button', { name: 'image-1.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Background' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(callbacks.onItemClick).toHaveBeenCalledWith('image-1', 0, expect.any(Object));
    expect(callbacks.onRangeSelection).toHaveBeenCalledWith([0], true);
    expect(callbacks.onBackgroundClick).toHaveBeenCalledOnce();
    expect(callbacks.onSelectAll).toHaveBeenCalledOnce();
    expect(callbacks.onClearSelection).toHaveBeenCalledOnce();
};

describe('maintenance content tabs', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders and switches both untagged empty scopes', () => {
        const onScopeChange = vi.fn();
        const callbacks = common();
        const { rerender } = render(
            <UntaggedTab {...callbacks} images={[]} onRemoveFromLibrary={vi.fn()} onViewImage={vi.fn()} maskedKeywords={[]} untaggedScope="global" onScopeChange={onScopeChange} />
        );
        expect(screen.getByText('No Untagged Images')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Switch to Filtered scope' }));
        expect(onScopeChange).toHaveBeenCalledWith('filtered');

        rerender(<UntaggedTab {...callbacks} images={[]} onRemoveFromLibrary={vi.fn()} onViewImage={vi.fn()} maskedKeywords={[]} untaggedScope="filtered" onScopeChange={onScopeChange} />);
        expect(screen.getByText('in this filter', { exact: false })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Switch to Global scope' }));
        expect(onScopeChange).toHaveBeenCalledWith('global');
    });

    it('handles populated untagged actions, scopes, and item viewing', () => {
        const callbacks = common();
        const onRemove = vi.fn();
        const onView = vi.fn();
        const onScopeChange = vi.fn();
        const { rerender } = render(
            <UntaggedTab {...callbacks} images={[image()]} onRemoveFromLibrary={onRemove} onViewImage={onView} maskedKeywords={[]} untaggedScope="global" onScopeChange={onScopeChange} />
        );
        exerciseGrid(callbacks);
        fireEvent.click(screen.getByRole('button', { name: 'View Image' }));
        fireEvent.click(screen.getByRole('button', { name: 'Filtered' }));
        fireEvent.click(screen.getByRole('button', { name: 'Global' }));
        expect(onView).toHaveBeenCalledWith('image-1');
        expect(onScopeChange.mock.calls).toEqual([['filtered'], ['global']]);
        expect(screen.getByText('Recover')).toBeTruthy();

        rerender(<UntaggedTab {...callbacks} selectedIds={new Set(['image-1'])} images={[image()]} onRemoveFromLibrary={onRemove} onViewImage={onView} maskedKeywords={[]} untaggedScope="filtered" onScopeChange={onScopeChange} />);
        fireEvent.click(screen.getByRole('button', { name: /^Remove from Library/ }));
        expect(onRemove).toHaveBeenCalledOnce();
        expect(screen.queryByText('Recover')).toBeNull();
    });

    it('covers missing-file empty, purge, selection, and viewing states', () => {
        const callbacks = common();
        const onDelete = vi.fn();
        const onPurge = vi.fn();
        const onView = vi.fn();
        const { rerender } = render(<MissingTab {...callbacks} images={[]} onDeleteSelected={onDelete} onPurgeMissing={onPurge} onViewImage={onView} />);
        expect(screen.getByText('No Missing Files')).toBeTruthy();

        rerender(<MissingTab {...callbacks} images={[image()]} onDeleteSelected={onDelete} onPurgeMissing={onPurge} onViewImage={onView} />);
        exerciseGrid(callbacks);
        fireEvent.click(screen.getByRole('button', { name: 'Remove all 1 from Library' }));
        fireEvent.click(screen.getByRole('button', { name: 'View Image' }));
        expect(onPurge).toHaveBeenCalledOnce();
        expect(onView).toHaveBeenCalledWith('image-1');
        expect(screen.getByTestId('maintenance-item').dataset.missing).toBe('true');

        rerender(<MissingTab {...callbacks} selectedIds={new Set(['image-1'])} images={[image()]} onDeleteSelected={onDelete} onPurgeMissing={onPurge} onViewImage={onView} />);
        fireEvent.click(screen.getByRole('button', { name: /^Remove from Library/ }));
        expect(onDelete).toHaveBeenCalledOnce();
    });

    it('covers trash empty, idle, restore, and both busy action states', () => {
        const callbacks = common();
        const onRestore = vi.fn();
        const onDelete = vi.fn();
        const baseProps = { ...callbacks, images: [image()], onRestoreSelected: onRestore, onDeleteSelected: onDelete, maskedKeywords: [] };
        const { rerender } = render(<TrashTab {...baseProps} images={[]} />);
        expect(screen.getByText('Removed List is Empty')).toBeTruthy();

        rerender(<TrashTab {...baseProps} />);
        exerciseGrid(callbacks);
        expect(screen.getByText('Select images to restore or delete from disk')).toBeTruthy();
        expect(screen.getByTestId('maintenance-item').dataset.imageClass).toContain('grayscale');

        rerender(<TrashTab {...baseProps} selectedIds={new Set(['image-1'])} />);
        fireEvent.click(screen.getByRole('button', { name: /^Restore to Library/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete File' }));
        expect(onRestore).toHaveBeenCalledOnce();
        expect(onDelete).toHaveBeenCalledOnce();

        rerender(<TrashTab {...baseProps} selectedIds={new Set(['image-1'])} busyAction="restoring" />);
        expect(screen.getByRole('button', { name: /^Restoring.../ })).toBeTruthy();
        rerender(<TrashTab {...baseProps} selectedIds={new Set(['image-1'])} busyAction="deleting" />);
        expect(screen.getByRole('button', { name: 'Deleting from Disk...' })).toBeTruthy();
    });

    it('covers intermediate empty scopes and populated processing actions', () => {
        const callbacks = common();
        const onDelete = vi.fn();
        const onUnmark = vi.fn();
        const onView = vi.fn();
        const onScopeChange = vi.fn();
        const baseProps = { ...callbacks, images: [image()], onDeleteSelected: onDelete, onUnmarkSelected: onUnmark, onViewImage: onView, maskedKeywords: [], scope: 'global' as const, onScopeChange };
        const { rerender } = render(<IntermediatesTab {...baseProps} images={[]} />);
        expect(screen.getByText('Your library is clean!', { exact: false })).toBeTruthy();

        rerender(<IntermediatesTab {...baseProps} images={[]} scope="filtered" />);
        fireEvent.click(screen.getByRole('button', { name: 'Switch to Global Scan' }));
        expect(onScopeChange).toHaveBeenCalledWith('global');

        rerender(<IntermediatesTab {...baseProps} />);
        exerciseGrid(callbacks);
        expect(screen.getByText('Select images to process')).toBeTruthy();
        expect(screen.getByText('Intermediate')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'View Image' }));
        fireEvent.click(screen.getByRole('button', { name: 'Filtered' }));
        fireEvent.click(screen.getByRole('button', { name: 'Global' }));
        expect(onView).toHaveBeenCalledWith('image-1');

        rerender(<IntermediatesTab {...baseProps} selectedIds={new Set(['image-1'])} scope="filtered" />);
        fireEvent.click(screen.getByRole('button', { name: /^Move to Gallery/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(onUnmark).toHaveBeenCalledOnce();
        expect(onDelete).toHaveBeenCalledOnce();
        expect(screen.queryByText('Intermediate')).toBeNull();
    });
});
