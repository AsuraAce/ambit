import type { InvokeOwnerScopeState } from '../stores/invokeOwnerScopeStore';
import { getInvokePathIdentity } from '../services/invoke/pathIdentity';

export const getInvokeOwnerQueryScopeKey = (
    configuredPath: string | null | undefined,
    state: InvokeOwnerScopeState
): string => {
    if (!configuredPath) return 'invoke:none';
    if (state.status !== 'ready' && state.status !== 'offline_ready') return 'invoke:blocked';

    const scope = state.scope;
    if (!scope) return 'invoke:blocked';

    const dbPath = getInvokePathIdentity(scope.dbPath);
    return scope.mode === 'owner'
        ? `invoke:${dbPath}:owner:${scope.ownerId}`
        : `invoke:${dbPath}:${scope.mode}`;
};

export const previousQueryMatchesInvokeScope = (
    previousQueryKey: readonly unknown[] | undefined,
    scopeKey: string
): boolean => previousQueryKey?.at(-1) === scopeKey;
