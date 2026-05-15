import * as React from 'react';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Monitor, RefreshCcw, FolderSearch, RefreshCw, X, CheckCircle2, Info } from 'lucide-react';
import { commands } from '../../../bindings';
import { AppSettings, GeneratorTool } from '../../../types';
import { useFoldersTabLogic } from '../hooks/useFoldersTabLogic';
import { FolderItem } from './FolderItem';
import { AddFolderForm } from './AddFolderForm';
import { ResourceDiscoverySection } from './ResourceDiscoverySection';
import { useMetadataRefresh } from '../../../hooks/useMetadataRefresh';
import { useLibraryContext } from '../../../contexts/LibraryContext';
import { useToast } from '../../../hooks/useToast';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useLibraryStore } from '../../../stores/libraryStore';
import { unwrap } from '../../../utils/spectaUtils';
import { formatHashResolutionMessage, isHashResolutionPartial } from '../utils/hashResolution';
import type { ImportResult } from '../../../services/importService';
import { rebuildFacetCacheIncremental } from '../../../services/db/imageRepo';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<ImportResult | void>;
    onInvokeSync?: () => Promise<void>;
}

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

export const FoldersTab: React.FC<TabProps> = React.memo(({
    settings,
    setSettings,
    onScanFolder,
    onInvokeSync
}) => {
    const {
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
    } = useFoldersTabLogic({ settings, setSettings, onScanFolder, onInvokeSync });

    const {
        isResolvingModels: isResolving,
        setIsResolvingModels: setIsResolving,
        modelResolutionProgress: resolutionProgress,
        setModelResolutionProgress: setResolutionProgress,
        lastModelResolutionResult: resolutionResult,
        setLastModelResolutionResult: setResolutionResult
    } = useLibraryContext() as any;

    const { addToast } = useToast();
    const queryClient = useQueryClient();
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
    const [confirmState, setConfirmState] = React.useState({
        isOpen: false,
        title: '',
        message: '',
        confirmLabel: '',
        onConfirm: () => { }
    });

    const { forceRefresh } = useMetadataRefresh();
    const resolutionProgressPercent = resolutionProgress && resolutionProgress.total > 0
        ? Math.min(100, Math.max(0, Math.round((resolutionProgress.current / resolutionProgress.total) * 100)))
        : 0;

    // Route refresh to the correct handler based on integration type.
    // InvokeAI folders re-sync from their database; all others re-parse stored PNG chunks.
    const handleRefresh = useCallback((path: string, force: boolean, variant?: GeneratorTool, isManaged?: boolean) => {
        if (isManaged && variant === GeneratorTool.INVOKEAI) {
            const folder = combinedFolders.find((f: any) => (f.isManaged ? f.pathRaw : f.path) === path);
            if (folder) {
                handleRescan(folder.id, path, variant, true);
            }
            return;
        }
        forceRefresh(path, force);
    }, [combinedFolders, handleRescan, forceRefresh]);

    const handleRefreshAll = useCallback(async () => {
        // 1. If we have a managed InvokeAI integration, sync it first
        const managedInvoke = (combinedFolders as any[]).find((f) => f.isManaged && f.variant === GeneratorTool.INVOKEAI);
        if (managedInvoke) {
            console.log('[FoldersTab] Syncing managed InvokeAI database for Refresh All');
            await handleRescan(managedInvoke.id, managedInvoke.pathRaw, GeneratorTool.INVOKEAI, true);
        }

        // 2. Trigger the global reparse job
        console.log('[FoldersTab] Triggering global metadata reparse');
        forceRefresh(undefined, false); // No path = all, force = false (version-gated)
    }, [combinedFolders, handleRescan, forceRefresh]);

    return (
        <div className="space-y-8 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* 1. Image Monitoring Section */}
            <div className="space-y-4">
                <div className="p-4 bg-sage-50 dark:bg-sage-500/10 border border-sage-200 dark:border-sage-500/20 rounded-xl text-sm text-sage-800 dark:text-sage-200 flex items-start gap-3">
                    <Monitor className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                        <strong className="block mb-1">Image Folders</strong>
                        Add folders containing AI-generated images. Use this for <span className="font-semibold">archived images</span> or specific output directories.
                    </div>
                </div>

                <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden shadow-sm">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-white/[0.02]">
                        <div className="flex items-center gap-2.5">
                            <Monitor className="w-4 h-4 text-sage-600 dark:text-sage-400" />
                            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 tracking-tight">Monitored Folders</h3>
                        </div>
                        <button
                            type="button"
                            onClick={handleRefreshAll}
                            className="group flex items-center gap-2 px-3.5 py-1.5 bg-white dark:bg-white/5 border border-sage-200 dark:border-sage-500/30 hover:border-sage-500 dark:hover:border-sage-400 text-sage-600 dark:text-sage-400 text-[11px] font-bold uppercase tracking-wider rounded-lg transition-all shadow-sm hover:shadow-sage-500/10"
                        >
                            <RefreshCcw className="w-3.5 h-3.5 transition-transform group-hover:rotate-180 duration-500" />
                            Refresh All Metadata
                        </button>
                    </div>
                    <div className="p-2 space-y-1">
                        {combinedFolders.map(folder => (
                            <FolderItem
                                key={folder.id}
                                folder={folder}
                                scanningIds={scanningIds}
                                onRescan={handleRescan}
                                onRemove={removeFolder}
                                onRefresh={handleRefresh}
                            />
                        ))}
                        {combinedFolders.length === 0 && (
                            <div className="text-sm text-gray-400 text-center py-8 italic">No image folders monitored.</div>
                        )}
                    </div>
                    <div className="border-t border-gray-200 dark:border-white/5 p-4 bg-gray-50/50 dark:bg-black/20">
                        <AddFolderForm
                            value={newFolderPath}
                            onChange={setNewFolderPath}
                            onBrowse={handleBrowse}
                            onSubmit={handleAddFolder}
                        />
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            // @ts-ignore
                            webkitdirectory=""
                            directory=""
                        />
                    </div>
                </div>
            </div>

            {/* 2. Resource Discovery Section */}
            <>
                <ResourceDiscoverySection
                    resourceFolders={settings.resourceFolders || []}
                    isScanning={isScanningDiscovery}
                    scanProgress={discoveryScanProgress ?? undefined}
                    isPopulatingThumbnails={isPopulatingThumbnails}
                    newResourcePath={newResourcePath}
                    setNewResourcePath={setNewResourcePath}
                    onBrowse={handleBrowseResource}
                    onAdd={handleAddResourceFolder}
                    onRemove={handleRemoveResourceFolder}
                    onScanNow={handleScanNow}
                />
                <input
                    type="file"
                    ref={resourceInputRef}
                    className="hidden"
                    // @ts-ignore
                    webkitdirectory=""
                    directory=""
                />
            </>

            {/* 3. Model Hash Resolution */}
            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg">
                            <FolderSearch className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">Online Model Hash Resolution</h4>
                            <p className="text-xs text-gray-500">Optional CivitAI lookup for unresolved model hashes</p>
                        </div>
                    </div>
                    {isResolving ? (
                        <div className="flex items-center gap-3 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                            <RefreshCw className="w-3.5 h-3.5 text-blue-600 animate-spin" />
                            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Resolving...</span>
                            <div className="w-[1px] h-3 bg-blue-500/30" />
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    await commands.cancelModelResolution().catch(console.error);
                                }}
                                className="text-blue-600 hover:text-blue-700 transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => {
                                if (isHashResolutionBlocked) {
                                    addToast("Wait for the current library task to finish before resolving hashes", "warning");
                                    return;
                                }

                                setConfirmState({
                                    isOpen: true,
                                    title: "Resolve Online?",
                                    message: "Search CivitAI for metadata for unresolved model hashes? This sends hash strings to CivitAI, not image files. It requires internet access and may take some time.",
                                    confirmLabel: "Resolve Online",
                                    onConfirm: async () => {
                                        setConfirmState(prev => ({ ...prev, isOpen: false }));
                                        if (isLibraryBusyForHashResolution()) {
                                            setResolutionResult({
                                                success: false,
                                                message: "Resolution paused: wait for the current sync, import, scan, or cache rebuild to finish, then run it again."
                                            });
                                            addToast("Hash resolution is paused while the library is busy", "warning");
                                            return;
                                        }

                                        setIsResolving(true);
                                        setResolutionProgress({
                                            current: 0,
                                            total: 100,
                                            message: "Starting hash resolution..."
                                        });
                                        setResolutionResult(null);
                                        addToast("Resolving unknown hashes...", "info");

                                        try {
                                            const res = await unwrap(commands.resolveHashesOnline(false));
                                            const isPartial = isHashResolutionPartial(res);
                                            let message = formatHashResolutionMessage(res);
                                            let refreshFailed = false;

                                            setResolutionProgress({
                                                current: 95,
                                                total: 100,
                                                message: "Refreshing checkpoint filters..."
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
                                                addToast("Lookup finished, but the UI refresh needs another pass", "warning");
                                            }

                                            setResolutionResult({
                                                success: !isPartial,
                                                message
                                            });

                                            if (!refreshFailed) {
                                                if (isPartial) {
                                                    addToast(`Lookup finished with ${res.failedCount} failed and ${res.unknownCount} unknown`, "warning");
                                                } else {
                                                    addToast(`Lookup finished: ${res.resolvedCount} verified online`, "success");
                                                }
                                            }
                                        } catch (e: unknown) {
                                            const errorMessage = e instanceof Error ? e.message : String(e);
                                            if (errorMessage.toLowerCase().includes("cancelled")) {
                                                addToast("Resolution cancelled", "info");
                                            } else {
                                                console.error(e);
                                                setResolutionResult({ success: false, message: `Lookup failed: ${errorMessage}` });
                                                addToast("Lookup failed", "error");
                                            }
                                        } finally {
                                            setIsResolving(false);
                                            setResolutionProgress(null);
                                        }
                                    }
                                });
                            }}
                            disabled={isHashResolutionBlocked}
                            title={isHashResolutionBlocked ? 'Wait for the current library task to finish' : undefined}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-300 dark:disabled:bg-white/10 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all shadow-lg shadow-blue-500/20 disabled:shadow-none"
                        >
                            {isHashResolutionBlocked ? 'Library Busy' : 'Resolve Online'}
                        </button>
                    )}
                </div>

                {isResolving && resolutionProgress && (
                    <div className="mb-6 space-y-2">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-blue-600/60">
                            <span>{resolutionProgress.message}</span>
                            <span>{resolutionProgressPercent} %</span>
                        </div>
                        <div className="h-1.5 w-full bg-blue-500/10 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-500 transition-all duration-300"
                                style={{ width: `${resolutionProgressPercent}%` }}
                            />
                        </div>
                    </div>
                )}

                {resolutionResult && (
                    <div className={`p-4 rounded-xl flex items-start gap-3 border ${resolutionResult.success
                        ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400'
                        }`}>
                        {resolutionResult.success ? <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" /> : <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />}
                        <div className="min-w-0">
                            <span className="block text-[10px] font-black uppercase tracking-widest opacity-60 mb-0.5">
                                {resolutionResult.success ? 'Success' : 'Resolution Partial'}
                            </span>
                            <p className="text-sm font-medium leading-relaxed">{resolutionResult.message}</p>
                        </div>
                    </div>
                )}
            </section>

            <ConfirmDialog
                isOpen={confirmState.isOpen}
                onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmState.onConfirm}
                title={confirmState.title}
                message={confirmState.message}
                confirmLabel={confirmState.confirmLabel}
            />
        </div>
    );
});
