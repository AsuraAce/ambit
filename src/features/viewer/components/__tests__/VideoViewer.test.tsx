import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type VideoAsset } from '../../../../types';
import { VideoViewer } from '../VideoViewer';

const mocks = vi.hoisted(() => ({
    updateVideoPlaybackStatus: vi.fn().mockResolvedValue(undefined),
    openFileInDefaultApp: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    prepareVideoPlayback: vi.fn().mockResolvedValue({ status: 'ok', data: 'C:/videos/clip.mp4' }),
    convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
    getCollectionsForImage: vi.fn().mockResolvedValue([]),
    addToast: vi.fn()
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    updateVideoPlaybackStatus: mocks.updateVideoPlaybackStatus
}));
vi.mock('../../../../services/db/collectionRepo', () => ({
    getCollectionsForImage: mocks.getCollectionsForImage
}));
vi.mock('../../../../services/osOpen', () => ({
    openFileInDefaultApp: mocks.openFileInDefaultApp
}));
vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({ addToast: mocks.addToast })
}));
vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: mocks.convertFileSrc
}));
vi.mock('../../../../stores/collectionStore', () => ({
    useCollectionStore: (selector: (state: { collections: Array<{ id: string; name: string }> }) => unknown) =>
        selector({ collections: [{ id: 'collection-1', name: 'Favorites set' }] })
}));
vi.mock('../../../../bindings', () => ({
    commands: {
        exportAssetOriginal: vi.fn(),
        prepareVideoPlayback: mocks.prepareVideoPlayback
    }
}));

const video: VideoAsset = {
    id: 'C:/videos/clip.mp4',
    url: 'asset://localhost/C:/videos/clip.mp4',
    thumbnailUrl: 'poster.webp',
    thumbnailSource: 'ambit-video-v1',
    filename: 'clip.mp4',
    timestamp: 1,
    width: 1920,
    height: 1080,
    isFavorite: false,
    isPinned: false,
    mediaType: 'video',
    mediaContainer: 'MPEG-4',
    durationMs: 2_500,
    videoCodec: 'AVC',
    audioPresent: true,
    audioCodec: 'AAC',
    rotationDegrees: 0,
    probeStatus: 'ready',
    playbackStatus: 'unknown',
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: ''
    }
};

const setup = (isMasked = false) => {
    const props: React.ComponentProps<typeof VideoViewer> = {
        video,
        isMasked,
        onClose: vi.fn(),
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onToggleFavorite: vi.fn(),
        onTogglePin: vi.fn(),
        onDelete: vi.fn(),
        onUpdateNotes: vi.fn(),
        onSetCollectionMembership: vi.fn().mockResolvedValue(true)
    };
    return { ...render(<VideoViewer {...props} />), props };
};

describe('VideoViewer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCollectionsForImage.mockResolvedValue([]);
    });

    it('does not create or scope a player before a masked video is revealed', async () => {
        setup(true);

        expect(screen.queryByRole('application')).toBeNull();
        expect(document.querySelector('video')).toBeNull();
        expect(mocks.prepareVideoPlayback).not.toHaveBeenCalled();
        expect(mocks.convertFileSrc).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Reveal video' }));
        expect(document.querySelector('video')).toBeNull();
        await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('clip.mp4'));
        expect(mocks.prepareVideoPlayback).toHaveBeenCalledWith(video.id);
        expect(mocks.convertFileSrc).toHaveBeenCalledWith('C:/videos/clip.mp4');
    });

    it('records decode success and renders an external fallback after a playback error', async () => {
        setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });

        fireEvent.canPlay(player);
        expect(mocks.updateVideoPlaybackStatus).toHaveBeenCalledWith(video.id, 'playable');

        fireEvent.error(player);
        expect(await screen.findByText('Playback unavailable here')).toBeTruthy();
        expect(mocks.updateVideoPlaybackStatus).toHaveBeenCalledWith(video.id, 'external_required');
    });

    it('persists notes and collection membership through generic asset actions', async () => {
        const { props } = setup();
        const notes = screen.getByRole('textbox');
        fireEvent.change(notes, { target: { value: 'Useful motion reference' } });
        fireEvent.blur(notes);
        expect(props.onUpdateNotes).toHaveBeenCalledWith(video.id, 'Useful motion reference');

        const membership = screen.getByRole('checkbox', { name: 'Favorites set' }) as HTMLInputElement;
        await waitFor(() => expect(membership.disabled).toBe(false));
        fireEvent.click(membership);
        await waitFor(() => expect(props.onSetCollectionMembership).toHaveBeenCalledWith(
            video.id,
            'collection-1',
            true
        ));
    });

    it('loads persisted collection membership when the viewer opens', async () => {
        mocks.getCollectionsForImage.mockResolvedValueOnce(['collection-1']);
        setup();

        const membership = screen.getByRole('checkbox', { name: 'Favorites set' }) as HTMLInputElement;
        await waitFor(() => expect(membership.checked).toBe(true));
        expect(mocks.getCollectionsForImage).toHaveBeenCalledWith(video.id);
    });

    it('shows a retryable error when collection membership cannot be loaded', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.getCollectionsForImage
            .mockRejectedValueOnce(new Error('sqlite busy'))
            .mockResolvedValueOnce(['collection-1']);
        setup();

        expect((await screen.findByRole('alert')).textContent).toContain('Could not load collection membership.');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        const membership = screen.getByRole('checkbox', { name: 'Favorites set' }) as HTMLInputElement;
        await waitFor(() => expect(membership.checked).toBe(true));
        expect(mocks.getCollectionsForImage).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalled();
    });

    it('seeks with visible controls and clamps at video boundaries', async () => {
        setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        Object.defineProperty(player, 'duration', { configurable: true, value: 30 });
        player.currentTime = 5;

        fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
        expect(player.currentTime).toBe(0);

        player.currentTime = 25;
        fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
        expect(player.currentTime).toBe(30);
    });

    it('uses J and L for seeking while preserving arrow gallery navigation', async () => {
        const { props } = setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
        player.currentTime = 30;

        fireEvent.keyDown(window, { key: 'j' });
        expect(player.currentTime).toBe(20);
        fireEvent.keyDown(window, { key: 'L' });
        expect(player.currentTime).toBe(30);

        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(props.onPrev).toHaveBeenCalledOnce();
        expect(props.onNext).toHaveBeenCalledOnce();
    });

    it('does not seek from editable controls or without finite media duration', async () => {
        setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        Object.defineProperty(player, 'duration', { configurable: true, value: Number.NaN });
        player.currentTime = 4;
        fireEvent.keyDown(window, { key: 'l' });
        expect(player.currentTime).toBe(4);

        Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
        const notes = screen.getByRole('textbox');
        fireEvent.keyDown(notes, { key: 'l' });
        expect(player.currentTime).toBe(4);

        const speed = screen.getByRole('combobox');
        fireEvent.keyDown(speed, { key: 'j' });
        expect(player.currentTime).toBe(4);
    });
});
