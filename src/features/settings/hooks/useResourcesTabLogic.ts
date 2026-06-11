import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppSettings } from '../../../types';
import { commands, type ResourcePurgeResult, type ThumbnailScanResult } from '../../../bindings';
import { useToast } from '../../../hooks/useToast';
import { useLibraryContext } from '../../../contexts/LibraryContext';
import { useLibraryStore } from '../../../stores/libraryStore';
import { scanResourceThumbnails } from '../../../services/importService';
import { refreshFacetCacheForResourcesStrict, rebuildFacetCacheIncremental } from '../../../services/db/imageRepo';
import { isBrowserMockMode } from '../../../services/runtime';
import { normalizePath } from '../../../utils/pathUtils';
import { unwrap } from '../../../utils/spectaUtils';
import {
    createEmptyTouchedFacetResources,
    hasTouchedFacetResources,
    type TouchedFacetResources
} from '../../../utils/touchedFacetTypes';
import { formatHashResolutionMessage, isHashResolutionPartial } from '../utils/hashResolution';

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

const formatResourcePurgeToast = (result: ResourcePurgeResult): string => {
    const details: string[] = [];
    if (result.removedModels > 0) {
        details.push(`${result.removedModels} local ${result.removedModels === 1 ? 'asset' : 'assets'} purged`);
    }
    if (result.preservedModels > 0) {
        details.push(`${result.preservedModels} customized ${result.preservedModels === 1 ? 'asset' : 'assets'} preserved`);
    }

    return details.length > 0
        ? `Removed resource folder: ${details.join(', ')}`
        : 'Removed resource folder; no indexed local assets needed cleanup';
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

const isLibraryBusyForHashResolution = () => {
    const state = useLibraryStore.getState();
    return state.syncStatus === 'syncing'
        || state.isImporting
        || state.isLiveSyncing
        || state.isRegeneratingThumbnails
        || state.isRefreshingMetadata
        || state.isScanningDiscovery
        || state.isScanningDuplicates
        || state.isScanningMissingFiles
        || state.isPopulatingThumbnails
        || state.isBackgroundHealingActive;
};

interface UseResourcesTabLogicProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const useResourcesTabLogic = ({
    settings,
    setSettings
}: UseResourcesTabLogicProps) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const [newResourcePath, setNewResourcePath] = React.useState('');
    const [removingResourcePath, setRemovingResourcePath] = React.useState<string | null>(null);
    const [isResolveConfirmOpen, setIsResolveConfirmOpen] = React.useState(false);
    const resourceInputRef = React.useRef<HTMLInputElement>(null);
    const removingResourcePathRef = React.useRef<string | null>(null);

    const {
        isResolvingModels: isResolving,
        setIsResolvingModels: setIsResolving,
        modelResolutionProgress: resolutionProgress,
        setModelResolutionProgress: setResolutionProgress,
        lastModelResolutionResult: resolutionResult,
        setLastModelResolutionResult: setResolutionResult
    } = useLibraryContext();

    const {
        isScanningDiscovery, setIsScanningDiscovery,
        discoveryScanProgress, setDiscoveryScanProgress, isPopulatingThumbnails
    } = useLibraryStore();
    const incrementFacetCacheVersion = useLibraryStore(state => state.incrementFacetCacheVersion);
    const isHashResolutionBlocked = useLibraryStore(state => state.syncStatus === 'syncing'
        || state.isImporting
        || state.isLiveSyncing
        || state.isRegeneratingThumbnails
        || state.isRefreshingMetadata
        || state.isScanningDiscovery
        || state.isScanningDuplicates
        || state.isScanningMissingFiles
        || state.isPopulatingThumbnails
        || state.isBackgroundHealingActive);

    const resolutionProgressPercent = resolutionProgress && resolutionProgress.total > 0
        ? Math.min(100, Math.max(0, Math.round((resolutionProgress.current / resolutionProgress.total) * 100)))
        : 0;

    const refreshResourceFacetCache = React.useCallback(async (scanResult: ThumbnailScanResult): Promise<number> => {
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
        const indexedRows = await refreshFacetCacheForResourcesStrict(resources);
        useLibraryStore.getState().incrementFacetCacheVersion();
        return indexedRows;
    }, [addToast, setDiscoveryScanProgress]);

    const showResourceScanComplete = React.useCallback(async (scanResult: ThumbnailScanResult, indexedRows: number) => {
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

    const runResourceDiscoveryScan = React.useCallback(async (paths: string[]) => {
        const result = await scanResourceThumbnails(paths);
        const indexedRows = await refreshResourceFacetCache(result);
        return { result, indexedRows };
    }, [refreshResourceFacetCache]);

    const handleBrowseResource = React.useCallback(async () => {
        if (removingResourcePathRef.current) return;

        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({ directory: true, multiple: false });
            if (selected && typeof selected === 'string') {
                setNewResourcePath(normalizePath(selected));
            }
        } catch (e) {
            resourceInputRef.current?.click();
        }
    }, []);

    const handleAddResourceFolder = React.useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (removingResourcePathRef.current) return;
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
        addToast('Added resource folder', 'success');
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
    }, [
        addToast,
        newResourcePath,
        runResourceDiscoveryScan,
        setDiscoveryScanProgress,
        setIsScanningDiscovery,
        setSettings,
        settings.resourceFolders,
        showResourceScanComplete
    ]);

    const handleRemoveResourceFolder = React.useCallback(async (path: string) => {
        if (isScanningDiscovery || isPopulatingThumbnails || removingResourcePathRef.current) return;

        const normalizedPath = normalizePath(path);
        const remainingPaths = (settings.resourceFolders || [])
            .map(normalizePath)
            .filter(configuredPath => configuredPath !== normalizedPath);

        removingResourcePathRef.current = normalizedPath;
        setRemovingResourcePath(path);

        try {
            let purgeResult: ResourcePurgeResult | null = null;
            if (!isBrowserMockMode()) {
                purgeResult = await unwrap(commands.purgeResourceFolderAssets(path, remainingPaths));
                incrementFacetCacheVersion();
            }

            setSettings(prev => ({
                ...prev,
                resourceFolders: (prev.resourceFolders || []).filter(
                    configuredPath => normalizePath(configuredPath) !== normalizedPath
                )
            }));
            addToast(purgeResult ? formatResourcePurgeToast(purgeResult) : 'Removed resource folder', 'success');
        } catch (error) {
            console.error('Failed to remove resource folder', error);
            addToast('Failed to remove resource folder', 'error');
        } finally {
            removingResourcePathRef.current = null;
            setRemovingResourcePath(null);
        }
    }, [
        addToast,
        incrementFacetCacheVersion,
        isPopulatingThumbnails,
        isScanningDiscovery,
        setSettings,
        settings.resourceFolders
    ]);

    const handleScanNow = React.useCallback(async () => {
        if (removingResourcePathRef.current) return;
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
    }, [
        addToast,
        runResourceDiscoveryScan,
        setDiscoveryScanProgress,
        setIsScanningDiscovery,
        settings.resourceFolders,
        showResourceScanComplete
    ]);

    const requestResolveOnline = React.useCallback(() => {
        if (isHashResolutionBlocked) {
            addToast('Wait for the current library task to finish before resolving hashes', 'warning');
            return;
        }
        setIsResolveConfirmOpen(true);
    }, [addToast, isHashResolutionBlocked]);

    const confirmResolveOnline = React.useCallback(async () => {
        setIsResolveConfirmOpen(false);
        if (isLibraryBusyForHashResolution()) {
            setResolutionResult({
                success: false,
                message: 'Resolution paused: wait for the current sync, import, scan, or cache rebuild to finish, then run it again.'
            });
            addToast('Hash resolution is paused while the library is busy', 'warning');
            return;
        }

        setIsResolving(true);
        setResolutionProgress({
            current: 0,
            total: 100,
            message: 'Starting hash resolution...'
        });
        setResolutionResult(null);
        addToast('Resolving unknown hashes...', 'info');

        try {
            const res = await unwrap(commands.resolveHashesOnline(false));
            const isPartial = isHashResolutionPartial(res);
            let message = formatHashResolutionMessage(res);
            let refreshFailed = false;

            setResolutionProgress({
                current: 95,
                total: 100,
                message: 'Refreshing checkpoint filters...'
            });

            try {
                await rebuildFacetCacheIncremental('checkpoints');
                incrementFacetCacheVersion();
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['images'] }),
                    queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
                ]);
            } catch (refreshError: unknown) {
                refreshFailed = true;
                const refreshMessage = refreshError instanceof Error ? refreshError.message : String(refreshError);
                console.error(refreshError);
                message = `${message} UI refresh pending: ${refreshMessage}`;
                addToast('Lookup finished, but the UI refresh needs another pass', 'warning');
            }

            setResolutionResult({
                success: !isPartial,
                message
            });

            if (!refreshFailed) {
                if (isPartial) {
                    addToast(`Lookup finished with ${res.failedCount} failed and ${res.unknownCount} unknown`, 'warning');
                } else {
                    addToast(`Lookup finished: ${res.resolvedCount} verified online`, 'success');
                }
            }
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            if (errorMessage.toLowerCase().includes('cancelled')) {
                addToast('Resolution cancelled', 'info');
            } else {
                console.error(e);
                setResolutionResult({ success: false, message: `Lookup failed: ${errorMessage}` });
                addToast('Lookup failed', 'error');
            }
        } finally {
            setIsResolving(false);
            setResolutionProgress(null);
        }
    }, [
        addToast,
        incrementFacetCacheVersion,
        queryClient,
        setIsResolving,
        setResolutionProgress,
        setResolutionResult
    ]);

    const cancelResolveOnline = React.useCallback(async () => {
        await commands.cancelModelResolution().catch(console.error);
    }, []);

    return {
        resourceFolders: settings.resourceFolders || [],
        isScanningDiscovery,
        discoveryScanProgress,
        isPopulatingThumbnails,
        removingResourcePath,
        newResourcePath,
        setNewResourcePath,
        resourceInputRef,
        handleBrowseResource,
        handleAddResourceFolder,
        handleRemoveResourceFolder,
        handleScanNow,
        isResolving,
        resolutionProgress,
        resolutionProgressPercent,
        resolutionResult,
        isHashResolutionBlocked,
        isResolveConfirmOpen,
        requestResolveOnline,
        confirmResolveOnline,
        cancelResolveOnline,
        cancelResolveConfirmation: () => setIsResolveConfirmOpen(false),
    };
};
