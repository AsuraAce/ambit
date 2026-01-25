import { useState, useEffect } from 'react';

/**
 * Hook to handle drag and drop of files/folders from external sources.
 * 
 * Handles two environments:
 * 1. Tauri (Native): Uses 'tauri://file-drop' event. Supports files AND folders.
 * 2. Web (Browser): Uses standard HTML5 drag-and-drop. Supports files only (folders require complex API).
 * 
 * When running in Tauri, we disable the Web logic for drops to avoid double-firing 
 * and to ensure we use the native handler which supports folders properly.
 */

interface UseDragDropProps {
    onImportPaths: (paths: string[]) => void;
    onImportFiles: (files: FileList) => void;
}

export function useDragDrop({ onImportPaths, onImportFiles }: UseDragDropProps) {
    const [isDraggingExternal, setIsDraggingExternal] = useState(false);
    const [isTauri, setIsTauri] = useState(false);

    useEffect(() => {
        let unlistenDrop: (() => void) | null = null;
        let unlistenHover: (() => void) | null = null;
        let unlistenCancel: (() => void) | null = null;

        // Check if we are in Tauri environment
        // @ts-ignore
        const isTauriEnv = !!window.__TAURI_INTERNALS__;
        setIsTauri(isTauriEnv);

        if (isTauriEnv) {
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
        }

        // Web Logic
        // We always listen to dragenter/over/leave to show the UI overlay in all envs (if needed)
        // OR we can rely on Tauri hover for UI.
        // Actually, Tauri hover is only for the OS drag operation. 
        // The Web dragenter/leave might still fire?
        // Let's keep the Web UI logic for now, but BLOCK the actual 'drop' action if in Tauri.

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

            // CRITICAL: If in Tauri, ignore web drops. Tauri native event handles it.
            // This prevents "folders failing" (because Web drop sees them as 0-byte files or fails)
            // and prevents double-importing single files.
            if (isTauriEnv) {
                return;
            }

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
