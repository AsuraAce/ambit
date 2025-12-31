import { useEffect, useRef } from 'react';
import { MonitoredFolder } from '../types';

interface UseFolderMonitorProps {
    isLoaded: boolean;
    monitoredFolders: MonitoredFolder[];
    onScan: (paths: string[], isStartup: boolean) => void;
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
            const activeNewPaths = newFolders
                .filter(f => f.isActive)
                .map(f => f.path);

            if (activeNewPaths.length > 0) {
                // Check if this is likely a startup initialization scan (prevFolders was empty/default)
                const isStartup = prevFoldersRef.current.length === 0 && currentFolders.length > 0;

                if (!isStartup) {
                    if (activeNewPaths.length === 1) {
                        addToast(`Scanning new folder: ${activeNewPaths[0]}`, 'info');
                    } else {
                        addToast(`Scanning ${activeNewPaths.length} new folders`, 'info');
                    }
                }

                // Call onScan with ALL paths at once if supported, 
                // but useFileOperations' scanDirectory only takes one path.
                // handleImportPaths takes multiple! Let's check App.tsx.
                onScan(activeNewPaths as any, isStartup);
            }
        }
        prevFoldersRef.current = currentFolders;
    }, [monitoredFolders, isLoaded, onScan, addToast]);
}
