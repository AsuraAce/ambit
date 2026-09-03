import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    importVideoAsset: vi.fn(),
    storeVideoPoster: vi.fn(),
    cancelVideoImport: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock('../../bindings', () => ({
    commands: {
        importVideoAsset: mocks.importVideoAsset,
        storeVideoPoster: mocks.storeVideoPoster,
        cancelVideoImport: mocks.cancelVideoImport,
    },
}));

describe('videoService', () => {
    beforeEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('stops a sequential import batch after the active probe is cancelled', async () => {
        mocks.importVideoAsset.mockResolvedValue({
            status: 'ok',
            data: { status: 'cancelled', asset: null, reason: null },
        });
        const { importVideoPaths } = await import('../videoService');

        const summary = await importVideoPaths([
            'C:/videos/first.mp4',
            'C:/videos/second.mp4',
        ]);

        expect(summary.cancelled).toBe(1);
        expect(mocks.importVideoAsset).toHaveBeenCalledTimes(1);
        expect(mocks.storeVideoPoster).not.toHaveBeenCalled();
    });

    it('does not start another probe after the batch cancellation flag is set', async () => {
        const { importVideoPaths } = await import('../videoService');

        const summary = await importVideoPaths(
            ['C:/videos/first.mp4'],
            undefined,
            () => true
        );

        expect(summary).toMatchObject({ imported: 0, duplicate: 0, rejected: 0, cancelled: 0 });
        expect(mocks.importVideoAsset).not.toHaveBeenCalled();
    });

    it('isolates a failed native import and continues with the remaining paths', async () => {
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.importVideoAsset
            .mockRejectedValueOnce(new Error('file vanished'))
            .mockResolvedValueOnce({
                status: 'ok',
                data: { status: 'duplicate', asset: null, reason: null },
            });
        const { importVideoPaths } = await import('../videoService');

        const summary = await importVideoPaths([
            'C:/videos/vanished.mp4',
            'C:/videos/existing.mp4',
        ]);

        expect(summary).toMatchObject({ imported: 0, duplicate: 1, rejected: 1, cancelled: 0 });
        expect(mocks.importVideoAsset).toHaveBeenCalledTimes(2);
        expect(warning).toHaveBeenCalledWith(
            '[VideoImport] Failed to import video; continuing batch',
            'C:/videos/vanished.mp4',
            expect.any(Error)
        );
    });

    it('does not decode a poster again for an unchanged video record', async () => {
        const createElement = vi.spyOn(document, 'createElement');
        mocks.importVideoAsset.mockResolvedValue({
            status: 'ok',
            data: {
                status: 'duplicate',
                reason: null,
                asset: {
                    id: 'C:/videos/existing.mp4',
                    path: 'C:/videos/existing.mp4',
                    fileSize: 1024,
                    timestamp: 100,
                    width: 320,
                    height: 180,
                    mediaContainer: 'mp4',
                    mediaMimeType: 'video/mp4',
                    durationMs: 2000,
                    videoCodec: 'h264',
                    videoProfile: null,
                    audioPresent: false,
                    audioCodec: null,
                    frameRateNum: 30,
                    frameRateDen: 1,
                    rotationDegrees: 0,
                },
            },
        });
        const { importVideoPaths } = await import('../videoService');

        const summary = await importVideoPaths(['C:/videos/existing.mp4']);

        expect(summary).toMatchObject({ duplicate: 1, posterFailures: 0 });
        expect(summary.handledPaths).toEqual(['C:/videos/existing.mp4']);
        expect(createElement).not.toHaveBeenCalledWith('video');
        expect(mocks.storeVideoPoster).not.toHaveBeenCalled();
    });

    it('stops poster extraction promptly when the committed import batch is cancelled', async () => {
        vi.useFakeTimers();
        const listeners = new Map<string, EventListener>();
        const video = {
            crossOrigin: '',
            muted: false,
            preload: '',
            src: '',
            duration: 2,
            currentTime: 0,
            videoWidth: 320,
            videoHeight: 180,
            addEventListener: vi.fn((event: string, listener: EventListener) => listeners.set(event, listener)),
            removeEventListener: vi.fn((event: string) => listeners.delete(event)),
            removeAttribute: vi.fn(),
            load: vi.fn(),
        };
        const createElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => (
            tagName === 'video'
                ? video as unknown as HTMLVideoElement
                : createElement(tagName)
        ));
        mocks.importVideoAsset.mockResolvedValue({
            status: 'ok',
            data: {
                status: 'imported',
                reason: null,
                asset: {
                    id: 'C:/videos/first.mp4',
                    path: 'C:/videos/first.mp4',
                    fileSize: 1024,
                    timestamp: 100,
                    width: 320,
                    height: 180,
                    mediaContainer: 'mp4',
                    mediaMimeType: 'video/mp4',
                    durationMs: 2000,
                    videoCodec: 'h264',
                    videoProfile: null,
                    audioPresent: false,
                    audioCodec: null,
                    frameRateNum: 30,
                    frameRateDen: 1,
                    rotationDegrees: 0,
                },
            },
        });
        const { importVideoPaths } = await import('../videoService');
        let cancelled = false;

        const resultPromise = importVideoPaths(
            ['C:/videos/first.mp4', 'C:/videos/second.mp4'],
            undefined,
            () => cancelled
        );
        await vi.advanceTimersByTimeAsync(0);
        expect(video.addEventListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function), { once: true });

        cancelled = true;
        await vi.advanceTimersByTimeAsync(50);
        const summary = await resultPromise;

        expect(summary).toMatchObject({
            imported: 1,
            cancelled: 0,
            posterFailures: 0,
            handledPaths: ['C:/videos/first.mp4'],
        });
        expect(summary.assets).toHaveLength(1);
        expect(mocks.importVideoAsset).toHaveBeenCalledTimes(1);
        expect(mocks.storeVideoPoster).not.toHaveBeenCalled();
        expect(video.removeAttribute).toHaveBeenCalledWith('src');
        expect(video.load).toHaveBeenCalledOnce();
        expect(listeners.size).toBe(0);
    });
});
