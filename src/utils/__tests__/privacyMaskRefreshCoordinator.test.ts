import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privacyMaskRefreshCoordinator } from '../privacyMaskRefreshCoordinator';

describe('privacyMaskRefreshCoordinator', () => {
    beforeEach(() => privacyMaskRefreshCoordinator.resetForTests());

    it('keeps only the latest refresh requested behind active work', async () => {
        let releaseFirst: (() => void) | undefined;
        const calls: string[] = [];
        const first = new Promise<void>(resolve => { releaseFirst = resolve; });

        privacyMaskRefreshCoordinator.schedule(async () => {
            calls.push('first');
            await first;
        });
        privacyMaskRefreshCoordinator.schedule(async () => { calls.push('superseded'); });
        privacyMaskRefreshCoordinator.schedule(async () => { calls.push('latest'); });

        expect(calls).toEqual(['first']);
        releaseFirst?.();
        await vi.waitFor(() => expect(calls).toEqual(['first', 'latest']));
    });
});
