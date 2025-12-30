
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFolderMonitor } from '../useFolderMonitor';

describe('useFolderMonitor', () => {
    const mockOnScan = vi.fn();
    const mockAddToast = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should NOT scan if not loaded', () => {
        const folders = [{ id: '1', path: '/test', isActive: true }];
        renderHook(() => useFolderMonitor({
            isLoaded: false,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast
        }));

        expect(mockOnScan).not.toHaveBeenCalled();
    });

    it('should scan new active folders', () => {
        const initialFolders = [{ id: '1', path: '/test1', isActive: true }];
        const { rerender } = renderHook(({ folders }) => useFolderMonitor({
            isLoaded: true,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast
        }), {
            initialProps: { folders: initialFolders }
        });

        // Add new folder
        const updatedFolders = [
            ...initialFolders,
            { id: '2', path: '/test2', isActive: true }
        ];

        rerender({ folders: updatedFolders });

        expect(mockOnScan).toHaveBeenCalledWith('/test2', false);
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('/test2'), 'info');
    });

    it('should detect startup scan (prevFolders empty)', () => {
        const { rerender } = renderHook(({ folders, isLoaded }) => useFolderMonitor({
            isLoaded,
            monitoredFolders: folders,
            onScan: mockOnScan,
            addToast: mockAddToast
        }), {
            initialProps: { folders: [], isLoaded: false }
        });

        // Set loaded and add folder
        rerender({ folders: [{ id: '1', path: '/test', isActive: true }], isLoaded: true });

        expect(mockOnScan).toHaveBeenCalledWith('/test', true);
        expect(mockAddToast).not.toHaveBeenCalled(); // No toast on startup scan
    });
});
