import { useEffect, useRef } from 'react';
import { MonitoredFolder, GeneratorTool, FacetType, ImportMode } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';
import { refreshStartupFacetCache } from '../utils/startupFacetRefresh';
import {
    createEmptyTouchedFacetResources,
    mergeTouchedFacetResources,
    orderFacetTypes
} from '../utils/touchedFacetTypes';

// Need to access store actions directly since we are bypassing handleImportPaths state management
import { useLibraryStore } from '../stores/libraryStore';
import { isBrowserMockMode } from '../services/runtime';
import type { ImportResult } from '../services/importService';

interface ImportOptions {
    mode?: ImportMode;
    skipStateManagement?: boolean;
    onProgress?: (current: number, total: number, message?: string) => void;
    forceRescan?: boolean;
    waitForStableFiles?: boolean;
    deferFacetCacheRefresh?: boolean;
    abortSignal?: AbortSignal;
}

interface FolderScanOptions {
    mode?: ImportMode;
}

interface UseFolderMonitorProps {
    isLoaded: boolean;
    monitoredFolders: MonitoredFolder[];
    onScan: (folders: { path: string, variant?: string }[], options?: FolderScanOptions) => Promise<ImportResult | void>;
    handleImportPaths: (paths: string[], defaultTool?: GeneratorTool, options?: ImportOptions) => Promise<ImportResult | void>;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    refreshMetadata: () => Promise<void>;
    invokeAiPath?: string;
    startInvokeSync?: (options?: { mode?: 'startup' }) => Promise<void>;
}

const isCompleteImport = (result: ImportResult | void): boolean =>
    !!result && !result.wasCancelled && result.failedPaths.length === 0;

const markInitialScanCancelled = (folderIds: string[]) => {
    const idSet = new Set(folderIds);
    useSettingsStore.getState().setSettings((prev) => ({
        monitoredFolders: prev.monitoredFolders.map(folder =>
            idSet.has(folder.id)
                ? { ...folder, lastScanned: undefined, initialScanPending: false, initialScanCancelled: true }
                : folder
        )
    }));
};

export function useFolderMonitor({ isLoaded, monitoredFolders, onScan, handleImportPaths, addToast, refreshMetadata, invokeAiPath, startInvokeSync }: UseFolderMonitorProps) {
    const prevFoldersRef = useRef(monitoredFolders);
    const hasScannedOnStartup = useRef(false);
    const updateFolderLastScanned = useSettingsStore(s => s.updateFolderLastScanned);
    const browserMockMode = isBrowserMockMode();

    const warnCursorHeld = (source: string, folderId: string, result: ImportResult | void) => {
        const failedCount = result ? result.failedPaths.length : null;
        console.warn(`[FolderMonitor] ${source}: Keeping folder cursor unchanged for ${folderId}; ${failedCount ?? 'unknown'} path(s) were not fully handled.`);
    };

    useEffect(() => {
        if (browserMockMode) {
            prevFoldersRef.current = monitoredFolders;
            return;
        }

        if (!isLoaded) {
            prevFoldersRef.current = monitoredFolders;
            return;
        }

        // STARTUP LOGIC: Smart Scan
        const hasStartups = monitoredFolders.length > 0 || !!invokeAiPath;
        if (hasStartups && !hasScannedOnStartup.current) {
            hasScannedOnStartup.current = true;
            const activeFolders = monitoredFolders.filter(f => f.isActive && !f.initialScanCancelled);

            console.log('[FolderMonitor] Startup Check:', {
                allFolders: monitoredFolders.length,
                active: activeFolders.length,
                hasInvokeIntegration: !!invokeAiPath
            });

            const performStartupScan = async () => {
                const startupStartedAt = Date.now();
                const folderScanStartedAt = Date.now();
                const { setIsImporting, setImportProgress, setImportAbortController } = useLibraryStore.getState();
                const tasks: { paths: string[], variant: GeneratorTool | undefined, folderId: string }[] = [];
                let totalFilesFound = 0;
                let startupScanWasCancelled = false;
                const scanTime = Date.now();

                // Phase 1: Aggregation - Collect all new files from all valid folders
                for (const folder of activeFolders) {
                    if (folder.lastScanned) {
                        try {
                            console.log(`[FolderMonitor] Smart Scan for ${folder.path}`);
                            const newFiles = await unwrap(commands.scanDirectorySince(folder.path, folder.lastScanned));

                            if (newFiles && newFiles.length > 0) {
                                console.log(`[FolderMonitor] Found ${newFiles.length} new files in ${folder.path}`);
                                const paths = newFiles.map(f => f.path);
                                tasks.push({ paths, variant: folder.variant, folderId: folder.id });
                                totalFilesFound += paths.length;
                            } else {
                                console.log(`[FolderMonitor] No new files in ${folder.path}`);
                                updateFolderLastScanned(folder.id, scanTime); // Safe to update if nothing found
                            }
                        } catch (e) {
                            console.error(`[FolderMonitor] Smart scan failed for ${folder.path}, falling back to full scan`, e);
                        }
                    } else {
                        // Full scan usage (rare on startup if already configured)
                        console.log(`[FolderMonitor] Full Scan for ${folder.path} (first time)`);
                        const result = await onScan([{ path: folder.path, variant: folder.variant }], { mode: 'startup' });
                        if (isCompleteImport(result)) {
                            updateFolderLastScanned(folder.id, scanTime);
                        } else if (!result || !result.wasCancelled) {
                            warnCursorHeld('Startup full scan', folder.id, result);
                        } else {
                            markInitialScanCancelled([folder.id]);
                            startupScanWasCancelled = true;
                            break;
                        }
                    }
                }
                console.info('[Startup Catch-up] Folder scan phase complete.', {
                    activeFolders: activeFolders.length,
                    filesFound: totalFilesFound,
                    durationMs: Date.now() - folderScanStartedAt
                });

                // Phase 2: Execution - Run single unified batch for smart updates
                if (!startupScanWasCancelled && totalFilesFound > 0) {
                    const importStartedAt = Date.now();
                    const abortCtrl = new AbortController();
                    console.log(`[FolderMonitor] Starting aggregated import for ${totalFilesFound} files`);
                    setIsImporting(true);
                    setImportAbortController(abortCtrl);
                    setImportProgress({ current: 0, total: totalFilesFound, message: 'Starting aggregated import...' });

                    let globalCurrent = 0;
                    let totalImported = 0;
                    let touchedFacetTypes: FacetType[] = [];
                    let touchedFacetResources = createEmptyTouchedFacetResources();
                    let wasCancelled = false;

                    try {
                        for (const task of tasks) {
                            if (abortCtrl.signal.aborted) {
                                wasCancelled = true;
                                break;
                            }
                            // We use skipStateManagement: true to prevent handleImportPaths from resetting our global progress
                            const result = await handleImportPaths(task.paths, task.variant, {
                                mode: 'startup',
                                skipStateManagement: true,
                                forceRescan: true,
                                waitForStableFiles: true,
                                deferFacetCacheRefresh: true,
                                abortSignal: abortCtrl.signal,
                                onProgress: (current, total, message) => {
                                    // Add accumulated count from previous batches
                                    const actualCurrent = globalCurrent + current;
                                    setImportProgress({
                                        current: actualCurrent,
                                        total: totalFilesFound,
                                        message: message
                                    });
                                }
                            });
                            if ((result && result.wasCancelled) || abortCtrl.signal.aborted) {
                                wasCancelled = true;
                            }
                            globalCurrent += task.paths.length;

                            if (result) {
                                totalImported += result.stats.imported;
                                touchedFacetTypes = orderFacetTypes([
                                    ...touchedFacetTypes,
                                    ...result.touchedFacetTypes
                                ]);
                                touchedFacetResources = mergeTouchedFacetResources(
                                    touchedFacetResources,
                                    result.touchedFacetResources
                                );
                            }

                            // ONLY update once successfully imported
                            if (isCompleteImport(result)) {
                                updateFolderLastScanned(task.folderId, scanTime);
                            } else if (!result || !result.wasCancelled) {
                                warnCursorHeld('Startup incremental scan', task.folderId, result);
                            }
                            if (wasCancelled) break;
                        }

                        if (!wasCancelled) {
                            setImportProgress({ current: totalFilesFound, total: totalFilesFound, message: 'Updating startup filters...' });
                            await refreshStartupFacetCache({
                                source: 'folder',
                                totalProcessed: totalImported,
                                touchedFacetTypes,
                                touchedFacetResources,
                                onRefreshApplied: () => useLibraryStore.getState().incrementFacetCacheVersion()
                            });
                        }
                    } catch (error) {
                        console.error('[Startup Catch-up] Folder incremental facet refresh failed.', error);
                    } finally {
                        setIsImporting(false);
                        setImportProgress(null);
                        setImportAbortController(null);
                    }

                    // Force UI Refresh
                    if (!wasCancelled) {
                        await refreshMetadata();
                        console.info('[Startup Catch-up] Folder import phase complete.', {
                            filesImported: totalFilesFound,
                            durationMs: Date.now() - importStartedAt
                        });
                    }
                }

                // Unconditionally catch up InvokeAI DB if configured
                // Fires synchronously at the end as part of startup catchup sequence
                if (invokeAiPath && startInvokeSync) {
                    const invokeStartedAt = Date.now();
                    console.log('[FolderMonitor] Triggering startup catch-up sync for InvokeAI DB...');
                    await startInvokeSync({ mode: 'startup' }).catch(e => console.error("Startup Invoke sync failed", e));
                    console.info('[Startup Catch-up] Invoke phase complete.', {
                        durationMs: Date.now() - invokeStartedAt
                    });
                }

                console.info('[Startup Catch-up] Complete.', {
                    durationMs: Date.now() - startupStartedAt
                });
            };

            void performStartupScan();

            prevFoldersRef.current = monitoredFolders;
            return;
        }

        const currentFolders = monitoredFolders;
        const prevFolders = prevFoldersRef.current;

        // Find folders that exist in current but NOT in previous (New Folders)
        const newFolders = currentFolders.filter(f => !prevFolders.find(pf => pf.id === f.id));

        if (newFolders.length > 0) {
            const activeNew = newFolders.filter(f => f.isActive && !f.lastScanned && !f.initialScanPending && !f.initialScanCancelled);

            if (activeNew.length > 0) {
                void (async () => {
                    if (activeNew.length === 1) {
                        addToast(`Scanning new folder: ${activeNew[0].path}`, 'info');
                    } else {
                        addToast(`Scanning ${activeNew.length} new folders`, 'info');
                    }

                    const scanData = activeNew.map(f => ({ path: f.path, variant: f.variant }));
                    const result = await onScan(scanData);

                    if (isCompleteImport(result)) {
                        const completedAt = Date.now();
                        activeNew.forEach(f => updateFolderLastScanned(f.id, completedAt));
                    } else if (!result || !result.wasCancelled) {
                        activeNew.forEach(f => warnCursorHeld('New folder scan', f.id, result));
                    } else {
                        markInitialScanCancelled(activeNew.map(f => f.id));
                    }
                })();
            }
        }

        prevFoldersRef.current = currentFolders;
    }, [monitoredFolders, isLoaded, onScan, addToast, updateFolderLastScanned, handleImportPaths, browserMockMode]);

    // Live Watch Catch-up
    const isLiveWatching = useLibraryStore(s => s.isLiveWatching);
    const hasLiveWatchStartedRef = useRef(isLiveWatching);

    // Unified Watcher Effect (Handles "Turn On")
    useEffect(() => {
        if (browserMockMode) return;

        const activeFolders = monitoredFolders.filter(f => f.isActive && !f.initialScanCancelled);
        if (activeFolders.length === 0) {
            hasLiveWatchStartedRef.current = isLiveWatching;
            return;
        }

        // CRITICAL: If an import is already running (e.g. manual re-scan), DO NOT start another scan.
        // This prevents lock contention on the database (Read lock vs Write lock).
        if (useLibraryStore.getState().isImporting) {
            console.log('[FolderMonitor] Skipping live scan check - Import already in progress');
            return;
        }

        // Condition 1: Turning ON (Catch-up)
        const isTurningOn = isLiveWatching && !hasLiveWatchStartedRef.current;

        if (isTurningOn) {
            console.log('[FolderMonitor] Live Watch enabled - triggering catch-up scan for linked folders');
            performUnifiedScan(activeFolders, 'Catch-up');
        } 

        hasLiveWatchStartedRef.current = isLiveWatching;
    }, [isLiveWatching, monitoredFolders, onScan, handleImportPaths, updateFolderLastScanned, addToast, refreshMetadata, browserMockMode]);

    // Reusable Scan Logic (Extracted from previous effect)
    const performUnifiedScan = async (folders: MonitoredFolder[], source: string) => {
        const { setIsImporting, setImportProgress, setImportAbortController } = useLibraryStore.getState();
        let totalFilesFound = 0;
        let scanWasCancelled = false;
        const tasks: { paths: string[], variant: GeneratorTool | undefined, folderId: string }[] = [];
        const scanTime = Date.now();

        for (const folder of folders) {
            try {
                if (folder.lastScanned) {
                    const newFiles = await unwrap(commands.scanDirectorySince(folder.path, folder.lastScanned));
                    if (newFiles.length > 0) {
                        tasks.push({ paths: newFiles.map(f => f.path), variant: folder.variant, folderId: folder.id });
                        totalFilesFound += newFiles.length;
                    } else {
                        updateFolderLastScanned(folder.id, scanTime);
                    }
                } else {
                    console.log(`[FolderMonitor] ${source}: Full scan needed for ${folder.path}`);
                    const result = await onScan([{ path: folder.path, variant: folder.variant }], { mode: 'background' });
                    if (isCompleteImport(result)) {
                        updateFolderLastScanned(folder.id, scanTime);
                    } else if (!result || !result.wasCancelled) {
                        warnCursorHeld(`${source} full scan`, folder.id, result);
                    } else {
                        markInitialScanCancelled([folder.id]);
                        scanWasCancelled = true;
                        break;
                    }
                }
            } catch (e) {
                console.error(`[FolderMonitor] ${source} failed for ${folder.path}`, e);
            }
        }

        if (scanWasCancelled) return;

        if (totalFilesFound > 0) {
            const abortCtrl = new AbortController();
            setIsImporting(true);
            setImportAbortController(abortCtrl);
            setImportProgress({ current: 0, total: totalFilesFound, message: `${source}: Importing images...` });
            let currentCount = 0;
            let wasCancelled = false;
            try {
                for (const task of tasks) {
                    if (abortCtrl.signal.aborted) {
                        wasCancelled = true;
                        break;
                    }
                    const result = await handleImportPaths(task.paths, task.variant, {
                        mode: 'background',
                        skipStateManagement: true,
                        forceRescan: true,
                        waitForStableFiles: true,
                        abortSignal: abortCtrl.signal,
                        onProgress: (c, t, m) => setImportProgress({
                            current: currentCount + c,
                            total: totalFilesFound,
                            message: m ? `${source}: ${m}` : `${source}: Importing images...`
                        })
                    });
                    if ((result && result.wasCancelled) || abortCtrl.signal.aborted) {
                        wasCancelled = true;
                    }
                    currentCount += task.paths.length;
                    if (isCompleteImport(result)) {
                        updateFolderLastScanned(task.folderId, scanTime);
                    } else if (!result || !result.wasCancelled) {
                        warnCursorHeld(`${source} incremental scan`, task.folderId, result);
                    }
                    if (wasCancelled) break;
                }
            } finally {
                setIsImporting(false);
                setImportProgress(null);
                setImportAbortController(null);
            }

            // Force UI Refresh
            if (wasCancelled) return;

            await refreshMetadata();

            addToast(`${source}: Synced ${totalFilesFound} new images`, 'success');
        } else {
            console.log(`[FolderMonitor] ${source}: No new files found.`);
        }
    };
}
