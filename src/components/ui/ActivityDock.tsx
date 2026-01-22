import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, X, Info, Sparkles, Minus } from 'lucide-react';
import { useLibraryStore } from '../../stores/libraryStore';

export const ActivityDock: React.FC = () => {
    const {
        isImporting, importProgress,
        syncStatus, syncProgress, isLiveSyncing,
        isRegeneratingThumbnails, thumbnailProgress,
        isResolvingModels, modelResolutionProgress,
        isActivityDockDismissed, setIsActivityDockDismissed,
        isActivityDockMinimized, setIsActivityDockMinimized, // Added
        isPopulatingThumbnails,
        isBackgroundHealingActive, backgroundHealingProgress, backgroundHealingPaused,
        cancelImport,
        cancelThumbnailRegeneration
    } = useLibraryStore();

    const isSyncing = syncStatus === 'syncing' || isLiveSyncing;

    // Priority order: Import > Sync > Manual Regen > Model Resolution > Populating > Background Healing
    const isHighPriorityActive = isImporting || isSyncing || isRegeneratingThumbnails || isResolvingModels || isPopulatingThumbnails;
    const isBackgroundActive = isBackgroundHealingActive && !backgroundHealingPaused && !isHighPriorityActive;

    const active = isHighPriorityActive || isBackgroundActive;

    // Determine current task details
    let progress = null;
    let label = "";
    let isLowPriority = false;

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
    } else if (isPopulatingThumbnails) {
        progress = { current: 0, total: 0, message: "Matching images to models..." };
        label = "Smart Fill";
    } else if (isBackgroundActive) {
        progress = backgroundHealingProgress;
        label = "Auto-Optimizing";
        isLowPriority = true;
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
                    layout
                    initial={{ y: 100, opacity: 0, scale: 0.95 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    exit={{ y: 50, opacity: 0, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    className="fixed bottom-8 right-8 z-[100]"
                >
                    {isActivityDockMinimized ? (
                        // Minimized Pill View
                        <motion.div
                            layoutId="dock-content"
                            onClick={() => setIsActivityDockMinimized(false)}
                            className={`group bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-white/20 dark:border-white/10 p-2.5 rounded-full shadow-xl flex items-center gap-3 cursor-pointer hover:scale-105 transition-transform ${isLowPriority ? 'hover:shadow-[0_0_15px_rgba(139,92,246,0.2)]' : 'hover:shadow-[0_0_15px_rgba(139,174,124,0.3)]'}`}
                            title="Click to expand details"
                        >
                            <motion.div layout="position" className={`${isLowPriority ? 'text-violet-600 dark:text-violet-400' : 'text-sage-600 dark:text-sage-400'}`}>
                                {isLowPriority ? <Sparkles className="w-5 h-5 animate-pulse" /> : <Loader2 className="w-5 h-5 animate-spin" />}
                            </motion.div>
                            <motion.div layout="position" className="w-12 h-1 bg-gray-200 dark:bg-zinc-700 rounded-full overflow-hidden mr-1">
                                <div
                                    className={`h-full ${isLowPriority ? 'bg-violet-500' : 'bg-sage-500'}`}
                                    style={{ width: `${percent}%` }}
                                />
                            </motion.div>
                        </motion.div>
                    ) : (
                        // Maximized Card View
                        <motion.div
                            layoutId="dock-content"
                            className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl border border-white/20 dark:border-white/10 p-4 rounded-2xl shadow-2xl flex flex-col min-w-[320px] max-w-[400px] gap-3 group"
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <motion.div layout="position" className={`p-2 rounded-lg ${isLowPriority ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'bg-sage-500/10 text-sage-600 dark:text-sage-400'}`}>
                                        {isLowPriority ? <Sparkles className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
                                    </motion.div>
                                    <motion.div layout="position">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic opacity-80 leading-none mb-1">Background Activity</h4>
                                        <p className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                            {label}
                                            {total > 0 && <span className="text-xs font-medium text-gray-400 font-mono tracking-tight">{current.toLocaleString()} / {total.toLocaleString()}</span>}
                                        </p>
                                    </motion.div>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => setIsActivityDockMinimized(true)}
                                        className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all hover:scale-105 active:scale-95"
                                        title="Minimize"
                                    >
                                        <Minus className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => setIsActivityDockDismissed(true)}
                                        className="p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all hover:scale-105 active:scale-95"
                                        title="Dismiss (Continues in Header)"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>

                            {/* Progress Bar */}
                            <motion.div layout="position" className="space-y-1.5">
                                <div className="w-full h-2 bg-gray-100 dark:bg-black/40 rounded-full overflow-hidden relative">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${percent}%` }}
                                        transition={{ duration: 0.5, ease: "easeOut" }}
                                        className={`h-full ${isLowPriority ? 'bg-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.3)]' : 'bg-sage-500 shadow-[0_0_12px_rgba(139,174,124,0.5)]'}`}
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
                                    <span className={`text-[11px] font-black font-mono italic ${isLowPriority ? 'text-violet-600 dark:text-violet-400' : 'text-sage-600 dark:text-sage-400'}`}>
                                        {percent}%
                                    </span>
                                </div>
                            </motion.div>

                            {/* Subtle Footer with CANCEL button */}
                            <motion.div layout="position" className="pt-2 border-t border-black/5 dark:border-white/5 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <Info className="w-3 h-3 text-gray-400" />
                                    <span className="text-[9px] text-gray-500 font-medium">Tracking continues in the top header.</span>
                                </div>

                                {(isImporting || isRegeneratingThumbnails) && (
                                    <button
                                        onClick={isImporting ? cancelImport : cancelThumbnailRegeneration}
                                        className="text-[10px] font-bold text-red-500 hover:text-red-700 dark:hover:text-red-400 bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/30 px-2 py-1 rounded-md transition-colors uppercase tracking-wider"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </motion.div>
                        </motion.div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
};
