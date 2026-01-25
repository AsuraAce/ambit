import { useState, useEffect, useRef } from 'react';

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

    // Stable references to callbacks to prevent listener re-attachment
    const onImportPathsRef = useRef(onImportPaths);
    const onImportFilesRef = useRef(onImportFiles);

    useEffect(() => {
        onImportPathsRef.current = onImportPaths;
        onImportFilesRef.current = onImportFiles;
    }, [onImportPaths, onImportFiles]);

    useEffect(() => {
        let isUnmounted = false;
        let unlistenDrop: (() => void) | null = null;
        let unlistenHover: (() => void) | null = null;
        let unlistenCancel: (() => void) | null = null;

        // Check if we are in Tauri environment
        // @ts-ignore
        const isTauriEnv = !!window.__TAURI_INTERNALS__;
        console.log('[DragDrop] isTauriEnv detected:', isTauriEnv);
        setIsTauri(isTauriEnv);

        if (isTauriEnv) {
            // Tauri Logic
            let unlisteners: (() => void)[] = [];

            import('@tauri-apps/api/event').then(async ({ listen }) => {
                console.log('[DragDrop] Setting up Tauri listeners (ONCE)');

                // Helper to handle any drop event
                const handleTauriDrop = (event: any, source: string) => {
                    setIsDraggingExternal(false);
                    // Payload can be string[] (file-drop) or object (drag-drop)
                    let files: string[] = [];

                    if (Array.isArray(event.payload)) {
                        files = event.payload;
                    } else if (event.payload?.paths && Array.isArray(event.payload.paths)) {
                        // V2 drag-drop event payload often has { paths: [], position: ... }
                        files = event.payload.paths;
                    }

                    if (files && files.length > 0) {
                        onImportPathsRef.current(files);
                    }
                };

                // Listen to ALL potential event names
                // Check if we were cleaned up while awaiting
                if (unlistenDrop === null && unlistenHover === null && unlistenCancel === null && unlistenDrop !== undefined) {
                    // This indicates unmount happened? No, rely on variable.
                }

                const u1 = await listen('tauri://file-drop', (e) => handleTauriDrop(e, 'tauri://file-drop'));
                unlisteners.push(u1);

                const u2 = await listen('tauri://drag-drop', (e) => handleTauriDrop(e, 'tauri://drag-drop'));
                unlisteners.push(u2);

                const u3 = await listen('tauri://drop', (e) => handleTauriDrop(e, 'tauri://drop'));
                unlisteners.push(u3);

                const u4 = await listen('tauri://file-drop-hover', (event) => {
                    console.log('[DragDrop] tauri://file-drop-hover fired', event);
                    setIsDraggingExternal(true);
                });
                unlisteners.push(u4);

                // Also listen for drag-enter/over for V2 consistency?
                const u5 = await listen('tauri://drag-enter', (event) => {
                    console.log('[DragDrop] tauri://drag-enter fired', event);
                    setIsDraggingExternal(true);
                });
                unlisteners.push(u5);

                const u6 = await listen('tauri://file-drop-cancelled', (event) => {
                    console.log('[DragDrop] tauri://file-drop-cancelled fired');
                    setIsDraggingExternal(false);
                });
                unlisteners.push(u6);

                // If unmount happened during setup, clean up immediately
                if (isUnmounted) {
                    unlisteners.forEach(u => u());
                    unlisteners = [];
                }
            });

            // Assign the cleanup function
            unlistenDrop = () => {
                isUnmounted = true;
                unlisteners.forEach(u => u());
            };
        }

        // Web Logic
        const handleDragEnter = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer?.types.includes('Files')) {
                console.log('[DragDrop] Web dragenter fired');
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
            if (e.clientX === 0 && e.clientY === 0) {
                console.log('[DragDrop] Web dragleave fired');
                setIsDraggingExternal(false);
            }
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingExternal(false);
            console.log('[DragDrop] Web drop fired');

            if (isTauriEnv) {
                if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                    const files = Array.from(e.dataTransfer.files);
                    // @ts-ignore
                    const paths = files.map(f => f.path || f.name).filter(p => !!p);
                    // @ts-ignore
                    const hasPaths = files.every(f => !!f.path);

                    if (hasPaths) {
                        console.log('[DragDrop] Detected paths in Web drop (Tauri Context):', paths);
                        onImportPathsRef.current(paths);
                        return;
                    }
                }

                console.log('[DragDrop] Ignoring Web drop (Tauri mode active, no paths found)');
                return;
            }

            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
                console.log('[DragDrop] Processing Web files:', e.dataTransfer.files);
                onImportFilesRef.current(e.dataTransfer.files);
            }
        };

        window.addEventListener('dragenter', handleDragEnter);
        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);

        // Return cleanup function
        return () => {
            if (unlistenDrop) unlistenDrop();
            if (unlistenHover) unlistenHover();
            if (unlistenCancel) unlistenCancel();
            window.removeEventListener('dragenter', handleDragEnter);
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('drop', handleDrop);
        };
    }, []); // Empty dependency array = Setup ONCE.

    return { isDraggingExternal };
}
