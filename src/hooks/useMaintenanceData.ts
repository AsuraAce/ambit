import { useState, useCallback, useEffect } from 'react';
import { AIImage } from '../types';
import { useLibraryContext } from './useLibraryContext';
import { useLibraryStore } from '../stores/libraryStore';

export type MaintenanceTab = 'duplicates' | 'trash' | 'missing' | 'untagged' | 'thumbnails' | 'intermediates';

interface MaintenanceRefreshOptions {
    scope?: 'global' | 'filtered';
    includeUpgradeable?: boolean;
    runHashBackfill?: boolean;
}

export const useMaintenanceData = (activeTab: MaintenanceTab, thumbnailsScope: 'global' | 'filtered') => {
    const {
        activeSqlWhere,
        activeSqlParams
    } = useLibraryContext();
    const isScanningDuplicates = useLibraryStore(s => s.isScanningDuplicates);
    const lastDuplicateScanResult = useLibraryStore(s => s.lastDuplicateScanResult);

    const [isLoading, setIsLoading] = useState(false);
    const [initializedTabs, setInitializedTabs] = useState<Set<string>>(new Set());

    const [localDeletedImages, setLocalDeletedImages] = useState<AIImage[]>([]);
    const [localUntaggedImages, setLocalUntaggedImages] = useState<AIImage[]>([]);
    const [localUnoptimizedImages, setLocalUnoptimizedImages] = useState<AIImage[]>([]);
    const [localDuplicateCandidates, setLocalDuplicateCandidates] = useState<AIImage[]>([]);
    const [localIntermediateImages, setLocalIntermediateImages] = useState<AIImage[]>([]);
    const [unoptimizedTotalCount, setUnoptimizedTotalCount] = useState<number>(0);

    const refreshData = useCallback(async (tab: MaintenanceTab, showLoader: boolean = true, options: MaintenanceRefreshOptions = {}) => {
        const useGlobalLoader = showLoader && tab !== 'duplicates';
        if (useGlobalLoader) setIsLoading(true);
        try {
            const db = await import('../services/db/maintenanceRepo');


            if (tab === 'trash') {
                const data = await db.getDeletedImages();
                setLocalDeletedImages(data);
            } else if (tab === 'untagged') {
                const where = options.scope === 'filtered' ? activeSqlWhere : '';
                const params = options.scope === 'filtered' ? activeSqlParams : [];
                const data = await db.getUntaggedImages(where, params);
                setLocalUntaggedImages(data);
            } else if (tab === 'thumbnails') {
                const where = options.scope === 'filtered' ? activeSqlWhere : '';
                const params = options.scope === 'filtered' ? activeSqlParams : [];
                // Fetch count first (fast), then limited preview
                const [count, data] = await Promise.all([
                    db.getUnoptimizedImagesCount(where, params, options.includeUpgradeable),
                    db.getUnoptimizedImages(where, params, options.includeUpgradeable)
                ]);
                setUnoptimizedTotalCount(count);
                setLocalUnoptimizedImages(data);
            } else if (tab === 'duplicates') {
                const scope = options.scope ?? 'global';
                const where = scope === 'filtered' ? activeSqlWhere : '';
                const params = scope === 'filtered' ? activeSqlParams : [];
                const shouldRunHashBackfill = options.runHashBackfill ?? true;

                const data = await db.getDuplicateCandidates(where, params);
                setLocalDuplicateCandidates(data);
                setInitializedTabs(prev => new Set(prev).add(tab));

                if (shouldRunHashBackfill) {
                    const store = useLibraryStore.getState();
                    if (!store.isScanningDuplicates) {
                        store.setDuplicateScanScope(scope);
                        store.setLastDuplicateScanResult(null);
                        store.setIsScanningDuplicates(true);
                        store.setDuplicateScanProgress({
                            current: 0,
                            total: 0,
                            message: 'Preparing duplicate scan...'
                        });

                        void db.backfillImageFileHashes()
                            .then(async (result) => {
                                store.setLastDuplicateScanResult(result);
                                const refreshed = await db.getDuplicateCandidates(where, params);
                                setLocalDuplicateCandidates(refreshed);
                            })
                            .catch((e) => {
                                console.error("Failed to run duplicate hash scan", e);
                            })
                            .finally(() => {
                                store.setIsScanningDuplicates(false);
                                store.setDuplicateScanProgress(null);
                            });
                    }
                }

                return;
            } else if (tab === 'intermediates') {
                const where = options.scope === 'filtered' ? activeSqlWhere : '';
                const params = options.scope === 'filtered' ? activeSqlParams : [];
                const data = await db.getIntermediateImages(where, params);
                setLocalIntermediateImages(data);
            }

            setInitializedTabs(prev => new Set(prev).add(tab));
        } catch (e) {
            console.error("Failed to refresh maintenance data", e);
        } finally {
            if (useGlobalLoader) setIsLoading(false);
        }
    }, [activeSqlWhere, activeSqlParams]);

    useEffect(() => {
        // ONLY auto-trigger for trash. Everything else requires manual 'Start Scan'.
        if (activeTab === 'trash' && !initializedTabs.has('trash')) {
            refreshData('trash', true);
        }
    }, [activeTab, refreshData, initializedTabs]);

    useEffect(() => {
        if (activeTab !== 'duplicates' || initializedTabs.has('duplicates')) {
            return;
        }

        if (isScanningDuplicates || lastDuplicateScanResult) {
            const scope = useLibraryStore.getState().duplicateScanScope;
            refreshData('duplicates', false, { scope, runHashBackfill: false });
        }
    }, [activeTab, initializedTabs, isScanningDuplicates, lastDuplicateScanResult, refreshData]);

    return {
        isLoading,
        initializedTabs, // Export this so the UI knows if a tab has been scanned
        localDeletedImages,
        localUntaggedImages,
        localUnoptimizedImages,
        localDuplicateCandidates,
        localIntermediateImages,
        unoptimizedTotalCount,
        refreshData,
        setLocalDeletedImages,
        setLocalUntaggedImages,
        setLocalUnoptimizedImages,
        setLocalDuplicateCandidates,
        setLocalIntermediateImages
    };
};
