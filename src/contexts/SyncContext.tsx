import * as React from 'react';
import { createContext, useState, useContext, useCallback, useRef, ReactNode } from 'react';
import { useSettings } from './SettingsContext';
import { useCollections } from './CollectionContext';
import { useToast } from '../hooks/useToast';

interface SyncContextType {
    syncStatus: 'idle' | 'syncing' | 'complete' | 'error';
    syncProgress: { current: number; total: number; message?: string };
    startInvokeSync: (options?: any) => Promise<void>;
    cancelSync: () => void;
    cleanLibrary: () => Promise<void>;
    isLiveSyncing: boolean;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export const SyncProvider: React.FC<{ children: ReactNode; onSyncComplete?: () => void }> = ({ children, onSyncComplete }) => {
    const { settings, settingsRef, setSettings } = useSettings();
    const { setCollections } = useCollections();
    const { addToast } = useToast();

    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'complete' | 'error'>('idle');
    const [syncProgress, setSyncProgress] = useState<{ current: number; total: number; message?: string }>({ current: 0, total: 0, message: '' });
    const [isLiveSyncing, setIsLiveSyncing] = useState(false);

    const abortControllerRef = useRef<AbortController | null>(null);
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

        abortControllerRef.current = new AbortController();

        try {
            const { syncImages } = await import('../services/invoke/syncService');
            const { scanForOrphans } = await import('../services/invoke/orphanScanner');

            const effectiveTimestamp = options.afterTimestamp !== undefined ? options.afterTimestamp : settingsRef.current.lastSyncedAt;

            const { imported, updated, maxTimestamp: newTs, boardMapping, syncedIds } = await syncImages(
                settingsRef.current.invokeAiPath!,
                (c, t, msg) => setSyncProgress({ current: c, total: t, message: msg }),
                abortControllerRef.current.signal,
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
                setSyncProgress(prev => ({ ...prev, message: 'Synchronizing boards...' }));
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
            if (options.mode === 'manual' && settingsRef.current.importOrphans !== false) {
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
            setSyncProgress({ current: totalProcessed, total: totalProcessed });

            if (options.mode === 'manual' && newTs) {
                setSettings(prev => ({ ...prev, lastSyncedAt: newTs }));
            }

            if (onSyncComplete) onSyncComplete();

        } catch (e: any) {
            if (e.message === 'Aborted') setSyncStatus('idle');
            else {
                console.error('Sync failed', e);
                setSyncStatus('error');
                if (options.mode === 'manual') addToast('Sync failed: ' + e.message, 'error');
            }
        } finally {
            abortControllerRef.current = null;
            if (options.mode === 'live') {
                isLiveSyncingRef.current = false;
                setIsLiveSyncing(false);
            }
        }
    }, [syncStatus, addToast, onSyncComplete, setSettings, setCollections]);

    const cancelSync = useCallback(() => {
        abortControllerRef.current?.abort();
    }, []);

    const cleanLibrary = useCallback(async () => {
        try {
            console.log('[Purge] Starting library purge...');
            const { purgeLibrary } = await import('../services/db/imageRepo');
            const { appRepository } = await import('../services/repository');

            console.log('[Purge] Purging main library, FTS index, and all collections...');
            await purgeLibrary();

            console.log('[Purge] Clearing legacy storage file...');
            const legacyState = await appRepository.load();
            await appRepository.save({
                ...legacyState,
                images: [],
                collections: [],
                smartCollections: []
            });

            console.log('[Purge] Resetting settings...');
            setSettings(prev => ({ ...prev, lastSyncedAt: null }));

            addToast('Library purged successfully', 'success');
            console.log('[Purge] Purge complete. Reloading window...');

            setTimeout(() => {
                window.location.reload();
            }, 1500);
        } catch (e: any) {
            console.error("[Purge] Purge failed:", e);
            addToast('Purge failed: ' + e.message, 'error');
        }
    }, [addToast, setSettings]);

    return (
        <SyncContext.Provider value={{
            syncStatus,
            syncProgress,
            startInvokeSync,
            cancelSync,
            cleanLibrary,
            isLiveSyncing
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
