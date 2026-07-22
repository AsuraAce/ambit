import type { InvokeOwnerDiscovery, InvokeOwnerSelection } from '../../types';

interface InvokeSyncScopeBase {
    dbPath: string;
    imagesRoot: string;
}

export type InvokeSyncScope = InvokeSyncScopeBase & (
    | { mode: 'legacy' }
    | { mode: 'all' }
    | { mode: 'owner'; ownerId: string }
);

export const resolveInvokeSyncScope = (
    discovery: InvokeOwnerDiscovery,
    selection?: InvokeOwnerSelection
): InvokeSyncScope | null => {
    if (discovery.schemaMode === 'legacy') {
        return {
            dbPath: discovery.dbPath,
            imagesRoot: discovery.imagesRoot,
            mode: 'legacy',
        };
    }

    if (!selection || selection.dbPath !== discovery.dbPath) return null;

    if (selection.mode === 'all') {
        return {
            dbPath: discovery.dbPath,
            imagesRoot: discovery.imagesRoot,
            mode: 'all',
        };
    }

    const ownerId = selection.ownerId.trim();
    if (!ownerId) return null;

    return {
        dbPath: discovery.dbPath,
        imagesRoot: discovery.imagesRoot,
        mode: 'owner',
        ownerId,
    };
};

export const invokeOwnerPredicate = (
    scope: InvokeSyncScope,
    tableAlias?: string
): { clause: string; params: string[] } => {
    if (scope.mode !== 'owner') return { clause: '', params: [] };
    const column = tableAlias ? `${tableAlias}.user_id` : 'user_id';
    return { clause: `${column} = ?`, params: [scope.ownerId] };
};
