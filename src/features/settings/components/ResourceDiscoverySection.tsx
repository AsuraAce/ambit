import * as React from 'react';
import { AlertTriangle, Folder, FolderSearch, RefreshCw, Trash2, Plus } from 'lucide-react';
import { APP_NAME } from '../../../constants/app';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

interface ResourceDiscoverySectionProps {
    resourceFolders: string[];
    isScanning: boolean;
    scanProgress?: { message?: string };
    isPopulatingThumbnails: boolean;
    removingResourcePath: string | null;
    newResourcePath: string;
    setNewResourcePath: (val: string) => void;
    onBrowse: () => void;
    onAdd: (e: React.FormEvent) => void;
    onRemove: (path: string) => void | Promise<void>;
    onScanNow: () => void;
}

const isBroadModelsPath = (path: string): boolean => {
    const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
    return normalized.split('/').pop() === 'models';
};

export const ResourceDiscoverySection: React.FC<ResourceDiscoverySectionProps> = ({
    resourceFolders,
    isScanning,
    scanProgress,
    isPopulatingThumbnails,
    removingResourcePath,
    newResourcePath,
    setNewResourcePath,
    onBrowse,
    onAdd,
    onRemove,
    onScanNow
}) => {
    const showBroadPathWarning = isBroadModelsPath(newResourcePath);
    const hasConfiguredBroadPath = resourceFolders.some(isBroadModelsPath);
    const isDiscoveryBusy = isScanning || isPopulatingThumbnails || removingResourcePath !== null;

    return (
        <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-white/5">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-harbor-200 bg-harbor-50 p-4 text-sm text-harbor-600 dark:border-harbor-400/30 dark:bg-harbor-500/15 dark:text-harbor-300">
                <div className="flex items-start gap-3">
                    <FolderSearch className="w-5 h-5 flex-shrink-0 mt-0.5" />
                    <div>
                        <strong className="block mb-1">Resource Discovery</strong>
                        Add your model and resource folders here. {APP_NAME} will scan local assets and sidecar previews (<span className="font-mono text-xs">.jpg, .png, .webp</span>).
                    </div>
                </div>
                <div className="flex gap-2">
                    {resourceFolders.length > 0 && (
                        <div className="flex flex-col items-end gap-2">
                            {isScanning && scanProgress?.message && (
                                <span className="max-w-[200px] truncate text-[10px] font-medium text-harbor-600 animate-pulse dark:text-harbor-300">
                                    {scanProgress.message}
                                </span>
                            )}
                            <button
                                type="button"
                                onClick={onScanNow}
                                disabled={isDiscoveryBusy}
                                className={`flex items-center gap-2 rounded-lg bg-sage-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sage-500 disabled:bg-gray-300 disabled:text-gray-500 dark:disabled:bg-white/10 ${isDiscoveryBusy ? 'cursor-wait opacity-70' : ''}`}
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                                {isScanning ? 'Scanning...' : 'Scan Now'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden shadow-sm">
                <div className="p-2 space-y-1">
                    {resourceFolders.map((path, idx) => {
                        const isRemoving = removingResourcePath === path;
                        const isBroadPath = isBroadModelsPath(path);

                        return (
                            <div key={idx} className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 group transition-colors">
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <div className="p-2 bg-gray-100 dark:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400">
                                        <Folder className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm text-gray-700 dark:text-gray-300 font-mono truncate">{path}</span>
                                    {isBroadPath && (
                                        <span
                                            className="flex-shrink-0 text-ember-600 dark:text-ember-300"
                                            role="img"
                                            aria-label={`Broad models root ${path}`}
                                            title="Broad models root; prefer specific resource folders"
                                        >
                                            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                                        </span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onRemove(path)}
                                    disabled={isDiscoveryBusy}
                                    aria-label={`${isRemoving ? 'Removing' : 'Remove'} resource folder ${path}`}
                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                                >
                                    {isRemoving
                                        ? <RefreshCw className="h-4 w-4 animate-spin" />
                                        : <Trash2 className="w-4 h-4" />}
                                </button>
                            </div>
                        );
                    })}
                    {resourceFolders.length === 0 && (
                        <div className="text-sm text-gray-400 text-center py-8 italic">No resource folders added.</div>
                    )}
                    {hasConfiguredBroadPath && (
                        <div className="mx-2 mb-2 flex items-start gap-2 rounded-lg border border-ember-200 bg-ember-50 px-3 py-2 text-xs text-ember-600 dark:border-ember-500/30 dark:bg-ember-500/10 dark:text-ember-300">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            <span>
                                A configured models root may include false positives. Remove it and add specific folders such as <span className="font-mono">models/Lora</span> or <span className="font-mono">models/checkpoints</span>.
                            </span>
                        </div>
                    )}
                </div>
                <div className="border-t border-gray-200 dark:border-white/5 p-4 bg-gray-50/50 dark:bg-black/20">
                    <form onSubmit={onAdd} className="flex gap-2">
                        <input
                            type="text"
                            value={newResourcePath}
                            onChange={(e) => setNewResourcePath(e.target.value)}
                            disabled={isDiscoveryBusy}
                            placeholder="e.g. D:/StableDiffusion/models/Lora"
                            className="flex-1 bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:border-sage-500 outline-none text-gray-900 dark:text-white placeholder-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <TooltipButton
                            label="Browse for resource folder"
                            content="Browse for resource folder"
                            onClick={onBrowse}
                            disabled={isDiscoveryBusy}
                            className="px-3 py-2 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-white/20 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <FolderSearch className="w-4 h-4" />
                        </TooltipButton>
                        <button
                            type="submit"
                            disabled={!newResourcePath.trim() || isDiscoveryBusy}
                            className="flex items-center gap-1 rounded-lg bg-sage-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sage-500 disabled:bg-gray-300 disabled:text-gray-500"
                        >
                            {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            {isScanning ? 'Scanning...' : 'Add Path'}
                        </button>
                    </form>
                    {showBroadPathWarning && (
                        <div className="mt-3 flex items-start gap-2 rounded-lg border border-ember-200 bg-ember-50 px-3 py-2 text-xs text-ember-600 dark:border-ember-500/30 dark:bg-ember-500/10 dark:text-ember-300">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                            <span>
                                This looks like a broad models root. Prefer specific folders such as <span className="font-mono">models/Lora</span> or <span className="font-mono">models/checkpoints</span> to avoid false positives.
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
