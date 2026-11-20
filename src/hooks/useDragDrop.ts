import { useState, useEffect, useRef } from 'react';

/**
 * Hook to handle drag and drop of files/folders from external sources.
 *
 * With dragDropEnabled: false in tauri.conf.json, we handle ALL drag-and-drop
 * (both internal and external) via the standard HTML5 Drag and Drop API.
 * Tauri's native drop would stop the app's own HTML5 drags on Windows (#493).
 *
 * Internal drags (application/x-ambit-image-ids) are ignored by this hook
 * and handled by the individual drop target components. Dropped files go to
 * `onDropFiles`, which hands them to Rust for their paths (see useDropImport).
 */

interface UseDragDropProps {
    onDropFiles: (files: File[]) => void;
}

export function useDragDrop({ onDropFiles }: UseDragDropProps) {
    const [isDraggingExternal, setIsDraggingExternal] = useState(false);

    const onDropFilesRef = useRef(onDropFiles);

    useEffect(() => {
        onDropFilesRef.current = onDropFiles;
    }, [onDropFiles]);

    useEffect(() => {
        // Helper: is this an internal (image reorder) drag?
        const isInternalDrag = (e: DragEvent): boolean => {
            const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : [];
            return types.some((t) => t === 'application/x-ambit-image-ids' || t === 'application/json');
        };

        const handleDragEnter = (e: DragEvent) => {
            if (isInternalDrag(e)) return; // Let component drop zones handle it
            if (e.dataTransfer?.types.includes('Files')) {
                e.preventDefault();
                setIsDraggingExternal(true);
            }
        };

        const handleDragOver = (e: DragEvent) => {
            if (isInternalDrag(e)) return; // Let component drop zones handle it
            if (e.dataTransfer?.types.includes('Files')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        };

        const handleDragLeave = (e: DragEvent) => {
            // Only trigger when actually leaving the window (coordinates become 0,0)
            if (e.clientX === 0 && e.clientY === 0) {
                setIsDraggingExternal(false);
            }
        };

        // Any drop ends the drag, so the overlay clears even when a drop zone stops the event.
        const clearOverlay = () => setIsDraggingExternal(false);

        const handleDrop = (e: DragEvent) => {
            if (isInternalDrag(e)) return; // Don't intercept internal drops

            e.preventDefault();
            e.stopPropagation();
            setIsDraggingExternal(false);

            const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
            if (files.length > 0) {
                onDropFilesRef.current(files);
            }
        };

        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', clearOverlay, true);
        window.addEventListener('drop', handleDrop);

        return () => {
            window.removeEventListener('dragenter', handleDragEnter);
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('drop', clearOverlay, true);
            window.removeEventListener('drop', handleDrop);
        };
    }, []);

    return { isDraggingExternal };
}
