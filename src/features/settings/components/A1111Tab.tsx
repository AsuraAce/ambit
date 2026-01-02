import * as React from 'react';
import { useState } from 'react';
import { Palette, Folder, Info, FolderSearch, Loader2, CheckCircle2, XCircle, Plus, ChevronDown, FolderOpen, RefreshCw } from 'lucide-react';
import { AppSettings, GeneratorTool } from '../../../types';
import { useLibraryContext } from '../../../hooks/useLibraryContext';
import { A1111FolderType, DiscoveryCandidate, WebUIVariant } from '../../../services/a1111/types';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const A1111Tab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const {
        setIsImporting,
        setImportProgress,
        refreshCollections,
        isResolvingModels: isResolving,
        setIsResolvingModels: setIsResolving,
        modelResolutionProgress: resolutionProgress,
        setModelResolutionProgress: setResolutionProgress
    } = useLibraryContext() as any;
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isDiscovering, setIsDiscovering] = useState(false);
    const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
    const [scanLogs, setScanLogs] = useState<string[]>([]);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [showAllFolders, setShowAllFolders] = useState(false);
    const [forceVariant, setForceVariant] = useState<WebUIVariant | 'Auto'>('Auto');

    const handleDiscover = async () => {
        if (!settings.a1111Path) return;
        setIsDiscovering(true);
        setTestResult(null);
        try {
            const { discoverA1111Candidates } = await import('../../../services/a1111/config');
            const existing = new Set(settings.monitoredFolders.map(f => f.path.replace(/\\/g, '/').toLowerCase()));
            const { candidates: results, logs } = await discoverA1111Candidates(settings.a1111Path, existing);

            // Apply Manual Override if selected
            if (forceVariant !== 'Auto') {
                results.forEach(c => {
                    c.variant = forceVariant;
                });
                logs.push(`[Info] Manual Override applied: Forced all candidates to ${forceVariant}`);
            }

            setCandidates(results);
            setScanLogs(logs);

            // Auto-select priority folders that aren't linked yet
            const priorityUnlinked = results.filter(c => c.isPriority && !c.isAlreadyLinked);
            setSelectedPaths(new Set(priorityUnlinked.map(c => c.path)));

            // If NO priority folders AT ALL, auto-show all
            if (results.filter(c => c.isPriority).length === 0 && results.length > 0) {
                setShowAllFolders(true);
            }

            if (results.length === 0) {
                setTestResult({ success: false, message: "No potential folders containing images found." });
            }
        } catch (e) {
            console.error(e);
            setTestResult({ success: false, message: "Discovery failed. Check path permissions." });
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
        if (toLink.length === 0) return;

        // Separate new folders from already linked ones
        const alreadyLinked = toLink.filter(c => c.isAlreadyLinked);
        const brandNew = toLink.filter(c => !c.isAlreadyLinked);

        if (brandNew.length > 0) {
            setSettings(prev => {
                const newFolders = brandNew.map(c => {
                    let variant: GeneratorTool | undefined = undefined;
                    if (c.variant === WebUIVariant.FORGE) variant = GeneratorTool.FORGE;
                    else if (c.variant === WebUIVariant.SDNEXT) variant = GeneratorTool.SDNEXT;
                    else if (c.variant === WebUIVariant.ANAPNOE) variant = GeneratorTool.ANAPNOE;
                    else if (c.variant === WebUIVariant.A1111) variant = GeneratorTool.AUTOMATIC1111;

                    return {
                        id: `a1111_${c.inferredType}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        path: c.path,
                        isActive: true,
                        imageCount: c.imageCount,
                        variant: variant
                    };
                });
                return {
                    ...prev,
                    monitoredFolders: [...prev.monitoredFolders, ...newFolders]
                };
            });
        }

        // If there are already linked folders, trigger a manual scan for them
        if (alreadyLinked.length > 0) {
            try {
                const { processNativePaths } = await import('../../../services/importService');
                const { getThumbnailDir } = await import('../../../services/thumbnailService');
                const { GeneratorTool } = await import('../../../types');
                const { WebUIVariant } = await import('../../../services/a1111/types');

                const thumbDir = await getThumbnailDir();

                setIsDiscovering(true);
                setIsImporting(true);
                setImportProgress({ current: 0, total: alreadyLinked.length, message: 'Starting sync...' });

                // Group by variant to pass the correct defaultTool
                const groups = new Map<string, typeof alreadyLinked>();
                for (const c of alreadyLinked) {
                    const v = c.variant || 'Unknown';
                    if (!groups.has(v)) groups.set(v, []);
                    groups.get(v)!.push(c);
                }

                let processedCount = 0;
                for (const [variant, group] of groups) {
                    let defaultTool = GeneratorTool.UNKNOWN;
                    if (variant === WebUIVariant.FORGE) defaultTool = GeneratorTool.FORGE;
                    else if (variant === WebUIVariant.SDNEXT) defaultTool = GeneratorTool.SDNEXT;
                    else if (variant === WebUIVariant.ANAPNOE) defaultTool = GeneratorTool.ANAPNOE;
                    else if (variant === WebUIVariant.A1111) defaultTool = GeneratorTool.AUTOMATIC1111;

                    await processNativePaths(group.map(c => c.path), thumbDir, (curr, tot, msg) => {
                        // curr is for this batch
                        const actualCurrent = processedCount + curr;
                        const actualTotal = alreadyLinked.length; // Approximate if batched weirdly, but total passed to us is usually total for that batch. 
                        // Check processNativePaths implementation, it calls onProgress with (current, total, msg).
                        // Wait, processNativePaths total is the batch size? No, totalToProcess.
                        // So we should just map it relative to total
                        setImportProgress({ current: actualCurrent, total: alreadyLinked.length, message: msg });
                    }, defaultTool);

                    processedCount += group.length;
                }

                if (refreshCollections) refreshCollections();
                setTestResult({ success: true, message: `Successfully synced ${alreadyLinked.length} folders!` });
            } catch (e) {
                console.error("Manual sync failed", e);
                setTestResult({ success: false, message: "Sync failed. See console for details." });
            } finally {
                setIsDiscovering(false);
                setIsImporting(false);
                setImportProgress(null);
            }
        } else {
            setTestResult({ success: true, message: `Successfully linked ${brandNew.length} folders!` });
        }

        setCandidates([]);
    };

    const displayedCandidates = showAllFolders
        ? candidates
        : candidates.filter(c => c.isPriority);

    const hiddenCount = candidates.length - displayedCandidates.length;

    return (
        <div className="space-y-6 max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="px-1">
                <p className="text-sm text-gray-500">
                    Connect your A1111, Forge, SD.Next, or Anapnoe installation.
                </p>
            </div>

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
                                        onChange={(e) => setSettings(prev => ({ ...prev, a1111Path: e.target.value }))}
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

                        {testResult && (
                            <div className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 animate-in fade-in slide-in-from-right-2 duration-300 ${testResult.success
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                }`}>
                                {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                {testResult.message}
                            </div>
                        )}
                    </div>

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
                                        : `Link ${selectedPaths.size} Folders`}
                                </button>
                            </div>

                            {scanLogs.length > 0 && (
                                <div className="mt-4 mb-4">
                                    <details className="group">
                                        <summary className="text-[10px] font-black uppercase tracking-widest text-gray-400 cursor-pointer select-none hover:text-sage-500 transition-colors list-none flex items-center gap-2">
                                            <span className="group-open:rotate-90 transition-transform">▸</span>
                                            View Scan Debug Log ({scanLogs.length} entries)
                                        </summary>
                                        <div className="mt-2 p-3 bg-black/90 text-green-400 font-mono text-[10px] rounded-lg max-h-60 overflow-y-auto whitespace-pre-wrap border border-white/10 shadow-inner">
                                            {scanLogs.join('\n')}
                                        </div>
                                    </details>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section >

            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
                <div className="flex items-center justify-between mb-6">
                    <h4 className="text-[10px] font-black text-white px-4 py-2 bg-blue-600 rounded-lg inline-flex items-center gap-3 uppercase tracking-widest shadow-lg shadow-blue-500/20">
                        <FolderSearch className="w-4 h-4" /> Model Hash Resolution
                    </h4>
                    <button
                        onClick={async () => {
                            if (!window.confirm("This will clear all currently resolved model names and re-trigger the resolution process. Continue?")) return;

                            setTestResult(null);
                            setResolutionProgress(null);
                            setIsResolving(true);

                            try {
                                const { invoke } = await import('@tauri-apps/api/core');
                                const { listen } = await import('@tauri-apps/api/event');

                                await invoke('clear_model_cache');

                                let unlisten: (() => void) | undefined;
                                unlisten = await listen<{ current: number, total: number, message: string }>('model_resolution_progress', (event) => {
                                    setResolutionProgress(event.payload);
                                });

                                const res = await invoke<{ resolvedCount: number, failedCount: number }>('resolve_hashes_online', { skipHarvest: true });
                                setTestResult({
                                    success: true,
                                    message: `Resolution re-run finished: ${res.resolvedCount} resolved, ${res.failedCount} failed.`
                                });
                                if (unlisten) unlisten();
                            } catch (e: any) {
                                console.error(e);
                                setTestResult({ success: false, message: `Re-run failed: ${e.message || e}` });
                            } finally {
                                setIsResolving(false);
                                setResolutionProgress(null);
                            }
                        }}
                        disabled={isResolving}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-blue-600 hover:bg-blue-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                        title="Clear cache and re-run resolution"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${isResolving ? 'animate-spin' : 'group-hover:rotate-180'} transition-transform duration-500`} />
                        Re-run Hashing
                    </button>
                </div>

                <div className="space-y-4">
                    <div className="px-1">
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Resolve unknown model hashes from image metadata using local caches or CivitAI.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-gray-50 dark:bg-black/20 p-4 rounded-xl border border-gray-200 dark:border-white/5 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h5 className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Layer 1: Local Cache</h5>
                                <span className="text-[10px] font-mono bg-gray-200 dark:bg-white/10 px-2 py-0.5 rounded text-gray-500">Fast & Offline</span>
                            </div>
                            <p className="text-[11px] text-gray-500">
                                Import <code className="text-xs bg-gray-200 dark:bg-white/10 px-1 rounded mx-0.5">cache.json</code> from your A1111 installation.
                            </p>
                            <button
                                onClick={async () => {
                                    try {
                                        const { open } = await import('@tauri-apps/plugin-dialog');
                                        const { invoke } = await import('@tauri-apps/api/core');

                                        const selected = await open({
                                            multiple: false,
                                            filters: [{ name: 'JSON', extensions: ['json'] }],
                                            defaultPath: settings.a1111Path
                                        });

                                        if (selected && typeof selected === 'string') {
                                            const res = await invoke<{ added: number, totalFound: number, message: string }>('import_a1111_cache', { cachePath: selected });
                                            setTestResult({ success: (res.added > 0 || res.totalFound > 0), message: res.message });
                                        }
                                    } catch (e: any) {
                                        console.error(e);
                                        setTestResult({ success: false, message: `Import failed: ${e.message || e}` });
                                    }
                                }}
                                className="mt-auto w-full py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 rounded-lg text-xs font-bold transition-all text-gray-700 dark:text-gray-200 mb-1"
                            >
                                Import cache.json
                            </button>
                        </div>

                        <div className="bg-gray-50 dark:bg-black/20 p-4 rounded-xl border border-gray-200 dark:border-white/5 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                                <h5 className="text-xs font-bold text-gray-700 dark:text-gray-200 uppercase tracking-wide">Layer 2: External API</h5>
                                <span className="text-[10px] font-mono bg-blue-500/10 text-blue-600 px-2 py-0.5 rounded">CivitAI Lookup</span>
                            </div>
                            <p className="text-[11px] text-gray-500">
                                Query CivitAI for unknown hashes. Required for deleted/archived models.
                            </p>
                            <button
                                onClick={async () => {
                                    setIsResolving(true);
                                    setResolutionProgress(null);
                                    setTestResult(null); // Clear previous results

                                    let unlisten: (() => void) | undefined;

                                    try {
                                        const { invoke } = await import('@tauri-apps/api/core');
                                        const { listen } = await import('@tauri-apps/api/event');

                                        unlisten = await listen<{ current: number, total: number, message: string }>('model_resolution_progress', (event) => {
                                            setResolutionProgress(event.payload);
                                        });

                                        const res = await invoke<{ resolvedCount: number, failedCount: number }>('resolve_hashes_online', { skipHarvest: false });
                                        setTestResult({
                                            success: true,
                                            message: `Online lookup finished: ${res.resolvedCount} resolved, ${res.failedCount} failed.`
                                        });
                                    } catch (e: any) {
                                        console.error(e);
                                        setTestResult({ success: false, message: `Lookup failed: ${e.message || e}` });
                                    } finally {
                                        if (unlisten) unlisten();
                                        setIsResolving(false);
                                        setResolutionProgress(null);
                                    }
                                }}
                                disabled={isResolving}
                                className="mt-auto w-full py-2 bg-blue-600 hover:bg-blue-500 border border-transparent rounded-lg text-xs font-bold transition-all text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden"
                            >
                                {isResolving ? (
                                    resolutionProgress ? (
                                        <div className="relative z-10 flex items-center justify-center gap-2">
                                            <span>{resolutionProgress.message}</span>
                                        </div>
                                    ) : (
                                        'Starting...'
                                    )
                                ) : (
                                    'Resolve Online'
                                )}

                                {isResolving && resolutionProgress && (
                                    <div
                                        className="absolute top-0 left-0 h-full bg-blue-400 transition-all duration-300 pointer-events-none"
                                        style={{ width: `${(resolutionProgress.current / (resolutionProgress.total || 100)) * 100}%` }}
                                    />
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </section>
        </div >
    );
});
