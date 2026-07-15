import { listen } from '@tauri-apps/api/event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../../bindings';
import { WatcherService } from '../WatcherService';

const runtimeMocks = vi.hoisted(() => ({
    isBrowserMockMode: vi.fn(() => false)
}));

vi.mock('../../bindings', () => ({
    commands: {
        startNativeFolderWatcher: vi.fn()
    }
}));

vi.mock('../runtime', () => ({
    isBrowserMockMode: runtimeMocks.isBrowserMockMode
}));

const mockedStartNativeFolderWatcher = vi.mocked(commands.startNativeFolderWatcher);
const mockedListen = vi.mocked(listen);

describe('WatcherService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtimeMocks.isBrowserMockMode.mockReturnValue(false);
        mockedListen.mockResolvedValue(() => undefined);
        mockedStartNativeFolderWatcher.mockResolvedValue({ status: 'ok', data: null });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('logs and skips native watcher startup in browser mock mode', async () => {
        runtimeMocks.isBrowserMockMode.mockReturnValue(true);
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const service = new WatcherService();

        await service.startWatching(['C:/watch-a', 'C:/watch-b'], vi.fn());

        expect(infoSpy).toHaveBeenCalledWith(
            '[WatcherService] Native watcher unavailable in browser mock mode; skipped start.',
            { pathCount: 2 }
        );
        expect(mockedStartNativeFolderWatcher).not.toHaveBeenCalled();
        expect(mockedListen).not.toHaveBeenCalled();
    });

    it('logs and skips empty watcher path lists before native startup', async () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const service = new WatcherService();

        await service.startWatching([], vi.fn());

        expect(infoSpy).toHaveBeenCalledWith('[WatcherService] Native watcher start skipped because no paths were configured.');
        expect(mockedStartNativeFolderWatcher).not.toHaveBeenCalled();
        expect(mockedListen).not.toHaveBeenCalled();
    });

    it('logs successful native starts and debounced change events with path counts', async () => {
        type FolderChangeEvent = { payload: string[] };
        let changeHandler: ((event: FolderChangeEvent) => void) | undefined;
        const onChange = vi.fn();
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        mockedListen.mockImplementationOnce((_eventName, handler) => {
            changeHandler = handler as (event: FolderChangeEvent) => void;
            return Promise.resolve(() => undefined);
        });

        const service = new WatcherService();
        await service.startWatching(['C:/watch'], onChange);
        changeHandler?.({ payload: ['C:/watch/a.png', 'C:/watch/b.png'] });

        expect(logSpy).toHaveBeenCalledWith('[WatcherService] Native watcher started for 1 paths');
        expect(logSpy).toHaveBeenCalledWith('[WatcherService] Folder change detected with 2 paths');
        expect(onChange).toHaveBeenCalledWith(['C:/watch/a.png', 'C:/watch/b.png']);
    });

    it('logs and skips a duplicate watcher request without restarting native state', async () => {
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        const service = new WatcherService();

        await service.startWatching(['C:/watch'], vi.fn());
        await service.startWatching(['C:/watch'], vi.fn());

        expect(debugSpy).toHaveBeenCalledWith(
            '[WatcherService] Native watcher already active for requested paths; skipped restart.',
            { pathCount: 1 }
        );
        expect(mockedStartNativeFolderWatcher).toHaveBeenCalledTimes(1);
    });

    it('logs start failures with path count context', async () => {
        const startupError = new Error('permission denied');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockedStartNativeFolderWatcher.mockRejectedValueOnce(startupError);
        const service = new WatcherService();

        await service.startWatching(['C:/watch-a', 'C:/watch-b'], vi.fn());

        expect(errorSpy).toHaveBeenCalledWith(
            '[WatcherService] Failed to start native watcher:',
            {
                pathCount: 2
            },
            startupError
        );
        expect(mockedListen).not.toHaveBeenCalled();
    });

    it('logs stop failures after clearing frontend watcher state', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockedStartNativeFolderWatcher
            .mockResolvedValueOnce({ status: 'ok', data: null })
            .mockResolvedValueOnce({ status: 'error', error: 'stop failed' });
        const service = new WatcherService();

        await service.startWatching(['C:/watch'], vi.fn());
        await service.stopWatching();

        expect(errorSpy).toHaveBeenCalledWith('[WatcherService] Failed to stop native watcher:', 'stop failed');
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

    it('resumes the same watcher only when a paused purge attempt fails', async () => {
        const onChange = vi.fn();
        const service = new WatcherService();
        await service.startWatching(['C:/watch'], onChange);

        const resume = await service.pauseWatching();
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(2, []);

        await resume();
        expect(mockedStartNativeFolderWatcher).toHaveBeenNthCalledWith(3, ['C:/watch']);
        expect(mockedListen).toHaveBeenCalledTimes(2);
    });
});
