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

type InvokeOwnerScopeStateUpdate = InvokeOwnerScopeState
    | ((previous: InvokeOwnerScopeState) => InvokeOwnerScopeState);

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

interface InvokeOwnerScopeStore {
    ownerScopeState: InvokeOwnerScopeState;
    operation: InvokeOperationState | null;
    setOperation: (update: InvokeOperationState | null | ((previous: InvokeOperationState | null) => InvokeOperationState | null)) => void;
    setOwnerScopeState: (update: InvokeOwnerScopeStateUpdate) => void;
    resetOwnerScopeState: () => void;
}

const INITIAL_OWNER_SCOPE_STATE: InvokeOwnerScopeState = { status: 'idle' };

export const isInvokeOwnerScopeAdmitted = (
    configuredPath: string | null | undefined,
    state: InvokeOwnerScopeState
): boolean => {
    const configuredRoot = normalizeInvokeRoot(configuredPath);
    if (!configuredRoot) return true;

    const admittedRoot = normalizeInvokeRoot(state.rootPath ?? state.discovery?.imagesRoot);
    return admittedRoot === configuredRoot
        && (state.status === 'ready' || state.status === 'offline_ready');
};

export const useInvokeOwnerScopeStore = create<InvokeOwnerScopeStore>((set) => ({
    ownerScopeState: INITIAL_OWNER_SCOPE_STATE,
    operation: null,
    setOperation: (update) => set(current => ({
        operation: typeof update === 'function' ? update(current.operation) : update,
    })),
    setOwnerScopeState: (update) => set(current => ({
        ownerScopeState: typeof update === 'function'
            ? update(current.ownerScopeState)
            : update,
    })),
    resetOwnerScopeState: () => set({ ownerScopeState: INITIAL_OWNER_SCOPE_STATE, operation: null }),
}));
