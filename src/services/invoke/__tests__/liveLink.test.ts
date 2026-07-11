import { beforeEach, describe, expect, it, vi } from 'vitest';
import { watch } from '@tauri-apps/plugin-fs';
import { startLiveLink } from '../liveLink';

vi.mock('@tauri-apps/plugin-fs', () => ({ watch: vi.fn() }));

const mockedWatch = vi.mocked(watch);

describe('startLiveLink', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('does not watch until an InvokeAI path is configured', async () => {
        expect(await startLiveLink('', vi.fn())).toBeNull();
        expect(mockedWatch).not.toHaveBeenCalled();
    });

    it('normalizes the image path and forwards create, modify, and string events', async () => {
        const unwatch = vi.fn();
        let handler: ((event: { type: unknown }) => void) | undefined;
        mockedWatch.mockImplementation(async (_path, callback) => {
            handler = callback as (event: { type: unknown }) => void;
            return unwatch;
        });
        const onNewImage = vi.fn();

        expect(await startLiveLink('C:\\InvokeAI', onNewImage)).toBe(unwatch);
        expect(mockedWatch).toHaveBeenCalledWith(
            'C:/InvokeAI/outputs/images',
            expect.any(Function),
            { recursive: false }
        );

        handler?.({ type: 'create' });
        handler?.({ type: { Create: { kind: 'file' } } });
        handler?.({ type: { Modify: { kind: 'data' } } });
        handler?.({ type: {} });
        handler?.({ type: '' });
        expect(onNewImage).toHaveBeenCalledTimes(3);
    });

    it('returns null when the filesystem watcher cannot start', async () => {
        mockedWatch.mockRejectedValueOnce(new Error('scope denied'));
        expect(await startLiveLink('D:/InvokeAI', vi.fn())).toBeNull();
        expect(console.error).toHaveBeenCalledWith(
            '[LiveLink] Failed to start live watch:',
            expect.any(Error)
        );
    });
});
