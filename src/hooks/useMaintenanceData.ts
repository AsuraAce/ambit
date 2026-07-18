import { useState, useCallback, useEffect, useRef } from 'react';
import { AIImage } from '../types';
import { useLibraryContext } from './useLibraryContext';
import { useLibraryStore } from '../stores/libraryStore';
import * as db from '../services/db/maintenanceRepo';
import type { FileHashBackfillResult } from '../bindings';

export type MaintenanceTab = 'duplicates' | 'trash' | 'missing' | 'untagged' | 'thumbnails' | 'intermediates';

interface MaintenanceRefreshOptions {
    scope?: 'global' | 'filtered';
    includeUpgradeable?: boolean;
    runHashBackfill?: boolean;
}

interface InFlightMaintenanceRequest {
    requestId: number;
    signature: string;
    showLoader: boolean;
    promise: Promise<void>;
}

const FAILED_DUPLICATE_SCAN_RESULT: FileHashBackfillResult = {
    scanned: 0,
    updated: 0,
    missing: 0,
    errors: 1,
    remaining: 1,
    wasCancelled: false,
};

export const useMaintenanceData = (activeTab: MaintenanceTab, thumbnailsScope: 'global' | 'filtered') => {
    const {
        activeSqlWhere,
        activeSqlParams
    } = useLibraryContext();
    const isScanningDuplicates = useLibraryStore(s => s.isScanningDuplicates);
    const lastDuplicateScanResult = useLibraryStore(s => s.lastDuplicateScanResult);

    const [initializedTabs, setInitializedTabs] = useState<Set<string>>(new Set());
    const [loadingTabs, setLoadingTabs] = useState<Set<MaintenanceTab>>(new Set());
    const [loadErrorTabs, setLoadErrorTabs] = useState<Set<MaintenanceTab>>(new Set());
    const [successfulTabs, setSuccessfulTabs] = useState<Set<MaintenanceTab>>(new Set());

    const nextRequestIdRef = useRef(0);
    const latestRequestIdsRef = useRef<Map<MaintenanceTab, number>>(new Map());
    const inFlightRequestsRef = useRef<Map<MaintenanceTab, InFlightMaintenanceRequest>>(new Map());
    const lastRequestOptionsRef = useRef<Map<MaintenanceTab, MaintenanceRefreshOptions>>(new Map());

    const [localDeletedImages, setLocalDeletedImages] = useState<AIImage[]>([]);
    const [localUntaggedImages, setLocalUntaggedImages] = useState<AIImage[]>([]);
    const [localUnoptimizedImages, setLocalUnoptimizedImages] = useState<AIImage[]>([]);
    const [localDuplicateCandidates, setLocalDuplicateCandidates] = useState<AIImage[]>([]);
    const [localMissingImages, setLocalMissingImages] = useState<AIImage[]>([]);
    const [localIntermediateImages, setLocalIntermediateImages] = useState<AIImage[]>([]);
    const [unoptimizedTotalCount, setUnoptimizedTotalCount] = useState<number>(0);

    const refreshData = useCallback((tab: MaintenanceTab, showLoader: boolean = true, options: MaintenanceRefreshOptions = {}) => {
        const useGlobalLoader = showLoader && tab !== 'duplicates';
        const scope = options.scope ?? 'global';
        const where = scope === 'filtered' ? activeSqlWhere : '';
        const params = scope === 'filtered' ? [...activeSqlParams] : [];
        const signature = JSON.stringify([
            tab,
            scope,
            where,
            params,
            options.includeUpgradeable ?? false,
            tab === 'duplicates' ? options.runHashBackfill ?? true : false,
        ]);

        const existingRequest = inFlightRequestsRef.current.get(tab);
        if (existingRequest?.signature === signature) {
            if (useGlobalLoader && !existingRequest.showLoader) {
                existingRequest.showLoader = true;
                setLoadingTabs(prev => new Set(prev).add(tab));
            }
            return existingRequest.promise;
        }

        const requestId = nextRequestIdRef.current + 1;
        nextRequestIdRef.current = requestId;
        latestRequestIdsRef.current.set(tab, requestId);
        lastRequestOptionsRef.current.set(tab, { ...options, scope });

        setLoadingTabs(prev => {
            const next = new Set(prev);
            if (useGlobalLoader) next.add(tab);
            else next.delete(tab);
            return next;
        });
        setLoadErrorTabs(prev => {
            if (!prev.has(tab)) return prev;
            const next = new Set(prev);
            next.delete(tab);
            return next;
        });

        const isCurrentRequest = () => latestRequestIdsRef.current.get(tab) === requestId;

        const runRequest = async () => {
            let startedDuplicateScan = false;
            try {
                if (tab === 'trash') {
                    const data = await db.getDeletedImages();
                    if (isCurrentRequest()) setLocalDeletedImages(data);
                } else if (tab === 'missing') {
                    const data = await db.getMissingImages();
                    if (isCurrentRequest()) setLocalMissingImages(data);
                } else if (tab === 'untagged') {
                    const data = await db.getUntaggedImages(where, params);
                    if (isCurrentRequest()) setLocalUntaggedImages(data);
                } else if (tab === 'thumbnails') {
                    // Fetch count first (fast), then limited preview
                    const [count, data] = await Promise.all([
                        db.getUnoptimizedImagesCount(where, params, options.includeUpgradeable),
                        db.getUnoptimizedImages(where, params, options.includeUpgradeable)
                    ]);
                    if (isCurrentRequest()) {
                        setUnoptimizedTotalCount(count);
                        setLocalUnoptimizedImages(data);
                    }
                } else if (tab === 'duplicates') {
                    const shouldRunHashBackfill = options.runHashBackfill ?? true;
                    setInitializedTabs(prev => new Set(prev).add(tab));

                    if (shouldRunHashBackfill) {
                        const store = useLibraryStore.getState();
                        if (!store.isScanningDuplicates) {
                            store.setLastDuplicateScanResult(null);
                            store.setIsScanningDuplicates(true);
                            store.setDuplicateScanProgress({
                                current: 0,
                                total: 0,
                                message: 'Preparing duplicate scan...'
                            });
                            startedDuplicateScan = true;
                        }
                    }

                    const data = await db.getDuplicateCandidates();
                    if (isCurrentRequest()) {
                        setLocalDuplicateCandidates(data);
                        setSuccessfulTabs(prev => new Set(prev).add(tab));
                    }

                    if (startedDuplicateScan && useLibraryStore.getState().isScanningDuplicates) {
                        const store = useLibraryStore.getState();
                        void db.backfillImageFileHashes()
                            .then(async (result) => {
                                store.setLastDuplicateScanResult(result);
                                const refreshed = await db.getDuplicateCandidates();
                                setLocalDuplicateCandidates(refreshed);
                                setSuccessfulTabs(prev => new Set(prev).add(tab));
                                setLoadErrorTabs(prev => {
                                    if (!prev.has(tab)) return prev;
                                    const next = new Set(prev);
                                    next.delete(tab);
                                    return next;
                                });
                            })
                            .catch((e) => {
                                console.error("Failed to complete duplicate scan", e);
                                store.setLastDuplicateScanResult(FAILED_DUPLICATE_SCAN_RESULT);
                            })
                            .finally(() => {
                                store.setIsScanningDuplicates(false);
                                store.setDuplicateScanProgress(null);
                            });
                    }

                    return;
                } else {
                    const data = await db.getIntermediateImages(where, params);
                    if (isCurrentRequest()) setLocalIntermediateImages(data);
                }

                if (isCurrentRequest()) {
                    setInitializedTabs(prev => new Set(prev).add(tab));
                    setSuccessfulTabs(prev => new Set(prev).add(tab));
                }
            } catch (e) {
                console.error("Failed to refresh maintenance data", e);
                if (tab === 'duplicates') {
                    const store = useLibraryStore.getState();
                    store.setLastDuplicateScanResult(FAILED_DUPLICATE_SCAN_RESULT);
                    if (startedDuplicateScan) {
                        store.setIsScanningDuplicates(false);
                        store.setDuplicateScanProgress(null);
                    }
                }
                if (isCurrentRequest()) {
                    setLoadErrorTabs(prev => new Set(prev).add(tab));
                }
            } finally {
                if (isCurrentRequest()) {
                    setLoadingTabs(prev => {
                        if (!prev.has(tab)) return prev;
                        const next = new Set(prev);
                        next.delete(tab);
                        return next;
                    });
                }
                if (inFlightRequestsRef.current.get(tab)?.requestId === requestId) {
                    inFlightRequestsRef.current.delete(tab);
                }
            }
        };

        const promise = Promise.resolve().then(runRequest);
        inFlightRequestsRef.current.set(tab, {
            requestId,
            signature,
            showLoader: useGlobalLoader,
            promise,
        });
        return promise;
    }, [activeSqlWhere, activeSqlParams]);

    const retryActiveTab = useCallback(() => (
        refreshData(activeTab, true, lastRequestOptionsRef.current.get(activeTab) ?? {})
    ), [activeTab, refreshData]);

    const isLoading = loadingTabs.has(activeTab);

    useEffect(() => {
        // Cheap record fetches can load on tab entry; long-running scans remain manual.
        if ((activeTab === 'trash' || activeTab === 'missing') && !initializedTabs.has(activeTab)) {
            void refreshData(activeTab, true);
        }
    }, [activeTab, refreshData, initializedTabs]);

    useEffect(() => {
        if (activeTab !== 'duplicates' || initializedTabs.has('duplicates')) {
            return;
        }

        if (isScanningDuplicates || lastDuplicateScanResult) {
            void refreshData('duplicates', false, { runHashBackfill: false });
        }
    }, [activeTab, initializedTabs, isScanningDuplicates, lastDuplicateScanResult, refreshData]);

    return {
        isLoading,
        hasActiveLoadError: loadErrorTabs.has(activeTab),
        hasLoadedActiveTab: successfulTabs.has(activeTab),
        retryActiveTab,
        initializedTabs, // Export this so the UI knows if a tab has been scanned
        localDeletedImages,
        localUntaggedImages,
        localUnoptimizedImages,
        localDuplicateCandidates,
        localMissingImages,
        localIntermediateImages,
        unoptimizedTotalCount,
        refreshData,
        setLocalDeletedImages,
        setLocalUntaggedImages,
        setLocalUnoptimizedImages,
        setLocalDuplicateCandidates,
        setLocalMissingImages,
        setLocalIntermediateImages
    };
};
