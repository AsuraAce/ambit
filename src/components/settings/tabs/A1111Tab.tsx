import * as React from 'react';
import { useState } from 'react';
import { Palette, Folder, Info, FolderSearch, Loader2, CheckCircle2, XCircle, Plus } from 'lucide-react';
import { AppSettings } from '../../../types';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const A1111Tab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [candidates, setCandidates] = useState<any[]>([]);
    const [scanLogs, setScanLogs] = useState<string[]>([]);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [showAllFolders, setShowAllFolders] = useState(false);

    const handleDiscover = async () => {
        if (!settings.a1111Path) return;
        setIsScanning(true);
        setTestResult(null);
        try {
            const { discoverA1111Candidates } = await import('../../../services/a1111/config');
            const existing = new Set(settings.monitoredFolders.map(f => f.path.replace(/\\/g, '/').toLowerCase()));
            const { candidates: results, logs } = await discoverA1111Candidates(settings.a1111Path, existing);
            setCandidates(results);
            setScanLogs(logs);

            // Auto-select priority folders that aren't linked yet
            const priorityUnlinked = results.filter(c => c.isPriority && !c.isAlreadyLinked);
            setSelectedPaths(new Set(priorityUnlinked.map(c => c.path)));

            // If NO priority folders found, auto-show all
            if (priorityUnlinked.length === 0 && results.length > 0) {
                setShowAllFolders(true);
            }

            if (results.length === 0) {
                setTestResult({ success: false, message: "No potential folders containing images found." });
            }
        } catch (e) {
            console.error(e);
            setTestResult({ success: false, message: "Discovery failed. Check path permissions." });
        } finally {
            setIsScanning(false);
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
                const newFolders = brandNew.map(c => ({
                    id: `a1111_${c.inferredType}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    path: c.path,
                    isActive: true,
                    imageCount: c.imageCount
                }));
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
                setIsScanning(true);
                await processNativePaths(alreadyLinked.map(c => c.path), undefined, (curr, tot) => {
                    // Progress feedback could be added here
                });
                setTestResult({ success: true, message: `Successfully synced ${alreadyLinked.length} folders!` });
            } catch (e) {
                console.error("Manual sync failed", e);
                setTestResult({ success: false, message: "Sync failed. See console for details." });
            } finally {
                setIsScanning(false);
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
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                    Stable Diffusion WebUI
                </h3>
                <p className="text-sm text-gray-500">
                    Connect your A1111, Forge, or SD.Next installation and discover output folders.
                </p>
            </div>

            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
                <h4 className="text-[10px] font-black text-white px-4 py-2 bg-sage-600 rounded-lg inline-flex items-center gap-3 mb-6 uppercase tracking-widest shadow-lg shadow-sage-500/20">
                    <Palette className="w-4 h-4" /> Core Configuration
                </h4>

                <div className="space-y-6">
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
                                className="px-4 py-2.5 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-white/20 active:scale-95 transition-all text-sm font-bold"
                            >
                                Browse
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-3 flex items-center gap-1.5 opacity-80 px-1">
                            <Info className="w-3 h-3" /> Select the root of your SD installation or any folder with outputs.
                        </p>
                    </div>

                    <div className="pt-6 border-t border-black/5 dark:border-white/5 flex flex-col gap-6">
                        <div className="flex items-center justify-between">
                            <button
                                onClick={handleDiscover}
                                disabled={isScanning || !settings.a1111Path}
                                className={`px-8 py-3 rounded-xl text-sm font-black tracking-wide transition-all flex items-center gap-2.5 ${!settings.a1111Path
                                    ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                                    : 'bg-sage-600 hover:bg-sage-500 text-white shadow-xl shadow-sage-500/20 active:scale-95'
                                    }`}
                            >
                                {isScanning ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Scanning...
                                    </>
                                ) : (
                                    <>
                                        <FolderSearch className="w-4 h-4" />
                                        Scan for Folders
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
                                    </div>
                                    <div className="flex items-center gap-4">
                                        {candidates.some(c => !c.isPriority) || showAllFolders ? (
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
                                                                    cand.path === c.path ? { ...cand, inferredType: e.target.value } : cand
                                                                );
                                                                setCandidates(newCandidates);
                                                            }}
                                                            className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-lg text-xs font-bold py-1 px-2 outline-none focus:ring-1 focus:ring-sage-500/30"
                                                        >
                                                            <option value="txt2img">txt2img</option>
                                                            <option value="img2img">img2img</option>
                                                            <option value="extras">Extras</option>
                                                            <option value="grid">Grids</option>
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
                </div>
            </section>
        </div>
    );
});
