import * as React from 'react';
import { useCallback } from 'react';
import { Monitor, RefreshCcw } from 'lucide-react';
import { AppSettings, GeneratorTool } from '../../../types';
import { useFoldersTabLogic } from '../hooks/useFoldersTabLogic';
import { FolderItem } from './FolderItem';
import { AddFolderForm } from './AddFolderForm';
import { useMetadataRefresh } from '../../../hooks/useMetadataRefresh';
import type { ImportResult } from '../../../services/importService';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<ImportResult | void>;
    onInvokeSync?: () => Promise<void>;
}

export const FoldersTab: React.FC<TabProps> = React.memo(({
    settings,
    setSettings,
    onScanFolder,
    onInvokeSync
}) => {
    const {
        newFolderPath, setNewFolderPath,
        scanningIds,
        combinedFolders,
        fileInputRef,
        handleRescan,
        handleAddFolder,
        removeFolder,
        handleBrowse,
    } = useFoldersTabLogic({ settings, setSettings, onScanFolder, onInvokeSync });

    const { forceRefresh } = useMetadataRefresh();

    // Route refresh to the correct handler based on integration type.
    // InvokeAI folders re-sync from their database; all others re-parse stored PNG chunks.
    const handleRefresh = useCallback((path: string, force: boolean, variant?: GeneratorTool, isManaged?: boolean) => {
        if (isManaged && variant === GeneratorTool.INVOKEAI) {
            const folder = combinedFolders.find((f) => (f.isManaged ? f.pathRaw : f.path) === path);
            if (folder) {
                handleRescan(folder.id, path, variant, true);
            }
            return;
        }
        forceRefresh(path, force);
    }, [combinedFolders, handleRescan, forceRefresh]);

    const handleRefreshAll = useCallback(async () => {
        // 1. If we have a managed InvokeAI integration, sync it first
        const managedInvoke = combinedFolders.find((f) => f.isManaged && f.variant === GeneratorTool.INVOKEAI);
        if (managedInvoke) {
            console.log('[FoldersTab] Syncing managed InvokeAI database for Refresh All');
            await handleRescan(managedInvoke.id, managedInvoke.pathRaw ?? managedInvoke.path, GeneratorTool.INVOKEAI, true);
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

        </div>
    );
});
