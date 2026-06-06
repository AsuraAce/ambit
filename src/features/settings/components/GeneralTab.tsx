import * as React from 'react';
import { AlertTriangle, ChevronDown, Loader2, Moon, RefreshCw, Sun } from 'lucide-react';
import {
    commands,
    type ThumbnailOptimizationFailure
} from '../../../bindings';
import { useToast } from '../../../hooks/useToast';
import {
    useLibraryStore,
    type ThumbnailOptimizationDetails,
    type ThumbnailOptimizationRunSummary
} from '../../../stores/libraryStore';
import { AppSettings } from '../../../types';
import { unwrap } from '../../../utils/spectaUtils';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

type ThumbnailFailureLoadState = 'idle' | 'loading' | 'ready' | 'error';

const THUMBNAIL_PROFILE_OPTIONS: {
    id: NonNullable<AppSettings['thumbnailOptimizationProfile']>;
    label: string;
}[] = [
        { id: 'quiet', label: 'Quiet' },
        { id: 'balanced', label: 'Balanced' },
        { id: 'fast', label: 'Fast' },
    ];

const NUMBER_FORMATTER = new Intl.NumberFormat();
const THUMBNAIL_FAILURE_LIMIT = 50;
const formatNumber = (value: number): string => NUMBER_FORMATTER.format(value);
const formatRate = (value: number): string => value > 0 ? `${value.toFixed(value >= 10 ? 0 : 1)}/s` : '0/s';
const formatDuration = (durationMs: number): string => {
    const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
};
const getFileNameFromPath = (path: string): string => {
    const normalized = path.replace(/\\/g, '/');
    return normalized.split('/').filter(Boolean).pop() ?? path;
};
const formatAttemptTime = (timestamp: number | null): string => {
    if (!timestamp) return 'Unknown time';
    return new Date(timestamp).toLocaleString();
};

const getThumbnailMetricValue = (
    details: ThumbnailOptimizationDetails | null,
    lastRun: ThumbnailOptimizationRunSummary | null,
    field: 'imagesPerSecond' | 'optimized' | 'reused' | 'failed' | 'skipped'
): number => details?.[field] ?? lastRun?.[field] ?? 0;

const getSmartThumbnailStatus = (
    details: ThumbnailOptimizationDetails | null,
    isActive: boolean,
    isPaused: boolean
): string => {
    if (isPaused) return 'Paused';
    if (details?.isThrottled) return 'Throttled';
    if (isActive) return 'Running';
    return 'Idle';
};

export const GeneralTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const { addToast } = useToast();
    const [failurePanelOpen, setFailurePanelOpen] = React.useState(false);
    const [thumbnailFailures, setThumbnailFailures] = React.useState<ThumbnailOptimizationFailure[]>([]);
    const [failureLoadState, setFailureLoadState] = React.useState<ThumbnailFailureLoadState>('idle');
    const [failureLoadError, setFailureLoadError] = React.useState<string | null>(null);
    const [isRetryingFailures, setIsRetryingFailures] = React.useState(false);
    const thumbnailDetails = useLibraryStore(s => s.backgroundHealingDetails);
    const lastThumbnailRun = useLibraryStore(s => s.lastBackgroundHealingRun);
    const isBackgroundHealingActive = useLibraryStore(s => s.isBackgroundHealingActive);
    const backgroundHealingPaused = useLibraryStore(s => s.backgroundHealingPaused);
    const requestThumbnailOptimizationRun = useLibraryStore(s => s.requestThumbnailOptimizationRun);
    const smartThumbnailStatus = getSmartThumbnailStatus(
        thumbnailDetails,
        isBackgroundHealingActive,
        backgroundHealingPaused
    );
    const showLastThumbnailRun = !thumbnailDetails && Boolean(lastThumbnailRun);
    const failedThumbnailCount = getThumbnailMetricValue(thumbnailDetails, lastThumbnailRun, 'failed');
    const hasKnownThumbnailFailures = failedThumbnailCount > 0;
    const canRetryThumbnailFailures = failureLoadState === 'ready'
        && thumbnailFailures.length > 0
        && !isBackgroundHealingActive
        && !isRetryingFailures;

    const loadThumbnailFailures = React.useCallback(async () => {
        setFailureLoadState('loading');
        setFailureLoadError(null);

        try {
            const result = await unwrap(commands.getThumbnailOptimizationFailures(THUMBNAIL_FAILURE_LIMIT));
            setThumbnailFailures(result.failures);
            setFailureLoadState('ready');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setThumbnailFailures([]);
            setFailureLoadError(message);
            setFailureLoadState('error');
        }
    }, []);

    React.useEffect(() => {
        if (!failurePanelOpen || failureLoadState !== 'idle') {
            return;
        }

        void loadThumbnailFailures();
    }, [
        failureLoadState,
        failurePanelOpen,
        loadThumbnailFailures
    ]);

    const handleThemeToggle = () => {
        const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
        setSettings(prev => ({ ...prev, theme: newTheme }));
        addToast(`Switched to ${newTheme} mode`, 'success');
    };

    const handleConfirmDeleteToggle = () => {
        const newValue = !settings.confirmDelete;
        setSettings(prev => ({ ...prev, confirmDelete: newValue }));
        addToast(newValue ? 'Removal confirmations enabled' : 'Removal confirmations disabled', 'success');
    };

    const handleAutoThumbnailHealingToggle = () => {
        const newValue = !settings.enableAutoThumbnailHealing;
        setSettings(prev => ({ ...prev, enableAutoThumbnailHealing: newValue }));
        addToast(newValue ? 'Smart optimization enabled' : 'Smart optimization disabled', 'success');
    };

    const handleToggleFailures = () => {
        setFailurePanelOpen(open => {
            const nextOpen = !open;
            if (nextOpen && failureLoadState === 'error') {
                setFailureLoadState('idle');
            }
            return nextOpen;
        });
    };

    const handleRetryFailedThumbnails = async () => {
        setIsRetryingFailures(true);

        try {
            const retryCount = await unwrap(commands.retryFailedThumbnailOptimizations());
            await loadThumbnailFailures();
            requestThumbnailOptimizationRun();
            addToast(
                retryCount === 1
                    ? 'Queued 1 thumbnail for retry'
                    : `Queued ${formatNumber(retryCount)} thumbnails for retry`,
                'success'
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            addToast(`Failed to retry thumbnails: ${message}`, 'error');
        } finally {
            setIsRetryingFailures(false);
        }
    };

    return (
        <div className="space-y-8 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Appearance</h4>
                <div
                    onClick={handleThemeToggle}
                    className="flex items-center justify-between cursor-pointer group"
                >
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl transition-colors ${settings.theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700'}`}>
                            {settings.theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                        </div>
                        <div>
                            <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Theme Mode</div>
                            <div className="text-sm text-gray-500">{settings.theme === 'dark' ? 'Dark Mode Active' : 'Light Mode Active'}</div>
                        </div>
                    </div>
                    <button
                        type="button"
                        className="text-xs font-bold px-4 py-2 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
                    >
                        Switch
                    </button>
                </div>
            </section>

            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Library & Files</h4>

                <div
                    onClick={handleAutoThumbnailHealingToggle}
                    className="flex items-center justify-between cursor-pointer group mb-6"
                >
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Smart Thumbnail Optimization</div>
                        </div>
                        <div className="text-sm text-gray-500">Optimizes thumbnails automatically in the background</div>
                    </div>
                    <button
                        type="button"
                        className={`w-12 h-7 rounded-full relative transition-colors ${settings.enableAutoThumbnailHealing ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}
                    >
                        <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${settings.enableAutoThumbnailHealing ? 'left-6' : 'left-1'}`} />
                    </button>
                </div>

                {
                    settings.enableAutoThumbnailHealing && (
                        <div className="mb-6 ml-4 pl-4 border-l-2 border-gray-100 dark:border-white/10 animate-in slide-in-from-left-2 fade-in duration-300 space-y-5">
                            <div
                                onClick={() => {
                                    const newValue = !settings.enforceHighQualityThumbnails;
                                    setSettings(prev => ({ ...prev, enforceHighQualityThumbnails: newValue }));
                                    addToast(newValue ? 'High quality enforcement enabled' : 'High quality enforcement disabled', 'success');
                                }}
                                className="flex items-center justify-between cursor-pointer group"
                            >
                                <div>
                                    <div className="flex items-center gap-2">
                                        <div className="text-sm font-medium text-gray-800 dark:text-gray-300 group-hover:text-sage-500 transition-colors">Upgrade Existing Thumbnails</div>
                                        <span className="text-[10px] font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 px-1.5 py-0.5 rounded">Slow</span>
                                    </div>
                                    <div className="text-xs text-gray-400 mt-0.5">Re-generate "fast" or external thumbnails with high-quality versions</div>
                                </div>
                                <button
                                    type="button"
                                    className={`w-10 h-6 rounded-full relative transition-colors ${settings.enforceHighQualityThumbnails ? 'bg-violet-500' : 'bg-gray-200 dark:bg-white/10'}`}
                                >
                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${settings.enforceHighQualityThumbnails ? 'left-5' : 'left-1'}`} />
                                </button>
                            </div>

                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <div className="text-sm font-medium text-gray-800 dark:text-gray-300">Background Speed</div>
                                    <div className="text-xs text-gray-400 mt-0.5">Controls CPU use while Ambit is idle</div>
                                </div>
                                <div className="inline-flex rounded-lg border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/20 p-0.5">
                                    {THUMBNAIL_PROFILE_OPTIONS.map(option => {
                                        const isActive = (settings.thumbnailOptimizationProfile ?? 'balanced') === option.id;
                                        return (
                                            <button
                                                key={option.id}
                                                type="button"
                                                onClick={() => {
                                                    setSettings(prev => ({ ...prev, thumbnailOptimizationProfile: option.id }));
                                                    addToast(`Thumbnail speed set to ${option.label}`, 'success');
                                                }}
                                                className={`px-2.5 py-1 text-xs font-bold rounded-md transition-colors ${isActive
                                                    ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm'
                                                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                                                    }`}
                                            >
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="border-t border-gray-100 dark:border-white/10 pt-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-medium text-gray-800 dark:text-gray-300">Smart Thumbnail Status</div>
                                    <div className="text-xs font-bold text-gray-600 dark:text-gray-300">{smartThumbnailStatus}</div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                                    {showLastThumbnailRun && lastThumbnailRun && (
                                        <span>Last run {formatDuration(lastThumbnailRun.durationMs)}</span>
                                    )}
                                    <span>Speed {formatRate(getThumbnailMetricValue(thumbnailDetails, lastThumbnailRun, 'imagesPerSecond'))}</span>
                                    <span>Optimized {formatNumber(getThumbnailMetricValue(thumbnailDetails, lastThumbnailRun, 'optimized'))}</span>
                                    <span>Reused {formatNumber(getThumbnailMetricValue(thumbnailDetails, lastThumbnailRun, 'reused'))}</span>
                                    <span>Failed {formatNumber(failedThumbnailCount)}</span>
                                    <span>Skipped {formatNumber(getThumbnailMetricValue(thumbnailDetails, lastThumbnailRun, 'skipped'))}</span>
                                </div>
                                <div className="mt-3">
                                    <button
                                        type="button"
                                        onClick={handleToggleFailures}
                                        className={`inline-flex items-center gap-1.5 text-xs font-bold transition-colors ${hasKnownThumbnailFailures
                                            ? 'text-amber-600 hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-200'
                                            : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                                            }`}
                                    >
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        {failurePanelOpen ? 'Hide failures' : (hasKnownThumbnailFailures ? 'View failures' : 'Check failures')}
                                        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${failurePanelOpen ? 'rotate-180' : ''}`} />
                                    </button>

                                    {failurePanelOpen && (
                                        <div className="mt-3 space-y-3 border-l border-amber-200 dark:border-amber-400/20 pl-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">Recent thumbnail failures</div>
                                                <button
                                                    type="button"
                                                    onClick={handleRetryFailedThumbnails}
                                                    disabled={!canRetryThumbnailFailures}
                                                    className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 hover:text-sage-600 dark:hover:text-sage-300 disabled:opacity-50 disabled:hover:text-gray-700 dark:disabled:hover:text-gray-200 transition-colors"
                                                >
                                                    {isRetryingFailures ? (
                                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    ) : (
                                                        <RefreshCw className="w-3.5 h-3.5" />
                                                    )}
                                                    Retry all
                                                </button>
                                            </div>

                                            {failureLoadState === 'loading' && (
                                                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                    Loading failures...
                                                </div>
                                            )}

                                            {failureLoadState === 'error' && (
                                                <div className="text-xs text-amber-600 dark:text-amber-300">
                                                    Failed to load thumbnail failures: {failureLoadError}
                                                </div>
                                            )}

                                            {failureLoadState === 'ready' && thumbnailFailures.length === 0 && (
                                                <div className="text-xs text-gray-500 dark:text-gray-400">No thumbnail failures found.</div>
                                            )}

                                            {failureLoadState === 'ready' && thumbnailFailures.length > 0 && (
                                                <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                                                    {thumbnailFailures.map(failure => (
                                                        <div key={failure.id} className="text-xs">
                                                            <div className="font-medium text-gray-800 dark:text-gray-200 truncate" title={failure.path}>
                                                                {getFileNameFromPath(failure.path)}
                                                            </div>
                                                            <div className="text-gray-500 dark:text-gray-400 break-all">{failure.path}</div>
                                                            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-gray-400">
                                                                <span>Attempts {formatNumber(failure.failureCount)}</span>
                                                                <span>{formatAttemptTime(failure.lastAttemptAt)}</span>
                                                                <span className="text-amber-600 dark:text-amber-300">{failure.lastError ?? 'Unknown error'}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )
                }

                <div className="border-t border-gray-100 dark:border-white/5 pt-6">
                    <div
                        onClick={handleConfirmDeleteToggle}
                        className="flex items-center justify-between cursor-pointer group"
                    >
                        <div>
                            <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Confirm Deletions</div>
                            <div className="text-sm text-gray-500">Show a warning before removing files from Ambit while keeping them on disk</div>
                        </div>
                        <button
                            type="button"
                            className={`w-12 h-7 rounded-full relative transition-colors ${settings.confirmDelete ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}
                        >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${settings.confirmDelete ? 'left-6' : 'left-1'}`} />
                        </button>
                    </div>
                </div>

            </section >
        </div >
    );
});
