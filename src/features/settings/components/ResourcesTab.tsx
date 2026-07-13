import * as React from 'react';
import { CheckCircle2, FolderSearch, Info, RefreshCw, X } from 'lucide-react';
import { AppSettings } from '../../../types';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { ResourceDiscoverySection } from './ResourceDiscoverySection';
import { useResourcesTabLogic } from '../hooks/useResourcesTabLogic';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const ResourcesTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const {
        resourceFolders,
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
        cancelResolveConfirmation,
    } = useResourcesTabLogic({ settings, setSettings });

    return (
        <div className="space-y-8 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <ResourceDiscoverySection
                resourceFolders={resourceFolders}
                isScanning={isScanningDiscovery}
                scanProgress={discoveryScanProgress ?? undefined}
                isPopulatingThumbnails={isPopulatingThumbnails}
                removingResourcePath={removingResourcePath}
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
                                type="button"
                                aria-label="Cancel Online Model Resolution"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void cancelResolveOnline();
                                }}
                                className="text-blue-600 hover:text-blue-700 transition-colors"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={requestResolveOnline}
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
                isOpen={isResolveConfirmOpen}
                onCancel={cancelResolveConfirmation}
                onConfirm={confirmResolveOnline}
                title="Resolve Online?"
                message="Search CivitAI for metadata for unresolved model hashes? This sends hash strings to CivitAI, not image files. It requires internet access and may take some time."
                confirmLabel="Resolve Online"
            />
        </div>
    );
});
