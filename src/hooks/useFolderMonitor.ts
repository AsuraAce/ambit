import { useEffect, useRef } from 'react';
import { MonitoredFolder, GeneratorTool } from '../types';
import { useSettingsStore } from '../stores/settingsStore';
import { commands } from '../bindings';
import { unwrap } from '../utils/spectaUtils';

interface UseFolderMonitorProps {
    isLoaded: boolean;
    monitoredFolders: MonitoredFolder[];
    onScan: (folders: { path: string, variant?: string }[], isStartup: boolean) => void;
    handleImportPaths: (paths: string[], defaultTool?: GeneratorTool, isStartup?: boolean) => Promise<void>;
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
                // Determine which folders need Full Scan vs Smart Scan
                for (const folder of activeFolders) {
                    if (folder.lastScanned) {
                        try {
                            console.log(`[FolderMonitor] Smart Scan for ${folder.path} since ${folder.lastScanned}`);
                            // Cast because bindings aren't regenerated yet
                            const newFiles = await unwrap((commands as any).scanDirectorySince(folder.path, folder.lastScanned)) as { path: string }[];

                            if (newFiles && newFiles.length > 0) {
                                console.log(`[FolderMonitor] Found ${newFiles.length} new files in ${folder.path}`);
                                const paths = newFiles.map((f: any) => f.path);
                                await handleImportPaths(paths, folder.variant, true);
                            } else {
                                console.log(`[FolderMonitor] No new files in ${folder.path}`);
                            }

                            // Update timestamp
                            updateFolderLastScanned(folder.id, Date.now());
                        } catch (e) {
                            console.error(`[FolderMonitor] Smart scan failed for ${folder.path}, falling back to full scan`, e);
                            // Fallback? Or just log error?
                            // If smart scan fails, maybe we shouldn't update timestamp.
                        }
                    } else {
                        console.log(`[FolderMonitor] Full Scan for ${folder.path} (first time)`);
                        // Use existing full scan logic via onScan -> handleImportFolders
                        onScan([{ path: folder.path, variant: folder.variant }], true);
                        updateFolderLastScanned(folder.id, Date.now());
                    }
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
