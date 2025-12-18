import { useEffect, useRef } from 'react';
import { MonitoredFolder } from '../types';

interface UseFolderMonitorProps {
    isLoaded: boolean;
    monitoredFolders: MonitoredFolder[];
    onScan: (path: string, isStartup: boolean) => void;
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
            newFolders.forEach(folder => {
                if (folder.isActive) {
                    // Check if this is likely a startup initialization scan (prevFolders was empty/default)
                    const isStartup = prevFoldersRef.current.length === 0 && currentFolders.length > 0;

                    if (!isStartup) addToast(`Scanning new folder: ${folder.path}`, 'info');

                    onScan(folder.path, isStartup);
                }
            });
        }
        prevFoldersRef.current = currentFolders;
    }, [monitoredFolders, isLoaded, onScan, addToast]);
}
