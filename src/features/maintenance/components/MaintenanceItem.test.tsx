import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type VideoAsset } from '../../../types';
import { MaintenanceItem } from './MaintenanceItem';

const settingsState = vi.hoisted(() => ({ privacyEnabled: true }));
vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

const image = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'image-1',
    url: 'asset://image-1',
    thumbnailUrl: 'asset://image-1-thumb',
    filename: 'image-1.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: '',
        steps: 20,
        cfg: 7,
        sampler: '',
        positivePrompt: 'contains secret material',
        negativePrompt: '',
    },
    ...overrides,
});

const video = (overrides: Partial<VideoAsset> = {}): VideoAsset => ({
    ...image(),
    mediaType: 'video',
    durationMs: 1000,
    videoCodec: 'h264',
    audioPresent: false,
    rotationDegrees: 0,
    probeStatus: 'ready',
    playbackStatus: 'unknown',
    ...overrides,
});

describe('MaintenanceItem', () => {
    beforeEach(() => {
        settingsState.privacyEnabled = true;
    });

    it('reveals masked content without triggering selection and remasks on leave', () => {
        const onClick = vi.fn();
        const { container } = render(
            <MaintenanceItem
                img={image()}
                style={{ width: 200 }}
                onClick={onClick}
                maskedKeywords={['secret']}
                overlayActions={(revealGranted) => <button data-reveal-granted={revealGranted}>Open</button>}
            >
                <span>Child badge</span>
            </MaintenanceItem>
        );

        const photo = container.querySelector('img') as HTMLImageElement;
        expect(photo.className).toContain('blur-xl');
        expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        expect(onClick).not.toHaveBeenCalled();
        expect(photo.className).not.toContain('blur-xl');
        expect(screen.getByRole('button', { name: 'Open' }).getAttribute('data-reveal-granted')).toBe('true');
        fireEvent.click(photo.closest('.cursor-pointer') as Element);
        expect(onClick).toHaveBeenCalledWith(expect.anything(), true);
        expect(screen.getByText('Child badge')).toBeTruthy();
        expect(screen.getByText('image-1.png')).toBeTruthy();

        fireEvent.mouseLeave(photo.closest('.cursor-pointer') as Element);
        expect(screen.getByRole('button', { name: 'Reveal' })).toBeTruthy();
    });

    it('renders selected missing content and optional presentation controls', () => {
        settingsState.privacyEnabled = false;
        const onClick = vi.fn();
        const { container } = render(
            <MaintenanceItem
                img={image({ userMasked: true })}
                style={{ height: 180 }}
                isSelected
                onClick={onClick}
                maskedKeywords={['secret']}
                showFilename={false}
                imageClassName="custom-image"
                isMissing
            />
        );

        expect(screen.getByText('Missing Source')).toBeTruthy();
        expect(screen.queryByText('image-1.png')).toBeNull();
        expect((container.querySelector('img') as HTMLImageElement).className).toContain('custom-image');
        fireEvent.click(container.querySelector('.cursor-pointer') as Element);
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('uses a generic placeholder instead of requesting a posterless video source', () => {
        settingsState.privacyEnabled = false;
        const { container } = render(
            <MaintenanceItem
                img={video({
                    id: 'C:/videos/clip.mp4',
                    url: 'asset://C:/videos/clip.mp4',
                    thumbnailUrl: 'asset://C:/videos/clip.mp4',
                    filename: 'clip.mp4',
                })}
                style={{ height: 180 }}
                onClick={vi.fn()}
                maskedKeywords={[]}
            />
        );

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getByText('clip.mp4')).toBeTruthy();
    });

    it('renders an Ambit-owned video poster without falling back to the video source', () => {
        settingsState.privacyEnabled = false;
        const { container } = render(
            <MaintenanceItem
                img={video({
                    thumbnailUrl: 'asset://poster.webp',
                    thumbnailSource: 'ambit-video-v1',
                })}
                style={{ height: 180 }}
                onClick={vi.fn()}
                maskedKeywords={[]}
            />
        );

        expect((container.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('asset://poster.webp');
    });
});
