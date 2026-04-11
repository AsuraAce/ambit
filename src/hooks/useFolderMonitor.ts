import { useEffect, useRef } from 'react';
import { MonitoredFolder, GeneratorTool } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';

// Need to access store actions directly since we are bypassing handleImportPaths state management
import { useLibraryStore } from '../stores/libraryStore';
import { useWatchers } from '../contexts/WatcherContext';

interface ImportOptions {
    isStartup?: boolean;
    skipStateManagement?: boolean;
    onProgress?: (current: number, total: number, message?: string) => void;
}

interface UseFolderMonitorProps {
    isLoaded: boolean;
    monitoredFolders: MonitoredFolder[];
    onScan: (folders: { path: string, variant?: string }[], isStartup: boolean) => void;
    // Update signature to match new options
    handleImportPaths: (paths: string[], defaultTool?: GeneratorTool, options?: ImportOptions) => Promise<void>;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
    refreshMetadata: () => Promise<void>;
    invokeAiPath?: string;
    startInvokeSync?: (options?: any) => Promise<void>;
}

export function useFolderMonitor({ isLoaded, monitoredFolders, onScan, handleImportPaths, addToast, refreshMetadata, invokeAiPath, startInvokeSync }: UseFolderMonitorProps) {
    const prevFoldersRef = useRef(monitoredFolders);
    const hasScannedOnStartup = useRef(false);
    const updateFolderLastScanned = useSettingsStore(s => s.updateFolderLastScanned);

    useEffect(() => {
        if (!isLoaded) {
            prevFoldersRef.current = monitoredFolders;
            return;
        }

        // STARTUP LOGIC: Smart Scan
        const hasStartups = monitoredFolders.length > 0 || !!invokeAiPath;
        if (hasStartups && !hasScannedOnStartup.current) {
            hasScannedOnStartup.current = true;
            const activeFolders = monitoredFolders.filter(f => f.isActive);

            console.log('[FolderMonitor] Startup Check:', {
                allFolders: monitoredFolders.length,
                active: activeFolders.length,
                hasInvokeIntegration: !!invokeAiPath
            });

            const performStartupScan = async () => {
                const { setIsImporting, setImportProgress } = useLibraryStore.getState();
                const tasks: { paths: string[], variant: GeneratorTool | undefined, folderId: string }[] = [];
                let totalFilesFound = 0;
                const scanTime = Date.now();

                // Phase 1: Aggregation - Collect all new files from all valid folders
                for (const folder of activeFolders) {
                    if (folder.lastScanned) {
                        try {
                            console.log(`[FolderMonitor] Smart Scan for ${folder.path}`);
                            // Cast because bindings aren't regenerated yet
                            const newFiles = await unwrap((commands as any).scanDirectorySince(folder.path, folder.lastScanned)) as { path: string }[];

                            if (newFiles && newFiles.length > 0) {
                                console.log(`[FolderMonitor] Found ${newFiles.length} new files in ${folder.path}`);
                                const paths = newFiles.map((f: any) => f.path);
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
                        onScan([{ path: folder.path, variant: folder.variant }], true);
                        updateFolderLastScanned(folder.id, scanTime);
                    }
                }

                // Phase 2: Execution - Run single unified batch for smart updates
                if (totalFilesFound > 0) {
                    console.log(`[FolderMonitor] Starting aggregated import for ${totalFilesFound} files`);
                    setIsImporting(true);
                    setImportProgress({ current: 0, total: totalFilesFound, message: 'Starting aggregated import...' });

                    let globalCurrent = 0;

                    for (const task of tasks) {
                        // We use skipStateManagement: true to prevent handleImportPaths from resetting our global progress
                        await handleImportPaths(task.paths, task.variant, {
                            isStartup: true,
                            skipStateManagement: true,
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
                        globalCurrent += task.paths.length;
                        // ONLY update once successfully imported
                        updateFolderLastScanned(task.folderId, scanTime);
                    }

                    setIsImporting(false);
                    setImportProgress(null);

                    // Force UI Refresh
                    await refreshMetadata();
                }

                // Unconditionally catch up InvokeAI DB if configured
                // Fires synchronously at the end as part of startup catchup sequence
                if (invokeAiPath && startInvokeSync) {
                    console.log('[FolderMonitor] Triggering startup catch-up sync for InvokeAI DB...');
                    await startInvokeSync({ mode: 'startup' }).catch(e => console.error("Startup Invoke sync failed", e));
                }
            };

            performStartupScan();

            prevFoldersRef.current = monitoredFolders;
            return;
        }

        const currentFolders = monitoredFolders;
        const prevFolders = prevFoldersRef.current;

        // Find folders that exist in current but NOT in previous (New Folders)
        const newFolders = currentFolders.filter(f => !prevFolders.find(pf => pf.id === f.id));

        if (newFolders.length > 0) {
            const activeNew = newFolders.filter(f => f.isActive);

            if (activeNew.length > 0) {
                if (activeNew.length === 1) {
                    addToast(`Scanning new folder: ${activeNew[0].path}`, 'info');
                } else {
                    addToast(`Scanning ${activeNew.length} new folders`, 'info');
                }

                const scanData = activeNew.map(f => ({ path: f.path, variant: f.variant }));
                onScan(scanData, false);

                // Mark them as scanned now so next startup is smart
                activeNew.forEach(f => updateFolderLastScanned(f.id, Date.now()));
            }
        }

        prevFoldersRef.current = currentFolders;
    }, [monitoredFolders, isLoaded, onScan, addToast, updateFolderLastScanned, handleImportPaths]);

    // Live Watch Catch-up
    const isLiveWatching = useLibraryStore(s => s.isLiveWatching);
    const hasLiveWatchStartedRef = useRef(isLiveWatching);

    // Unified Watcher Effect (Handles "Turn On")
    useEffect(() => {
        const activeFolders = monitoredFolders.filter(f => f.isActive);
        if (activeFolders.length === 0) return;

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
    }, [isLiveWatching, monitoredFolders, onScan, handleImportPaths, updateFolderLastScanned, addToast, refreshMetadata]);

    // Reusable Scan Logic (Extracted from previous effect)
    const performUnifiedScan = async (folders: MonitoredFolder[], source: string) => {
        const { setIsImporting, setImportProgress } = useLibraryStore.getState();
        let totalFilesFound = 0;
        const tasks: any[] = [];
        const scanTime = Date.now();

        for (const folder of folders) {
            try {
                if (folder.lastScanned) {
                    const newFiles = await unwrap((commands as any).scanDirectorySince(folder.path, folder.lastScanned)) as { path: string }[];
                    if (newFiles.length > 0) {
                        tasks.push({ paths: newFiles.map((f: any) => f.path), variant: folder.variant, folderId: folder.id });
                        totalFilesFound += newFiles.length;
                    } else {
                        updateFolderLastScanned(folder.id, scanTime);
                    }
                } else {
                    console.log(`[FolderMonitor] ${source}: Full scan needed for ${folder.path}`);
                    onScan([{ path: folder.path, variant: folder.variant }], false);
                    updateFolderLastScanned(folder.id, scanTime);
                }
            } catch (e) {
                console.error(`[FolderMonitor] ${source} failed for ${folder.path}`, e);
            }
        }

        if (totalFilesFound > 0) {
            setIsImporting(true);
            setImportProgress({ current: 0, total: totalFilesFound, message: `${source}: Importing images...` });
            let currentCount = 0;
            for (const task of tasks) {
                await handleImportPaths(task.paths, task.variant, {
                    skipStateManagement: true,
                    onProgress: (c, t, m) => setImportProgress({ 
                        current: currentCount + c, 
                        total: totalFilesFound, 
                        message: m ? `${source}: ${m}` : `${source}: Importing images...`
                    })
                });
                currentCount += task.paths.length;
                updateFolderLastScanned(task.folderId, scanTime);
            }
            setIsImporting(false);
            setImportProgress(null);

            // Force UI Refresh
            await refreshMetadata();

            addToast(`${source}: Synced ${totalFilesFound} new images`, 'success');
        } else {
            console.log(`[FolderMonitor] ${source}: No new files found.`);
        }
    };
}
