
import * as React from 'react';
import { useState } from 'react';
import { Database, Zap, AlertTriangle, Loader2, Shield, Trash2, History as HistoryIcon } from 'lucide-react';
import { generateStressTestData } from '../../../utils/dev/dataGenerator';
import { useLibraryContext } from '../../../hooks/useLibraryContext';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

export const DevTab: React.FC = () => {
    const { fetchData, setSettings, cleanLibrary } = useLibraryContext();
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [targetCount, setTargetCount] = useState(10000);

    const handleStressTest = async () => {
        setIsGenerating(true);
        try {
            await generateStressTestData(targetCount, (current, total) => {
                setProgress({ current, total });
            });
            await fetchData(false);
        } finally {
            setIsGenerating(false);
            setProgress({ current: 0, total: 0 });
        }
    };

    // Danger Zone State
    const [confirmAction, setConfirmAction] = useState<{ type: 'reset' | 'purge' | null, isOpen: boolean }>({ type: null, isOpen: false });
    const [isPurging, setIsPurging] = useState(false);

    const closeConfirm = () => setConfirmAction({ type: null, isOpen: false });

    // Handle Purge async correctly
    const handlePurge = async () => {
        setIsPurging(true);
        try {
            await cleanLibrary();
        } catch (e) {
            console.error('[Purge] Failed:', e);
        } finally {
            setIsPurging(false);
            closeConfirm();
        }
    };


    return (
        <>
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                {/* Migration Reset Section */}
                {/* Danger Zone Section */}
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <Shield className="w-5 h-5 text-gray-400" />
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Danger Zone</h4>
                    </div>

                    <div className="p-4 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl space-y-6">
                        {/* Reset Sync Cursor */}
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Reset Sync Cursor</div>
                                <div className="text-xs text-gray-500 mt-0.5">Force a full re-scan of external libraries on next sync.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setConfirmAction({ type: 'reset', isOpen: true })}
                                className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2"
                            >
                                <HistoryIcon className="w-3.5 h-3.5" /> Reset Cursor
                            </button>
                        </div>

                        {/* Purge Database */}
                        <div className="pt-6 border-t border-gray-100 dark:border-white/5 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-rose-600 dark:text-rose-400">Purge Database</div>
                                <div className="text-xs text-gray-500 mt-0.5">Remove all imported metadata and reset application state.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setConfirmAction({ type: 'purge', isOpen: true })}
                                className="px-3 py-2 bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-bold transition-all flex items-center gap-2"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Purge Database
                            </button>
                        </div>
                    </div>
                </section>

                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <Database className="w-5 h-5 text-sage-500" />
                        <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Database Stress Testing</h4>
                    </div>

                    <div className="p-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl mb-6">
                        <div className="flex gap-4">
                            <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0" />
                            <div>
                                <h5 className="text-sm font-bold text-amber-500 mb-1">Warning: Destructive Operation</h5>
                                <p className="text-xs text-amber-900/70 dark:text-amber-500/70 leading-relaxed">
                                    Generating large amounts of data will significantly increase database size and may affect performance on low-end hardware.
                                    Use this only for benchmarking virtualization and SQL performance.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                        <div className="space-y-2">
                            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Target Image Count</label>
                            <select
                                value={targetCount}
                                onChange={(e) => setTargetCount(Number(e.target.value))}
                                className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sage-500/50 transition-all font-mono text-gray-900 dark:text-gray-100"
                                disabled={isGenerating}
                            >
                                <option value={1000}>1,000 images</option>
                                <option value={5000}>5,000 images</option>
                                <option value={10000}>10,000 images</option>
                                <option value={50000}>50,000 images</option>
                                <option value={100000}>100,000 images</option>
                            </select>
                        </div>

                        <button
                            onClick={handleStressTest}
                            disabled={isGenerating}
                            className="w-full h-[46px] bg-sage-600 hover:bg-sage-500 disabled:bg-gray-300 dark:disabled:bg-white/5 text-white rounded-xl text-sm font-bold shadow-lg shadow-sage-500/20 flex items-center justify-center gap-2 transition-all transform active:scale-95 px-6"
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Generating {progress.current.toLocaleString()} / {progress.total.toLocaleString()}...
                                </>
                            ) : (
                                <>
                                    <Zap className="w-4 h-4 fill-white" />
                                    Start Stress Test
                                </>
                            )}
                        </button>
                    </div>
                </section>
            </div>

            <ConfirmDialog
                isOpen={confirmAction.isOpen && confirmAction.type === 'reset'}
                title="Reset Sync Cursor?"
                message={`This will reset the "Last Synced" timestamp. The next sync operation will scan your ENTIRE external library from the beginning. This process may take some time.`}
                confirmLabel="Reset Cursor"
                onConfirm={() => {
                    setSettings((p: any) => ({ ...p, lastSyncedAt: null }));
                    closeConfirm();
                }}
                onCancel={closeConfirm}
                zIndex={220}
            />

            <ConfirmDialog
                isOpen={confirmAction.isOpen && confirmAction.type === 'purge'}
                title="Purge Application Database?"
                message="DANGER: This will delete ALL images and metadata from your Ambit library. Your actual image files on disk will NOT be touched, but you will lose all Ambit-specific data (collections, tags, favorites). Are you sure?"
                confirmLabel="Purge Database"
                isDangerous={true}
                onConfirm={handlePurge}
                isLoading={isPurging}
                onCancel={closeConfirm}
                zIndex={220}
            />
        </>
    );
};
