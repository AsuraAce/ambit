import type * as React from 'react';
import { AppSettings, GeneratorTool, MonitoredFolder } from '../../../types';
import { isImportSourceCancelled, isImportSourceCompleted } from '../../../utils/importSourceStatus';
import type { ImportResult } from '../../../services/importService';
import { isOwnerSwitchPending, useInvokeOwnerScopeStore } from '../../../stores/invokeOwnerScopeStore';

// Adding a library folder and running its first scan, shared by Settings → Folders
// and a folder dropped onto the window (#493).

// Helper to detect generator from path
export const detectGeneratorVariant = (path: string): GeneratorTool => {
    const lower = path.toLowerCase();
    if (lower.includes('invokeai')) return GeneratorTool.INVOKEAI;
    if (lower.includes('comfyui') || lower.includes('comfy')) return GeneratorTool.COMFYUI;
    if (lower.includes('webui') || lower.includes('stable-diffusion-webui') || lower.includes('a1111')) return GeneratorTool.AUTOMATIC1111;
    if (lower.includes('sdnext') || lower.includes('sd.next')) return GeneratorTool.SDNEXT;
    if (lower.includes('forge')) return GeneratorTool.FORGE;
    if (lower.includes('anapnoe')) return GeneratorTool.ANAPNOE;
    return GeneratorTool.UNKNOWN;
};

export const isCompleteImport = (result: ImportResult | void): boolean =>
    !!result && !result.wasCancelled && result.failedPaths.length === 0;

/** A new active library folder, waiting for its first scan. `path` is already normalized. */
export const createMonitoredFolder = (path: string, queuedAt: number = Date.now()): MonitoredFolder => ({
    id: `folder_${queuedAt}`,
    path,
    isActive: true,
    imageCount: 0,
    variant: detectGeneratorVariant(path),
    initialScanPending: true,
});

export interface AddedFolder {
    id: string;
    path: string;
    variant?: string;
}

interface ScanAddedFoldersOptions {
    onScanFolder: (folders: { path: string; variant?: string }[]) => Promise<ImportResult | void>;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    addToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
    /** Runs after the folders are marked scanned; a failure here counts as a failed scan. */
    afterScan?: () => Promise<void>;
}

/** Resolves once no user owner switch is pending (finished, cancelled or failed). */
const waitForOwnerSwitchToEnd = (): Promise<void> =>
    new Promise((resolve) => {
        if (!isOwnerSwitchPending(useInvokeOwnerScopeStore.getState())) {
            resolve();
            return;
        }
        const unsubscribe = useInvokeOwnerScopeStore.subscribe((state) => {
            if (isOwnerSwitchPending(state)) return;
            unsubscribe();
            resolve();
        });
    });

/** Runs the first scan of newly added folders and records how it ended on each folder. */
export const scanAddedFolders = async (
    foldersToScan: AddedFolder[],
    { onScanFolder, setSettings, addToast, afterScan }: ScanAddedFoldersOptions
): Promise<void> => {
    // A switch that started after the folder was saved (#527): a user scan would be refused, so the first
    // scan waits for the switch to end. The folder stays queued (initialScanPending) meanwhile, and the
    // live auto-scan skips queued folders, so nothing else would scan it this session.
    const retained = useInvokeOwnerScopeStore.getState().retainedOwnerScope;
    if (retained) {
        addToast(
            `${foldersToScan.length === 1 ? 'The new folder is' : 'New folders are'} scanned after the switch to ${retained.targetLabel}.`,
            'info'
        );
        await waitForOwnerSwitchToEnd();
    }
    try {
        const result = await onScanFolder(foldersToScan.map(({ path, variant }) => ({ path, variant })));
        if (isCompleteImport(result)) {
            const completedAt = Date.now();
            setSettings((prev) => ({
                ...prev,
                monitoredFolders: prev.monitoredFolders.map((folder) =>
                    foldersToScan.some((pending) => pending.id === folder.id)
                        ? {
                              ...folder,
                              lastScanned: isImportSourceCompleted(result, folder.path) ? completedAt : undefined,
                              initialScanPending: false,
                              initialScanCancelled: isImportSourceCancelled(result, folder.path),
                          }
                        : folder
                ),
            }));
        } else if (result && result.wasCancelled) {
            const completedAt = Date.now();
            setSettings((prev) => ({
                ...prev,
                monitoredFolders: prev.monitoredFolders.map((folder) =>
                    foldersToScan.some((pending) => pending.id === folder.id)
                        ? {
                              ...folder,
                              lastScanned: isImportSourceCompleted(result, folder.path) ? completedAt : undefined,
                              initialScanPending: false,
                              initialScanCancelled: isImportSourceCancelled(result, folder.path),
                          }
                        : folder
                ),
            }));
        } else {
            const completedAt = Date.now();
            setSettings((prev) => ({
                ...prev,
                monitoredFolders: prev.monitoredFolders.map((folder) =>
                    foldersToScan.some((pending) => pending.id === folder.id)
                        ? {
                              ...folder,
                              lastScanned: isImportSourceCompleted(result, folder.path) ? completedAt : undefined,
                              initialScanPending: false,
                              initialScanCancelled: false,
                          }
                        : folder
                ),
            }));
            addToast('Folder scan completed with import errors', 'warning');
        }
        await afterScan?.();
    } catch (e) {
        console.error('Auto-scan failed:', e);
        setSettings((prev) => ({
            ...prev,
            monitoredFolders: prev.monitoredFolders.map((folder) =>
                foldersToScan.some((pending) => pending.id === folder.id)
                    ? { ...folder, lastScanned: undefined, initialScanPending: false, initialScanCancelled: false }
                    : folder
            ),
        }));
        addToast('Folder scan failed', 'error');
    }
};
