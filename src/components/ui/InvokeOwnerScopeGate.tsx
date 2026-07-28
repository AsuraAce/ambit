import * as React from 'react';
import { AlertTriangle, Loader2, RotateCw, Settings, ShieldCheck, Users } from 'lucide-react';
import type { InvokeOwnerScopeState } from '../../contexts/SyncContext';
import type { InvokeOwnerSelection } from '../../types';
import { InvokeOwnerScopeSelector } from './InvokeOwnerScopeSelector';

interface InvokeOwnerScopeGateProps {
    state: InvokeOwnerScopeState;
    onSelect: (selection: InvokeOwnerSelection) => void | Promise<void>;
    onRetry: () => void | Promise<void>;
    onOpenSettings: () => void;
}

const BusyGate: React.FC<{ state: InvokeOwnerScopeState }> = ({ state }) => {
    const progress = state.progress;
    const showCount = (progress?.total ?? 0) > 0;
    const message = progress?.message
        ?? (state.status === 'discovering'
            ? 'Checking InvokeAI owner information...'
            : 'Preparing your InvokeAI library...');

    return (
        <div className="w-full max-w-lg rounded-3xl border border-gray-200 bg-white/80 p-6 text-center shadow-2xl shadow-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/80 sm:p-8">
            <div className="relative mx-auto mb-5 h-14 w-14">
                <div className="absolute inset-0 rounded-2xl bg-sage-500/15" />
                <ShieldCheck className="absolute inset-0 m-auto h-7 w-7 text-sage-600 dark:text-sage-400" />
                <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-sage-600 dark:text-sage-400" />
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

            <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-left dark:border-white/10 dark:bg-black/20">
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
    );
};

export const InvokeOwnerScopeGate: React.FC<InvokeOwnerScopeGateProps> = ({
    state,
    onSelect,
    onRetry,
    onOpenSettings,
}) => {
    const headingRef = React.useRef<HTMLHeadingElement>(null);
    const isBusy = state.status === 'idle'
        || state.status === 'discovering'
        || state.status === 'applying';

    React.useEffect(() => {
        if (!isBusy) headingRef.current?.focus();
    }, [isBusy, state.status]);

    if (isBusy) {
        return (
            <main
                className="flex flex-1 items-center justify-center overflow-y-auto bg-gray-50 p-4 dark:bg-zinc-950 sm:p-8"
                role="status"
                aria-live="polite"
                data-testid="invoke-owner-scope-gate"
            >
                <BusyGate state={state} />
            </main>
        );
    }

    if (state.status === 'selection_required' && state.discovery?.schemaMode === 'multi_user') {
        return (
            <main
                className="flex flex-1 items-start justify-center overflow-y-auto bg-gray-50 p-4 dark:bg-zinc-950 sm:items-center sm:p-8"
                data-testid="invoke-owner-scope-gate"
            >
                <div className="w-full max-w-xl rounded-3xl border border-gray-200 bg-white/90 p-5 shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-zinc-900/90 sm:p-8">
                    <Users className="mb-4 h-8 w-8 text-sage-600 dark:text-sage-400" />
                    <h1 ref={headingRef} tabIndex={-1} className="text-xl font-black text-gray-900 outline-none dark:text-white">
                        Choose which InvokeAI images to show
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
                        This InvokeAI library contains multiple users. Choose one owner or explicitly show all users. Nothing is deleted, and you can change this later in Settings.
                    </p>
                    <div className="mt-6">
                        <InvokeOwnerScopeSelector
                            discovery={state.discovery}
                            selectionRequired
                            onSelect={onSelect}
                        />
                    </div>
                </div>
            </main>
        );
    }

    const isSourceUnavailable = state.failure?.kind === 'source_unavailable';
    const title = isSourceUnavailable
        ? 'InvokeAI needs attention'
        : 'InvokeAI library preparation failed';
    const description = isSourceUnavailable
        ? "Ambit couldn't open the configured InvokeAI database, so InvokeAI content is staying hidden."
        : "Ambit couldn't finish verifying owner visibility. InvokeAI content is staying hidden to avoid showing the wrong library.";

    return (
        <main
            className="flex flex-1 items-center justify-center overflow-y-auto bg-gray-50 p-4 dark:bg-zinc-950 sm:p-8"
            role="alert"
            data-testid="invoke-owner-scope-gate"
        >
            <div className="w-full max-w-lg rounded-3xl border border-rose-200 bg-white/90 p-5 shadow-2xl shadow-black/10 dark:border-rose-500/20 dark:bg-zinc-900/90 sm:p-8">
                <AlertTriangle className="mb-4 h-8 w-8 text-rose-600 dark:text-rose-400" />
                <h1 ref={headingRef} tabIndex={-1} className="text-xl font-black text-gray-900 outline-none dark:text-white">
                    {title}
                </h1>
                <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">{description}</p>
                {state.error && (
                    <details className="mt-5 rounded-xl border border-gray-200 bg-gray-50/80 p-3 text-xs dark:border-white/10 dark:bg-black/20">
                        <summary className="cursor-pointer font-bold text-gray-700 dark:text-gray-200">Technical details</summary>
                        <p className="mt-2 break-words font-mono leading-5 text-gray-500 dark:text-gray-400">{state.error}</p>
                    </details>
                )}
                <div className="mt-6 flex flex-col gap-2 min-[394px]:flex-row">
                    <button
                        type="button"
                        onClick={() => void onRetry()}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-sage-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-sage-500"
                    >
                        <RotateCw className="h-4 w-4" /> Retry
                    </button>
                    <button
                        type="button"
                        onClick={onOpenSettings}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-200 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15"
                    >
                        <Settings className="h-4 w-4" /> Open Settings
                    </button>
                </div>
            </div>
        </main>
    );
};
