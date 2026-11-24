import { beforeEach, describe, expect, it, vi } from 'vitest';

const { logFrontendWarning } = vi.hoisted(() => ({ logFrontendWarning: vi.fn() }));
vi.mock('../../bindings', () => ({ commands: { logFrontendWarning } }));

import { formatLiveWatchFailure, logLiveWatchFailure, sanitizeFailureReason } from '../liveWatchFailureLog';

describe('liveWatchFailureLog', () => {
    beforeEach(() => {
        logFrontendWarning.mockReset();
        logFrontendWarning.mockResolvedValue(undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('writes one Ambit.log warning with the count, the retry and the reason', () => {
        logLiveWatchFailure({
            failedCount: 2,
            retryCount: 2,
            leftForCatchUpCount: 0,
            nextAttempt: 1,
            maxAttempts: 5,
            retryInMs: 2000,
            reason: 'database is locked',
        });

        expect(logFrontendWarning).toHaveBeenCalledTimes(1);
        expect(logFrontendWarning).toHaveBeenCalledWith(
            '[LiveWatch] import failed paths=2 retrying=2 left_for_catch_up=0 retry=1/5 retry_in_ms=2000 reason=database is locked'
        );
    });

    // Ambit.log is shared in bug reports, so no file path or file name may reach it.
    it('keeps file paths and file names out of the logged reason', () => {
        const reasons = [
            'Failed to read C:\\Users\\me\\ComfyUI\\output\\secret prompt_00001_.png: truncated',
            'Failed to read C:/Users/me/ComfyUI/output/secret_00001_.png: truncated',
            'open /home/me/output/secret_00001_.png failed',
            'cannot open \\\\nas\\share\\secret_00001_.png',
            'bad chunk in secret_00001_.png',
        ];
        reasons.forEach((reason) => {
            logLiveWatchFailure({ failedCount: 1, retryCount: 0, leftForCatchUpCount: 1, maxAttempts: 5, reason });
        });

        logFrontendWarning.mock.calls.forEach(([line]: [string]) => {
            expect(line).not.toMatch(/secret|Users|home|nas|ComfyUI/);
            expect(line).toContain('left_for_catch_up=1');
        });
        expect(sanitizeFailureReason(reasons[1])).toBe('Failed to read <path> truncated');
    });

    it('caps a long reason and reports a missing one as unknown', () => {
        expect(sanitizeFailureReason(undefined)).toBe('unknown');
        expect(sanitizeFailureReason('x'.repeat(500))).toHaveLength(201);
        expect(formatLiveWatchFailure({ failedCount: 1, retryCount: 0, leftForCatchUpCount: 1, maxAttempts: 5 })).toBe(
            '[LiveWatch] import failed paths=1 retrying=0 left_for_catch_up=1 reason=unknown'
        );
    });

    it('never throws when the native log bridge is unavailable', () => {
        logFrontendWarning.mockImplementation(() => {
            throw new Error('no tauri');
        });
        expect(() => logLiveWatchFailure({ failedCount: 1, retryCount: 0, leftForCatchUpCount: 1, maxAttempts: 5 })).not.toThrow();
    });
});
