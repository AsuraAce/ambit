import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logFrontendWarning } = vi.hoisted(() => ({ logFrontendWarning: vi.fn() }));
vi.mock('../../bindings', () => ({ commands: { logFrontendWarning } }));

import { classifyImportFailure, formatLiveWatchFailure, logLiveWatchFailure } from '../liveWatchFailureLog';

describe('liveWatchFailureLog', () => {
    beforeEach(() => {
        logFrontendWarning.mockReset();
        logFrontendWarning.mockResolvedValue(undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('writes one Ambit.log warning with the count, the retry and the failure kind', () => {
        logLiveWatchFailure({
            failedCount: 2,
            retryCount: 2,
            leftForCatchUpCount: 0,
            nextAttempt: 1,
            maxAttempts: 5,
            retryInMs: 2000,
            reason: 'db_locked',
        });

        expect(logFrontendWarning).toHaveBeenCalledTimes(1);
        expect(logFrontendWarning).toHaveBeenCalledWith(
            '[LiveWatch] import failed paths=2 retrying=2 left_for_catch_up=0 retry=1/5 retry_in_ms=2000 reason=db_locked'
        );
    });

    it('maps a locked or busy database to db_locked, so the log says why the import was retried', () => {
        expect(classifyImportFailure('database is locked', 'other')).toBe('db_locked');
        expect(classifyImportFailure(new Error('Failed to save: database is busy'), 'other')).toBe('db_locked');
        expect(classifyImportFailure('error code 5: SQLITE_BUSY', 'scan_error')).toBe('db_locked');
    });

    // Ambit.log is shared in bug reports. File paths and prompt-like file names (with spaces, on
    // any platform) must never reach it, so only a fixed kind is logged, never the error text.
    it('logs only the failure kind for errors that carry paths and file names', () => {
        const cases: Array<[string, Parameters<typeof classifyImportFailure>[1], string]> = [
            [
                'Image path is outside the allowed filesystem scope and not in the library: C:/Users/Jane Doe/AI Out/cat girl portrait.png',
                'scan_error',
                'scope',
            ],
            ['Failed to read D:\\AI Art\\Secret Project\\out.png: truncated PNG', 'scan_error', 'scan_error'],
            ['cannot open \\\\nas box\\Secret Share\\Jane Doe\\out.png', 'scan_error', 'scan_error'],
            ['open /home/jane doe/Secret Project/out.png failed', 'other', 'other'],
            ['bad chunk in portrait of Jane Smith.jxl', 'scan_error', 'scan_error'],
            ['database is locked while saving portrait of Jane Smith.jxl', 'other', 'db_locked'],
        ];

        cases.forEach(([error, fallback, kind]) => {
            const reason = classifyImportFailure(error, fallback);
            expect(reason).toBe(kind);
            logLiveWatchFailure({ failedCount: 1, retryCount: 0, leftForCatchUpCount: 1, maxAttempts: 5, reason });
        });

        expect(logFrontendWarning).toHaveBeenCalledTimes(cases.length);
        for (const call of logFrontendWarning.mock.calls) {
            const line = String(call[0]);
            expect(line).toMatch(/ reason=(scope|scan_error|other|db_locked)$/);
            expect(line).not.toMatch(/Jane|Doe|Smith|portrait|Secret|Users|home|nas|[\\/:]/);
        }
    });

    it('reports a cycle with no known kind as other', () => {
        expect(formatLiveWatchFailure({ failedCount: 1, retryCount: 0, leftForCatchUpCount: 1, maxAttempts: 5 })).toBe(
            '[LiveWatch] import failed paths=1 retrying=0 left_for_catch_up=1 reason=other'
        );
    });

    it('never throws when the native log bridge is unavailable', () => {
        logFrontendWarning.mockImplementation(() => {
            throw new Error('no tauri');
        });
        expect(() => logLiveWatchFailure({ failedCount: 1, retryCount: 0, leftForCatchUpCount: 1, maxAttempts: 5 })).not.toThrow();
    });
});
