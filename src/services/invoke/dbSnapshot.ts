import { commands } from '../../bindings';
import type { AppSettings, InvokeDbSnapshotFile, InvokeDbSnapshotState, InvokeSourceFingerprint } from '../../types';
import { unwrap } from '../../utils/spectaUtils';
import type { InvokeSyncScope } from './syncScope';

interface InvokeDbSnapshotCommandResult {
    dbPath: string;
    files: InvokeDbSnapshotFile[];
}

interface InvokeDbSnapshotConfig {
    lastSyncedAt?: number | null;
    importIntermediates?: boolean;
    importOrphans?: boolean;
    syncBoardsToCollections?: boolean;
    scopeMode: 'legacy' | 'all' | 'owner';
    scopeOwnerId?: string | null;
    boardOwnerSchemaVersion?: number;
    sourceFingerprint?: InvokeSourceFingerprint;
}

export const INVOKE_PATH_REPAIR_SNAPSHOT_VERSION = 1;
export const INVOKE_IMPORT_SCHEMA_VERSION = 4;
export const INVOKE_BOARD_OWNER_SCHEMA_VERSION = 1;

const sortedFiles = (files: InvokeDbSnapshotFile[]): InvokeDbSnapshotFile[] =>
    [...files].sort((a, b) => a.path.localeCompare(b.path));

const sameFileSnapshot = (left: InvokeDbSnapshotFile, right: InvokeDbSnapshotFile): boolean =>
    left.path === right.path
    && left.exists === right.exists
    && left.size === right.size
    && (left.modifiedMs ?? null) === (right.modifiedMs ?? null);

export const buildInvokeDbSnapshotState = (
    snapshot: InvokeDbSnapshotCommandResult,
    config: InvokeDbSnapshotConfig
): InvokeDbSnapshotState => ({
    dbPath: snapshot.dbPath,
    lastSyncedAt: config.lastSyncedAt ?? null,
    importIntermediates: config.importIntermediates ?? false,
    importOrphans: config.importOrphans ?? false,
    syncBoardsToCollections: config.syncBoardsToCollections ?? false,
    scopeMode: config.scopeMode,
    scopeOwnerId: config.scopeMode === 'owner' ? (config.scopeOwnerId ?? null) : null,
    pathRepairVersion: INVOKE_PATH_REPAIR_SNAPSHOT_VERSION,
    importSchemaVersion: INVOKE_IMPORT_SCHEMA_VERSION,
    boardOwnerSchemaVersion: config.boardOwnerSchemaVersion ?? 0,
    ...(config.sourceFingerprint ? { sourceFingerprint: config.sourceFingerprint } : {}),
    files: sortedFiles(snapshot.files).map(file => ({
        path: file.path,
        exists: file.exists,
        size: file.size,
        modifiedMs: file.modifiedMs ?? null
    }))
});

export const isInvokeDbSnapshotCurrent = (
    saved: InvokeDbSnapshotState | undefined,
    current: InvokeDbSnapshotState
): boolean => {
    if (!saved) return false;
    if (saved.dbPath !== current.dbPath) return false;
    if ((saved.lastSyncedAt ?? null) !== (current.lastSyncedAt ?? null)) return false;
    if ((saved.importIntermediates ?? false) !== current.importIntermediates) return false;
    if ((saved.importOrphans ?? false) !== current.importOrphans) return false;
    if ((saved.syncBoardsToCollections ?? false) !== current.syncBoardsToCollections) return false;
    if (saved.scopeMode !== current.scopeMode) return false;
    if ((saved.scopeOwnerId ?? null) !== current.scopeOwnerId) return false;
    if ((saved.pathRepairVersion ?? 0) !== current.pathRepairVersion) return false;
    if ((saved.importSchemaVersion ?? 0) !== current.importSchemaVersion) return false;
    if ((saved.boardOwnerSchemaVersion ?? 0) !== (current.boardOwnerSchemaVersion ?? 0)) return false;

    const savedFiles = sortedFiles(saved.files ?? []);
    const currentFiles = sortedFiles(current.files);
    if (savedFiles.length !== currentFiles.length) return false;

    return savedFiles.every((file, index) => sameFileSnapshot(file, currentFiles[index]));
};

export const isInvokeSourceFingerprintCurrent = (
    saved: InvokeSourceFingerprint | undefined,
    current: InvokeSourceFingerprint
): boolean => !!saved
    && saved.schemaVersion === current.schemaVersion
    && saved.imageCount === current.imageCount
    && saved.imageUpdatedAt === current.imageUpdatedAt
    && saved.boardCount === current.boardCount
    && saved.boardUpdatedAt === current.boardUpdatedAt
    && saved.membershipCount === current.membershipCount
    && saved.membershipMaxRowId === current.membershipMaxRowId;

export const isInvokeImportSchemaCurrent = (saved: InvokeDbSnapshotState | undefined): boolean =>
    (saved?.importSchemaVersion ?? 0) === INVOKE_IMPORT_SCHEMA_VERSION;

export const isInvokePathRepairSnapshotCurrent = (saved: InvokeDbSnapshotState | undefined): boolean =>
    (saved?.pathRepairVersion ?? 0) === INVOKE_PATH_REPAIR_SNAPSHOT_VERSION;

export const isInvokeBoardOwnerSnapshotCurrent = (saved: InvokeDbSnapshotState | undefined): boolean =>
    (saved?.boardOwnerSchemaVersion ?? 0) === INVOKE_BOARD_OWNER_SCHEMA_VERSION;

const isSameSnapshotScope = (
    snapshot: InvokeDbSnapshotState,
    scope: InvokeSyncScope
): boolean => snapshot.dbPath === scope.dbPath
    && snapshot.scopeMode === scope.mode
    && (snapshot.scopeOwnerId ?? null) === (scope.mode === 'owner' ? scope.ownerId : null);

export const getInvokeDbSnapshotForScope = (
    settings: Pick<AppSettings, 'invokeDbSnapshot' | 'invokeDbSnapshots'>,
    scope: InvokeSyncScope | null
): InvokeDbSnapshotState | undefined => {
    if (!scope) return undefined;
    return settings.invokeDbSnapshots?.find(snapshot => isSameSnapshotScope(snapshot, scope))
        ?? (settings.invokeDbSnapshot && isSameSnapshotScope(settings.invokeDbSnapshot, scope)
            ? settings.invokeDbSnapshot
            : undefined);
};

export const upsertInvokeDbSnapshot = (
    snapshots: InvokeDbSnapshotState[] | undefined,
    snapshot: InvokeDbSnapshotState
): InvokeDbSnapshotState[] => [
    ...(snapshots ?? []).filter(existing => !(
        existing.dbPath === snapshot.dbPath
        && existing.scopeMode === snapshot.scopeMode
        && (existing.scopeOwnerId ?? null) === (snapshot.scopeOwnerId ?? null)
    )),
    snapshot,
];

export const isInvokeDbSnapshotScopeCurrent = (
    saved: InvokeDbSnapshotState | undefined,
    scope: InvokeSyncScope | null
): boolean => {
    if (!saved
        || !scope
        || !isInvokeImportSchemaCurrent(saved)
        || !isInvokePathRepairSnapshotCurrent(saved)) return false;
    if (saved.dbPath !== scope.dbPath || saved.scopeMode !== scope.mode) return false;

    const ownerId = scope.mode === 'owner' ? scope.ownerId : null;
    return (saved.scopeOwnerId ?? null) === ownerId;
};

export const readInvokeDbSnapshotState = async (
    rootPath: string,
    config: InvokeDbSnapshotConfig
): Promise<InvokeDbSnapshotState> => {
    const snapshot = await unwrap(commands.getInvokeDbSnapshot(rootPath));
    return buildInvokeDbSnapshotState(snapshot, config);
};
