import { listen, type Event } from '@tauri-apps/api/event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../../bindings';
import { WatcherService } from '../WatcherService';
import { isBrowserMockMode } from '../runtime';

vi.mock('../../bindings', () => ({
    commands: {
        startNativeFolderWatcher: vi.fn()
    }
}));

vi.mock('../runtime', () => ({
    isBrowserMockMode: vi.fn(() => false)
}));

const mockedStartNativeFolderWatcher = vi.mocked(commands.startNativeFolderWatcher);
const mockedListen = vi.mocked(listen);
const mockedIsBrowserMockMode = vi.mocked(isBrowserMockMode);
type FolderChangeHandler = (event: Event<string[]>) => void;

describe('WatcherService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedIsBrowserMockMode.mockReturnValue(false);
        mockedStartNativeFolderWatcher.mockResolvedValue({ status: 'ok', data: null });
        mockedListen.mockResolvedValue(() => undefined);
        vi.spyOn(console, 'info').mockImplementation(() => undefined);
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('invalidates a pending native watcher start when stop is requested before startup settles', async () => {
        let resolveStart!: () => void;
        mockedStartNativeFolderWatcher
            .mockReturnValueOnce(new Promise((resolve) => {
                resolveStart = () => resolve({ status: 'ok', data: null });
            }))
            .mockResolvedValue({ status: 'ok', data: null });

        const service = new WatcherService();
        const startPromise = service.startWatching(['C:/watch'], vi.fn());

        await Promise.resolve();
        await service.stopWatching();

        resolveStart();
        await startPromise;

        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(1, ['C:/watch']);
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(2, []);
        expect(mockedListen).not.toHaveBeenCalled();
    });

    it('starts the native watcher, forwards change payloads, and stops both listener and Rust watcher', async () => {
        let folderChangeHandler: FolderChangeHandler | undefined;
        const unlisten = vi.fn();
        mockedListen.mockImplementationOnce(async (_eventName, handler) => {
            folderChangeHandler = handler as FolderChangeHandler;
            return unlisten;
        });
        const onChange = vi.fn();

        const service = new WatcherService();
        await service.startWatching(['C:/watch', 'D:/more'], onChange);

        expect(folderChangeHandler).toBeDefined();
        const emitFolderChange: FolderChangeHandler = folderChangeHandler ?? (() => {
            throw new Error('Expected folder-change-event listener to be registered');
        });
        emitFolderChange({
            event: 'folder-change-event',
            id: 1,
            payload: ['C:/watch/new.png']
        });
        emitFolderChange({
            event: 'folder-change-event',
            id: 2,
            payload: undefined,
        } as unknown as Event<string[]>);
        await service.stopWatching();

        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(1, ['C:/watch', 'D:/more']);
        expect(mockedListen).toHaveBeenCalledWith('folder-change-event', expect.any(Function));
        expect(onChange).toHaveBeenCalledWith(['C:/watch/new.png']);
        expect(onChange).toHaveBeenCalledWith(undefined);
        expect(unlisten).toHaveBeenCalledTimes(1);
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(2, []);
    });

    it('does not restart when the watched paths are unchanged', async () => {
        const service = new WatcherService();

        await service.startWatching(['C:/watch'], vi.fn());
        await service.startWatching(['C:/watch'], vi.fn());

        expect(mockedStartNativeFolderWatcher).toHaveBeenCalledTimes(1);
        expect(mockedListen).toHaveBeenCalledTimes(1);
    });

    it('restarts when watched paths change', async () => {
        const firstUnlisten = vi.fn();
        const secondUnlisten = vi.fn();
        mockedListen
            .mockResolvedValueOnce(firstUnlisten)
            .mockResolvedValueOnce(secondUnlisten);

        const service = new WatcherService();
        await service.startWatching(['C:/watch'], vi.fn());
        await service.startWatching(['C:/watch', 'D:/more'], vi.fn());

        expect(firstUnlisten).toHaveBeenCalledTimes(1);
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(1, ['C:/watch']);
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(2, []);
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(3, ['C:/watch', 'D:/more']);
        expect(secondUnlisten).not.toHaveBeenCalled();
    });

    it('skips native work in browser mock mode', async () => {
        mockedIsBrowserMockMode.mockReturnValue(true);
        const service = new WatcherService();

        await service.startWatching(['C:/watch'], vi.fn());
        await service.stopWatching();

        expect(mockedStartNativeFolderWatcher).not.toHaveBeenCalled();
        expect(mockedListen).not.toHaveBeenCalled();
        expect(console.info).toHaveBeenCalledWith(
            '[WatcherService] Native watcher unavailable in browser mock mode; skipped start.',
            { pathCount: 1 }
        );
    });

    it('does not start a listener when there are no paths to watch', async () => {
        const service = new WatcherService();

        await service.startWatching([], vi.fn());

        expect(mockedStartNativeFolderWatcher).not.toHaveBeenCalled();
        expect(mockedListen).not.toHaveBeenCalled();
    });

    it('stops the Rust watcher when listener registration fails', async () => {
        mockedListen.mockRejectedValueOnce(new Error('listener unavailable'));
        const service = new WatcherService();

        await service.startWatching(['C:/watch'], vi.fn());

        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(1, ['C:/watch']);
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(2, []);
        expect(console.error).toHaveBeenCalledWith(
            '[TauriListener] Failed to listen for folder-change-event',
            expect.any(Error)
        );
    });

    it('clears failed starts so a later request can retry', async () => {
        mockedStartNativeFolderWatcher
            .mockResolvedValueOnce({ status: 'error', error: 'watcher refused' })
            .mockResolvedValue({ status: 'ok', data: null });
        const service = new WatcherService();

        await service.startWatching(['C:/watch'], vi.fn());
        await service.startWatching(['C:/watch'], vi.fn());

        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(1, ['C:/watch']);
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(2, ['C:/watch']);
        expect(mockedListen).toHaveBeenCalledTimes(1);
        expect(console.error).toHaveBeenCalledWith(
            '[WatcherService] Failed to start native watcher:',
            { pathCount: 1 },
            'watcher refused'
        );
    });

    it('formats Error start failures and stops a defensive active state without a listener', async () => {
        mockedStartNativeFolderWatcher.mockResolvedValueOnce({ status: 'error', error: new Error('native failed') } as never);
        const service = new WatcherService();

        await service.startWatching(['C:/watch'], vi.fn());

        (service as unknown as { isWatching: boolean }).isWatching = true;
        await service.stopWatching();
        expect(mockedStartNativeFolderWatcher).toHaveBeenLastCalledWith([]);
    });

    it('finishes active diagnostics with Error and string failure messages', async () => {
        for (const error of [new Error('native failed'), 'watcher refused']) {
            const finish = vi.fn();
            const service = new WatcherService();
            (service as unknown as { diagnostic: { finish: typeof finish } }).diagnostic = { finish };
            mockedStartNativeFolderWatcher.mockResolvedValueOnce({ status: 'error', error } as never);

            await service.startWatching(['C:/watch'], vi.fn());

            expect(finish).toHaveBeenCalledWith('failed', {
                error: error instanceof Error ? error.message : error,
            });
        }
    });

    it('cleans up a listener that becomes ready after a stop invalidates its start', async () => {
        let resolveListen!: (unlisten: () => void) => void;
        const unlisten = vi.fn();
        mockedListen.mockReturnValueOnce(new Promise((resolve) => {
            resolveListen = resolve;
        }));
        const service = new WatcherService();

        const startPromise = service.startWatching(['C:/watch'], vi.fn());
        for (let i = 0; i < 5 && mockedListen.mock.calls.length === 0; i++) {
            await Promise.resolve();
        }
        expect(mockedListen).toHaveBeenCalledTimes(1);
        await service.stopWatching();

        resolveListen(unlisten);
        await startPromise;

        expect(unlisten).toHaveBeenCalledTimes(1);
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(1, ['C:/watch']);
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(2, []);
    });

    it('logs stop failures after local watcher state has been cleared', async () => {
        mockedStartNativeFolderWatcher
            .mockResolvedValueOnce({ status: 'ok', data: null })
            .mockResolvedValueOnce({ status: 'error', error: 'stop refused' });
        const service = new WatcherService();

        await service.startWatching(['C:/watch'], vi.fn());
        await service.stopWatching();
        await service.startWatching(['C:/watch'], vi.fn());

        expect(console.error).toHaveBeenCalledWith('[WatcherService] Failed to stop native watcher:', 'stop refused');
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(3, ['C:/watch']);
    });

    it('updates the watcher through the same start path', async () => {
        const service = new WatcherService();
        const onChange = vi.fn();

        await service.updateWatcher(['C:/watch'], onChange);

        expect(mockedStartNativeFolderWatcher).toHaveBeenCalledWith(['C:/watch']);
        expect(mockedListen).toHaveBeenCalledWith('folder-change-event', expect.any(Function));
    });
});
