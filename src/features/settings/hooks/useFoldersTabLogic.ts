import * as React from 'react';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { AppSettings, MonitoredFolder, GeneratorTool } from '../../../types';
import { useToast } from '../../../hooks/useToast';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useLibraryStore } from '../../../stores/libraryStore';
import { commands } from '../../../bindings';
import { normalizePath } from '../../../utils/pathUtils';
import { unwrap } from '../../../utils/spectaUtils';
import { isImportSourceCancelled, isImportSourceCompleted } from '../../../utils/importSourceStatus';
import { formatStableImportProgress } from '../../../utils/importProgress';
import { processNativePaths, type ImportResult } from '../../../services/importService';
import { isBrowserMockMode } from '../../../services/runtime';
import { getThumbnailDir } from '../../../services/thumbnailService';

const MANUAL_IMPORT_CANCELLED_MESSAGE = 'Import cancelled. Imported images were kept; rescan to continue.';

// Helper to detect generator from path
const detectGeneratorVariant = (path: string): GeneratorTool => {
    const lower = path.toLowerCase();
    if (lower.includes('invokeai')) return GeneratorTool.INVOKEAI;
    if (lower.includes('comfyui') || lower.includes('comfy')) return GeneratorTool.COMFYUI;
    if (lower.includes('webui') || lower.includes('stable-diffusion-webui') || lower.includes('a1111')) return GeneratorTool.AUTOMATIC1111;
    if (lower.includes('sdnext') || lower.includes('sd.next')) return GeneratorTool.SDNEXT;
    if (lower.includes('forge')) return GeneratorTool.FORGE;
    if (lower.includes('anapnoe')) return GeneratorTool.ANAPNOE;
    return GeneratorTool.UNKNOWN;
};

// Helper to get InvokeAI root path (strip /databases suffix if present)
const getInvokeRootPath = (path: string): string => {
    return path.replace(/[\\/](databases)?[\\/]?$/i, '');
};

interface UseFoldersTabLogicProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<ImportResult | void>;
    onInvokeSync?: () => Promise<void>;
}

export const useFoldersTabLogic = ({
    settings,
    setSettings,
    onScanFolder,
    onInvokeSync
}: UseFoldersTabLogicProps) => {
    const { addToast } = useToast();
    const [newFolderPath, setNewFolderPath] = useState('');
    const [scanningIds, setScanningIds] = useState<Set<string>>(new Set());

    const fileInputRef = useRef<HTMLInputElement>(null);
    const pendingScansRef = useRef<{ id: string, path: string, variant?: string }[]>([]);
    const scanDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const updateFolderLastScanned = useSettingsStore(s => s.updateFolderLastScanned);

    const isCompleteImport = (result: ImportResult | void): boolean =>
        !!result && !result.wasCancelled && result.failedPaths.length === 0;

    const fetchCounts = useCallback(async () => {
        if (!settings.monitoredFolders.length && !settings.invokeAiPath) return;

        const browserMockMode = isBrowserMockMode();
        let hasUpdates = false;
        const updatesById = new Map<string, Partial<Pick<MonitoredFolder, 'imageCount' | 'variant'>>>();
        await Promise.all(settings.monitoredFolders.map(async (folder) => {
            try {
                let variant = folder.variant;
                if (!variant || variant === GeneratorTool.UNKNOWN) {
                    variant = detectGeneratorVariant(folder.path);
                    if (variant !== folder.variant) {
                        hasUpdates = true;
                        updatesById.set(folder.id, { ...(updatesById.get(folder.id) ?? {}), variant });
                    }
                }

                if (browserMockMode) return;

                const res = await commands.getImageCountForPathPrefix(folder.path);
                if (res.status === 'ok' && res.data !== folder.imageCount) {
                    hasUpdates = true;
                    updatesById.set(folder.id, { ...(updatesById.get(folder.id) ?? {}), imageCount: res.data });
                }
            } catch (e) {
                console.error('Failed to get count for', folder.path, e);
            }
        }));

        if (hasUpdates) {
            setSettings(prev => {
                let didApplyUpdates = false;
                const monitoredFolders = prev.monitoredFolders.map(folder => {
                    const update = updatesById.get(folder.id);
                    if (!update) return folder;

                    const nextFolder = {
                        ...folder,
                        ...update
                    };
                    didApplyUpdates = didApplyUpdates
                        || nextFolder.imageCount !== folder.imageCount
                        || nextFolder.variant !== folder.variant;
                    return nextFolder;
                });

                return didApplyUpdates ? { ...prev, monitoredFolders } : prev;
            });
        }
    }, [settings.monitoredFolders, settings.invokeAiPath, setSettings]);

    useEffect(() => {
        fetchCounts();
    }, [settings.monitoredFolders.length]);

    const combinedFolders = useMemo(() => {
        const list = [...settings.monitoredFolders];
        if (settings.invokeAiPath) {
            const invokeRoot = getInvokeRootPath(settings.invokeAiPath);
            const outputsPath = `${invokeRoot}/outputs/images`;
            const exists = list.some(f => f.path.startsWith(invokeRoot) || invokeRoot.startsWith(f.path));
            if (!exists) {
                list.unshift({
                    id: 'managed_invoke',
                    path: outputsPath,
                    pathRaw: outputsPath,
                    isActive: true,
                    imageCount: 0,
                    variant: GeneratorTool.INVOKEAI,
                    isManaged: true
                });
            }
        }
        return list;
    }, [settings.monitoredFolders, settings.invokeAiPath]);

    const handleRescan = useCallback(async (id: string, path: string, variant?: string, isManaged?: boolean) => {
        setScanningIds(prev => new Set(prev).add(id));
        try {
            if (isManaged && variant === GeneratorTool.INVOKEAI && onInvokeSync) {
                await onInvokeSync();
                addToast('InvokeAI database sync complete', 'success');
            } else if (onScanFolder) {
                const folder = settings.monitoredFolders.find(f => f.id === id);
                const lastScanned = folder?.lastScanned;

                if (lastScanned && lastScanned > 0) {
                    console.log(`[Resync] Incremental scan for ${path} since ${new Date(lastScanned).toISOString()}`);
                    const newFiles = await unwrap(commands.scanDirectorySince(path, lastScanned));

                    if (newFiles.length > 0) {
                        const changedPaths = newFiles.map(f => f.path);
                        const { beginImportRun, setImportProgressForRun, finishImportRun } = useLibraryStore.getState();
                        const abortCtrl = new AbortController();
                        const importRunId = beginImportRun({
                            owner: 'folder-incremental-rescan',
                            abortController: abortCtrl,
                            progress: formatStableImportProgress({
                                current: 0,
                                total: changedPaths.length,
                                sourceCount: 1,
                                phase: 'importing',
                                sourcePath: path
                            })
                        });
                        if (!importRunId) {
                            addToast('Import already in progress', 'info');
                            return;
                        }

                        try {
                            const thumbDir = await getThumbnailDir();
                            const result = await processNativePaths(
                                changedPaths,
                                thumbDir,
                                (current, total, _message) => {
                                    setImportProgressForRun(importRunId, formatStableImportProgress({
                                        current,
                                        total,
                                        sourceCount: 1,
                                        phase: 'importing',
                                        sourcePath: path
                                    }));
                                },
                                variant as GeneratorTool | undefined,
                                abortCtrl.signal,
                                false,
                                true,
                                true
                            );
                            if (result.wasCancelled) {
                                addToast(MANUAL_IMPORT_CANCELLED_MESSAGE, 'info');
                            } else {
                                addToast(`Synced ${result.images.length} new files`, 'success');
                            }
                            if (isCompleteImport(result)) {
                                updateFolderLastScanned(id, Date.now());
                            } else if (!result.wasCancelled) {
                                console.warn(`[Resync] Keeping cursor unchanged for ${path}; ${result.failedPaths.length} file(s) failed.`);
                            }
                        } finally {
                            finishImportRun(importRunId);
                        }
                    } else {
                        const allFiles = await unwrap(commands.scanDirectoryWithStats(path));
                        const knownCount = folder!.imageCount;

                        if (allFiles.length > knownCount) {
                            const repairPaths = allFiles.map(f => f.path);
                            const { beginImportRun, setImportProgressForRun, finishImportRun } = useLibraryStore.getState();
                            const abortCtrl = new AbortController();
                            let repairFailedCount = 0;
                            let repairWasCancelled = false;
                            const importRunId = beginImportRun({
                                owner: 'folder-repair-rescan',
                                abortController: abortCtrl,
                                progress: formatStableImportProgress({
                                    current: 0,
                                    total: repairPaths.length,
                                    sourceCount: 1,
                                    phase: 'importing',
                                    sourcePath: path
                                })
                            });
                            if (!importRunId) {
                                addToast('Import already in progress', 'info');
                                return;
                            }

                            try {
                                const thumbDir = await getThumbnailDir();
                                const result = await processNativePaths(
                                    repairPaths,
                                    thumbDir,
                                    (current, total, _message) => {
                                        setImportProgressForRun(importRunId, formatStableImportProgress({
                                            current,
                                            total,
                                            sourceCount: 1,
                                            phase: 'importing',
                                            sourcePath: path
                                        }));
                                    },
                                    variant as GeneratorTool | undefined,
                                    abortCtrl.signal,
                                    false
                                );
                                repairFailedCount = result.failedPaths.length;
                                repairWasCancelled = result.wasCancelled;
                                if (result.wasCancelled) {
                                    addToast(MANUAL_IMPORT_CANCELLED_MESSAGE, 'info');
                                } else {
                                    addToast(
                                        result.images.length > 0
                                            ? `Repair scan imported ${result.images.length} missing files`
                                            : 'Repair scan found no additional importable files',
                                        result.images.length > 0 ? 'success' : 'info'
                                    );
                                }
                            } finally {
                                finishImportRun(importRunId);
                            }
                            if (!repairWasCancelled && repairFailedCount === 0) {
                                updateFolderLastScanned(id, Date.now());
                            } else if (!repairWasCancelled) {
                                console.warn(`[Resync] Keeping cursor unchanged for ${path}; ${repairFailedCount} repair file(s) failed.`);
                            }
                        } else {
                            addToast(`No changes detected`, 'info');
                            updateFolderLastScanned(id, Date.now());
                        }
                    }
                } else {
                    const result = await onScanFolder([{ path, variant }]);
                    if (isImportSourceCompleted(result, path)) {
                        updateFolderLastScanned(id, Date.now());
                        addToast(`Rescan complete`, 'success');
                    } else if (result && result.wasCancelled) {
                        console.info(`[Resync] Keeping cursor unchanged for ${path}; import was cancelled.`);
                        setSettings(prev => ({
                            ...prev,
                            monitoredFolders: prev.monitoredFolders.map(folder =>
                                folder.id === id
                                    ? { ...folder, lastScanned: undefined, initialScanPending: false, initialScanCancelled: true }
                                    : folder
                            )
                        }));
                    } else if (!result) {
                        console.warn(`[Resync] Keeping cursor unchanged for ${path}; full scan did not start.`);
                        addToast(`Rescan completed with import errors`, 'warning');
                    } else {
                        console.warn(`[Resync] Keeping cursor unchanged for ${path}; full scan did not fully complete.`);
                        setSettings(prev => ({
                            ...prev,
                            monitoredFolders: prev.monitoredFolders.map(folder =>
                                folder.id === id
                                    ? { ...folder, lastScanned: undefined, initialScanPending: false, initialScanCancelled: false }
                                    : folder
                            )
                        }));
                        addToast(`Rescan completed with import errors`, 'warning');
                    }
                }
            }
            await fetchCounts();
        } catch (e) {
            console.error(e);
            addToast(isManaged ? 'InvokeAI sync failed' : `Rescan failed`, 'error');
        } finally {
            setScanningIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    }, [settings.monitoredFolders, onScanFolder, onInvokeSync, addToast, updateFolderLastScanned, fetchCounts]);

    const handleAddFolder = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newFolderPath.trim()) return;

        const normalizedNew = normalizePath(newFolderPath);
        const existing = settings.monitoredFolders.find(f => normalizePath(f.path) === normalizedNew);
        if (existing) {
            addToast(`Folder is already monitored`, 'info');
            setNewFolderPath('');
            return;
        }

        const variant = detectGeneratorVariant(normalizedNew);
        const queuedAt = Date.now();
        const newFolder: MonitoredFolder = {
            id: `folder_${queuedAt}`,
            path: normalizedNew,
            isActive: true,
            imageCount: 0,
            variant: variant,
            initialScanPending: true
        };

        setSettings(prev => ({
            ...prev,
            monitoredFolders: [...prev.monitoredFolders, newFolder]
        }));
        setNewFolderPath('');
        addToast(`Added folder: ${normalizedNew}`, 'success');

        // Trigger scan
        pendingScansRef.current.push({ id: newFolder.id, path: normalizedNew, variant });
        if (scanDebounceRef.current) clearTimeout(scanDebounceRef.current);
        scanDebounceRef.current = setTimeout(async () => {
            if (pendingScansRef.current.length === 0 || !onScanFolder) return;
            const foldersToScan = [...pendingScansRef.current];
            pendingScansRef.current = [];
            try {
                const result = await onScanFolder(foldersToScan.map(({ path, variant }) => ({ path, variant })));
                if (isCompleteImport(result)) {
                    const completedAt = Date.now();
                    setSettings(prev => ({
                        ...prev,
                        monitoredFolders: prev.monitoredFolders.map(folder =>
                            foldersToScan.some(pending => pending.id === folder.id)
                                ? {
                                    ...folder,
                                    lastScanned: isImportSourceCompleted(result, folder.path) ? completedAt : undefined,
                                    initialScanPending: false,
                                    initialScanCancelled: isImportSourceCancelled(result, folder.path)
                                }
                            : folder
                        )
                    }));
                } else if (result && result.wasCancelled) {
                    const completedAt = Date.now();
                    setSettings(prev => ({
                        ...prev,
                        monitoredFolders: prev.monitoredFolders.map(folder =>
                            foldersToScan.some(pending => pending.id === folder.id)
                                ? {
                                    ...folder,
                                    lastScanned: isImportSourceCompleted(result, folder.path) ? completedAt : undefined,
                                    initialScanPending: false,
                                    initialScanCancelled: isImportSourceCancelled(result, folder.path)
                                }
                                : folder
                        )
                    }));
                } else {
                    const completedAt = Date.now();
                    setSettings(prev => ({
                        ...prev,
                        monitoredFolders: prev.monitoredFolders.map(folder =>
                            foldersToScan.some(pending => pending.id === folder.id)
                                ? {
                                    ...folder,
                                    lastScanned: isImportSourceCompleted(result, folder.path) ? completedAt : undefined,
                                    initialScanPending: false,
                                    initialScanCancelled: false
                                }
                                : folder
                        )
                    }));
                    addToast('Folder scan completed with import errors', 'warning');
                }
                await fetchCounts();
            } catch (e) {
                console.error('Auto-scan failed:', e);
                setSettings(prev => ({
                    ...prev,
                    monitoredFolders: prev.monitoredFolders.map(folder =>
                        foldersToScan.some(pending => pending.id === folder.id)
                            ? { ...folder, lastScanned: undefined, initialScanPending: false, initialScanCancelled: false }
                            : folder
                    )
                }));
                addToast('Folder scan failed', 'error');
            }
        }, 500);
    };

    const removeFolder = (id: string) => {
        setSettings(prev => ({
            ...prev,
            monitoredFolders: prev.monitoredFolders.filter(f => f.id !== id)
        }));
    };

    const handleBrowse = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({ directory: true, multiple: false });
            if (selected && typeof selected === 'string') {
                setNewFolderPath(normalizePath(selected));
            }
        } catch (e) {
            fileInputRef.current?.click();
        }
    };

    return {
        newFolderPath, setNewFolderPath,
        scanningIds,
        combinedFolders,
        fileInputRef,
        handleRescan,
        handleAddFolder,
        removeFolder,
        handleBrowse,
    };
};
