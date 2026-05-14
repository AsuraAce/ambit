import type { ImportResult } from '../services/importService';
import { normalizePath } from './pathUtils';

const toPathSet = (paths?: string[]): Set<string> =>
    new Set((paths ?? []).map(path => normalizePath(path)));

export const isImportSourceCompleted = (result: ImportResult | void, sourcePath: string): boolean => {
    if (!result) return false;

    const completedSourcePaths = result.completedSourcePaths ?? [];
    if (completedSourcePaths.length > 0) {
        return toPathSet(completedSourcePaths).has(normalizePath(sourcePath));
    }

    return !result.wasCancelled && result.failedPaths.length === 0;
};

export const isImportSourceCancelled = (result: ImportResult | void, sourcePath: string): boolean => {
    if (!result || !result.wasCancelled) return false;

    const cancelledSourcePaths = result.cancelledSourcePaths ?? [];
    if (cancelledSourcePaths.length > 0) {
        return toPathSet(cancelledSourcePaths).has(normalizePath(sourcePath));
    }

    return true;
};
