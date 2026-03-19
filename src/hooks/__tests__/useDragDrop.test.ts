
import { renderHook, act } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDragDrop } from '../useDragDrop';
import { listen } from '@tauri-apps/api/event';

vi.mock('../../utils/env', () => ({
    isDesktop: () => true
}));

describe('useDragDrop', () => {
    const mockOnImportPaths = vi.fn();
    const mockOnImportFiles = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should set isDraggingExternal on dragenter (Web)', () => {
        const { result } = renderHook(() => useDragDrop({
            onImportPaths: mockOnImportPaths,
            onImportFiles: mockOnImportFiles
        }));

        act(() => {
            const event = new Event('dragenter', { bubbles: true }) as any;
            event.dataTransfer = { types: ['Files'] };
            window.dispatchEvent(event);
        });

        expect(result.current.isDraggingExternal).toBe(true);
    });

    it('should trigger onImportFiles on drop (Web)', () => {
        renderHook(() => useDragDrop({
            onImportPaths: mockOnImportPaths,
            onImportFiles: mockOnImportFiles
        }));

        act(() => {
            const event = new Event('drop', { bubbles: true }) as any;
            event.dataTransfer = {
                types: ['Files'],
                files: [{ name: 'test.jpg' }]
            };
            window.dispatchEvent(event);
        });

        expect(mockOnImportFiles).toHaveBeenCalled();
        expect(mockOnImportFiles.mock.calls[0][0][0].name).toBe('test.jpg');
    });

});
