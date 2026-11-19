import type { SyncProgress } from '../stores/libraryStore';

export type ImportMediaKind = 'images' | 'videos' | 'media';

type ImportProgressPhase = 'scanning' | 'importing' | 'finalizing';

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
