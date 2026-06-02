import { listen } from '@tauri-apps/api/event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../../bindings';
import { WatcherService } from '../WatcherService';

vi.mock('../../bindings', () => ({
    commands: {
        startNativeFolderWatcher: vi.fn()
    }
}));

const mockedStartNativeFolderWatcher = vi.mocked(commands.startNativeFolderWatcher);
const mockedListen = vi.mocked(listen);

describe('WatcherService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedListen.mockResolvedValue(() => undefined);
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
});
