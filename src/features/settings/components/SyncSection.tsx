import * as React from 'react';
import { useState } from 'react';
import { RefreshCw, Zap, ZapOff, XCircle, Loader2, Globe, CheckCircle2, Boxes } from 'lucide-react';
import { AppSettings } from '../../../types';
import { useLibrary } from '../../../contexts/LibraryContext';


interface SyncSectionProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const SyncSection: React.FC<SyncSectionProps> = React.memo(({ settings, setSettings }) => {
    const { syncState, startInvokeSync, cancelSync } = useLibrary();
    const { status, progress } = syncState;

    // Local state for sync options
    const [syncFavorites, setSyncFavorites] = useState(true);
    const [syncBoards, setSyncBoards] = useState(true);


    const handleSync = () => {
        if (!settings.invokeAiPath) return;
        startInvokeSync({
            syncFavorites,
            syncBoards,
            importIntermediates: settings.importIntermediates,
            afterTimestamp: settings.lastSyncedAt,
            starredAs: settings.starredAs
        });
    };

    if (!settings.invokeAiPath) return null;

    return (
        <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
            <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                <RefreshCw className="w-4 h-4" /> Synchronization
            </h4>

            <div className="mb-8 space-y-6 relative z-10">
                <p className="text-sm text-gray-500 font-medium">
                    Automate the bridge between InvokeAI and your Ambit library.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Favorites Group */}
                    <div className={`p-4 rounded-xl border transition-all duration-300 ${syncFavorites ? 'bg-sage-50 dark:bg-sage-500/5 border-sage-500/20' : 'bg-transparent border-gray-100 dark:border-white/5 opacity-60'}`}>
                        <label className="flex items-center gap-3 cursor-pointer group/label mb-3">
                            <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative ${syncFavorites ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                                {syncFavorites && <div className="w-2 h-2 bg-white rounded-sm" />}
                                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={syncFavorites} onChange={e => setSyncFavorites(e.target.checked)} />
                            </div>
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Sync Favorites</span>
                        </label>

                        {syncFavorites && (
                            <div className="pl-8 animate-in fade-in slide-in-from-left-2 duration-300">
                                <div className="flex items-center gap-3 p-2 bg-white/50 dark:bg-black/20 rounded-xl border border-black/5 dark:border-white/5">
                                    <span className="text-[10px] uppercase font-black text-gray-400 tracking-tighter">Map to</span>
                                    <select
                                        value={settings.starredAs || 'favorite'}
                                        onChange={(e) => setSettings(prev => ({ ...prev, starredAs: e.target.value as any }))}
                                        className="flex-1 bg-gray-100 dark:bg-zinc-800 text-xs font-bold outline-none text-sage-600 dark:text-sage-300 cursor-pointer py-1.5 px-2 rounded-lg"
                                    >
                                        <option value="favorite">Favorites</option>
                                        <option value="pin">Pins</option>
                                        <option value="both">Both</option>
                                        <option value="none">None (Ignore)</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Boards Group */}
                    <div className={`p-4 rounded-xl border transition-all duration-300 ${syncBoards ? 'bg-sage-50 dark:bg-sage-500/5 border-sage-500/20' : 'bg-transparent border-gray-100 dark:border-white/5 opacity-60'}`}>
                        <label className="flex items-center gap-3 cursor-pointer group/label mb-3">
                            <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative ${syncBoards ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                                {syncBoards && <div className="w-2 h-2 bg-white rounded-sm" />}
                                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={syncBoards} onChange={e => setSyncBoards(e.target.checked)} />
                            </div>
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Sync Boards</span>
                        </label>

                        {syncBoards && (
                            <div className="pl-8 animate-in fade-in slide-in-from-left-2 duration-300">
                                <label className="flex items-center gap-2 cursor-pointer group/sub">
                                    <div className={`w-8 h-4 rounded-full relative transition-colors ${settings.syncBoardsToCollections ? 'bg-sage-600' : 'bg-gray-300 dark:bg-white/10'}`}>
                                        <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={settings.syncBoardsToCollections || false} onChange={e => setSettings(prev => ({ ...prev, syncBoardsToCollections: e.target.checked }))} />
                                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full pointer-events-none transition-transform ${settings.syncBoardsToCollections ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </div>
                                    <span className="text-[10px] font-bold text-gray-500 group-hover/sub:text-sage-600 transition-colors">Persistent Collections</span>
                                </label>
                            </div>
                        )}
                    </div>
                </div>

                {/* Advanced Options */}
                <div className="p-5 bg-black/[0.03] dark:bg-black/20 rounded-2xl border border-black/5 dark:border-white/5 space-y-4">
                    <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Advanced Control</div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="flex items-start gap-3 cursor-pointer group/toggle">
                            <div className={`mt-1 w-10 h-5 rounded-full relative transition-colors shrink-0 ${settings.importIntermediates ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={settings.importIntermediates || false} onChange={e => setSettings(prev => ({ ...prev, importIntermediates: e.target.checked }))} />
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full pointer-events-none transition-transform ${settings.importIntermediates ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                            <div>
                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200 block">Import Intermediates</span>
                                <span className="text-[9px] text-gray-500 leading-tight">Sync background generation steps.</span>
                            </div>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer group/toggle">
                            <div className={`mt-1 w-10 h-5 rounded-full relative transition-colors shrink-0 ${settings.importOrphans !== false ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={settings.importOrphans !== false} onChange={e => setSettings(prev => ({ ...prev, importOrphans: e.target.checked }))} />
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full pointer-events-none transition-transform ${settings.importOrphans !== false ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                            <div>
                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200 block">Orphan Recovery</span>
                                <span className="text-[9px] text-gray-500 leading-tight">Find untracked files in output folder.</span>
                            </div>
                        </label>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 relative z-10">
                <div className="flex items-center justify-between">
                    {status === 'idle' || status === 'error' || status === 'complete' ? (
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleSync}
                                className="px-8 py-3 bg-sage-600 hover:bg-sage-500 text-white rounded-xl text-sm font-black transition-all shadow-xl shadow-sage-500/20 active:scale-95 flex items-center gap-3"
                            >
                                {status === 'error' ? <ZapOff className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                                {status === 'error' ? 'Retry Sync' : 'Initiate Sync'}
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={cancelSync}
                            className="px-6 py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-sm font-black transition-all flex items-center gap-3 active:scale-95"
                        >
                            <XCircle className="w-5 h-5" /> Terminate Sync
                        </button>
                    )}
                </div>



                {status === 'syncing' && (
                    <div className="p-5 bg-sage-50 dark:bg-sage-500/5 rounded-xl border border-sage-500/10 space-y-3 animate-in fade-in zoom-in-95 duration-500">
                        <div className="flex justify-between items-end">
                            <div>
                                <div className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-1">{progress.message || 'Processing...'}</div>
                                <div className="text-xs text-gray-500 font-medium">Synchronizing InvokeAI repository...</div>
                            </div>
                            <div className="text-xl font-black text-gray-900 dark:text-white font-mono tabular-nums">
                                {Math.round((progress.current / Math.max(progress.total, 1)) * 100)}<span className="text-xs opacity-40 ml-0.5">%</span>
                            </div>
                        </div>
                        <div className="w-full h-3 bg-gray-100 dark:bg-white/10 rounded-full overflow-hidden p-0.5 border border-gray-200 dark:border-white/5 relative ring-1 ring-sage-500/10 animate-pulse-glow">
                            <div
                                className="h-full bg-sage-500 rounded-full transition-all duration-500 ease-out shadow-[0_0_15px_rgba(110,121,107,0.3)] relative overflow-hidden"
                                style={{ width: `${Math.round((progress.current / Math.max(progress.total, 1)) * 100)}%` }}
                            >
                                {/* Pulsing shimmer effect */}
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-full animate-shimmer"
                                    style={{ backgroundSize: '200% 100%' }} />
                            </div>
                        </div>
                        <div className="flex justify-between text-[10px] font-bold text-gray-400 tabular-nums">
                            <span className="flex items-center gap-2"><Boxes className="w-3 h-3" /> {progress.current.toLocaleString()} units</span>
                            <span>Total: {progress.total.toLocaleString()}</span>
                        </div>
                    </div>
                )}

                {status === 'complete' && (
                    <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-[11px] font-bold text-emerald-600 dark:text-emerald-400 animate-in fade-in slide-in-from-top-2 flex items-center gap-3 shadow-lg shadow-emerald-500/5">
                        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/40 text-white">
                            <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <div>
                            <div className="uppercase tracking-widest text-[9px] mb-0.5">Library Updated</div>
                            Repository successfully synchronized with Ambit.
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
});
