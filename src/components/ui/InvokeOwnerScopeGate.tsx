import * as React from 'react';
import { AlertTriangle, CircleStop, RotateCw, Settings, ShieldCheck, Users } from 'lucide-react';
import type { InvokeOwnerScopeState } from '../../contexts/SyncContext';
import type { InvokeOwnerDiscovery, InvokeOwnerSelection } from '../../types';
import { ConfirmDialog } from './ConfirmDialog';
import { InvokeOwnerScopeSelector } from './InvokeOwnerScopeSelector';
import { StartupPreparationCard } from './StartupPreparationCard';
import { useInvokeOwnerScopeStore } from '../../stores/invokeOwnerScopeStore';
import { normalizeInvokeRoot } from '../../utils/pathUtils';

interface InvokeOwnerScopeGateProps {
    state: InvokeOwnerScopeState;
    onSelect: (selection: InvokeOwnerSelection) => void | Promise<void>;
    onRetry: () => void | Promise<void>;
    onOpenSettings: () => void;
    autoFocus?: boolean;
}

const BusyGate: React.FC<{ state: InvokeOwnerScopeState; autoFocus: boolean }> = ({ state, autoFocus }) => {
    const currentOperation = useInvokeOwnerScopeStore(store => store.operation);
    const operation = currentOperation && !currentOperation.viewCommitted
        && !['completed', 'cancelled', 'failed'].includes(currentOperation.phase)
        && (!state.rootPath || normalizeInvokeRoot(currentOperation.rootPath) === normalizeInvokeRoot(state.rootPath))
        ? currentOperation
        : null;
    const headingRef = React.useRef<HTMLHeadingElement>(null);
    const progress = operation?.progress ?? state.progress;
    const scopeIdentity = state.scope?.mode === 'owner'
        ? state.scope.ownerId
        : state.scope?.mode;
    const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
    React.useEffect(() => {
        setElapsedSeconds(0);
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [state.rootPath, scopeIdentity, operation?.id]);

    React.useEffect(() => {
        if (autoFocus) headingRef.current?.focus();
    }, [state.rootPath, scopeIdentity, operation?.id, autoFocus]);

    const operationPhase = operation ? 'preparing' : state.operationPhase ?? 'preparing';
    const isCancelling = operation?.phase === 'cancelling';
    const isSettling = operation?.phase === 'settling';
    const message = isCancelling ? 'Cancelling… Waiting for current work to finish safely.' : progress?.message
        ?? (state.status === 'discovering'
            ? 'Checking InvokeAI owner information...'
            : operationPhase === 'importing'
                ? 'Importing images into your InvokeAI view...'
                : 'Preparing your InvokeAI library...');
    const ownerId = state.scope?.mode === 'owner' ? state.scope.ownerId : undefined;
    const ownerLabel = operation?.targetLabel ?? (state.scope?.mode === 'all'
        ? 'All users'
        : state.scope?.mode === 'legacy'
            ? 'InvokeAI'
            : ownerId
                ? state.discovery?.owners.find(owner => owner.ownerId === ownerId)?.displayName
                    || ownerId
                : undefined);
    const statusMessage = elapsedSeconds >= 5
        ? `${message} · ${elapsedSeconds}s elapsed`
        : message;

    return (
        <StartupPreparationCard
            phaseLabel={operationPhase === 'importing' ? 'Importing images' : 'Preparing view'}
            title={ownerLabel
                ? `Preparing view — ${ownerLabel}`
                : 'Preparing your InvokeAI view'}
            headingRef={headingRef}
            icon={<ShieldCheck className="h-7 w-7" />}
            description="Ambit is loading the images, boards, and filters available in this view."
            statusMessage={statusMessage}
            reassurance="Existing images and collections are kept."
            progress={progress}
            actions={operation && (
                <button
                    type="button"
                    onClick={operation.cancel}
                    disabled={isCancelling || isSettling || !operation.cancel}
                    className="rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-200 disabled:cursor-wait disabled:opacity-60 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15"
                >
                    {isCancelling ? 'Cancelling…' : isSettling ? 'Finishing…' : 'Cancel'}
                </button>
            )}
        />
    );
};

const getAllUsersMessage = (discovery: InvokeOwnerDiscovery): string => {
    const unassignedBoards = discovery.unassignedBoardCount ?? 0;
    const unassignedDetails = [
        discovery.unassignedImageCount > 0
            ? `${discovery.unassignedImageCount.toLocaleString()} unassigned image rows`
            : null,
        unassignedBoards > 0
            ? `${unassignedBoards.toLocaleString()} unassigned boards`
            : null,
    ].filter((value): value is string => value !== null).join(' and ');

    return unassignedDetails
        ? `Ambit will show every owner's InvokeAI content, including ${unassignedDetails}, across the gallery, collections, maintenance views, and references. You can return to a single owner at any time.`
        : "Ambit will show every owner's InvokeAI images and boards from this local database. You can return to a single owner at any time.";
};

export const InvokeOwnerScopeGate: React.FC<InvokeOwnerScopeGateProps> = ({
    state,
    onSelect,
    onRetry,
    onOpenSettings,
    autoFocus = true,
}) => {
    const operation = useInvokeOwnerScopeStore(store => store.operation);
    const headingRef = React.useRef<HTMLHeadingElement>(null);
    const openViewRef = React.useRef<HTMLButtonElement>(null);
    const submitErrorRef = React.useRef<HTMLParagraphElement>(null);
    const isSubmittingRef = React.useRef(false);
    const [pendingSelection, setPendingSelection] = React.useState<InvokeOwnerSelection>();
    const [isAllUsersConfirmOpen, setIsAllUsersConfirmOpen] = React.useState(false);
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const [submitError, setSubmitError] = React.useState<string | null>(null);
    const isBusy = state.status === 'idle'
        || state.status === 'discovering'
        || state.status === 'applying';
    const discovery = state.discovery;
    const discoverySource = discovery
        ? `${discovery.dbPath}\u0000${discovery.imagesRoot}`
        : '';

    React.useEffect(() => {
        if (!isBusy && autoFocus) headingRef.current?.focus();
    }, [isBusy, state.status, autoFocus]);

    React.useEffect(() => {
        setPendingSelection(undefined);
        setIsAllUsersConfirmOpen(false);
        setSubmitError(null);
    }, [discoverySource]);

    React.useEffect(() => {
        if (state.status !== 'selection_required') {
            isSubmittingRef.current = false;
            setIsSubmitting(false);
            setIsAllUsersConfirmOpen(false);
        }
    }, [state.status]);

    React.useEffect(() => {
        if (pendingSelection && state.status === 'selection_required') {
            openViewRef.current?.focus();
        }
    }, [pendingSelection, state.status]);

    React.useEffect(() => {
        if (submitError) submitErrorRef.current?.focus();
    }, [submitError]);

    const submitSelection = React.useCallback(async (selection: InvokeOwnerSelection) => {
        if (isSubmittingRef.current) return;

        isSubmittingRef.current = true;
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            await onSelect(selection);
            isSubmittingRef.current = false;
            setIsSubmitting(false);
            openViewRef.current?.focus();
        } catch (error) {
            isSubmittingRef.current = false;
            setIsSubmitting(false);
            setSubmitError(error instanceof Error ? error.message : 'Could not open this InvokeAI view.');
        }
    }, [onSelect]);

    const handleOpenView = React.useCallback(() => {
        if (!pendingSelection || isSubmitting) return;
        if (pendingSelection.mode === 'all') {
            setIsAllUsersConfirmOpen(true);
            return;
        }
        void submitSelection(pendingSelection);
    }, [isSubmitting, pendingSelection, submitSelection]);

    const handleConfirmAllUsers = React.useCallback(() => {
        if (!pendingSelection || pendingSelection.mode !== 'all' || isSubmitting) return;
        setIsAllUsersConfirmOpen(false);
        void submitSelection(pendingSelection);
    }, [isSubmitting, pendingSelection, submitSelection]);

    if (isBusy) {
        return (
            <main
                className="flex flex-1 items-center justify-center overflow-y-auto bg-gray-50 p-4 dark:bg-zinc-950 sm:p-8"
                data-testid="invoke-owner-scope-gate"
            >
                <BusyGate state={state} autoFocus={autoFocus} />
            </main>
        );
    }

    if (state.status === 'selection_required' && discovery?.schemaMode === 'multi_user') {
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
                    <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
                        Open the view to sync using your saved import options.
                    </p>
                    <div className="mt-6">
                        <InvokeOwnerScopeSelector
                            discovery={discovery}
                            selection={pendingSelection}
                            disabled={isSubmitting}
                            selectionRequired
                            onSelect={(selection) => {
                                setSubmitError(null);
                                setPendingSelection(selection);
                            }}
                        />
                    </div>
                    {submitError && (
                        <p
                            ref={submitErrorRef}
                            tabIndex={-1}
                            role="alert"
                            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 outline-none dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
                        >
                            {submitError}
                        </p>
                    )}
                    <button
                        ref={openViewRef}
                        type="button"
                        onClick={handleOpenView}
                        disabled={!pendingSelection || isSubmitting}
                        className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-sage-600 px-4 py-3 text-sm font-bold text-white hover:bg-sage-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isSubmitting ? 'Opening view…' : 'Open view'}
                    </button>
                    <ConfirmDialog
                        isOpen={isAllUsersConfirmOpen}
                        title="Show images from all InvokeAI users?"
                        message={getAllUsersMessage(discovery)}
                        confirmLabel="Show All Users"
                        onConfirm={handleConfirmAllUsers}
                        onCancel={() => {
                            if (!isSubmitting) setIsAllUsersConfirmOpen(false);
                        }}
                        isLoading={isSubmitting}
                        zIndex={220}
                    />
                </div>
            </main>
        );
    }

    const isSourceUnavailable = state.failure?.kind === 'source_unavailable';
    const isCancelled = state.failure?.kind === 'preparation_cancelled';
    const retryOperation = operation?.retry
        && normalizeInvokeRoot(operation.rootPath) === normalizeInvokeRoot(state.rootPath)
        ? operation.retry
        : onRetry;
    const title = isCancelled
        ? 'InvokeAI preparation cancelled'
        : isSourceUnavailable ? 'InvokeAI needs attention' : 'InvokeAI library preparation failed';
    const description = isCancelled
        ? 'Your connection and import options are saved for retry. InvokeAI content stays hidden until preparation finishes.'
        : isSourceUnavailable
            ? "Ambit couldn't open the configured InvokeAI database, so InvokeAI content is staying hidden."
            : "Ambit couldn't finish verifying owner visibility. InvokeAI content is staying hidden to avoid showing the wrong library.";

    return (
        <main
            className="flex flex-1 items-center justify-center overflow-y-auto bg-gray-50 p-4 dark:bg-zinc-950 sm:p-8"
            role={isCancelled ? 'status' : 'alert'}
            data-testid="invoke-owner-scope-gate"
        >
            <div className={`w-full max-w-lg rounded-3xl border bg-white/90 p-5 shadow-2xl shadow-black/10 dark:bg-zinc-900/90 sm:p-8 ${isCancelled ? 'border-gray-200 dark:border-white/10' : 'border-red-200 dark:border-red-500/20'}`}>
                {isCancelled
                    ? <CircleStop className="mb-4 h-8 w-8 text-gray-600 dark:text-gray-300" />
                    : <AlertTriangle className="mb-4 h-8 w-8 text-red-600 dark:text-red-300" />}
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
                        onClick={() => void retryOperation()}
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
