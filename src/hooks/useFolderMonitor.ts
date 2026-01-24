import { useEffect, useRef } from 'react';
import { MonitoredFolder } from '../types';

interface UseFolderMonitorProps {
    isLoaded: boolean;
    monitoredFolders: MonitoredFolder[];
    onScan: (folders: { path: string, variant?: string }[], isStartup: boolean) => void;
    addToast: (msg: string, type: 'info' | 'success' | 'error') => void;
}

export function useFolderMonitor({ isLoaded, monitoredFolders, onScan, addToast }: UseFolderMonitorProps) {
    const prevFoldersRef = useRef(monitoredFolders);

    useEffect(() => {
        if (!isLoaded) {
            prevFoldersRef.current = monitoredFolders;
            return;
        }

        const currentFolders = monitoredFolders;
        const prevFolders = prevFoldersRef.current;

        // Check if this is likely a startup initialization scan (prevFolders was empty/default)
        // OR if we explicitly want to scan on startup (which we do now)
        // We track "hasStartedRef" to ensure we only do this ONCE per session load
        const isStartup = prevFolders.length === 0 && currentFolders.length > 0;

        // Find folders that exist in current but NOT in previous (New Folders)
        const newFolders = currentFolders.filter(f => !prevFolders.find(pf => pf.id === f.id));

        // 1. Handle Startup Sync (Scan EVERYTHING)
        // We rely on the fact that initially prevFolders is empty, so "newFolders" will be ALL folders.
        // But we want to be explicit about intent.

        if (isStartup) {
            const activeFolders = currentFolders.filter(f => f.isActive);
            if (activeFolders.length > 0) {
                console.log('[FolderMonitor] Startup: Scanning all actively monitored folders...');
                // Don't toast for startup scan to avoid spam, or make it subtle
                // addToast(`Startup: Verifying library contents...`, 'info'); 

                const scanData = activeFolders.map(f => ({ path: f.path, variant: f.variant }));
                onScan(scanData, true);
            }
        }
        // 2. Handle Runtime Additions (User adds a folder in Settings)
        else if (newFolders.length > 0) {
            const activeNew = newFolders.filter(f => f.isActive);

            if (activeNew.length > 0) {
                if (activeNew.length === 1) {
                    addToast(`Scanning new folder: ${activeNew[0].path}`, 'info');
                } else {
                    addToast(`Scanning ${activeNew.length} new folders`, 'info');
                }

                const scanData = activeNew.map(f => ({ path: f.path, variant: f.variant }));
                onScan(scanData, false);
            }
        }

        // 3. Handle modified folders (e.g. toggling active state) - Optional/Future

        prevFoldersRef.current = currentFolders;
    }, [monitoredFolders, isLoaded, onScan, addToast]);
}
