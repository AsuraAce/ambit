import { describe, expect, it } from 'vitest';
import { formatStableImportProgress } from '../importProgress';

describe('formatStableImportProgress', () => {
    it('uses singular folder copy when finalizing one source', () => {
        expect(formatStableImportProgress({
            current: 1,
            total: 1,
            sourceCount: 1,
            phase: 'finalizing'
        }).message).toBe('Finalizing import...');
    });

    it('formats stable single-folder scanning progress with path detail', () => {
        expect(formatStableImportProgress({
            current: 0,
            total: 0,
            sourceCount: 1,
            phase: 'scanning',
            sourcePath: 'C:/watch'
        })).toEqual({
            current: 0,
            total: 0,
            message: 'Scanning folder...',
            detail: 'C:/watch'
        });
    });

    it('formats stable single-folder import progress without native phase text', () => {
        expect(formatStableImportProgress({
            current: 5,
            total: 10,
            sourceCount: 1,
            phase: 'importing',
            sourcePath: 'C:/watch'
        })).toEqual({
            current: 5,
            total: 10,
            message: 'Importing images from folder...',
            detail: 'C:/watch'
        });
    });

    it('formats stable multi-folder import progress with folder index detail', () => {
        expect(formatStableImportProgress({
            current: 50,
            total: 100,
            sourceCount: 3,
            phase: 'importing',
            sourceIndex: 2
        })).toEqual({
            current: 50,
            total: 100,
            message: 'Importing images from 3 folders...',
            detail: 'Folder 2 of 3'
        });
    });

    it('supports prefixed finalizing progress', () => {
        expect(formatStableImportProgress({
            current: 100,
            total: 100,
            sourceCount: 2,
            phase: 'finalizing',
            prefix: 'Startup'
        })).toEqual({
            current: 100,
            total: 100,
            message: 'Startup: Finalizing import...'
        });
    });
});
