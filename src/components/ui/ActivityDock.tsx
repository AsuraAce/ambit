import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, X, Info, Sparkles, Minus, Fingerprint, Search } from 'lucide-react';
import { useLibraryStore, type SyncProgress } from '../../stores/libraryStore';
import { commands } from '../../bindings';
import {
    THUMBNAIL_QUEUE_COMPLETE_FOOTER,
    THUMBNAIL_QUEUE_FAILURE_FOOTER,
    THUMBNAIL_QUEUE_RUNNING_FOOTER
} from '../../hooks/thumbnailQueueProgress';

const ELAPSED_VISIBLE_AFTER_MS = 5000;

const formatElapsed = (elapsedMs: number): string | null => {
    if (elapsedMs < ELAPSED_VISIBLE_AFTER_MS) {
        return null;
    }

    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    if (totalSeconds < 60) {
        return `${totalSeconds}s elapsed`;
    }

    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${minutes}m ${seconds}s elapsed` : `${minutes}m elapsed`;
};

const splitDetailItems = (detail?: string): string[] => (
    detail
        ? detail.split('|').map(item => item.trim()).filter(Boolean)
        : []
);

export const ActivityDock: React.FC = () => {
    const {
        isImporting, importProgress, importAbortController,
        syncStatus, syncProgress,
        liveWatchSession,
        isRegeneratingThumbnails, thumbnailProgress,
        isResolvingModels, modelResolutionProgress,
        isActivityDockDismissed, setIsActivityDockDismissed,
        isActivityDockMinimized, setIsActivityDockMinimized,
        isPopulatingThumbnails,
        isScanningDiscovery,
        discoveryScanProgress,
        cancelDiscoveryScan,
        isScanningDuplicates,
        duplicateScanProgress,
        cancelDuplicateScan,
        isScanningMissingFiles,
        missingScanProgress,
        cancelMissingScan,
        setIsResolvingModels,
        isBackgroundHealingActive, backgroundHealingProgress, backgroundHealingPaused,
        isRefreshingMetadata, refreshProgress,
        cancelImport,
        cancelThumbnailRegeneration,
        cancelSync,
        cancelRefresh
    } = useLibraryStore();

    const isManualSyncing = syncStatus === 'syncing';

    // Priority order: Import > Manual Sync > Manual Regen > Model Resolution > Discovery > Duplicates > Missing Audit > Populating > Background Healing > Reparsing > Live Watch
    const isHighPriorityActive = isImporting || isManualSyncing || isRegeneratingThumbnails || isResolvingModels || isScanningDiscovery || isScanningDuplicates || isScanningMissingFiles || isPopulatingThumbnails;
    const isBackgroundActive = isBackgroundHealingActive && !backgroundHealingPaused && !isHighPriorityActive;

    const isRefreshActive = isRefreshingMetadata && !isHighPriorityActive && !isBackgroundActive;

    const isLiveWatchActive = liveWatchSession.active && !isHighPriorityActive && !isBackgroundActive && !isRefreshActive;
    const isLiveWatchSummary = isLiveWatchActive && liveWatchSession.phase === 'summary';
    const isLiveWatchTone = isLiveWatchActive;

    const active = isHighPriorityActive || isBackgroundActive || isRefreshActive || isLiveWatchActive;

    let progress: SyncProgress | null = null;
    let label = "";
    let isLowPriority = false;
    let supportsCancel = false;
    let footerMessage = "Tracking continues in the top header.";

    if (isImporting) {
        progress = importProgress;
        label = "Importing";
        supportsCancel = !!importAbortController;
    } else if (isManualSyncing) {
        progress = syncProgress;
        label = "Syncing";
        supportsCancel = true;
    } else if (isRegeneratingThumbnails) {
        progress = thumbnailProgress;
        label = "Optimizing";
        supportsCancel = true;
    } else if (isResolvingModels) {
        progress = modelResolutionProgress;
        label = "Resolving Models";
        supportsCancel = true;
    } else if (isScanningDiscovery) {
        progress = discoveryScanProgress;
        label = "Discovery Scan";
        supportsCancel = true;
    } else if (isScanningDuplicates) {
        progress = duplicateScanProgress;
        label = "Duplicate Scan";
        supportsCancel = true;
        footerMessage = "You can keep using Ambit while this scans.";
    } else if (isScanningMissingFiles) {
        progress = missingScanProgress;
        label = "Missing File Audit";
        supportsCancel = true;
        footerMessage = "You can keep using Ambit while this audit runs.";
    } else if (isPopulatingThumbnails) {
        progress = { current: 0, total: 0, message: "Matching images to models..." };
        label = "Smart Fill";
    } else if (isBackgroundActive) {
        progress = backgroundHealingProgress;
        label = "Smart Thumbnails";
        isLowPriority = true;
        footerMessage = THUMBNAIL_QUEUE_RUNNING_FOOTER;
    } else if (isRefreshActive) {
        progress = refreshProgress;
        label = "Refreshing Metadata";
        isLowPriority = false;
        supportsCancel = true;
    } else if (isLiveWatchActive) {
        progress = liveWatchSession.progress || {
            current: 0,
            total: 0,
            message: liveWatchSession.message
        };
        label = "Live Watch";
        isLowPriority = true;
        footerMessage = 'Live Watch stays active in the background.';
    }

    if (progress?.mode === 'complete') {
        supportsCancel = false;
    }

    const current = progress?.current ?? 0;
    const total = progress?.total ?? 0;
    const mode = progress?.mode;
    const isCompleteProgress = mode === 'complete';
    const showIndeterminateProgress = mode === 'indeterminate' || (total === 0 && active && !isCompleteProgress && (!isLiveWatchActive || !isLiveWatchSummary));

    const [elapsedNow, setElapsedNow] = React.useState(() => Date.now());

    React.useEffect(() => {
        if (!active || !progress?.startedAt || !showIndeterminateProgress) {
            return;
        }

        setElapsedNow(Date.now());
        const interval = window.setInterval(() => setElapsedNow(Date.now()), 1000);
        return () => window.clearInterval(interval);
    }, [active, progress?.startedAt, showIndeterminateProgress]);

    const message = progress?.message || progress?.phase || (isLiveWatchActive ? liveWatchSession.message || '' : '');
    const percent = isLiveWatchSummary || isCompleteProgress ? 100 : total > 0 ? Math.round((current / total) * 100) : 0;
    const showCounts = total > 0 && !isLiveWatchActive && !isBackgroundActive && !showIndeterminateProgress && !isCompleteProgress;
    const smartThumbnailHasFailures = isBackgroundActive && message.includes('need attention');
    const smartThumbnailIsComplete = isBackgroundActive && total > 0 && current >= total;
    const visibleFooterMessage = smartThumbnailHasFailures
        ? THUMBNAIL_QUEUE_FAILURE_FOOTER
        : (smartThumbnailIsComplete ? THUMBNAIL_QUEUE_COMPLETE_FOOTER : footerMessage);
    const elapsedLabel = progress?.startedAt && active && showIndeterminateProgress && !isCompleteProgress
        ? formatElapsed(elapsedNow - progress.startedAt)
        : null;
    const secondaryDetails = [
        ...splitDetailItems(progress?.detail),
        elapsedLabel
    ].filter((item): item is string => Boolean(item));
    const hasMultipleSecondaryDetails = secondaryDetails.length > 1;
    const accentClasses = isLiveWatchTone || isLowPriority
        ? {
            iconText: 'text-violet-600 dark:text-violet-400',
            iconBg: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
            fill: 'bg-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.3)]',
            pillHover: 'hover:shadow-[0_0_15px_rgba(139,92,246,0.2)]',
            percentText: 'text-violet-600 dark:text-violet-400'
        }
        : {
            iconText: 'text-sage-600 dark:text-sage-400',
            iconBg: 'bg-sage-500/10 text-sage-600 dark:text-sage-400',
            fill: 'bg-sage-500 shadow-[0_0_12px_rgba(139,174,124,0.5)]',
            pillHover: 'hover:shadow-[0_0_15px_rgba(139,174,124,0.3)]',
            percentText: 'text-sage-600 dark:text-sage-400'
        };

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
                        <motion.div
                            layoutId="dock-content"
                            onClick={() => setIsActivityDockMinimized(false)}
                            className={`group bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-white/20 dark:border-white/10 p-2.5 rounded-full shadow-xl flex items-center gap-3 cursor-pointer hover:scale-105 transition-transform ${accentClasses.pillHover}`}
                            title="Click to expand details"
                        >
                            <motion.div layout="position" className={accentClasses.iconText}>
                                {isLiveWatchTone || isLowPriority ? <Sparkles className="w-5 h-5 animate-pulse" /> : <Loader2 className="w-5 h-5 animate-spin" />}
                            </motion.div>
                            <motion.div layout="position" className="w-12 h-1 bg-gray-200 dark:bg-zinc-700 rounded-full overflow-hidden mr-1">
                                <div
                                    className={`h-full ${isLiveWatchTone || isLowPriority ? 'bg-violet-500' : 'bg-sage-500'}`}
                                    style={{ width: `${percent}%` }}
                                />
                            </motion.div>
                        </motion.div>
                    ) : (
                        <motion.div
                            layoutId="dock-content"
                            className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-2xl border border-white/20 dark:border-white/10 p-4 rounded-2xl shadow-2xl flex flex-col w-[min(400px,calc(100vw-2rem))] gap-3 group"
                        >
                            <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <motion.div layout="position" className={`p-2 rounded-lg ${accentClasses.iconBg}`}>
                                        {isScanningDuplicates ? <Fingerprint className="w-4 h-4" /> : isScanningMissingFiles ? <Search className="w-4 h-4" /> : isLiveWatchTone || isLowPriority ? <Sparkles className="w-4 h-4" /> : <Loader2 className="w-4 h-4 animate-spin" />}
                                    </motion.div>
                                    <motion.div layout="position">
                                        <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-500 italic opacity-80 leading-none mb-1">Background Activity</h4>
                                        <p className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                            {label}
                                            {showCounts && <span className="text-xs font-medium text-gray-400 font-mono tracking-tight">{current.toLocaleString()} / {total.toLocaleString()}</span>}
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
                                        title="Dismiss"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>

                            <motion.div layout="position" className="space-y-1.5">
                                <div className="w-full h-2 bg-gray-100 dark:bg-black/40 rounded-full overflow-hidden relative">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${percent}%` }}
                                        transition={{ duration: 0.5, ease: "easeOut" }}
                                        className={`h-full ${accentClasses.fill}`}
                                    />
                                    {showIndeterminateProgress && (
                                        <motion.div
                                            initial={{ x: "-100%" }}
                                            animate={{ x: "200%" }}
                                            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                                            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent w-full"
                                        />
                                    )}
                                </div>
                                <div className="flex justify-between items-center px-0.5">
                                    <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate flex-1 pr-4 h-4 leading-4">
                                        {message || "Starting work..."}
                                    </p>
                                    {!showIndeterminateProgress && !isLiveWatchActive && !isBackgroundActive && !isCompleteProgress && (
                                        <span className={`text-[11px] font-black font-mono italic ${accentClasses.percentText}`}>
                                            {percent}%
                                        </span>
                                    )}
                                </div>
                                {secondaryDetails.length > 0 && hasMultipleSecondaryDetails && (
                                    <div className="flex flex-wrap gap-1.5 px-0.5">
                                        {secondaryDetails.map((detail, index) => (
                                            <span
                                                key={`${detail}-${index}`}
                                                className="min-w-0 max-w-full truncate rounded-md bg-black/[0.03] px-2 py-1 text-[10px] font-medium leading-4 text-gray-500 dark:bg-white/[0.04] dark:text-gray-400"
                                                title={detail}
                                            >
                                                {detail}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {secondaryDetails.length === 1 && (
                                    <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 truncate px-0.5 leading-4">
                                        {secondaryDetails[0]}
                                    </p>
                                )}
                            </motion.div>

                            <motion.div layout="position" className="pt-2 border-t border-black/5 dark:border-white/5 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <Info className="w-3 h-3 text-gray-400" />
                                    <span className="text-[9px] text-gray-500 font-medium">{visibleFooterMessage}</span>
                                </div>

                                {supportsCancel && (
                                    <button
                                        onClick={() => {
                                            if (isImporting) cancelImport();
                                            if (isManualSyncing) cancelSync();
                                            if (isRegeneratingThumbnails) cancelThumbnailRegeneration();
                                            if (isResolvingModels) {
                                                commands.cancelModelResolution().catch(console.error);
                                                setIsResolvingModels(false);
                                            }
                                            if (isScanningDiscovery) cancelDiscoveryScan();
                                            if (isScanningDuplicates) cancelDuplicateScan();
                                            if (isScanningMissingFiles) cancelMissingScan();
                                            if (isRefreshActive) cancelRefresh();
                                        }}
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
