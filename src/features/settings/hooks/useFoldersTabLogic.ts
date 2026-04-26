import * as React from 'react';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { AppSettings, MonitoredFolder, GeneratorTool } from '../../../types';
import { useToast } from '../../../hooks/useToast';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useLibraryStore } from '../../../stores/libraryStore';
import { commands } from '../../../bindings';
import { normalizePath } from '../../../utils/pathUtils';
import { unwrap } from '../../../utils/spectaUtils';
import { scanResourceThumbnails, processNativePaths } from '../../../services/importService';

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
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<void>;
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
    const [newResourcePath, setNewResourcePath] = useState('');
    const [scanningIds, setScanningIds] = useState<Set<string>>(new Set());

    const fileInputRef = useRef<HTMLInputElement>(null);
    const resourceInputRef = useRef<HTMLInputElement>(null);
    const pendingScansRef = useRef<{ id: string, path: string, variant?: string }[]>([]);
    const scanDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const updateFolderLastScanned = useSettingsStore(s => s.updateFolderLastScanned);
    const {
        isScanningDiscovery, setIsScanningDiscovery,
        discoveryScanProgress, isPopulatingThumbnails
    } = useLibraryStore();

    const fetchCounts = useCallback(async () => {
        if (!settings.monitoredFolders.length && !settings.invokeAiPath) return;

        let hasUpdates = false;
        const updatedFolders = await Promise.all(settings.monitoredFolders.map(async (folder) => {
            try {
                let variant = folder.variant;
                if (!variant || variant === GeneratorTool.UNKNOWN) {
                    variant = detectGeneratorVariant(folder.path);
                    if (variant !== folder.variant) hasUpdates = true;
                }

                const res = await commands.getImageCountForPathPrefix(folder.path);
                if (res.status === 'ok' && res.data !== folder.imageCount) {
                    hasUpdates = true;
                    return { ...folder, imageCount: res.data, variant };
                }
                if (variant !== folder.variant) {
                    return { ...folder, variant };
                }
            } catch (e) {
                console.error('Failed to get count for', folder.path, e);
            }
            return folder;
        }));

        if (hasUpdates) {
            setSettings(prev => ({ ...prev, monitoredFolders: updatedFolders }));
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
                } as any);
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
                        const { setIsImporting, setImportProgress } = useLibraryStore.getState();
                        setIsImporting(true);
                        setImportProgress({ current: 0, total: changedPaths.length, message: 'Syncing changed files...' });

                        try {
                            const { getThumbnailDir } = await import('../../../services/thumbnailService');
                            const thumbDir = await getThumbnailDir();
                            const result = await processNativePaths(
                                changedPaths,
                                thumbDir,
                                (current, total, message) => {
                                    setImportProgress({ current, total, message });
                                },
                                variant as GeneratorTool | undefined,
                                undefined,
                                false
                            );
                            addToast(`Synced ${result.images.length} new files`, 'success');
                            updateFolderLastScanned(id, Date.now());
                        } finally {
                            setIsImporting(false);
                            setImportProgress(null);
                        }
                    } else {
                        const allFiles = await unwrap(commands.scanDirectoryWithStats(path));
                        const knownCount = folder?.imageCount ?? 0;

                        if (allFiles.length > knownCount) {
                            const repairPaths = allFiles.map(f => f.path);
                            const { setIsImporting, setImportProgress } = useLibraryStore.getState();
                            setIsImporting(true);
                            setImportProgress({ current: 0, total: repairPaths.length, message: 'Repairing incomplete import...' });

                            try {
                                const { getThumbnailDir } = await import('../../../services/thumbnailService');
                                const thumbDir = await getThumbnailDir();
                                const result = await processNativePaths(
                                    repairPaths,
                                    thumbDir,
                                    (current, total, message) => {
                                        setImportProgress({ current, total, message });
                                    },
                                    variant as GeneratorTool | undefined,
                                    undefined,
                                    false
                                );
                                addToast(
                                    result.images.length > 0
                                        ? `Repair scan imported ${result.images.length} missing files`
                                        : 'Repair scan found no additional importable files',
                                    result.images.length > 0 ? 'success' : 'info'
                                );
                            } finally {
                                setIsImporting(false);
                                setImportProgress(null);
                            }
                        } else {
                            addToast(`No changes detected`, 'info');
                        }
                        updateFolderLastScanned(id, Date.now());
                    }
                } else {
                    await onScanFolder([{ path, variant }]);
                    updateFolderLastScanned(id, Date.now());
                    addToast(`Rescan complete`, 'success');
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
                await onScanFolder(foldersToScan.map(({ path, variant }) => ({ path, variant })));
                const completedAt = Date.now();
                setSettings(prev => ({
                    ...prev,
                    monitoredFolders: prev.monitoredFolders.map(folder =>
                        foldersToScan.some(pending => pending.id === folder.id)
                            ? { ...folder, lastScanned: completedAt, initialScanPending: false }
                            : folder
                    )
                }));
                await fetchCounts();
            } catch (e) {
                console.error('Auto-scan failed:', e);
                setSettings(prev => ({
                    ...prev,
                    monitoredFolders: prev.monitoredFolders.map(folder =>
                        foldersToScan.some(pending => pending.id === folder.id)
                            ? { ...folder, lastScanned: undefined, initialScanPending: false }
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

    const handleAddResourceFolder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newResourcePath.trim()) return;
        const pathToAdd = newResourcePath.trim();
        setSettings(prev => ({
            ...prev,
            resourceFolders: [...(prev.resourceFolders || []), pathToAdd]
        }));
        setNewResourcePath('');
        addToast(`Added resource folder`, 'success');
        setIsScanningDiscovery(true);
        try {
            await scanResourceThumbnails([...(settings.resourceFolders || []), pathToAdd]);
        } finally {
            setIsScanningDiscovery(false);
        }
    };

    const handleRemoveResourceFolder = (path: string) => {
        setSettings(prev => ({
            ...prev,
            resourceFolders: (prev.resourceFolders || []).filter(p => p !== path)
        }));
    };

    const handleScanNow = async () => {
        if (!settings.resourceFolders?.length) return;
        setIsScanningDiscovery(true);
        try {
            await scanResourceThumbnails(settings.resourceFolders);
            addToast('Resource scan complete', 'success');
        } catch (e) {
            addToast('Resource scan failed', 'error');
        } finally {
            setIsScanningDiscovery(false);
        }
    };

    return {
        newFolderPath, setNewFolderPath,
        newResourcePath, setNewResourcePath,
        scanningIds,
        combinedFolders,
        fileInputRef,
        resourceInputRef,
        isScanningDiscovery,
        discoveryScanProgress,
        isPopulatingThumbnails,
        handleRescan,
        handleAddFolder,
        removeFolder,
        handleBrowse,
        handleAddResourceFolder,
        handleRemoveResourceFolder,
        handleScanNow
    };
};
