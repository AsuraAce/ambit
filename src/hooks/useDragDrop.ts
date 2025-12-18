import { useState, useEffect } from 'react';

interface UseDragDropProps {
    onImportPaths: (paths: string[]) => void;
    onImportFiles: (files: FileList) => void;
}

export function useDragDrop({ onImportPaths, onImportFiles }: UseDragDropProps) {
    const [isDraggingExternal, setIsDraggingExternal] = useState(false);

    useEffect(() => {
        let unlistenDrop: (() => void) | null = null;
        let unlistenHover: (() => void) | null = null;
        let unlistenCancel: (() => void) | null = null;

        // Tauri Logic
        import('@tauri-apps/api/event').then(async ({ listen }) => {
            unlistenDrop = await listen('tauri://file-drop', (event) => {
                setIsDraggingExternal(false);
                const files = event.payload as string[];
                if (files && files.length > 0) {
                    onImportPaths(files);
                }
            });

            unlistenHover = await listen('tauri://file-drop-hover', () => {
                setIsDraggingExternal(true);
            });

            unlistenCancel = await listen('tauri://file-drop-cancelled', () => {
                setIsDraggingExternal(false);
            });
        });

        // Web Logic
        const handleDragEnter = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer?.types.includes('Files')) {
                setIsDraggingExternal(true);
            }
        };

        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
        };

        const handleDragLeave = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.clientX === 0 && e.clientY === 0) setIsDraggingExternal(false);
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingExternal(false);
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                onImportFiles(e.dataTransfer.files);
            }
        };

        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);

        return () => {
            if (unlistenDrop) unlistenDrop();
            if (unlistenHover) unlistenHover();
            if (unlistenCancel) unlistenCancel();
            window.removeEventListener('dragenter', handleDragEnter);
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('drop', handleDrop);
        };
    }, [onImportPaths, onImportFiles]);

    return { isDraggingExternal };
}
