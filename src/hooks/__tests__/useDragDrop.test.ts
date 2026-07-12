import { act, renderHook } from '../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDragDrop } from '../useDragDrop';

type TransferOverrides = Partial<DataTransfer> & {
    types?: readonly string[];
    files?: FileList | Array<File & { path?: string }>;
};

const dragEvent = (
    type: string,
    transfer?: TransferOverrides,
    coordinates: { clientX?: number; clientY?: number } = {}
): DragEvent => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperties(event, {
        dataTransfer: { value: transfer, configurable: true },
        clientX: { value: coordinates.clientX ?? 1, configurable: true },
        clientY: { value: coordinates.clientY ?? 1, configurable: true }
    });
    return event;
};

const fileList = (...files: Array<File & { path?: string }>): FileList => files as unknown as FileList;

describe('useDragDrop', () => {
    const onImportPaths = vi.fn();
    const onImportFiles = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    });

    it('tracks external file entry and only clears when the pointer leaves the window', () => {
        const { result } = renderHook(() => useDragDrop({ onImportPaths, onImportFiles }));

        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] })));
        expect(result.current.isDraggingExternal).toBe(true);

        act(() => window.dispatchEvent(dragEvent('dragleave', undefined, { clientX: 0, clientY: 1 })));
        expect(result.current.isDraggingExternal).toBe(true);

        act(() => window.dispatchEvent(dragEvent('dragleave', undefined, { clientX: 0, clientY: 0 })));
        expect(result.current.isDraggingExternal).toBe(false);
    });

    it('ignores non-file and internal drag entry markers', () => {
        const { result } = renderHook(() => useDragDrop({ onImportPaths, onImportFiles }));

        act(() => window.dispatchEvent(dragEvent('dragenter')));
        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['text/plain'] })));
        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['application/x-ambit-image-ids', 'Files'] })));
        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['application/json', 'Files'] })));

        expect(result.current.isDraggingExternal).toBe(false);
    });

    it('prevents external file dragover and requests copy semantics', () => {
        renderHook(() => useDragDrop({ onImportPaths, onImportFiles }));
        const transfer: TransferOverrides = { types: ['Files'], dropEffect: 'none' };
        const event = dragEvent('dragover', transfer);

        act(() => window.dispatchEvent(event));

        expect(event.defaultPrevented).toBe(true);
        expect(transfer.dropEffect).toBe('copy');
    });

    it('does not intercept internal or non-file dragover', () => {
        renderHook(() => useDragDrop({ onImportPaths, onImportFiles }));
        const internal = dragEvent('dragover', { types: ['application/json', 'Files'] });
        const text = dragEvent('dragover', { types: ['text/plain'] });
        const missingTransfer = dragEvent('dragover');

        act(() => {
            window.dispatchEvent(internal);
            window.dispatchEvent(text);
            window.dispatchEvent(missingTransfer);
        });

        expect(internal.defaultPrevented).toBe(false);
        expect(text.defaultPrevented).toBe(false);
        expect(missingTransfer.defaultPrevented).toBe(false);
    });

    it('imports browser FileLists and clears the external overlay on drop', () => {
        const file = new File(['image'], 'test.jpg', { type: 'image/jpeg' });
        const files = fileList(file);
        const { result } = renderHook(() => useDragDrop({ onImportPaths, onImportFiles }));
        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] })));
        const event = dragEvent('drop', { types: ['Files'], files });

        act(() => window.dispatchEvent(event));

        expect(event.defaultPrevented).toBe(true);
        expect(result.current.isDraggingExternal).toBe(false);
        expect(onImportFiles).toHaveBeenCalledWith(files);
        expect(onImportPaths).not.toHaveBeenCalled();
    });

    it('ignores internal and empty drops', () => {
        renderHook(() => useDragDrop({ onImportPaths, onImportFiles }));
        const internal = dragEvent('drop', { types: ['application/x-ambit-image-ids', 'Files'], files: fileList(new File([], 'a.png')) });
        const empty = dragEvent('drop', { types: ['Files'], files: fileList() });

        act(() => {
            window.dispatchEvent(internal);
            window.dispatchEvent(empty);
        });

        expect(internal.defaultPrevented).toBe(false);
        expect(empty.defaultPrevented).toBe(true);
        expect(onImportFiles).not.toHaveBeenCalled();
        expect(onImportPaths).not.toHaveBeenCalled();
    });

    it('imports available Tauri paths and filters pathless files', () => {
        (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
        const withPath = Object.assign(new File([], 'a.png'), { path: 'C:/images/a.png' });
        const pathless = new File([], 'b.png');
        renderHook(() => useDragDrop({ onImportPaths, onImportFiles }));

        act(() => window.dispatchEvent(dragEvent('drop', {
            types: ['Files'],
            files: fileList(withPath, pathless)
        })));

        expect(onImportPaths).toHaveBeenCalledWith(['C:/images/a.png']);
        expect(onImportFiles).not.toHaveBeenCalled();
    });

    it('falls back to FileList import when Tauri files expose no paths', () => {
        (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
        const files = fileList(new File([], 'pathless.png'));
        renderHook(() => useDragDrop({ onImportPaths, onImportFiles }));

        act(() => window.dispatchEvent(dragEvent('drop', { types: ['Files'], files })));

        expect(onImportPaths).not.toHaveBeenCalled();
        expect(onImportFiles).toHaveBeenCalledWith(files);
    });

    it('uses the latest callbacks without reinstalling listeners', () => {
        const first = vi.fn();
        const second = vi.fn();
        const files = fileList(new File([], 'latest.png'));
        const { rerender } = renderHook(({ callback }) => useDragDrop({
            onImportPaths,
            onImportFiles: callback
        }), { initialProps: { callback: first } });

        rerender({ callback: second });
        act(() => window.dispatchEvent(dragEvent('drop', { types: ['Files'], files })));

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith(files);
    });

    it('removes all listeners when unmounted', () => {
        const { unmount } = renderHook(() => useDragDrop({ onImportPaths, onImportFiles }));
        unmount();

        act(() => {
            window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] }));
            window.dispatchEvent(dragEvent('drop', { types: ['Files'], files: fileList(new File([], 'ignored.png')) }));
        });

        expect(onImportFiles).not.toHaveBeenCalled();
    });
});
