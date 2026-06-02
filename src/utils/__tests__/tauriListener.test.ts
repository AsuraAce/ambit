import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listenWithCleanup } from '../tauriListener';

const mockedListen = vi.mocked(listen);

describe('listenWithCleanup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('unlistens when cleanup runs before Tauri listener registration resolves', async () => {
        let resolveListen!: (unlisten: UnlistenFn) => void;
        const unlisten = vi.fn();
        mockedListen.mockReturnValueOnce(new Promise<UnlistenFn>((resolve) => {
            resolveListen = resolve;
        }));

        const managed = listenWithCleanup('background-event', vi.fn());
        managed.cleanup();

        resolveListen(unlisten);
        const ready = await managed.ready;

        expect(ready).toBe(false);
        expect(unlisten).toHaveBeenCalledTimes(1);
    });

    it('unlistens an already registered listener exactly once', async () => {
        const unlisten = vi.fn();
        mockedListen.mockResolvedValueOnce(unlisten);

        const managed = listenWithCleanup('background-event', vi.fn());
        const ready = await managed.ready;
        managed.cleanup();
        managed.cleanup();

        expect(ready).toBe(true);
        expect(unlisten).toHaveBeenCalledTimes(1);
    });
});
