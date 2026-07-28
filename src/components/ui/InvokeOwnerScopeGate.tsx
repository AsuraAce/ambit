import * as React from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import type { InvokeOwnerScopeState } from '../../contexts/SyncContext';

interface InvokeOwnerScopeGateProps {
    state: InvokeOwnerScopeState;
}

export const InvokeOwnerScopeGate: React.FC<InvokeOwnerScopeGateProps> = ({ state }) => {
    const progress = state.progress;
    const showCount = (progress?.total ?? 0) > 0;
    const message = progress?.message
        ?? (state.status === 'discovering'
            ? 'Checking InvokeAI owner information...'
            : 'Preparing your InvokeAI library...');

    return (
        <main
            className="flex-1 flex items-center justify-center p-8 bg-gray-50 dark:bg-zinc-950"
            role="status"
            aria-live="polite"
            data-testid="invoke-owner-scope-gate"
        >
            <div className="w-full max-w-lg rounded-3xl border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-zinc-900/80 p-8 text-center shadow-2xl shadow-black/10 backdrop-blur-xl">
                <div className="relative mx-auto mb-5 h-14 w-14">
                    <div className="absolute inset-0 rounded-2xl bg-sage-500/15" />
                    <ShieldCheck className="absolute inset-0 m-auto h-7 w-7 text-sage-600 dark:text-sage-400" />
                    <Loader2 className="absolute -right-1 -bottom-1 h-5 w-5 animate-spin text-sage-600 dark:text-sage-400" />
                </div>
                <h1 className="text-xl font-black text-gray-900 dark:text-white">
                    Preparing your InvokeAI library
                </h1>
                <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Ambit is updating which InvokeAI images, boards, filters, and statistics belong in this view.
                </p>
                <p className="mt-2 text-sm font-semibold text-sage-700 dark:text-sage-300">
                    No images or collections are being deleted.
                </p>

                <div className="mt-6 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50/80 dark:bg-black/20 px-4 py-3 text-left">
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold text-gray-600 dark:text-gray-300">
                        <span>{message}</span>
                        {showCount && (
                            <span className="shrink-0 font-mono text-gray-500">
                                {progress?.current.toLocaleString()} / {progress?.total.toLocaleString()}
                            </span>
                        )}
                    </div>
                    <div
                        className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
                        role="progressbar"
                        aria-label={message}
                        aria-valuemin={showCount ? 0 : undefined}
                        aria-valuemax={showCount ? progress?.total : undefined}
                        aria-valuenow={showCount ? progress?.current : undefined}
                    >
                        {showCount ? (
                            <div
                                className="h-full rounded-full bg-sage-500 transition-[width] duration-300"
                                style={{ width: `${Math.min(100, ((progress?.current ?? 0) / (progress?.total ?? 1)) * 100)}%` }}
                            />
                        ) : (
                            <div className="h-full w-1/3 animate-pulse rounded-full bg-sage-500" />
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
};
