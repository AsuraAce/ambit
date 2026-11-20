import { act, renderHook } from '../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDragDrop } from '../useDragDrop';

type TransferOverrides = Partial<DataTransfer> & {
    types?: readonly string[];
    files?: FileList | File[];
};

const dragEvent = (type: string, transfer?: TransferOverrides, coordinates: { clientX?: number; clientY?: number } = {}): DragEvent => {
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperties(event, {
        dataTransfer: { value: transfer, configurable: true },
        clientX: { value: coordinates.clientX ?? 1, configurable: true },
        clientY: { value: coordinates.clientY ?? 1, configurable: true },
    });
    return event;
};

const fileList = (...files: File[]): FileList => files as unknown as FileList;

describe('useDragDrop', () => {
    const onDropFiles = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('tracks external file entry and only clears when the pointer leaves the window', () => {
        const { result } = renderHook(() => useDragDrop({ onDropFiles }));

        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] })));
        expect(result.current.isDraggingExternal).toBe(true);

        act(() => window.dispatchEvent(dragEvent('dragleave', undefined, { clientX: 0, clientY: 1 })));
        expect(result.current.isDraggingExternal).toBe(true);

        act(() => window.dispatchEvent(dragEvent('dragleave', undefined, { clientX: 0, clientY: 0 })));
        expect(result.current.isDraggingExternal).toBe(false);
    });

    it('ignores non-file and internal drag entry markers', () => {
        const { result } = renderHook(() => useDragDrop({ onDropFiles }));

        act(() => window.dispatchEvent(dragEvent('dragenter')));
        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['text/plain'] })));
        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['application/x-ambit-image-ids', 'Files'] })));
        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['application/json', 'Files'] })));

        expect(result.current.isDraggingExternal).toBe(false);
    });

    it('prevents external file dragover and requests copy semantics', () => {
        renderHook(() => useDragDrop({ onDropFiles }));
        const transfer: TransferOverrides = { types: ['Files'], dropEffect: 'none' };
        const event = dragEvent('dragover', transfer);

        act(() => window.dispatchEvent(event));

        expect(event.defaultPrevented).toBe(true);
        expect(transfer.dropEffect).toBe('copy');
    });

    it('does not intercept internal or non-file dragover', () => {
        renderHook(() => useDragDrop({ onDropFiles }));
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

    it('hands dropped files to the drop import and clears the external overlay', () => {
        const file = new File(['image'], 'test.jpg', { type: 'image/jpeg' });
        const { result } = renderHook(() => useDragDrop({ onDropFiles }));
        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] })));
        const event = dragEvent('drop', { types: ['Files'], files: fileList(file) });

        act(() => window.dispatchEvent(event));

        expect(event.defaultPrevented).toBe(true);
        expect(result.current.isDraggingExternal).toBe(false);
        expect(onDropFiles).toHaveBeenCalledWith([file]);
    });

    // #493: a drop that a drop zone stops before it reaches the window must still end the external drag.
    it('clears the external overlay when a drop zone stops the drop', () => {
        const { result } = renderHook(() => useDragDrop({ onDropFiles }));
        const zone = document.createElement('div');
        document.body.appendChild(zone);
        zone.addEventListener('drop', (event) => event.stopPropagation());
        act(() => window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] })));
        expect(result.current.isDraggingExternal).toBe(true);

        act(() => {
            zone.dispatchEvent(dragEvent('drop', { types: ['Files'], files: fileList(new File([], 'a.png')) }));
        });

        expect(result.current.isDraggingExternal).toBe(false);
        expect(onDropFiles).not.toHaveBeenCalled();
        zone.remove();
    });

    it('ignores internal and empty drops', () => {
        renderHook(() => useDragDrop({ onDropFiles }));
        const internal = dragEvent('drop', { types: ['application/x-ambit-image-ids', 'Files'], files: fileList(new File([], 'a.png')) });
        const empty = dragEvent('drop', { types: ['Files'], files: fileList() });

        act(() => {
            window.dispatchEvent(internal);
            window.dispatchEvent(empty);
        });

        expect(internal.defaultPrevented).toBe(false);
        expect(empty.defaultPrevented).toBe(true);
        expect(onDropFiles).not.toHaveBeenCalled();
    });

    it('uses the latest callback without reinstalling listeners', () => {
        const first = vi.fn();
        const second = vi.fn();
        const file = new File([], 'latest.png');
        const { rerender } = renderHook(({ callback }) => useDragDrop({ onDropFiles: callback }), { initialProps: { callback: first } });

        rerender({ callback: second });
        act(() => window.dispatchEvent(dragEvent('drop', { types: ['Files'], files: fileList(file) })));

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith([file]);
    });

    it('removes all listeners when unmounted', () => {
        const { unmount } = renderHook(() => useDragDrop({ onDropFiles }));
        unmount();

        act(() => {
            window.dispatchEvent(dragEvent('dragenter', { types: ['Files'] }));
            window.dispatchEvent(dragEvent('drop', { types: ['Files'], files: fileList(new File([], 'ignored.png')) }));
        });

        expect(onDropFiles).not.toHaveBeenCalled();
    });
});
