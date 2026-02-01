import * as React from 'react';
import { createContext, useContext, useCallback, useRef, ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import { useCollections } from './CollectionContext';
import { useToast } from '../hooks/useToast';
import { useLibraryStore } from '../stores/libraryStore';
import { useSearchStore } from '../stores/searchStore';
import { useQueryClient } from '@tanstack/react-query';


interface SyncContextType {
    startInvokeSync: (options?: any) => Promise<void>;
    cancelSync: () => void;
    syncStatus: 'idle' | 'syncing' | 'complete' | 'error';
    syncState: {
        status: 'idle' | 'syncing' | 'complete' | 'error';
        progress: { current: number; total: number; message?: string };
    };
    isLiveSyncing: boolean;
    setIsLiveSyncing: (val: boolean) => void;
    cleanLibrary: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export const SyncProvider: React.FC<{ children: ReactNode; onSyncComplete?: () => void }> = ({ children, onSyncComplete }) => {
    const { settings, settingsRef, setSettings } = useSettings();
    const { setCollections } = useCollections();
    const { addToast } = useToast();
    const queryClient = useQueryClient();

    // Zustand State
    const syncStatus = useLibraryStore(s => s.syncStatus);
    const setSyncStatus = useLibraryStore(s => s.setSyncStatus);
    // syncProgress is used internally in startInvokeSync but not exposed in Context
    const syncProgress = useLibraryStore(s => s.syncProgress);
    const setSyncProgress = useLibraryStore(s => s.setSyncProgress);
    const isLiveSyncing = useLibraryStore(s => s.isLiveSyncing);
    const setIsLiveSyncing = useLibraryStore(s => s.setIsLiveSyncing);
    const setSyncAbortController = useLibraryStore(s => s.setSyncAbortController);
    const cancelSyncAction = useLibraryStore(s => s.cancelSync);

    const isLiveSyncingRef = useRef(false);

    const startInvokeSync = useCallback(async (optionsInput?: any) => {
        const options = {
            syncFavorites: true,
            syncBoards: true,
            starredAs: settingsRef.current.starredAs || 'favorite',
            mode: 'manual' as const,
            ...optionsInput
        };

        if (syncStatus === 'syncing' && options.mode === 'manual') return;
        if ((syncStatus === 'syncing' || isLiveSyncingRef.current) && options.mode === 'live') {
            return;
        }

        if (options.mode === 'live') {
            isLiveSyncingRef.current = true;
            setIsLiveSyncing(true);
        } else {
            setSyncStatus('syncing');
        }
        setSyncProgress({ current: 0, total: 0, message: 'Preparing...' });

        const ctrl = new AbortController();
        setSyncAbortController(ctrl);

        try {
            const { syncImages } = await import('../services/invoke/syncService');
            const { scanForOrphans } = await import('../services/invoke/orphanScanner');

            const effectiveTimestamp = options.afterTimestamp !== undefined ? options.afterTimestamp : settingsRef.current.lastSyncedAt;

            const { imported, updated, maxTimestamp: newTs, boardMapping, syncedIds } = await syncImages(
                settingsRef.current.invokeAiPath!,
                (c, t, msg) => setSyncProgress({ current: c, total: t, message: msg }),
                ctrl.signal,
                {
                    syncFavorites: options.syncFavorites,
                    syncBoards: options.syncBoards,
                    afterTimestamp: effectiveTimestamp,
                    importIntermediates: options.importIntermediates !== undefined ? options.importIntermediates : settingsRef.current.importIntermediates,
                    starredAs: options.starredAs
                }
            );

            // Sync Boards to Collections
            if (settingsRef.current.syncBoardsToCollections && boardMapping && boardMapping.size > 0) {
                setSyncProgress({ ...useLibraryStore.getState().syncProgress, message: 'Synchronizing boards...' });
                // Note: setCollections is still from CollectionContext (Phase 3)
                setCollections(prev => {
                    const next = [...prev];
                    let changed = false;
                    boardMapping.forEach((data, id) => {
                        const { name, createdAt } = data;
                        const existing = next.find(c => c.id === id);
                        if (!existing) {
                            next.push({
                                id: id,
                                name: name,
                                imageIds: [],
                                count: 0,
                                createdAt: createdAt || Date.now()
                            });
                            changed = true;
                        } else if (existing.name !== name) {
                            const idx = next.indexOf(existing);
                            next[idx] = { ...existing, name };
                            changed = true;
                        }
                    });
                    return changed ? next : prev;
                });
            }

            // Orphan scanning
            let orphansImported = 0;
            const shouldImportOrphans = options.importOrphans !== undefined ? options.importOrphans : settingsRef.current.importOrphans;

            if (options.mode === 'manual' && shouldImportOrphans !== false) {
                orphansImported = await scanForOrphans(
                    settingsRef.current.invokeAiPath!,
                    syncedIds,
                    (phase, current, total) => {
                        setSyncProgress({ current, total, message: phase });
                    },
                    { importIntermediates: settingsRef.current.importIntermediates }
                );
            }

            setSyncStatus('complete');
            const totalProcessed = (imported || 0) + (updated || 0) + orphansImported;
            // Conditional Facet Rebuild
            const hasChanges = (imported || 0) > 0 || (updated || 0) > 0 || orphansImported > 0;

            if (hasChanges) {
                setSyncProgress({ current: totalProcessed, total: totalProcessed, message: 'Rebuilding filter cache...' });
                try {
                    const { rebuildFacetCache } = await import('../services/db/imageRepo');
                    await rebuildFacetCache();
                    // Increment version to trigger React Query refetch in useLibraryStatsQuery
                    useLibraryStore.getState().incrementFacetCacheVersion();
                    setSyncProgress({ ...useLibraryStore.getState().syncProgress, message: undefined });
                } catch (e) {
                    console.error('[Sync] Failed to rebuild facet cache after sync', e);
                }
            } else {
                console.log('[Sync] No changes detected, skipping facet cache rebuild.');
            }

            // Always update timestamp on success to advance the cursor (crucial for Live Sync efficiency)
            if (newTs) {
                setSettings(prev => ({ ...prev, lastSyncedAt: newTs }));
            }

            if (onSyncComplete) onSyncComplete();

            if (totalProcessed > 0 && options.mode === 'manual') {
                addToast(`Synchronization complete: ${totalProcessed} items processed.`, 'success');
            } else if (totalProcessed === 0 && options.mode === 'manual') {
                addToast('Synchronization complete: No new changes.', 'info');
            }

        } catch (e: any) {
            if (e.message === 'Aborted') setSyncStatus('idle');
            else {
                console.error('Sync failed', e);
                setSyncStatus('error');
                if (options.mode === 'manual') addToast('Sync failed: ' + e.message, 'error');
            }
        } finally {
            setSyncAbortController(null);
            if (options.mode === 'live') {
                isLiveSyncingRef.current = false;
                setIsLiveSyncing(false);
            }
        }
    }, [syncStatus, addToast, onSyncComplete, setSettings, setCollections, setSyncStatus, setSyncProgress, setIsLiveSyncing]);

    const cancelSync = useCallback(() => {
        cancelSyncAction();
    }, [cancelSyncAction]);

    const cleanLibrary = useCallback(async () => {
        try {
            console.log('[Purge] Starting library purge...');
            const { purgeLibrary } = await import('../services/db/imageRepo');
            const { appRepository } = await import('../services/repository');
            const { watcherService } = await import('../services/WatcherService');

            // 1. Graceful Shutdown & Auto-Healing Disable
            console.log('[Purge] Stopping background services...');
            setSettings(s => ({ ...s, enableAutoThumbnailHealing: false })); // Disable first to stop CPU usage

            await watcherService.stopWatching();
            useLibraryStore.getState().cancelThumbnailRegeneration();
            useLibraryStore.getState().cancelImport();
            useLibraryStore.getState().setBackgroundHealingPaused(true);

            // 2. Prepare Clean State (Settings & Legacy Data)
            console.log('[Purge] Resetting settings and legacy storage...');

            const legacyState = await appRepository.load();

            // Define clean settings
            const cleanSettings = {
                ...legacyState.settings,
                lastSyncedAt: null,
                monitoredFolders: [],
                invokeAiPath: undefined,
                a1111Path: undefined,
                comfyUiPath: undefined,
                resourceFolders: [], // Clear added model/lora folders
                importIntermediates: false,
                enableAutoThumbnailHealing: true, // Reset to default (True) so next run is fresh
                hasCompletedOnboarding: false // Optional: Reset onboarding for factory reset feel
            };

            // Force immediate save to disk BEFORE invoking the backend restart
            await appRepository.save({
                ...legacyState,
                images: [],
                collections: [],
                smartCollections: [],
                settings: cleanSettings
            });

            // Update local state (for Dev mode or if restart has delay)
            setSettings(cleanSettings);

            // 3. Reset React Query cache and Zustand store
            console.log('[Purge] Clearing React Query cache and store...');
            await queryClient.resetQueries();
            useSearchStore.getState().clearAllFilters();
            useSearchStore.getState().setImages([]);

            // 4. THE POINT OF NO RETURN: Trigger Backend Purge (Restarts App)
            console.log('[Purge] Purging backend database...');
            const backendMessage = await purgeLibrary();

            // Show the backend's message (e.g., "Purge scheduled. Please restart...")
            addToast(backendMessage, 'success');
            console.log('[Purge] Purge complete. User should restart the app.');

            // Note: In production, the app auto-restarts. In dev mode, user must restart terminal.
        } catch (e: any) {
            console.error("[Purge] Purge failed:", e);
            addToast('Purge failed: ' + e.message, 'error');
        }
    }, [addToast, setSettings, queryClient]);

    return (
        <SyncContext.Provider value={{
            startInvokeSync,
            cancelSync,
            syncStatus,
            syncState: { status: syncStatus, progress: syncProgress },
            isLiveSyncing,
            setIsLiveSyncing,
            cleanLibrary
        }}>
            {children}
        </SyncContext.Provider>
    );
};

export const useSync = () => {
    const context = useContext(SyncContext);
    if (!context) throw new Error('useSync must be used within SyncProvider');
    return context;
};
