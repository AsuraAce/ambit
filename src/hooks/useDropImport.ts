import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import type { LibraryDropResult } from '../bindings';
import { AppSettings, GeneratorTool, MonitoredFolder } from '../types';
import { useToast } from './useToast';
import { useLibraryStore } from '../stores/libraryStore';
import { isTauriRuntime } from '../services/runtime';
import { postDroppedFiles } from '../services/dropImportService';
import { VIDEO_FILTER_EXTENSIONS } from '../services/videoService';
import type { ImportResult } from '../services/importService';
import { listenWithCleanup } from '../utils/tauriListener';
import { normalizePath } from '../utils/pathUtils';
import type { ImportMediaKind } from '../utils/importProgress';
import { createMonitoredFolder, scanAddedFolders } from '../features/settings/utils/addedFolderScan';

// Files and folders dropped onto the window (#493). Files are imported in place, as
// Import files does; a folder Rust confirmed with the user becomes a library folder.

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const NAMES_SHOWN = 3;

export const DROP_BUSY_MESSAGE = 'An import is already running. Wait for it to finish or cancel it, then drop again.';
export const DROP_UNAVAILABLE_MESSAGE = "Drag-and-drop import isn't available here. Use Import files or Import videos instead.";

const extensionOf = (path: string): string => path.split('.').pop()?.toLowerCase() ?? '';
const nameOf = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const listNames = (names: string[]): string => {
    const shown = names.slice(0, NAMES_SHOWN).join(', ');
    const more = names.length - NAMES_SHOWN;
    return more > 0 ? `${shown} and ${more} more` : shown;
};

const mediaKindOf = (paths: string[]): ImportMediaKind => {
    if (paths.every((path) => IMAGE_EXTENSIONS.includes(extensionOf(path)))) return 'images';
    if (paths.every((path) => VIDEO_FILTER_EXTENSIONS.includes(extensionOf(path)))) return 'videos';
    return 'media';
};

/** For items dragged from a browser or another app, which have no file on disk to import in place. */
export const describeNotOnDisk = (names: string[]): string => {
    const one = names.length === 1;
    return `${listNames(names)} ${one ? "isn't a file" : "aren't files"} on disk. Save ${one ? 'it' : 'them'} to a folder first, then drop ${one ? 'it' : 'them'}.`;
};

/** One message for everything in a drop that Ambit could not import, or null when all of it could. */
export const describeDropProblems = (result: LibraryDropResult, droppedNames: string[]): string | null => {
    const problems: string[] = [];
    if (result.withoutPath.length > 0) {
        problems.push(describeNotOnDisk(result.withoutPath.map((index) => droppedNames[index] ?? 'an item')));
    }
    if (result.unsupported.length > 0) {
        problems.push(
            `Can't import ${listNames(result.unsupported.map(nameOf))}: Ambit imports PNG, JPG and WebP images and MP4, WebM, MOV, M4V and MKV videos.`
        );
    }
    if (result.unreadable.length > 0) {
        problems.push(`Couldn't read ${listNames(result.unreadable.map(nameOf))}.`);
    }
    return problems.length > 0 ? problems.join(' ') : null;
};

interface UseDropImportProps {
    importPaths: (
        paths: string[],
        defaultTool?: GeneratorTool,
        options?: { mediaKind?: ImportMediaKind }
    ) => Promise<ImportResult | undefined>;
    importFolders: (folders: { path: string; variant?: string }[]) => Promise<ImportResult | void>;
    /** The browser mock mode's in-memory import; the desktop app never uses it. */
    importWebFiles: (files: File[]) => Promise<void>;
    monitoredFolders: MonitoredFolder[];
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const useDropImport = ({ importPaths, importFolders, importWebFiles, monitoredFolders, setSettings }: UseDropImportProps) => {
    const { addToast } = useToast();
    // Drops posted to Rust, by id, with the dropped names for messages about items without a path.
    const pendingDropsRef = useRef(new Map<string, string[]>());
    const latestRef = useRef({ importPaths, importFolders, importWebFiles, monitoredFolders, setSettings, addToast });

    useEffect(() => {
        latestRef.current = { importPaths, importFolders, importWebFiles, monitoredFolders, setSettings, addToast };
    }, [importPaths, importFolders, importWebFiles, monitoredFolders, setSettings, addToast]);

    const addDroppedFolders = useCallback(async (folders: string[]) => {
        const { monitoredFolders: current, setSettings: update, importFolders: scan, addToast: toast } = latestRef.current;
        const known = new Set(current.map((folder) => normalizePath(folder.path)));
        const added: MonitoredFolder[] = [];
        const queuedAt = Date.now();
        for (const folder of folders) {
            const path = normalizePath(folder);
            if (known.has(path)) {
                toast(`Already a library folder: ${path}`, 'info');
                continue;
            }
            known.add(path);
            added.push(createMonitoredFolder(path, queuedAt + added.length));
        }
        if (added.length === 0) return;

        update((prev) => ({ ...prev, monitoredFolders: [...prev.monitoredFolders, ...added] }));
        for (const folder of added) toast(`Added folder: ${folder.path}`, 'success');
        await scanAddedFolders(
            added.map(({ id, path, variant }) => ({ id, path, variant })),
            { onScanFolder: scan, setSettings: update, addToast: toast }
        );
    }, []);

    const handleDropResult = useCallback(
        async (result: LibraryDropResult) => {
            const droppedNames = pendingDropsRef.current.get(result.dropId);
            if (!droppedNames) return;
            pendingDropsRef.current.delete(result.dropId);
            const { importPaths: importFiles, addToast: toast } = latestRef.current;

            const problems = describeDropProblems(result, droppedNames);
            if (problems) toast(problems, 'warning');

            // Another import may have started while Rust granted the drop: say so plainly
            // rather than letting the import guard turn it away or add an unscanned folder.
            if ((result.files.length > 0 || result.folders.length > 0) && useLibraryStore.getState().isImporting) {
                toast(DROP_BUSY_MESSAGE, 'info');
                return;
            }
            if (result.files.length > 0) {
                const imported = await importFiles(result.files, undefined, { mediaKind: mediaKindOf(result.files) });
                // A cancelled or failed file import has told the user; it also stops the folders.
                if (!imported || imported.wasCancelled) return;
            }
            if (result.folders.length > 0) {
                await addDroppedFolders(result.folders);
            }
        },
        [addDroppedFolders]
    );

    useEffect(() => {
        if (!isTauriRuntime()) return;
        const listener = listenWithCleanup<LibraryDropResult>('library-drop-result', (event) => {
            handleDropResult(event.payload).catch((error: unknown) => {
                console.error('[DropImport] Dropped items could not be imported', error);
                latestRef.current.addToast('Import of the dropped items failed', 'error');
            });
        });
        return listener.cleanup;
    }, [handleDropResult]);

    const handleDropFiles = useCallback((files: File[]) => {
        const { addToast: toast, importWebFiles: importInMemory } = latestRef.current;
        if (files.length === 0) return;
        if (!isTauriRuntime()) {
            importInMemory(files).catch((error: unknown) => console.error('[DropImport] Dropped-file import failed', error));
            return;
        }
        // One drop at a time: a drop Rust is still granting (or asking about) counts as busy,
        // so a second drop is never granted only to be turned away.
        if (useLibraryStore.getState().isImporting || pendingDropsRef.current.size > 0) {
            toast(DROP_BUSY_MESSAGE, 'info');
            return;
        }
        const names = files.map((file) => file.name);
        const post = postDroppedFiles(files);
        if (post.status === 'not-on-disk') {
            toast(describeNotOnDisk(names), 'warning');
            return;
        }
        if (post.status === 'unavailable') {
            toast(DROP_UNAVAILABLE_MESSAGE, 'error');
            return;
        }
        pendingDropsRef.current.set(post.dropId, names);
    }, []);

    return { handleDropFiles };
};
