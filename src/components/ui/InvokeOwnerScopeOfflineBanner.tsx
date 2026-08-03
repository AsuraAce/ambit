import * as React from 'react';
import { AlertTriangle, Loader2, RotateCw, Settings } from 'lucide-react';

interface InvokeOwnerScopeOfflineBannerProps {
    isRetrying?: boolean;
    onRetry: () => void | Promise<void>;
    onOpenSettings: () => void;
}

export const InvokeOwnerScopeOfflineBanner: React.FC<InvokeOwnerScopeOfflineBannerProps> = ({
    isRetrying = false,
    onRetry,
    onOpenSettings,
}) => (
    <div
        className="shrink-0 border-b border-amber-500/30 bg-amber-50 px-3 py-2 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100 sm:px-5"
        role="status"
        aria-live="polite"
        data-testid="invoke-owner-offline-banner"
    >
        <div className="mx-auto flex max-w-[1800px] flex-col gap-2 min-[394px]:flex-row min-[394px]:items-center min-[394px]:justify-between">
            <div className="flex min-w-0 items-start gap-2 text-xs leading-5 sm:text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                <span>
                    <strong>InvokeAI is unavailable</strong> — showing your last verified local view. Sync and Live Watch are paused.
                </span>
            </div>
            <div className="flex shrink-0 items-center gap-2 pl-6 min-[394px]:pl-0">
                <button
                    type="button"
                    disabled={isRetrying}
                    onClick={() => void onRetry()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-200/70 px-2.5 py-1.5 text-xs font-bold hover:bg-amber-200 disabled:cursor-wait disabled:opacity-70 dark:bg-amber-500/20 dark:hover:bg-amber-500/30"
                >
                    {isRetrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                    {isRetrying ? 'Retrying…' : 'Retry'}
                </button>
                <button
                    type="button"
                    onClick={onOpenSettings}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold hover:bg-amber-200/60 dark:hover:bg-amber-500/20"
                >
                    <Settings className="h-3.5 w-3.5" />
                    Open Settings
                </button>
            </div>
        </div>
    </div>
);
