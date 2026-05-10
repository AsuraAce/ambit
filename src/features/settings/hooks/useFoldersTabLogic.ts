import * as React from 'react';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { AppSettings, MonitoredFolder, GeneratorTool } from '../../../types';
import { useToast } from '../../../hooks/useToast';
import { useSettingsStore } from '../../../stores/settingsStore';
import { useLibraryStore } from '../../../stores/libraryStore';
import { commands, type ThumbnailScanResult } from '../../../bindings';
import { normalizePath } from '../../../utils/pathUtils';
import { unwrap } from '../../../utils/spectaUtils';
import { scanResourceThumbnails, processNativePaths, type ImportResult } from '../../../services/importService';
import {
    createEmptyTouchedFacetResources,
    hasTouchedFacetResources,
    type TouchedFacetResources
} from '../../../utils/touchedFacetTypes';

const RESOURCE_TOUCH_KEYS = [
    'checkpoints',
    'loras',
    'embeddings',
    'hypernetworks',
    'controlNets',
    'ipAdapters'
] as const;

type ResourceTouchKey = typeof RESOURCE_TOUCH_KEYS[number];

const RESOURCE_INDEX_LABELS: Record<ResourceTouchKey, string> = {
    checkpoints: 'checkpoint',
    loras: 'LoRA',
    embeddings: 'embedding',
    hypernetworks: 'hypernetwork',
    controlNets: 'ControlNet',
    ipAdapters: 'IP-Adapter'
};

const RESOURCE_FILE_LABELS: Record<ResourceTouchKey, string> = {
    checkpoints: 'checkpoint files',
    loras: 'LoRA files',
    embeddings: 'embedding files',
    hypernetworks: 'hypernetwork files',
    controlNets: 'ControlNet files',
    ipAdapters: 'IP-Adapter files'
};

const RESOURCE_SCAN_COMPLETE_VISIBLE_MS = 1200;

const resourcesForScanResult = (result: ThumbnailScanResult): TouchedFacetResources =>
    result.resources ?? createEmptyTouchedFacetResources();

const touchedResourceKeys = (resources: TouchedFacetResources): ResourceTouchKey[] =>
    RESOURCE_TOUCH_KEYS.filter(key => resources[key].length > 0);

const resourceFileLabel = (result: ThumbnailScanResult): string => {
    const keys = touchedResourceKeys(resourcesForScanResult(result));
    return keys.length === 1 ? RESOURCE_FILE_LABELS[keys[0]] : 'model files';
};

const formatResourceScanDetail = (result: ThumbnailScanResult, indexedRows?: number): string => {
    const parts = [`${result.found} ${resourceFileLabel(result)} found`];
    if (indexedRows != null) {
        parts.push(`${indexedRows} indexed`);
    }
    if (result.newOrChangedFiles > 0) {
        parts.push(`${result.newOrChangedFiles} new/changed`);
    }
    if (result.cachedFiles > 0) {
        parts.push(`${result.cachedFiles} unchanged`);
    }
    parts.push(`${result.updated} thumbnails linked`);
    return parts.join(' | ');
};

const formatResourceScanToast = (result: ThumbnailScanResult, indexedRows: number): string => {
    const indexedDetail = indexedRows > 0 ? `, ${indexedRows} indexed` : '';
    return `Resource scan complete: ${result.found} ${resourceFileLabel(result)} found${indexedDetail}`;
};

const formatResourceIndexMessage = (resources: TouchedFacetResources): string => {
    const keys = touchedResourceKeys(resources);
    if (keys.length === 1) {
        return `Updating ${RESOURCE_INDEX_LABELS[keys[0]]} index...`;
    }
    return 'Updating local asset index...';
};

const formatResourceIndexPhase = (resources: TouchedFacetResources): string => {
    const keys = touchedResourceKeys(resources);
    if (keys.length === 1) {
        return `Updating ${RESOURCE_INDEX_LABELS[keys[0]]} index`;
    }
    return 'Updating local asset index';
};

const waitForResourceScanCompletionState = () =>
    new Promise<void>(resolve => setTimeout(resolve, RESOURCE_SCAN_COMPLETE_VISIBLE_MS));

const getErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

const isCancellationError = (error: unknown): boolean =>
    getErrorMessage(error).toLowerCase().includes('cancel');

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
    const [newResourcePath, setNewResourcePath] = useState('');
    const [scanningIds, setScanningIds] = useState<Set<string>>(new Set());

    const fileInputRef = useRef<HTMLInputElement>(null);
    const resourceInputRef = useRef<HTMLInputElement>(null);
    const pendingScansRef = useRef<{ id: string, path: string, variant?: string }[]>([]);
    const scanDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const updateFolderLastScanned = useSettingsStore(s => s.updateFolderLastScanned);
    const {
        isScanningDiscovery, setIsScanningDiscovery,
        discoveryScanProgress, setDiscoveryScanProgress, isPopulatingThumbnails
    } = useLibraryStore();

    const refreshResourceFacetCache = useCallback(async (scanResult: ThumbnailScanResult): Promise<number> => {
        const resources = resourcesForScanResult(scanResult);
        if (!hasTouchedFacetResources(resources)) {
            if (scanResult.found > 0) {
                addToast('Resource scan found model files, but none could be classified for indexing', 'warning');
            }
            useLibraryStore.getState().incrementFacetCacheVersion();
            return 0;
        }

        const startedAt = useLibraryStore.getState().discoveryScanProgress?.startedAt ?? Date.now();
        setDiscoveryScanProgress({
            current: scanResult.found,
            total: 0,
            message: formatResourceIndexMessage(resources),
            phase: formatResourceIndexPhase(resources),
            mode: 'indeterminate',
            detail: formatResourceScanDetail(scanResult),
            startedAt
        });
        const { refreshFacetCacheForResourcesStrict } = await import('../../../services/db/imageRepo');
        const indexedRows = await refreshFacetCacheForResourcesStrict(resources);
        useLibraryStore.getState().incrementFacetCacheVersion();
        return indexedRows;
    }, [addToast, setDiscoveryScanProgress]);

    const showResourceScanComplete = useCallback(async (scanResult: ThumbnailScanResult, indexedRows: number) => {
        const startedAt = useLibraryStore.getState().discoveryScanProgress?.startedAt ?? Date.now();
        setDiscoveryScanProgress({
            current: scanResult.found,
            total: scanResult.found,
            message: 'Resource scan complete',
            phase: 'Complete',
            mode: 'complete',
            detail: formatResourceScanDetail(scanResult, indexedRows),
            startedAt
        });
        await waitForResourceScanCompletionState();
    }, [setDiscoveryScanProgress]);

    const runResourceDiscoveryScan = useCallback(async (paths: string[]) => {
        const result = await scanResourceThumbnails(paths);
        const indexedRows = await refreshResourceFacetCache(result);
        return { result, indexedRows };
    }, [refreshResourceFacetCache]);

    const isCompleteImport = (result: ImportResult | void): result is ImportResult =>
        !!result && result.failedPaths.length === 0;

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
                                false,
                                true,
                                true
                            );
                            addToast(`Synced ${result.images.length} new files`, 'success');
                            if (result.failedPaths.length === 0) {
                                updateFolderLastScanned(id, Date.now());
                            } else {
                                console.warn(`[Resync] Keeping cursor unchanged for ${path}; ${result.failedPaths.length} file(s) failed.`);
                            }
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
                            let repairFailedCount = 0;
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
                                repairFailedCount = result.failedPaths.length;
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
                            if (repairFailedCount === 0) {
                                updateFolderLastScanned(id, Date.now());
                            } else {
                                console.warn(`[Resync] Keeping cursor unchanged for ${path}; ${repairFailedCount} repair file(s) failed.`);
                            }
                        } else {
                            addToast(`No changes detected`, 'info');
                            updateFolderLastScanned(id, Date.now());
                        }
                    }
                } else {
                    const result = await onScanFolder([{ path, variant }]);
                    if (isCompleteImport(result)) {
                        updateFolderLastScanned(id, Date.now());
                        addToast(`Rescan complete`, 'success');
                    } else {
                        console.warn(`[Resync] Keeping cursor unchanged for ${path}; full scan did not fully complete.`);
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
                                ? { ...folder, lastScanned: completedAt, initialScanPending: false }
                                : folder
                        )
                    }));
                } else {
                    setSettings(prev => ({
                        ...prev,
                        monitoredFolders: prev.monitoredFolders.map(folder =>
                            foldersToScan.some(pending => pending.id === folder.id)
                                ? { ...folder, lastScanned: undefined, initialScanPending: false }
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

    const handleBrowseResource = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({ directory: true, multiple: false });
            if (selected && typeof selected === 'string') {
                setNewResourcePath(normalizePath(selected));
            }
        } catch (e) {
            resourceInputRef.current?.click();
        }
    };

    const handleAddResourceFolder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newResourcePath.trim()) return;

        const pathToAdd = normalizePath(newResourcePath.trim());
        const existing = (settings.resourceFolders || []).some(path => normalizePath(path) === pathToAdd);
        if (existing) {
            addToast('Resource folder is already added', 'info');
            setNewResourcePath('');
            return;
        }

        const nextResourceFolders = [...(settings.resourceFolders || []), pathToAdd];
        setSettings(prev => ({
            ...prev,
            resourceFolders: nextResourceFolders
        }));
        setNewResourcePath('');
        addToast(`Added resource folder`, 'success');
        setIsScanningDiscovery(true);
        try {
            const { result, indexedRows } = await runResourceDiscoveryScan([pathToAdd]);
            await showResourceScanComplete(result, indexedRows);
            addToast(formatResourceScanToast(result, indexedRows), 'success');
        } catch (e) {
            console.error('Resource scan failed', e);
            addToast(
                isCancellationError(e) ? 'Resource scan cancelled' : 'Resource scan failed',
                isCancellationError(e) ? 'info' : 'error'
            );
        } finally {
            setIsScanningDiscovery(false);
            setDiscoveryScanProgress(null);
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
            const { result, indexedRows } = await runResourceDiscoveryScan(settings.resourceFolders);
            await showResourceScanComplete(result, indexedRows);
            addToast(formatResourceScanToast(result, indexedRows), 'success');
        } catch (e) {
            console.error('Resource scan failed', e);
            addToast(
                isCancellationError(e) ? 'Resource scan cancelled' : 'Resource scan failed',
                isCancellationError(e) ? 'info' : 'error'
            );
        } finally {
            setIsScanningDiscovery(false);
            setDiscoveryScanProgress(null);
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
        handleBrowseResource,
        handleAddResourceFolder,
        handleRemoveResourceFolder,
        handleScanNow
    };
};
