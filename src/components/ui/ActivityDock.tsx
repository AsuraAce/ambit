import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, X, Info } from 'lucide-react';
import { useLibraryStore } from '../../stores/libraryStore';

export const ActivityDock: React.FC = () => {
    const {
        isImporting, importProgress,
        syncStatus, syncProgress, isLiveSyncing,
        isRegeneratingThumbnails, thumbnailProgress,
        isResolvingModels, modelResolutionProgress,
        isActivityDockDismissed, setIsActivityDockDismissed
    } = useLibraryStore();

    const isSyncing = syncStatus === 'syncing' || isLiveSyncing;
    const active = isImporting || isSyncing || isRegeneratingThumbnails || isResolvingModels;

    // Determine current task details
    let progress = null;
    let label = "";

    if (isImporting) {
        progress = importProgress;
        label = "Importing";
    } else if (isSyncing) {
        progress = syncProgress;
        label = "Syncing";
    } else if (isRegeneratingThumbnails) {
        progress = thumbnailProgress;
        label = "Optimizing";
    } else if (isResolvingModels) {
        progress = modelResolutionProgress;
        label = "Resolving Models";
    }

    const current = progress?.current || 0;
    const total = progress?.total || 0;
    const message = progress?.message || "";
    const percent = total > 0 ? Math.round((current / total) * 100) : (active ? 0 : 0);

    // Should we show the dock? Active AND not dismissed.
    const shouldShow = active && !isActivityDockDismissed;

    return (
        <AnimatePresence>
            {shouldShow && (
                <motion.div
                    initial={{ y: 100, opacity: 0, scale: 0.95 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: 50, opacity: 0, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className="fixed bottom-8 right-8 z-[100]"
                >
                    <div className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl border border-white/20 dark:border-white/10 p-4 rounded-2xl shadow-2xl flex flex-col min-w-[320px] max-w-[400px] gap-3 group">
                        {/* Header */}
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-sage-500/10 rounded-lg text-sage-600 dark:text-sage-400">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                </div>
                                <div>
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic opacity-80 leading-none mb-1">Background Activity</h4>
                                    <p className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                        {label}
                                        {total > 0 && <span className="text-xs font-medium text-gray-400 font-mono tracking-tight">{current.toLocaleString()} / {total.toLocaleString()}</span>}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsActivityDockDismissed(true)}
                                className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all scale-0 group-hover:scale-100 opacity-0 group-hover:opacity-100"
                                title="Dismiss (Stays active in background)"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>

                        {/* Progress Bar */}
                        <div className="space-y-1.5">
                            <div className="w-full h-2 bg-gray-100 dark:bg-black/40 rounded-full overflow-hidden relative">
                                <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${percent}%` }}
                                    transition={{ duration: 0.5, ease: "easeOut" }}
                                    className="h-full bg-sage-500 shadow-[0_0_12px_rgba(139,174,124,0.5)]"
                                />
                                {total === 0 && active && (
                                    <motion.div
                                        initial={{ x: "-100%" }}
                                        animate={{ x: "200%" }}
                                        transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                                        className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-full"
                                    />
                                )}
                            </div>
                            <div className="flex justify-between items-center px-0.5">
                                <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate flex-1 pr-4">
                                    {message || "Starting work..."}
                                </p>
                                <span className="text-[11px] font-black text-sage-600 dark:text-sage-400 font-mono italic">
                                    {percent}%
                                </span>
                            </div>
                        </div>

                        {/* Subtle Footer */}
                        <div className="pt-2 border-t border-black/5 dark:border-white/5 flex items-center gap-2">
                            <Info className="w-3 h-3 text-gray-400" />
                            <span className="text-[9px] text-gray-500 font-medium">Tracking continues in the top header border.</span>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
