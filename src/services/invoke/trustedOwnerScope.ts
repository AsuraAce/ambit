import type { AppSettings } from '../../types';
import { getDb } from '../db/connection';
import {
    isInvokeDbSnapshotScopeCurrent,
    isInvokeImportSchemaCurrent,
    isInvokePathRepairSnapshotCurrent,
} from './dbSnapshot';
import { resolveInvokePaths } from './connection';
import type { InvokeSyncScope } from './syncScope';

interface InvokeOwnerScopeStateRow {
    db_path: string;
    images_root: string;
    scope_mode: string;
    owner_id: string | null;
}

const scopeFromSavedState = (
    rootPath: string,
    settings: Pick<AppSettings, 'invokeDbSnapshot' | 'invokeOwnerSelection'>
): InvokeSyncScope | null => {
    const { dbPath, imagesRoot } = resolveInvokePaths(rootPath);
    const snapshot = settings.invokeDbSnapshot;
    if (!snapshot
        || !isInvokeImportSchemaCurrent(snapshot)
        || !isInvokePathRepairSnapshotCurrent(snapshot)
        || snapshot.dbPath !== dbPath) return null;

    const selection = settings.invokeOwnerSelection;
    let scope: InvokeSyncScope | null = null;
    if (snapshot.scopeMode === 'legacy') {
        if (selection) return null;
        scope = { dbPath, imagesRoot, mode: 'legacy' };
    } else if (snapshot.scopeMode === 'all') {
        if (!selection || selection.dbPath !== dbPath || selection.mode !== 'all') return null;
        scope = { dbPath, imagesRoot, mode: 'all' };
    } else {
        const ownerId = snapshot.scopeOwnerId?.trim();
        if (!ownerId
            || !selection
            || selection.dbPath !== dbPath
            || selection.mode !== 'owner'
            || selection.ownerId.trim() !== ownerId) return null;
        scope = { dbPath, imagesRoot, mode: 'owner', ownerId };
    }

    return isInvokeDbSnapshotScopeCurrent(snapshot, scope) ? scope : null;
};

const rowMatchesScope = (row: InvokeOwnerScopeStateRow, scope: InvokeSyncScope): boolean => {
    const expectedOwnerId = scope.mode === 'owner' ? scope.ownerId : null;
    return row.db_path === scope.dbPath
        && row.images_root === scope.imagesRoot
        && row.scope_mode === scope.mode
        && (row.owner_id ?? null) === expectedOwnerId;
};

export const readTrustedInvokeOwnerScope = async (
    rootPath: string,
    settings: Pick<AppSettings, 'invokeDbSnapshot' | 'invokeOwnerSelection'>
): Promise<InvokeSyncScope | null> => {
    const scope = scopeFromSavedState(rootPath, settings);
    if (!scope) return null;

    const database = await getDb();
    const rows = await database.select<InvokeOwnerScopeStateRow[]>(`
        SELECT scope.db_path, scope.images_root, scope.scope_mode, scope.owner_id
        FROM invoke_owner_scope_state scope
        INNER JOIN invoke_scope_cache_control control
            ON control.state_key = 'current'
        INNER JOIN invoke_scope_cache_state cache
            ON cache.scope_key = control.active_scope_key
        WHERE scope.state_key = 'current'
          AND cache.status = 'ready'
          AND cache.built_generation = cache.generation
    `);
    return rows.length === 1 && rowMatchesScope(rows[0], scope) ? scope : null;
};

export const isSameInvokeSyncScope = (
    left: InvokeSyncScope | undefined,
    right: InvokeSyncScope | null
): boolean => {
    if (!left || !right || left.mode !== right.mode) return false;
    if (left.dbPath !== right.dbPath || left.imagesRoot !== right.imagesRoot) return false;
    return left.mode !== 'owner' || (right.mode === 'owner' && left.ownerId === right.ownerId);
};
