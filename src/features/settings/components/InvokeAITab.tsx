import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DatabaseZap, Folder, Info, Globe, Loader2, CheckCircle2, XCircle, Activity, BarChart3, Search, Database, Files, AlertTriangle, FolderOpen, Users, RotateCcw } from 'lucide-react';
import { AppSettings } from '../../../types';
import { InvokeRecoverySection, SyncSection } from './SyncSection';
import { areDeveloperFeaturesEnabled } from '../../../utils/settingsUtils';
import { useLibrary } from '../../../contexts/LibraryContext';
import { InvokeOwnerScopeSelector } from '../../../components/ui/InvokeOwnerScopeSelector';
import { isSameInvokePath } from '../../../services/invoke/pathIdentity';
import {
    isSameInvokeConnectionSource,
    isSameInvokeOwnerSelection,
} from '../../../services/invoke/connectionDraft';
import {
    getSuppressedInvokeCollections,
    restoreInvokeCollection,
    type SuppressedInvokeCollection,
} from '../../../services/db/collectionRepo';
import { useCollectionStore } from '../../../stores/collectionStore';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { validateInvokeConnectionDraft, type InvokeConnectionDraftSession } from '../hooks/useInvokeConnectionDraft';
import { isStaleInvokeOwnerDiscoveryRequestError, type InvokeOwnerDiscoverySession } from '../hooks/useInvokeOwnerDiscovery';
import { useInvokeOwnerScopeStore } from '../../../stores/invokeOwnerScopeStore';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    draftSession: InvokeConnectionDraftSession;
    ownerDiscoverySession: InvokeOwnerDiscoverySession;
    onClose?: () => void;
}

interface InvokeDiagCount {
    count: number;
}

interface InvokeCategoryDiag extends InvokeDiagCount {
    image_category: string;
}

interface InvokeOriginDiag extends InvokeDiagCount {
    image_origin: string;
}

interface InvokeFolderAudit {
    imageFiles: number;
    thumbnailFiles: number;
    subfolders: Record<string, number>;
}

interface InvokeDiagnostics {
    totalInDb: number;
    categories: InvokeCategoryDiag[];
    origins: InvokeOriginDiag[];
    folder: InvokeFolderAudit;
}

export const InvokeAITab: React.FC<TabProps> = React.memo(({ settings, setSettings, draftSession, ownerDiscoverySession, onClose }) => {
    const {
        invokeOwnerScopeState,
        retryInvokeOwnerScope,
        applyInvokeConnection,
        cancelSync,
        syncState,
        isInvokeSyncActive,
        isLiveSyncing,
    } = useLibrary();
    const { draft, update, selectOwner, discard, isDirty } = draftSession;
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [applyResult, setApplyResult] = useState<string | null>(null);
    const [isAllUsersConfirmOpen, setIsAllUsersConfirmOpen] = useState(false);
    const [diagData, setDiagData] = useState<InvokeDiagnostics | null>(null);
    const [isDiagLoading, setIsDiagLoading] = useState(false);
    const [hiddenCollections, setHiddenCollections] = useState<SuppressedInvokeCollection[]>([]);
    const [restoringCollectionId, setRestoringCollectionId] = useState<string | null>(null);
    const applyResultRef = useRef<HTMLDivElement>(null);
    const applyInFlightRef = useRef(false);
    const primaryActionRef = useRef<HTMLButtonElement>(null);
    const mountedRef = useRef(true);
    const operation = useInvokeOwnerScopeStore(state => state.operation);
    const isOperationPending = operation !== null
        && !['completed', 'cancelled', 'failed'].includes(operation.phase);
    const refreshCollections = useCollectionStore(state => state.refreshCollections);
    const developerFeaturesEnabled = areDeveloperFeaturesEnabled(settings);
    const draftRoot = draft.invokeAiPath.trim();
    const draftRootRef = useRef(draftRoot);
    const matchingAppliedSource = isSameInvokeConnectionSource(draftRoot, settings.invokeAiPath ?? '');
    const ownerDiscovery = ownerDiscoverySession.discovery
        ?? (matchingAppliedSource && ownerDiscoverySession.canUseAppliedDiscovery ? invokeOwnerScopeState.discovery : undefined);
    const matchingDraftSelection = draft.invokeOwnerSelection && ownerDiscovery
        && isSameInvokePath(draft.invokeOwnerSelection.dbPath, ownerDiscovery.dbPath)
        ? draft.invokeOwnerSelection
        : undefined;
    const ownerSelection = matchingDraftSelection?.mode === 'owner'
        && !ownerDiscovery?.owners.some(owner => owner.ownerId === matchingDraftSelection.ownerId)
        ? undefined
        : matchingDraftSelection;
    const ownerScopeInProgress = invokeOwnerScopeState.status === 'discovering'
        || invokeOwnerScopeState.status === 'applying';
    const ownerScopeBusy = ownerScopeInProgress || invokeOwnerScopeState.isRetrying === true;
    const foregroundInvokeSyncActive = isInvokeSyncActive && !isLiveSyncing;
    const rootControlsBusy = ownerScopeBusy || foregroundInvokeSyncActive || isApplying;
    const rootControlsLocked = ownerScopeBusy || isInvokeSyncActive || isApplying;
    const scopeControlsBusy = ownerScopeBusy || foregroundInvokeSyncActive || isApplying;
    const singleOwner = ownerDiscovery?.schemaMode === 'multi_user'
        && ownerDiscovery.owners.length === 1
        && ownerDiscovery.unassignedImageCount === 0
        && (ownerDiscovery.unassignedBoardCount ?? 0) === 0
        ? ownerDiscovery.owners[0]
        : undefined;

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => {
        draftRootRef.current = draftRoot;
    }, [draftRoot]);

    useEffect(() => {
        if (!singleOwner || ownerSelection || isApplying) return;
        selectOwner({
            dbPath: ownerDiscovery!.dbPath,
            mode: 'owner',
            ownerId: singleOwner.ownerId,
        });
    }, [isApplying, ownerDiscovery, ownerSelection, selectOwner, singleOwner]);

    useEffect(() => {
        let cancelled = false;
        if (!settings.invokeAiPath) {
            setHiddenCollections([]);
            return () => { cancelled = true; };
        }
        void getSuppressedInvokeCollections()
            .then(collections => {
                if (!cancelled) setHiddenCollections(collections);
            })
            .catch(error => console.error('[InvokeAI] Failed to load hidden collections', error));
        return () => { cancelled = true; };
    }, [settings.invokeAiPath, invokeOwnerScopeState.status]);

    const handleRestoreCollection = async (collection: SuppressedInvokeCollection) => {
        setRestoringCollectionId(collection.id);
        try {
            await restoreInvokeCollection(collection.id);
            await refreshCollections(false, { consistency: 'authoritative' });
            setHiddenCollections(current => current.filter(item => item.id !== collection.id));
        } catch (error) {
            console.error('[InvokeAI] Failed to restore hidden collection', error);
        } finally {
            setRestoringCollectionId(null);
        }
    };

    const handleOwnerSelection = (selection: NonNullable<typeof ownerSelection>) => {
        selectOwner(selection);
    };

    const handleOwnerRetry = async () => {
        if (isDirty || isApplying || isInvokeSyncActive) return;
        await retryInvokeOwnerScope();
    };

    const runDiagnostics = async () => {
        setIsDiagLoading(true);
        try {
            const { diagnoseInvokeAI } = await import('../../../services/invoke/connection');
            const dbDiag = await diagnoseInvokeAI(settings.invokeAiPath!) as Omit<InvokeDiagnostics, 'folder'>;
            const folderAudit = await invoke<InvokeFolderAudit>('audit_invokeai_folder', { path: settings.invokeAiPath! });

            setDiagData({
                ...dbDiag,
                folder: folderAudit
            });
        } catch (e) {
            console.error(e);
        } finally {
            setIsDiagLoading(false);
        }
    };

    const handleTestConnection = async () => {
        if (!draftRoot || rootControlsLocked) return;
        setIsTesting(true);
        setTestResult(null);

        try {
            const discovery = await ownerDiscoverySession.inspect(draftRoot);
            if (!isSameInvokeConnectionSource(draftRootRef.current, draftRoot)) return;
            setTestResult({
                success: true,
                message: discovery.schemaMode === 'legacy'
                    ? 'Connected to a legacy InvokeAI database.'
                    : `Connected! Found ${discovery.owners.length.toLocaleString()} owner${discovery.owners.length === 1 ? '' : 's'}.`,
            });
        } catch (e) {
            if (isStaleInvokeOwnerDiscoveryRequestError(e) || !isSameInvokeConnectionSource(draftRootRef.current, draftRoot)) return;
            console.error(e);
            setTestResult({
                success: false,
                message: e instanceof Error ? e.message : 'Failed to inspect the InvokeAI database.',
            });
        } finally {
            setIsTesting(false);
        }
    };

    const handleBrowse = async () => {
        if (rootControlsLocked) return;

        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                directory: true,
                multiple: false,
                title: 'Select InvokeAI Root Folder'
            });

            if (selected && typeof selected === 'string') {
                setIsTesting(true);
                update({
                    invokeAiPath: selected,
                    invokeOwnerSelection: isSameInvokeConnectionSource(selected, draft.invokeAiPath)
                        ? draft.invokeOwnerSelection
                        : undefined,
                });
                setTestResult(null);
                try {
                    const discovery = await ownerDiscoverySession.inspect(selected);
                    if (!isSameInvokeConnectionSource(draftRootRef.current, selected)) return;
                    setTestResult({
                        success: true,
                        message: discovery.schemaMode === 'legacy'
                            ? 'Connected to a legacy InvokeAI database.'
                            : `Connected! Found ${discovery.owners.length.toLocaleString()} owner${discovery.owners.length === 1 ? '' : 's'}.`,
                    });
                } catch (error) {
                    if (isStaleInvokeOwnerDiscoveryRequestError(error) || !isSameInvokeConnectionSource(draftRootRef.current, selected)) return;
                    console.error(error);
                    setTestResult({
                        success: false,
                        message: error instanceof Error ? error.message : 'Failed to inspect the InvokeAI database.',
                    });
                } finally {
                    setIsTesting(false);
                }
            }
        } catch (e) {
            console.error(e);
        }
    };

    const validatedDraft = validateInvokeConnectionDraft(draft, ownerDiscovery);
    const selectionRequired = ownerDiscovery?.schemaMode === 'multi_user' && !ownerSelection;
    const sourceChanged = !matchingAppliedSource;
    const ownerSelectionChanged = !isSameInvokeOwnerSelection(
        ownerSelection,
        settings.invokeOwnerSelection,
    );
    const ownerChanged = !sourceChanged && ownerSelectionChanged;
    const primaryActionLabel = sourceChanged ? 'Connect & Import' : ownerChanged ? 'Switch view' : 'Sync now';
    const actionDisabled = !validatedDraft.valid || rootControlsLocked || isTesting;

    const handleApply = async () => {
        if (actionDisabled || applyInFlightRef.current) return;
        applyInFlightRef.current = true;
        setIsApplying(true);
        setApplyResult(null);
        let continuesInGallery = false;
        try {
            const outcome = onClose && (sourceChanged || ownerChanged)
                ? await applyInvokeConnection(validatedDraft.draft, {
                    onAccepted: () => {
                        continuesInGallery = true;
                        onClose();
                    },
                })
                : await applyInvokeConnection(validatedDraft.draft);
            if (!mountedRef.current || continuesInGallery) return;
            const message = outcome.status === 'completed'
                ? `${primaryActionLabel} completed.`
                : ('message' in outcome ? outcome.message : undefined) ?? `InvokeAI ${outcome.status.replace('_', ' ')}.`;
            setApplyResult(message);
        } catch (error) {
            console.error(error);
            if (mountedRef.current && !continuesInGallery) {
                setApplyResult(error instanceof Error ? error.message : 'Failed to apply the InvokeAI connection.');
            }
        } finally {
            applyInFlightRef.current = false;
            if (mountedRef.current && !continuesInGallery) {
                setIsApplying(false);
                requestAnimationFrame(() => {
                    if (mountedRef.current) applyResultRef.current?.focus();
                });
            }
        }
    };

    const handlePrimaryAction = () => {
        if (actionDisabled) return;
        if (ownerSelection?.mode === 'all' && (sourceChanged || ownerChanged)) {
            setIsAllUsersConfirmOpen(true);
            return;
        }
        void handleApply();
    };

    const describeSelection = (selection?: typeof ownerSelection): string => {
        if (!selection) return 'No owner selected';
        if (selection.mode === 'all') return 'All users';
        return ownerDiscovery?.owners.find(owner => owner.ownerId === selection.ownerId)?.displayName
            || selection.ownerId;
    };

    return (
        <div className="space-y-8 max-w-2xl">

            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
                <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-300 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                    <DatabaseZap className="w-4 h-4" /> InvokeAI Configuration
                </h4>

                <div className="space-y-6">
                    <div className="relative">
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">
                            Root Installation Path
                        </label>
                        <div className="flex gap-2">
                            <div className="flex-1 relative group">
                                <input
                                    type="text"
                                    value={draft.invokeAiPath}
                                    disabled={rootControlsBusy}
                                    readOnly={isLiveSyncing}
                                    aria-disabled={rootControlsLocked}
                                    title={rootControlsLocked ? 'Wait for the current InvokeAI sync to finish' : undefined}
                                    onChange={(e) => {
                                        if (rootControlsLocked) return;
                                        const nextPath = e.target.value;
                                        draftRootRef.current = nextPath.trim();
                                        update({
                                            invokeAiPath: nextPath,
                                            invokeOwnerSelection: isSameInvokeConnectionSource(nextPath, draft.invokeAiPath)
                                                ? draft.invokeOwnerSelection
                                                : undefined,
                                        });
                                        setTestResult(null);
                                        setApplyResult(null);
                                        ownerDiscoverySession.invalidate(nextPath);
                                    }}
                                    placeholder="e.g. C:\\AI\\invokeai"
                                    className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-sage-500 focus:ring-1 focus:ring-sage-500/50 outline-none text-gray-900 dark:text-white font-mono transition-all"
                                />
                                <Folder className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-sage-500 transition-colors" />
                            </div>
                            <button
                                type="button"
                                onClick={handleBrowse}
                                disabled={rootControlsBusy}
                                aria-disabled={rootControlsLocked}
                                title={rootControlsLocked ? 'Wait for the current InvokeAI sync to finish' : undefined}
                                className="px-4 py-2.5 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-white/20 active:scale-95 transition-all text-sm font-bold"
                            >
                                Browse
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-3 flex items-center gap-1.5 opacity-80">
                            <Info className="w-3 h-3" /> Select the folder containing <code>databases/invokeai.db</code>.
                        </p>
                        {settings.invokeAiPath && !matchingAppliedSource && (
                            <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
                                Active connection: <code>{settings.invokeAiPath}</code>. The path above is a draft until you apply it.
                            </p>
                        )}
                        {isDirty && matchingAppliedSource && (
                            <p className="mt-2 text-[10px] text-ember-600 dark:text-ember-300">Draft import options have not been applied.</p>
                        )}
                        {foregroundInvokeSyncActive && syncState.status === 'syncing' && (
                            <p className="text-[10px] text-ember-600 dark:text-ember-300 mt-2">
                                The InvokeAI path and owner scope are locked until synchronization finishes.
                            </p>
                        )}
                    </div>

                    <div className="pt-4 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
                        <button
                            onClick={handleTestConnection}
                            disabled={rootControlsBusy || isTesting || !draftRoot}
                            className={`px-6 py-2.5 rounded-xl text-sm font-black tracking-wide transition-all flex items-center gap-2.5 ${!draftRoot
                                ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                                : 'bg-sage-600 hover:bg-sage-500 text-white shadow-xl shadow-sage-500/20 active:scale-95'
                                }`}
                        >
                            {isTesting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Verifying...
                                </>
                            ) : (
                                <>
                                    <Globe className="w-4 h-4" />
                                    Test Connection
                                </>
                            )}
                        </button>

                        {testResult && (
                            <div className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 animate-in fade-in duration-150 motion-reduce:animate-none ${testResult.success
                                ? 'bg-sage-500/10 text-sage-600 dark:text-sage-300'
                                : 'bg-red-500/10 text-red-600 dark:text-red-300'
                                }`}>
                                {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                {testResult.message}
                            </div>
                        )}
                    </div>

                </div>
            </section>

            {draftRoot && (
                <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden">
                    <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-300 uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
                        <Users className="w-4 h-4" /> InvokeAI Owner Scope
                    </h4>

                    {ownerDiscovery?.schemaMode === 'multi_user' && (
                        <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-[10px] text-gray-500 dark:border-white/10 dark:bg-black/20 dark:text-gray-400">
                            <p>Active view: <span className="font-bold text-gray-700 dark:text-gray-200">{matchingAppliedSource ? describeSelection(settings.invokeOwnerSelection) : 'current connection'}</span></p>
                            {(sourceChanged || ownerSelectionChanged) && ownerSelection && <p className="mt-1">Pending view: <span className="font-bold text-sage-600 dark:text-sage-300">{describeSelection(ownerSelection)}</span></p>}
                        </div>
                    )}

                    {matchingAppliedSource && ownerScopeInProgress && (
                        <div className="flex items-start gap-3 text-sm text-gray-500" role="status" aria-live="polite">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>
                                <span className="block">
                                    {invokeOwnerScopeState.progress?.message
                                        ?? (invokeOwnerScopeState.status === 'discovering'
                                            ? 'Checking InvokeAI owner information...'
                                            : 'Preparing your InvokeAI library...')}
                                </span>
                                {(invokeOwnerScopeState.progress?.total ?? 0) > 0 && (
                                    <span className="mt-1 block text-[10px] font-mono text-gray-400">
                                        {invokeOwnerScopeState.progress?.current.toLocaleString()} / {invokeOwnerScopeState.progress?.total.toLocaleString()}
                                    </span>
                                )}
                            </span>
                        </div>
                    )}

                    {matchingAppliedSource && invokeOwnerScopeState.status === 'error' && (
                        <div className={`p-4 rounded-xl border ${invokeOwnerScopeState.failure?.kind === 'preparation_cancelled'
                            ? 'bg-harbor-500/10 border-harbor-500/20 text-harbor-600 dark:text-harbor-300'
                            : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-300'}`}>
                            <p className="text-xs font-bold">
                                {invokeOwnerScopeState.failure?.kind === 'preparation_cancelled'
                                    ? 'InvokeAI preparation cancelled'
                                    : invokeOwnerScopeState.failure?.kind === 'source_unavailable'
                                        ? 'InvokeAI connection unavailable'
                                        : 'InvokeAI library preparation failed'}
                            </p>
                            <p className="mt-1 text-[10px] leading-4">
                                {invokeOwnerScopeState.failure?.kind === 'preparation_cancelled'
                                    ? 'Your connection and import options are saved for retry. InvokeAI content stays hidden until preparation finishes.'
                                    : invokeOwnerScopeState.failure?.kind === 'source_unavailable'
                                        ? 'Ambit could not verify this InvokeAI database, so its content remains hidden.'
                                        : 'Ambit could not finish verifying owner visibility, so its content remains hidden.'}
                            </p>
                            {invokeOwnerScopeState.error && (
                                <details className="mt-3 text-[10px]">
                                    <summary className="cursor-pointer font-bold">Technical details</summary>
                                    <p className="mt-1 break-words font-mono">{invokeOwnerScopeState.error}</p>
                                </details>
                            )}
                            <button type="button" disabled={isDirty || isApplying || isInvokeSyncActive} onClick={() => void handleOwnerRetry()} className={`mt-3 px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50 ${invokeOwnerScopeState.failure?.kind === 'preparation_cancelled'
                                ? 'bg-sage-600 text-white hover:bg-sage-500'
                                : 'bg-red-500/15 text-red-600 dark:text-red-300'}`}>
                                Retry
                            </button>
                        </div>
                    )}

                    {matchingAppliedSource && invokeOwnerScopeState.status === 'offline_ready' && (
                        <div className="rounded-xl border border-ember-500/20 bg-ember-500/10 p-4 text-ember-600 dark:text-ember-300">
                            <p className="text-xs font-bold">Using the last verified local view</p>
                            <p className="mt-1 text-[10px] leading-4">
                                InvokeAI is unavailable. Your verified library remains visible, but Sync and Live Watch are paused.
                            </p>
                            {invokeOwnerScopeState.error && (
                                <details className="mt-3 text-[10px]">
                                    <summary className="cursor-pointer font-bold">Technical details</summary>
                                    <p className="mt-1 break-words font-mono">{invokeOwnerScopeState.error}</p>
                                </details>
                            )}
                            <button
                                type="button"
                                disabled={invokeOwnerScopeState.isRetrying || isDirty || isApplying || isInvokeSyncActive}
                                onClick={() => void handleOwnerRetry()}
                                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-ember-500/15 px-3 py-2 text-[10px] font-black uppercase tracking-wider disabled:cursor-wait disabled:opacity-60"
                            >
                                {invokeOwnerScopeState.isRetrying && <Loader2 className="h-3 w-3 animate-spin" />}
                                {invokeOwnerScopeState.isRetrying ? 'Retrying…' : 'Retry connection'}
                            </button>
                        </div>
                    )}

                    {matchingAppliedSource && !ownerScopeBusy
                        && invokeOwnerScopeState.status !== 'error'
                        && invokeOwnerScopeState.status !== 'offline_ready'
                        && invokeOwnerScopeState.warning && (
                        <div className="mb-4 rounded-xl border border-ember-500/20 bg-ember-500/10 p-4 text-xs text-ember-600 dark:text-ember-300">
                            {invokeOwnerScopeState.warning}
                        </div>
                    )}

                    {!ownerScopeBusy
                        && (!matchingAppliedSource || (invokeOwnerScopeState.status !== 'error'
                            && invokeOwnerScopeState.status !== 'offline_ready'))
                        && ownerDiscovery?.schemaMode === 'legacy' && (
                        <div className="p-4 rounded-xl bg-sage-500/10 border border-sage-500/20 text-xs text-gray-600 dark:text-gray-300">
                            This InvokeAI database predates per-user ownership. Ambit keeps the existing unscoped behavior.
                        </div>
                    )}

                    {!ownerScopeBusy
                        && (!matchingAppliedSource || (invokeOwnerScopeState.status !== 'error'
                            && invokeOwnerScopeState.status !== 'offline_ready'))
                        && singleOwner && (
                        <div className="rounded-xl border border-sage-500/20 bg-sage-500/10 p-4 text-gray-700 dark:text-gray-200">
                            <p className="text-xs font-bold">
                                {singleOwner.displayName || singleOwner.ownerId}
                            </p>
                            <p className="mt-1 text-[10px] font-mono text-gray-500 dark:text-gray-400">
                                {singleOwner.ownerId} · {(singleOwner.imageCount - (singleOwner.intermediateImageCount ?? 0)).toLocaleString()}
                                {singleOwner.intermediateImageCount ? ' standard images' : ' images'}
                            </p>
                            {!!singleOwner.intermediateImageCount && (
                                <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                                    {singleOwner.intermediateImageCount.toLocaleString()} intermediates
                                </p>
                            )}
                            <p className="mt-3 text-xs leading-5 text-gray-600 dark:text-gray-300">
                                Ambit found one InvokeAI owner and selected it automatically. All users would show the same library, so no scope switch is needed.
                            </p>
                        </div>
                    )}

                    {!ownerScopeBusy
                        && (!matchingAppliedSource || (invokeOwnerScopeState.status !== 'error'
                            && invokeOwnerScopeState.status !== 'offline_ready'))
                        && ownerDiscovery?.schemaMode === 'multi_user'
                        && !singleOwner && (
                        <InvokeOwnerScopeSelector
                            discovery={ownerDiscovery}
                            selection={ownerSelection}
                            disabled={scopeControlsBusy}
                            selectionRequired={selectionRequired}
                            onSelect={handleOwnerSelection}
                        />
                    )}
                </section>
            )}

            <SyncSection
                draftSession={draftSession}
                ownerDiscovery={ownerDiscovery}
                isApplying={isApplying}
            />

            {(draftRoot || isDirty) && (
                <section className="rounded-xl border border-sage-500/20 bg-sage-500/5 p-6 shadow-sm">
                    <p className="text-xs leading-5 text-gray-600 dark:text-gray-300">
                        {sourceChanged
                            ? 'Connect & Import catalogs the selected images in Ambit. Existing images and collections are kept.'
                            : ownerChanged
                                ? 'Switch view may synchronize the selected owner using these options.'
                                : 'Sync the active InvokeAI view using these import options.'}
                    </p>
                    <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">Changes apply when you click the action below.</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
                        <button
                            ref={primaryActionRef}
                            type="button"
                            onClick={handlePrimaryAction}
                            disabled={actionDisabled}
                            className="rounded-xl bg-sage-600 px-6 py-2.5 text-sm font-black tracking-wide text-white shadow-xl shadow-sage-500/20 transition-all hover:bg-sage-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isApplying ? 'Applying…' : primaryActionLabel}
                        </button>
                        {isDirty && (
                            <button type="button" onClick={() => { discard(); ownerDiscoverySession.reset(); }} disabled={isApplying} className="rounded-xl bg-gray-100 px-4 py-2.5 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20">
                                Discard changes
                            </button>
                        )}
                        {((foregroundInvokeSyncActive && syncState.status === 'syncing') || isOperationPending) && (
                            <button
                                type="button"
                                onClick={operation?.cancel ?? cancelSync}
                                disabled={operation?.phase === 'cancelling' || operation?.phase === 'settling'}
                                className="rounded-xl bg-red-500/10 px-4 py-2.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-300"
                            >
                                {operation?.phase === 'cancelling' ? 'Cancelling…' : operation?.phase === 'settling' ? 'Finishing…' : 'Cancel sync'}
                            </button>
                        )}
                        {selectionRequired && <span className="text-[10px] text-ember-600 dark:text-ember-300">Choose an owner or All users before applying this connection.</span>}
                        {applyResult && <div ref={applyResultRef} tabIndex={-1} role="status" className="text-xs font-bold text-gray-600 outline-none dark:text-gray-300">{applyResult}</div>}
                    </div>
                </section>
            )}

            <InvokeRecoverySection
                settings={settings}
                setSettings={setSettings}
                hasPendingDraft={isDirty}
                isApplying={isApplying}
            />

            <ConfirmDialog
                isOpen={isAllUsersConfirmOpen}
                title="Show images from all InvokeAI users?"
                message="Ambit will show every owner's InvokeAI images and boards, including unassigned rows, across the gallery, collections, maintenance views, and references."
                confirmLabel={primaryActionLabel}
                onConfirm={() => {
                    setIsAllUsersConfirmOpen(false);
                    void handleApply();
                }}
                onCancel={() => {
                    setIsAllUsersConfirmOpen(false);
                    requestAnimationFrame(() => primaryActionRef.current?.focus());
                }}
                zIndex={220}
            />

            {settings.invokeAiPath && hiddenCollections.length > 0 && (
                <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
                    <h4 className="mb-2 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-sage-600 dark:text-sage-300">
                        <RotateCcw className="h-4 w-4" /> Hidden InvokeAI collections
                    </h4>
                    <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
                        Restore collections hidden from Ambit. Source ownership and local organization are retained.
                    </p>
                    <div className="space-y-2">
                        {hiddenCollections.map(collection => (
                            <div key={collection.id} className="flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/5 dark:bg-black/20">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{collection.name}</p>
                                    {collection.invokeSourcePresent === false && (
                                        <p className="mt-1 flex items-center gap-1 text-[10px] font-medium text-ember-600 dark:text-ember-300">
                                            <AlertTriangle className="h-3 w-3" /> Source unavailable
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    aria-label={`Restore ${collection.name}`}
                                    disabled={restoringCollectionId === collection.id || isDirty || isApplying || isInvokeSyncActive || isLiveSyncing}
                                    onClick={() => void handleRestoreCollection(collection)}
                                    className="rounded-lg bg-sage-600 px-3 py-2 text-xs font-bold text-white hover:bg-sage-500 disabled:cursor-wait disabled:opacity-60"
                                >
                                    {restoringCollectionId === collection.id ? 'Restoring…' : 'Restore'}
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {developerFeaturesEnabled && (
                <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
                    <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-300 uppercase tracking-[0.2em] mb-6 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Activity className="w-4 h-4" /> System Audit
                        </div>
                        <button
                            type="button"
                            onClick={runDiagnostics}
                            disabled={isDiagLoading || !settings.invokeAiPath}
                            className="text-[10px] bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 px-3 py-1.5 rounded-lg transition-all active:scale-95 font-black uppercase tracking-widest flex items-center gap-2 text-gray-600 dark:text-gray-300"
                        >
                            {isDiagLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
                            {isDiagLoading ? 'Analyzing...' : 'Run Audit'}
                        </button>
                    </h4>

                    {!diagData ? (
                        <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-gray-200 dark:border-white/5">
                            <div className="p-3 bg-white dark:bg-white/5 rounded-xl shadow-sm">
                                <Search className="w-5 h-5 text-gray-400" />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-gray-700 dark:text-gray-300">Ready for Scan</p>
                                <p className="text-[10px] text-gray-500">Run an audit to compare database entries with local output files.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-in fade-in duration-150 motion-reduce:animate-none relative z-10">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-sm group/stat">
                                    <div className="text-[9px] text-gray-500 dark:text-gray-400 uppercase font-black tracking-widest mb-1 flex items-center gap-2">
                                        <Database className="w-3 h-3 text-sage-500" /> InvokeAI Database
                                    </div>
                                    <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums drop-shadow-sm transition-transform group-hover/stat:scale-105 origin-left duration-500">{diagData.totalInDb.toLocaleString()}</div>
                                    <div className="text-[9px] text-gray-500 font-medium">Synced Records</div>
                                </div>
                                <div className="p-4 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-sm group/stat">
                                    <div className="text-[9px] text-gray-500 dark:text-gray-400 uppercase font-black tracking-widest mb-1 flex items-center gap-2">
                                        <Files className="w-3 h-3 text-sage-500" /> Image Repository
                                    </div>
                                    <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums drop-shadow-sm transition-transform group-hover/stat:scale-105 origin-left duration-500">{diagData.folder.imageFiles.toLocaleString()}</div>
                                    <div className="text-[10px] text-gray-500 font-medium">Files on Disk</div>
                                </div>
                            </div>

                            {diagData.totalInDb !== diagData.folder.imageFiles && (
                                <div className="p-4 bg-ember-500/10 border border-ember-500/20 rounded-2xl text-[11px] text-ember-600 dark:text-ember-300 shadow-lg shadow-ember-500/5">
                                    <div className="font-black uppercase tracking-widest flex items-center gap-2 mb-2">
                                        <AlertTriangle className="w-4 h-4" />
                                        Count Discrepancy Found
                                    </div>
                                    <p className="opacity-90 leading-normal">
                                        There are <strong>{Math.abs(diagData.totalInDb - diagData.folder.imageFiles).toLocaleString()}</strong> {diagData.totalInDb > diagData.folder.imageFiles ? 'extra records in the database' : 'extra files in the outputs folder'}.
                                    </p>
                                    {diagData.totalInDb > diagData.folder.imageFiles && (
                                        <p className="mt-2 text-[10px] font-medium opacity-80 bg-black/5 dark:bg-white/5 p-2 rounded-lg">Recommended: use "Force Full Resync" to re-validate image availability.</p>
                                    )}
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-6 pt-2">
                                <div className="space-y-3">
                                    <div className="text-[9px] text-gray-400 uppercase font-black tracking-widest px-1">Categories (DB)</div>
                                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-2 scrollbar-thin">
                                        {diagData.categories.map((c) => (
                                            <div key={c.image_category} className="flex justify-between text-[10px] p-2.5 bg-gray-100/50 dark:bg-white/[0.02] rounded-xl border border-gray-200 dark:border-white/5 transition-colors hover:bg-gray-200/50 dark:hover:bg-white/[0.05]">
                                                <span className="text-gray-500 dark:text-gray-400 capitalize font-bold">{c.image_category}</span>
                                                <span className="font-black text-gray-900 dark:text-white tabular-nums">{c.count.toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="text-[9px] text-gray-400 uppercase font-black tracking-widest px-1">Origins (DB)</div>
                                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-2 scrollbar-thin">
                                        {diagData.origins.map((o) => (
                                            <div key={o.image_origin} className="flex justify-between text-[10px] p-2.5 bg-gray-100/50 dark:bg-white/[0.02] rounded-xl border border-gray-200 dark:border-white/5 transition-colors hover:bg-gray-200/50 dark:hover:bg-white/[0.05]">
                                                <span className="text-gray-500 dark:text-gray-400 capitalize font-bold">{o.image_origin}</span>
                                                <span className="font-black text-gray-900 dark:text-white tabular-nums">{o.count.toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-black/5 dark:border-white/5 space-y-4">
                                <div className="flex items-center justify-between px-1">
                                    <div className="text-[9px] text-gray-400 uppercase font-black tracking-widest">Storage Status</div>
                                    <div className="text-[9px] text-gray-500 font-medium italic">
                                        {diagData.folder.thumbnailFiles.toLocaleString()} Thumbnails active
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    {Object.entries(diagData.folder.subfolders || {}).map(([folder, count]) => (
                                        <div key={folder} className="flex justify-between items-center text-[10px] p-2 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-all">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <FolderOpen className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                                <span className="text-gray-500 dark:text-gray-400 truncate font-mono">{folder}</span>
                                            </div>
                                            <span className="font-black text-gray-700 dark:text-gray-300 pl-2 tabular-nums">{count.toLocaleString()}</span>
                                        </div>
                                    ))}
                                    {Object.keys(diagData.folder.subfolders || {}).length === 0 && (
                                        <div className="col-span-2 text-[10px] text-gray-500 italic p-3 bg-black/5 dark:bg-black/20 rounded-xl text-center">Output repository is flat (no sub-collections found).</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            )}

        </div>
    );
});
