import { useState, useEffect, useRef } from 'react';

/**
 * Hook to handle drag and drop of files/folders from external sources.
 * 
 * With dragDropEnabled: false in tauri.conf.json, we handle ALL drag-and-drop
 * (both internal and external) via the standard HTML5 Drag and Drop API.
 * 
 * Internal drags (application/x-ambit-image-ids) are ignored by this hook
 * and handled by the individual drop target components.
 */

interface UseDragDropProps {
    onImportPaths: (paths: string[]) => void;
    onImportFiles: (files: FileList) => void;
}

export function useDragDrop({ onImportPaths, onImportFiles }: UseDragDropProps) {
    const [isDraggingExternal, setIsDraggingExternal] = useState(false);

    const onImportPathsRef = useRef(onImportPaths);
    const onImportFilesRef = useRef(onImportFiles);

    useEffect(() => {
        onImportPathsRef.current = onImportPaths;
        onImportFilesRef.current = onImportFiles;
    }, [onImportPaths, onImportFiles]);

    useEffect(() => {
        // @ts-ignore
        const isTauriEnv = typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

        // Helper: is this an internal (image reorder) drag?
        const isInternalDrag = (e: DragEvent): boolean => {
            const types = e.dataTransfer?.types ? Array.from(e.dataTransfer.types) : [];
            return types.some(t => t === 'application/x-ambit-image-ids' || t === 'application/json');
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
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            }
        };

        const handleDragLeave = (e: DragEvent) => {
            // Only trigger when actually leaving the window (coordinates become 0,0)
            if (e.clientX === 0 && e.clientY === 0) {
                setIsDraggingExternal(false);
            }
        };

        const handleDrop = (e: DragEvent) => {
            if (isInternalDrag(e)) return; // Don't intercept internal drops

            e.preventDefault();
            e.stopPropagation();
            setIsDraggingExternal(false);

            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                if (isTauriEnv) {
                    // In Tauri, File objects may have a .path property
                    const files = Array.from(e.dataTransfer.files);
                    // @ts-ignore - Tauri adds .path to File objects
                    const paths = files.map(f => f.path).filter((p): p is string => !!p);

                    if (paths.length > 0) {
                        console.log('[DragDrop] External drop with paths:', paths.length);
                        onImportPathsRef.current(paths);
                        return;
                    }
                }

                console.log('[DragDrop] External drop with files:', e.dataTransfer.files.length);
                onImportFilesRef.current(e.dataTransfer.files);
            }
        };

        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);

        return () => {
            window.removeEventListener('dragenter', handleDragEnter);
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('drop', handleDrop);
        };
    }, []);

    return { isDraggingExternal };
}
