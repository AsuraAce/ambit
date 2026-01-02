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

        // Find folders that exist in current but NOT in previous (New Folders)
        const newFolders = currentFolders.filter(f => !prevFoldersRef.current.find(pf => pf.id === f.id));

        if (newFolders.length > 0) {
            const activeNew = newFolders.filter(f => f.isActive);

            if (activeNew.length > 0) {
                // Check if this is likely a startup initialization scan (prevFolders was empty/default)
                const isStartup = prevFoldersRef.current.length === 0 && currentFolders.length > 0;

                if (!isStartup) {
                    if (activeNew.length === 1) {
                        addToast(`Scanning new folder: ${activeNew[0].path}`, 'info');
                    } else {
                        addToast(`Scanning ${activeNew.length} new folders`, 'info');
                    }
                }

                const scanData = activeNew.map(f => ({ path: f.path, variant: f.variant }));

                // Call onScan with ALL paths and variants at once
                onScan(scanData, isStartup);
            }
        }
        prevFoldersRef.current = currentFolders;
    }, [monitoredFolders, isLoaded, onScan, addToast]);
}
