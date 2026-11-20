import { create } from 'zustand';
import type { InvokeOwnerDiscovery } from '../types';
import type { InvokeSyncScope } from '../services/invoke/syncScope';
import type { SyncProgress } from './libraryStore';
import { normalizeInvokeRoot } from '../utils/pathUtils';

export interface InvokeOwnerScopeState {
    status: 'idle' | 'discovering' | 'applying' | 'ready' | 'selection_required' | 'offline_ready' | 'error';
    rootPath?: string;
    scope?: InvokeSyncScope;
    discovery?: InvokeOwnerDiscovery;
    error?: string;
    warning?: string;
    failure?: {
        kind: 'source_unavailable' | 'preparation_failed' | 'preparation_cancelled';
        details: string;
    };
    isRetrying?: boolean;
    operationPhase?: 'preparing' | 'importing';
    progress?: SyncProgress;
}

type InvokeOwnerScopeStateUpdate = InvokeOwnerScopeState | ((previous: InvokeOwnerScopeState) => InvokeOwnerScopeState);

/** Operation lifetime is independent of whether the selected view is safe to browse. */
export interface InvokeOperationState {
    id: symbol;
    origin: 'user' | 'startup';
    rootPath: string;
    targetLabel: string;
    phase: 'validating' | 'preparing' | 'syncing' | 'cancelling' | 'settling' | 'completed' | 'cancelled' | 'failed';
    viewCommitted: boolean;
    progress: SyncProgress;
    imported?: number;
    updated?: number;
    pathsRepaired?: number;
    hasChanges?: boolean;
    message?: string;
    cancel?: () => void;
    retry?: () => void;
}

/**
 * The admitted owner the gallery still shows while a user switch on the same InvokeAI root prepares
 * another owner (#527). The backend scope has already moved to the target, so this keeps the shown
 * owner's identity. While it is set, library writes are refused: they would land in the target scope.
 */
export interface RetainedOwnerScope {
    operationId: symbol;
    rootPath: string;
    scope: InvokeSyncScope;
    label: string;
    targetLabel: string;
    /** Set by "Switch now": swap to the target once it is admitted, even with the viewer or a modal open. */
    swapRequested?: boolean;
}

interface InvokeOwnerScopeStore {
    ownerScopeState: InvokeOwnerScopeState;
    operation: InvokeOperationState | null;
    retainedOwnerScope: RetainedOwnerScope | null;
    retainOwnerScope: (retained: RetainedOwnerScope) => void;
    /** Releases only the given operation's retained scope, so a stale operation cannot release a newer one. */
    releaseRetainedOwnerScope: (operationId: symbol) => void;
    requestOwnerSwitchSwap: (operationId: symbol) => void;
    setOperation: (update: InvokeOperationState | null | ((previous: InvokeOperationState | null) => InvokeOperationState | null)) => void;
    setOwnerScopeState: (update: InvokeOwnerScopeStateUpdate) => void;
    resetOwnerScopeState: () => void;
}

const INITIAL_OWNER_SCOPE_STATE: InvokeOwnerScopeState = { status: 'idle' };

export const isInvokeOwnerScopeAdmitted = (configuredPath: string | null | undefined, state: InvokeOwnerScopeState): boolean => {
    const configuredRoot = normalizeInvokeRoot(configuredPath);
    if (!configuredRoot) return true;

    const admittedRoot = normalizeInvokeRoot(state.rootPath ?? state.discovery?.imagesRoot);
    return admittedRoot === configuredRoot && (state.status === 'ready' || state.status === 'offline_ready');
};

/** True while a user owner switch is pending and the screen still shows the previous owner. */
export const isOwnerSwitchPending = (state: Pick<InvokeOwnerScopeStore, 'retainedOwnerScope'>): boolean =>
    state.retainedOwnerScope !== null;

// Fail closed: states that need the gate never keep a retained view.
const releasesRetainedScope = (status: InvokeOwnerScopeState['status']): boolean =>
    status === 'error' || status === 'selection_required' || status === 'idle' || status === 'discovering';

export const useInvokeOwnerScopeStore = create<InvokeOwnerScopeStore>((set) => ({
    ownerScopeState: INITIAL_OWNER_SCOPE_STATE,
    operation: null,
    retainedOwnerScope: null,
    retainOwnerScope: (retained) => set({ retainedOwnerScope: retained }),
    releaseRetainedOwnerScope: (operationId) =>
        set((current) => (current.retainedOwnerScope?.operationId === operationId ? { retainedOwnerScope: null } : {})),
    requestOwnerSwitchSwap: (operationId) =>
        set((current) =>
            current.retainedOwnerScope?.operationId === operationId
                ? { retainedOwnerScope: { ...current.retainedOwnerScope, swapRequested: true } }
                : {}
        ),
    setOperation: (update) =>
        set((current) => ({
            operation: typeof update === 'function' ? update(current.operation) : update,
        })),
    setOwnerScopeState: (update) =>
        set((current) => {
            const ownerScopeState = typeof update === 'function' ? update(current.ownerScopeState) : update;
            return releasesRetainedScope(ownerScopeState.status) ? { ownerScopeState, retainedOwnerScope: null } : { ownerScopeState };
        }),
    resetOwnerScopeState: () => set({ ownerScopeState: INITIAL_OWNER_SCOPE_STATE, operation: null, retainedOwnerScope: null }),
}));
