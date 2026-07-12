import * as React from 'react';
import { useState } from 'react';
import { Palette, Folder, Info, FolderSearch, Loader2, CheckCircle2, XCircle, Plus, ChevronDown, FolderOpen } from 'lucide-react';
import { GeneratorTool, type AppSettings, type MonitoredFolder } from '../../../types';
import { useLibraryContext } from '../../../hooks/useLibraryContext';
import { useSearch } from '../../../contexts/SearchContext'; // Added
import { A1111FolderType, type DiscoveryCandidate, WebUIVariant } from '../../../services/a1111/types';
import { useToast } from '../../../hooks/useToast';
import type { ImportResult } from '../../../services/importService';
import { isImportSourceCancelled, isImportSourceCompleted } from '../../../utils/importSourceStatus';
import { areDeveloperFeaturesEnabled } from '../../../utils/settingsUtils';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    onClose?: () => void;
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<ImportResult | void>;
}

const variantToGeneratorTool = (variant?: WebUIVariant): GeneratorTool | undefined => {
    switch (variant) {
        case WebUIVariant.FORGE:
            return GeneratorTool.FORGE;
        case WebUIVariant.SDNEXT:
            return GeneratorTool.SDNEXT;
        case WebUIVariant.ANAPNOE:
            return GeneratorTool.ANAPNOE;
        case WebUIVariant.A1111:
            return GeneratorTool.AUTOMATIC1111;
        default:
            return undefined;
    }
};

const variantToImportTool = (variant?: WebUIVariant): GeneratorTool =>
    variantToGeneratorTool(variant) ?? GeneratorTool.UNKNOWN;

export const A1111Tab: React.FC<TabProps> = React.memo(({ settings, setSettings, onScanFolder }) => {
    const {
        refreshCollections
    } = useLibraryContext();
    const { refreshMetadata } = useSearch(); // Added hook usage
    const { addToast } = useToast();
    const [localTestResult, setLocalTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
    const [scanLogs, setScanLogs] = useState<string[]>([]);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [showAllFolders, setShowAllFolders] = useState(false);
    const [forceVariant, setForceVariant] = useState<WebUIVariant | 'Auto'>('Auto');
    const developerFeaturesEnabled = areDeveloperFeaturesEnabled(settings);

    const handleDiscover = async () => {
        const rootPath = settings.a1111Path!;
        setIsDiscovering(true);
        setLocalTestResult(null);
        setScanLogs([]);
        try {
            const { discoverA1111Candidates, getUnlinkedPriorityCandidatePaths } = await import('../../../services/a1111/config');
            const existing = new Set(settings.monitoredFolders.map(f => f.path.replace(/\\/g, '/').toLowerCase()));
            const { candidates: results, logs, warnings } = await discoverA1111Candidates(rootPath, existing, forceVariant);

            setCandidates(results);
            setScanLogs(logs);

            // Auto-select priority folders that aren't linked yet
            setSelectedPaths(new Set(getUnlinkedPriorityCandidatePaths(results)));

            const priorityCount = results.filter(c => c.isPriority).length;
            setShowAllFolders(priorityCount === 0 && results.length > 0);

            if (warnings.length > 0) {
                const warningLabel = warnings.length === 1 ? 'warning' : 'warnings';
                const message = results.length === 0
                    ? `Discovery completed with ${warnings.length} ${warningLabel} and no importable folders. Review scan debug log.`
                    : `Discovery completed with ${warnings.length} ${warningLabel}. Review scan debug log.`;
                setLocalTestResult({ success: false, message });
            } else if (results.length === 0) {
                setLocalTestResult({ success: false, message: "No potential folders containing images found." });
            }
        } catch (e) {
            console.error(e);
            setCandidates([]);
            setSelectedPaths(new Set());
            setShowAllFolders(false);
            setLocalTestResult({ success: false, message: "Discovery failed. Check path permissions." });
        } finally {
            setIsDiscovering(false);
        }
    };

    const toggleSelection = (path: string) => {
        const next = new Set(selectedPaths);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        setSelectedPaths(next);
    };

    const handleLinkSelected = async () => {
        const toLink = candidates.filter(c => selectedPaths.has(c.path));
        if (!onScanFolder) {
            setLocalTestResult({ success: false, message: "Import service is unavailable." });
            addToast("Import service is unavailable", "error");
            return;
        }

        setIsDiscovering(true);
        let newFolderIds = new Set<string>();

        try {
            // 1. Prepare New Folders. Keep lastScanned empty until import succeeds.
            const brandNew = toLink.filter(c => !c.isAlreadyLinked);
            const alreadyLinked = toLink.filter(c => c.isAlreadyLinked);

            const now = Date.now();
            const newFolderObjects: MonitoredFolder[] = brandNew.map(c => ({
                id: `a1111_${c.inferredType}_${now}_${Math.random().toString(36).substr(2, 5)}`,
                path: c.path,
                isActive: true,
                imageCount: c.imageCount,
                variant: variantToGeneratorTool(c.variant),
                initialScanPending: true
            }));
            newFolderIds = new Set(newFolderObjects.map(folder => folder.id));

            // 2. Update Settings (UI will show them immediately)
            if (newFolderObjects.length > 0) {
                setSettings(prev => ({
                    ...prev,
                    monitoredFolders: [...prev.monitoredFolders, ...newFolderObjects]
                }));
            }

            // 3. Build Unified Task List
            const foldersToSync = [
                ...alreadyLinked.map(c => ({ path: c.path, variant: variantToImportTool(c.variant) })),
                ...newFolderObjects.map(f => ({ path: f.path, variant: f.variant }))
            ];

            // 4. Run Unified Import
            const result = await onScanFolder(foldersToSync);
                const completedAt = Date.now();
                const importCancelled = !!result && result.wasCancelled;
                const importCompleted = !!result && !result.wasCancelled && result.failedPaths.length === 0;
                const completedNewFolderCount = newFolderObjects.filter(folder =>
                    isImportSourceCompleted(result, folder.path)
                ).length;
                const cancelledNewFolderCount = newFolderObjects.filter(folder =>
                    isImportSourceCancelled(result, folder.path)
                ).length;
                const retryableNewFolderCount = Math.max(
                    0,
                    newFolderObjects.length - completedNewFolderCount - cancelledNewFolderCount
                );
                const unfinishedNewFolderCount = cancelledNewFolderCount + retryableNewFolderCount;

                if (newFolderIds.size > 0) {
                    setSettings(prev => ({
                        ...prev,
                        monitoredFolders: prev.monitoredFolders.map(folder =>
                            newFolderIds.has(folder.id)
                                ? {
                                    ...folder,
                                    lastScanned: isImportSourceCompleted(result, folder.path) ? completedAt : undefined,
                                    initialScanPending: false,
                                    initialScanCancelled: isImportSourceCancelled(result, folder.path)
                                }
                                : folder
                        )
                    }));
                }

                if (importCancelled) {
                    const msg = completedNewFolderCount > 0
                        ? `Import cancelled. ${completedNewFolderCount} folder(s) completed; ${unfinishedNewFolderCount} unfinished folder(s) were paused. Imported images were kept; rescan unfinished folders to continue.`
                        : "Import cancelled. Imported images were kept; unfinished folders were paused. Rescan to continue.";
                    setLocalTestResult({ success: false, message: msg });
                    return;
                }

                if (!result) {
                    setLocalTestResult({ success: false, message: "Import did not complete. Folder cursor was not advanced." });
                    return;
                }

                let refreshFailed = false;
                try {
                    await refreshCollections();
                    await refreshMetadata(); // Force full gallery refresh
                } catch (refreshError) {
                    refreshFailed = true;
                    console.error("Post-import refresh failed", refreshError);
                }

                const totalCount = foldersToSync.length;
                if (importCompleted) {
                    const msg = refreshFailed
                        ? `Processed ${totalCount} folders (${brandNew.length} new, ${alreadyLinked.length} rescanned), but refresh failed.`
                        : `Processed ${totalCount} folders (${brandNew.length} new, ${alreadyLinked.length} rescanned)`;
                    setLocalTestResult({ success: !refreshFailed, message: msg });
                } else {
                    const msg = `Processed ${totalCount} folders with ${result.failedPaths.length} failed file(s). Completed folders were marked scanned; folders with failures were left retryable.`;
                    setLocalTestResult({ success: false, message: msg });
                }
        } catch (e) {
            console.error("Link/Import failed", e);
            if (newFolderIds.size > 0) {
                setSettings(prev => ({
                    ...prev,
                    monitoredFolders: prev.monitoredFolders.map(folder =>
                        newFolderIds.has(folder.id)
                            ? { ...folder, lastScanned: undefined, initialScanPending: false, initialScanCancelled: false }
                            : folder
                    )
                }));
            }
            setLocalTestResult({ success: false, message: "Use Check Console for details" });
            addToast("Import failed", "error");
        } finally {
            setIsDiscovering(false);
            setCandidates([]); // Clear selection
        }
    };

    const displayedCandidates = showAllFolders
        ? candidates
        : candidates.filter(c => c.isPriority);

    const hiddenCount = candidates.length - displayedCandidates.length;

    return (
        <div className="space-y-8 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">

            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
                <h4 className="text-[10px] font-black text-white px-4 py-2 bg-sage-600 rounded-lg inline-flex items-center gap-3 mb-6 uppercase tracking-widest shadow-lg shadow-sage-500/20">
                    <Palette className="w-4 h-4" /> Core Configuration
                </h4>

                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="relative">
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 px-1">
                                Installation or Archive Path
                            </label>
                            <div className="flex gap-2">
                                <div className="flex-1 relative group">
                                    <input
                                        type="text"
                                        value={settings.a1111Path || ''}
                                        onChange={(e) => {
                                            const a1111Path = e.target.value;
                                            setSettings(prev => ({ ...prev, a1111Path }));
                                        }}
                                        placeholder="e.g. C:\\StableDiffusion or C:\\MyArchive"
                                        className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-sage-500 focus:ring-1 focus:ring-sage-500/50 outline-none text-gray-900 dark:text-white font-mono transition-all"
                                    />
                                    <Folder className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-sage-500 transition-colors" />
                                </div>
                                <button
                                    type="button"
                                    title="Browse"
                                    onClick={async () => {
                                        try {
                                            const { open } = await import('@tauri-apps/plugin-dialog');
                                            const selected = await open({ directory: true, multiple: false, title: 'Select SD Folder' });
                                            if (selected && typeof selected === 'string') {
                                                const { normalizePath } = await import('../../../utils/pathUtils');
                                                setSettings(prev => ({ ...prev, a1111Path: normalizePath(selected) }));
                                            }
                                        } catch (e) { console.error(e); }
                                    }}
                                    className="aspect-square h-[42px] flex items-center justify-center bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-white/20 active:scale-95 transition-all"
                                >
                                    <FolderOpen className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        <div className="relative">
                            <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 px-1">
                                Installation Type
                            </label>
                            <div className="relative">
                                <select
                                    value={forceVariant}
                                    onChange={(e) => setForceVariant(e.target.value as WebUIVariant | 'Auto')}
                                    className="w-full bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm focus:border-sage-500 focus:ring-1 focus:ring-sage-500/50 outline-none text-gray-900 dark:text-white font-bold transition-all appearance-none"
                                >
                                    <option value="Auto">Auto-Detect (Recommended)</option>
                                    <option value={WebUIVariant.A1111}>SD WebUI (Generic / A1111)</option>
                                    <option value={WebUIVariant.FORGE}>Stable Diffusion Forge</option>
                                    <option value={WebUIVariant.SDNEXT}>SD.Next (Vladmandic)</option>
                                    <option value={WebUIVariant.ANAPNOE}>Anapnoe WebUI</option>
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                                    <ChevronDown className="w-4 h-4 text-gray-500" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <p className="text-[10px] text-gray-500 mt-3 flex items-center gap-1.5 opacity-80 px-1">
                        <Info className="w-3 h-3" /> Select the root of your SD installation (containing webui.py) or any archive folder.
                    </p>
                </div>

                <div className="pt-6 border-t border-black/5 dark:border-white/5 flex flex-col gap-6">
                    <div className="flex items-center justify-between">
                        <button
                            onClick={handleDiscover}
                            disabled={isDiscovering || !settings.a1111Path}
                            className={`px-8 py-3 rounded-xl text-sm font-black tracking-wide transition-all flex items-center gap-2.5 ${!settings.a1111Path
                                || isDiscovering
                                ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                                : 'bg-sage-600 hover:bg-sage-500 text-white shadow-xl shadow-sage-500/20 active:scale-95'
                                }`}
                        >
                            {isDiscovering ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Scanning...
                                </>
                            ) : (
                                <>
                                    <FolderSearch className="w-4 h-4" />
                                    {forceVariant === 'Auto' ? 'Scan for Folders' : `Scan as ${forceVariant}`}
                                </>
                            )}
                        </button>

                    </div>

                    {localTestResult && (
                        <div className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-bold ${localTestResult.success
                            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            }`}>
                            {localTestResult.success ? (
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                            ) : (
                                <XCircle className="h-4 w-4 shrink-0" />
                            )}
                            <span>{localTestResult.message}</span>
                        </div>
                    )}

                    {candidates.length > 0 && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                            <div className="flex items-center justify-between px-1">
                                <div className="flex flex-col gap-1">
                                    <h5 className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Discovery Results</h5>
                                    {!showAllFolders && hiddenCount > 0 && (
                                        <span className="text-[9px] text-gray-500 font-medium">Showing standard output folders ({displayedCandidates.length} of {candidates.length})</span>
                                    )}
                                    {candidates.some(c => c.variant && c.variant !== 'Unknown') ? (
                                        <span className="text-[10px] bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded-md font-bold mt-1 inline-block w-fit">
                                            Detected: {candidates.find(c => c.variant && c.variant !== 'Unknown')?.variant}
                                        </span>
                                    ) : (
                                        forceVariant === 'Auto' && (
                                            <span className="text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-500 px-2 py-0.5 rounded-md font-bold mt-1 inline-block w-fit flex items-center gap-1">
                                                <Info className="w-3 h-3" />
                                                Generic WebUI detected. Select specific Installation Type above for correct image tagging.
                                            </span>
                                        )
                                    )}
                                </div>
                                <div className="flex items-center gap-4">
                                    {candidates.some(c => !c.isPriority) ? (
                                        <label className="flex items-center gap-3 cursor-pointer group">
                                            <input
                                                type="checkbox"
                                                className="hidden"
                                                checked={showAllFolders}
                                                onChange={(e) => setShowAllFolders(e.target.checked)}
                                            />
                                            <span className="text-[10px] font-bold text-gray-500 group-hover:text-sage-600 transition-colors uppercase tracking-tight">Show non-standard folders</span>
                                            <div
                                                className={`w-8 h-4 rounded-full relative transition-colors ${showAllFolders ? 'bg-sage-500' : 'bg-gray-300 dark:bg-white/10'}`}
                                            >
                                                <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${showAllFolders ? 'left-[17px]' : 'left-0.5'}`} />
                                            </div>
                                        </label>
                                    ) : null}
                                    <span className="text-[10px] font-bold text-sage-600 bg-sage-500/10 px-2 py-0.5 rounded-full">{displayedCandidates.length} found</span>
                                </div>
                            </div>

                            <div className="border border-black/5 dark:border-white/10 rounded-2xl overflow-hidden bg-gray-50/50 dark:bg-black/20">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="border-b border-black/5 dark:border-white/5 bg-gray-100/50 dark:bg-white/5">
                                            <th className="px-4 py-3 text-[9px] font-black text-gray-400 uppercase tracking-widest w-10">Link</th>
                                            <th className="px-4 py-3 text-[9px] font-black text-gray-400 uppercase tracking-widest">Folder Name / Path</th>
                                            <th className="px-4 py-3 text-[9px] font-black text-gray-400 uppercase tracking-widest w-32">Type</th>
                                            <th className="px-4 py-3 text-[9px] font-black text-gray-400 uppercase tracking-widest w-24 text-right">Images</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-black/5 dark:divide-white/5">
                                        {displayedCandidates.map((c) => (
                                            <tr key={c.path} className={`group hover:bg-white/50 dark:hover:bg-white/[0.03] transition-colors ${c.isAlreadyLinked ? 'opacity-40 grayscale' : ''}`}>
                                                <td className="px-4 py-3">
                                                    <label className="flex items-center justify-center cursor-pointer">
                                                        <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative ${selectedPaths.has(c.path) ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                                                            {selectedPaths.has(c.path) && <div className="w-2 h-2 bg-white rounded-sm" />}
                                                            <input
                                                                type="checkbox"
                                                                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                                                                checked={selectedPaths.has(c.path)}
                                                                onChange={() => toggleSelection(c.path)}
                                                            />
                                                        </div>
                                                    </label>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                                            <Folder className="w-3.5 h-3.5 text-gray-400" />
                                                            {c.name}
                                                            {c.isAlreadyLinked && <span className="text-[8px] bg-gray-200 dark:bg-white/10 text-gray-500 px-1.5 py-0.5 rounded uppercase font-black">Linked</span>}
                                                        </span>
                                                        <span className="text-[10px] text-gray-500 font-mono truncate max-w-md opacity-60">
                                                            {c.path.replace(settings.a1111Path || '', '...')}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <select
                                                        value={c.inferredType}
                                                        onChange={(e) => {
                                                            const newCandidates = candidates.map(cand =>
                                                                cand.path === c.path ? { ...cand, inferredType: e.target.value as A1111FolderType } : cand
                                                            );
                                                            setCandidates(newCandidates);
                                                        }}
                                                        className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-lg text-xs font-bold py-1 px-2 outline-none focus:ring-1 focus:ring-sage-500/30"
                                                    >
                                                        <option value="txt2img">txt2img</option>
                                                        <option value="img2img">img2img</option>
                                                        <option value="extras">Extras</option>
                                                        <option value="grid">Grids</option>
                                                        <option value="saved">Saved</option>
                                                        <option value="unknown">Unknown</option>
                                                    </select>
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <span className="text-xs font-bold text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                                                        {c.imageCount.toLocaleString()}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex justify-end pt-2">
                                <button
                                    onClick={handleLinkSelected}
                                    disabled={selectedPaths.size === 0}
                                    className={`px-8 py-2.5 rounded-xl text-sm font-black transition-all flex items-center gap-2.5 ${selectedPaths.size === 0
                                        ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                                        : 'bg-sage-600 hover:bg-sage-500 text-white shadow-xl shadow-sage-500/20 active:scale-95'
                                        }`}
                                >
                                    <Plus className="w-4 h-4" />
                                    {candidates.some(c => selectedPaths.has(c.path) && c.isAlreadyLinked)
                                        ? `Link/Sync ${selectedPaths.size} Folders`
                                        : `Link & Import ${selectedPaths.size} Folders`}
                                </button>
                            </div>

                        </div>
                    )}

                    {developerFeaturesEnabled && scanLogs.length > 0 && (
                        <div className="mt-4 mb-4">
                            <details className="group">
                                <summary className="text-[10px] font-black uppercase tracking-widest text-gray-400 cursor-pointer select-none hover:text-sage-500 transition-colors list-none flex items-center gap-2">
                                    <span className="group-open:rotate-90 transition-transform">â–¸</span>
                                    View Scan Debug Log ({scanLogs.length} entries)
                                </summary>
                                <div className="mt-2 p-3 bg-black/90 text-green-400 font-mono text-[10px] rounded-lg max-h-60 overflow-y-auto whitespace-pre-wrap border border-white/10 shadow-inner">
                                    {scanLogs.join('\n')}
                                </div>
                            </details>
                        </div>
                    )}
                </div>
            </section >
        </div>
    );
});
