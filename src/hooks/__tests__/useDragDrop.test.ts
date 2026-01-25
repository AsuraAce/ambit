
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDragDrop } from '../useDragDrop';
import { listen } from '@tauri-apps/api/event';

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
                files: [{ name: 'test.jpg' }]
            };
            window.dispatchEvent(event);
        });

        expect(mockOnImportFiles).toHaveBeenCalled();
        expect(mockOnImportFiles.mock.calls[0][0][0].name).toBe('test.jpg');
    });

    it('should handle Tauri file-drop events', async () => {
        // Mock Tauri environment
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
            value: {},
            writable: true,
            configurable: true
        });

        const { result } = renderHook(() => useDragDrop({
            onImportPaths: mockOnImportPaths,
            onImportFiles: mockOnImportFiles
        }));

        // Wait for dynamic import and listeners to be set up
        await new Promise(r => setTimeout(r, 10));

        // Find the tauri://file-drop listener
        const [[event, handler]] = (listen as any).mock.calls.filter(([ev]: any) => ev === 'tauri://file-drop');

        act(() => {
            handler({ payload: ['/path/to/file.jpg'] });
        });

        expect(mockOnImportPaths).toHaveBeenCalledWith(['/path/to/file.jpg']);
        expect(result.current.isDraggingExternal).toBe(false);
    });

    it('should handle Tauri hover events', async () => {
        // Mock Tauri environment
        Object.defineProperty(window, '__TAURI_INTERNALS__', {
            value: {},
            writable: true,
            configurable: true
        });

        const { result } = renderHook(() => useDragDrop({
            onImportPaths: mockOnImportPaths,
            onImportFiles: mockOnImportFiles
        }));

        await new Promise(r => setTimeout(r, 10));

        const [[event, handler]] = (listen as any).mock.calls.filter(([ev]: any) => ev === 'tauri://file-drop-hover');

        act(() => {
            handler({});
        });

        expect(result.current.isDraggingExternal).toBe(true);
    });
});
