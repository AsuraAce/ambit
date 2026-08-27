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
        kind: 'source_unavailable' | 'preparation_failed';
        details: string;
    };
    isRetrying?: boolean;
    progress?: SyncProgress;
}

type InvokeOwnerScopeStateUpdate = InvokeOwnerScopeState
    | ((previous: InvokeOwnerScopeState) => InvokeOwnerScopeState);

interface InvokeOwnerScopeStore {
    ownerScopeState: InvokeOwnerScopeState;
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
    setOwnerScopeState: (update) => set(current => ({
        ownerScopeState: typeof update === 'function'
            ? update(current.ownerScopeState)
            : update,
    })),
    resetOwnerScopeState: () => set({ ownerScopeState: INITIAL_OWNER_SCOPE_STATE }),
}));
