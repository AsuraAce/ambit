import type { SyncProgress } from '../stores/libraryStore';

export type ImportMediaKind = 'images' | 'videos' | 'media';

type ImportProgressPhase = 'scanning' | 'importing' | 'finalizing';

// The files are written and the library refresh runs; the import run stays open through it (#603).
export const IMPORT_REFRESH_PHASE = 'refreshing';

interface StableImportProgressOptions {
    current: number;
    total: number;
    sourceCount: number;
    phase: ImportProgressPhase;
    prefix?: string;
    /** What the import brings in; 'media' when the kind is not known up front or both are imported. */
    mediaKind?: ImportMediaKind;
    sourceIndex?: number;
    sourcePath?: string;
}

const folderLabel = (count: number): string => `${count} folders`;

const withPrefix = (message: string, prefix?: string): string => (prefix ? `${prefix}: ${message}` : message);

export const formatStableImportProgress = ({
    current,
    total,
    sourceCount,
    phase,
    prefix,
    mediaKind = 'media',
    sourceIndex,
    sourcePath,
}: StableImportProgressOptions): SyncProgress => {
    const isSingleFolder = sourceCount === 1;
    const message =
        phase === 'finalizing'
            ? withPrefix('Finalizing import...', prefix)
            : phase === 'scanning'
              ? withPrefix(isSingleFolder ? 'Scanning folder...' : `Scanning ${folderLabel(sourceCount)}...`, prefix)
              : withPrefix(
                    isSingleFolder ? `Importing ${mediaKind} from folder...` : `Importing ${mediaKind} from ${folderLabel(sourceCount)}...`,
                    prefix
                );

    const progress: SyncProgress = {
        current,
        total,
        message,
    };

    if (sourceCount === 1 && sourcePath) {
        progress.detail = sourcePath;
    } else if (sourceIndex && sourceCount > 1) {
        progress.detail = `Folder ${sourceIndex} of ${sourceCount}`;
    }

    return progress;
};

/** The run's progress while the post-import library refresh runs: no counts, and the dock offers no Cancel. */
export const formatImportRefreshProgress = (prefix?: string): SyncProgress => ({
    current: 0,
    total: 0,
    message: withPrefix('Refreshing library...', prefix),
    phase: IMPORT_REFRESH_PHASE,
    mode: 'indeterminate',
});

// A batch insert is waiting for the library database; Cancel still works but only applies after the batch.
export const IMPORT_DATABASE_WAIT_PHASE = 'waiting-database';

/** The run's progress while a batch waits for the library database: the counts stay, the dock explains the wait. */
export const formatImportDatabaseWaitProgress = (current: number, total: number, prefix?: string): SyncProgress => ({
    current,
    total,
    message: withPrefix('Waiting for the library database...', prefix),
    phase: IMPORT_DATABASE_WAIT_PHASE,
});
