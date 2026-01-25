import { useEffect, useRef } from 'react';
import { MonitoredFolder, GeneratorTool } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';

// Need to access store actions directly since we are bypassing handleImportPaths state management
import { useLibraryStore } from '../stores/libraryStore';

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
}

export function useFolderMonitor({ isLoaded, monitoredFolders, onScan, handleImportPaths, addToast }: UseFolderMonitorProps) {
    const prevFoldersRef = useRef(monitoredFolders);
    const hasScannedOnStartup = useRef(false);
    const updateFolderLastScanned = useSettingsStore(s => s.updateFolderLastScanned);

    useEffect(() => {
        if (!isLoaded) {
            prevFoldersRef.current = monitoredFolders;
            return;
        }

        // STARTUP LOGIC: Smart Scan
        if (monitoredFolders.length > 0 && !hasScannedOnStartup.current) {
            hasScannedOnStartup.current = true;
            const activeFolders = monitoredFolders.filter(f => f.isActive);

            console.log('[FolderMonitor] Startup Check:', {
                allFolders: monitoredFolders.length,
                active: activeFolders.length
            });

            const performStartupScan = async () => {
                const { setIsImporting, setImportProgress } = useLibraryStore.getState();
                const tasks: { paths: string[], variant: GeneratorTool | undefined }[] = [];
                let totalFilesFound = 0;

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
                                tasks.push({ paths, variant: folder.variant });
                                totalFilesFound += paths.length;
                            } else {
                                console.log(`[FolderMonitor] No new files in ${folder.path}`);
                            }

                            // Update timestamp immediately
                            updateFolderLastScanned(folder.id, Date.now());
                        } catch (e) {
                            console.error(`[FolderMonitor] Smart scan failed for ${folder.path}, falling back to full scan`, e);
                        }
                    } else {
                        // Full scan usage (rare on startup if already configured)
                        // For simplicity, we just trigger these independently as they are heavy anyway
                        console.log(`[FolderMonitor] Full Scan for ${folder.path} (first time)`);
                        onScan([{ path: folder.path, variant: folder.variant }], true);
                        updateFolderLastScanned(folder.id, Date.now());
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
                    }

                    setIsImporting(false);
                    setImportProgress(null);
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
}
