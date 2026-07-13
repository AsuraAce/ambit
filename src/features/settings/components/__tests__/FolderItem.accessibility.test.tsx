import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import type { MonitoredFolder } from '../../../../types';
import { FolderItem } from '../FolderItem';

describe('FolderItem', () => {
    it('names the remove action with its folder path and explains it on focus', () => {
        const folder: MonitoredFolder = {
            id: 'folder-1',
            path: 'C:/images/outputs',
            isActive: true,
            imageCount: 12,
        };
        const onRemove = vi.fn();

        render(
            <FolderItem
                folder={folder}
                scanningIds={new Set()}
                onRescan={vi.fn()}
                onRemove={onRemove}
            />
        );

        const removeButton = screen.getByRole('button', { name: 'Remove Folder: C:/images/outputs' });
        expect(removeButton.getAttribute('title')).toBeNull();

        fireEvent.focus(removeButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Remove Folder: C:/images/outputs');

        fireEvent.click(removeButton);
        expect(onRemove).toHaveBeenCalledWith('folder-1');
    });
});
