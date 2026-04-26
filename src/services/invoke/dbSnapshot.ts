import { commands } from '../../bindings';
import { InvokeDbSnapshotFile, InvokeDbSnapshotState } from '../../types';
import { unwrap } from '../../utils/spectaUtils';

interface InvokeDbSnapshotCommandResult {
    dbPath: string;
    files: InvokeDbSnapshotFile[];
}

interface InvokeDbSnapshotConfig {
    lastSyncedAt?: number | null;
    importIntermediates?: boolean;
    importOrphans?: boolean;
    syncBoardsToCollections?: boolean;
}

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

    const savedFiles = sortedFiles(saved.files ?? []);
    const currentFiles = sortedFiles(current.files);
    if (savedFiles.length !== currentFiles.length) return false;

    return savedFiles.every((file, index) => sameFileSnapshot(file, currentFiles[index]));
};

export const readInvokeDbSnapshotState = async (
    rootPath: string,
    config: InvokeDbSnapshotConfig
): Promise<InvokeDbSnapshotState> => {
    const snapshot = await unwrap(commands.getInvokeDbSnapshot(rootPath));
    return buildInvokeDbSnapshotState(snapshot, config);
};
