import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type VideoAsset } from '../../../../types';
import { ImageCard } from '../ImageCard';

const smartImageMocks = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock('../SmartImage', () => ({
    SmartImage: (props: Record<string, unknown>) => {
        smartImageMocks.props.push(props);
        return <img src={String(props.src)} alt={String(props.alt)} className={String(props.className)} onError={() => (props.onImageError as (() => void) | undefined)?.()} />;
    }
}));

const image = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'image-1',
    url: 'source.png',
    thumbnailUrl: 'thumb.png',
    microThumbnail: 'micro',
    filename: 'image.png',
    timestamp: 1,
    width: 1024,
    height: 768,
    isFavorite: false,
    isPinned: false,
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: 'flux_dev',
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: '',
        negativePrompt: ''
    },
    ...overrides
});

const setup = (overrides: Partial<React.ComponentProps<typeof ImageCard>> = {}) => {
    const props: React.ComponentProps<typeof ImageCard> = {
        image: image(),
        isSelected: false,
        onClick: vi.fn(),
        onToggleSelection: vi.fn(),
        onToggleFavorite: vi.fn(),
        onTogglePin: vi.fn(),
        onContextMenu: vi.fn(),
        onDragStart: vi.fn(),
        onDrag: vi.fn(),
        onDragEnd: vi.fn(),
        onMouseDown: vi.fn(),
        onImageError: vi.fn(),
        ...overrides
    };
    const result = render(<ImageCard {...props} />);
    return { ...result, props };
};

const video = (overrides: Partial<VideoAsset> = {}): VideoAsset => ({
    ...image({ id: 'video-1', url: 'source.mp4', thumbnailUrl: 'source.mp4', filename: 'source.mp4' }),
    mediaType: 'video',
    durationMs: 12_000,
    videoCodec: 'AVC',
    audioPresent: true,
    rotationDegrees: 0,
    probeStatus: 'ready',
    playbackStatus: 'unknown',
    ...overrides
});

describe('ImageCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        smartImageMocks.props.length = 0;
    });

    it('renders image metadata and routes card, selection, drag, and image events', () => {
        const { container, props } = setup();
        const root = container.firstElementChild as HTMLElement;
        const renderedImage = screen.getByAltText('image.png');

        expect(root.draggable).toBe(true);
        expect(root.dataset.dragSource).toBe('true');
        expect(screen.getByText('flux_dev')).toBeTruthy();
        expect(screen.getByText('1024x768')).toBeTruthy();
        expect(smartImageMocks.props[0]).toMatchObject({ src: 'thumb.png', fallbackSrc: 'source.png', microSrc: 'micro', loading: 'lazy' });

        fireEvent.mouseDown(root);
        fireEvent.click(root);
        fireEvent.contextMenu(root);
        fireEvent.dragStart(root);
        fireEvent.drag(root);
        fireEvent.dragEnd(root);
        fireEvent.error(renderedImage);
        expect(props.onMouseDown).toHaveBeenCalledTimes(1);
        expect(props.onClick).toHaveBeenCalledTimes(1);
        expect(props.onContextMenu).toHaveBeenCalledTimes(1);
        expect(props.onDragStart).toHaveBeenCalledWith(expect.anything(), 'image-1');
        expect(props.onDrag).toHaveBeenCalledTimes(1);
        expect(props.onDragEnd).toHaveBeenCalledTimes(1);
        expect(props.onImageError).toHaveBeenCalledTimes(1);

        fireEvent.click(container.querySelector('.absolute.top-2.left-2') as HTMLElement);
        fireEvent.click(screen.getByRole('button', { name: 'Add to Favorites' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pin to Top' }));
        expect(props.onToggleSelection).toHaveBeenCalledTimes(1);
        expect(props.onToggleFavorite).toHaveBeenCalledTimes(1);
        expect(props.onTogglePin).toHaveBeenCalledTimes(1);
        expect(props.onClick).toHaveBeenCalledTimes(1);
    });

    it('reveals masked content and automatically hides it after leaving', () => {
        const { container, props } = setup({ isMasked: true, isSelected: true });
        const root = container.firstElementChild as HTMLElement;
        expect(screen.getByText('Hidden Content')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Hide Content' })).toBeNull();
        fireEvent.mouseLeave(root);
        expect(screen.getByText('Hidden Content')).toBeTruthy();

        fireEvent.click(screen.getByText('Reveal'));
        expect(screen.queryByText('Hidden Content')).toBeNull();
        expect(screen.getByRole('button', { name: 'Hide Content' })).toBeTruthy();
        fireEvent.click(root);
        expect(props.onClick).toHaveBeenCalledWith(expect.anything(), true);
        expect(root.className).toContain('border-sage-500');

        fireEvent.click(screen.getByRole('button', { name: 'Hide Content' }));
        expect(screen.getByText('Hidden Content')).toBeTruthy();
        fireEvent.click(screen.getByText('Reveal'));
        fireEvent.mouseLeave(root);
        expect(screen.getByText('Hidden Content')).toBeTruthy();
        expect(props.onClick).toHaveBeenCalledOnce();
    });

    it('never assigns a posterless video to an image element and requires a revealed card before opening', () => {
        const { container, props } = setup({ image: video(), isMasked: true });

        expect(smartImageMocks.props).toHaveLength(0);
        expect(screen.getByText('Hidden Content')).toBeTruthy();
        fireEvent.mouseEnter(container.firstElementChild as HTMLElement);
        expect(screen.getByText('Hidden Content')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        expect(props.onClick).not.toHaveBeenCalled();
        expect(screen.queryByText('Hidden Content')).toBeNull();
        fireEvent.click(container.firstElementChild as HTMLElement);
        expect(props.onClick).toHaveBeenCalledWith(expect.anything(), true);
        expect(screen.getByText('AVC')).toBeTruthy();
        expect(screen.getByText('1024x768 · 0:12')).toBeTruthy();
    });

    it('uses only an Ambit poster for video cards and has no source-video fallback', () => {
        setup({
            image: video({
                thumbnailUrl: 'poster.webp',
                thumbnailSource: 'ambit-video-v1'
            })
        });

        expect(smartImageMocks.props[0]).toMatchObject({ src: 'poster.webp', fallbackSrc: undefined });
    });

    it('disables unavailable actions and shows missing, deleted, thumbnail, pin, and favorite states', () => {
        const favorite = vi.fn();
        const { container, rerender } = setup({
            image: image({ isMissing: true, isDeleted: true, isPinned: true, isFavorite: true }),
            isMasked: true,
            isThumbnail: true,
            onTogglePin: undefined,
            onDragStart: undefined,
            onToggleFavorite: favorite
        });
        const root = container.firstElementChild as HTMLElement;
        expect(root.draggable).toBe(false);
        expect(root.className).toContain('cursor-not-allowed');
        expect(screen.getByTitle('Source file not found')).toBeTruthy();
        expect(screen.queryByText('Trash')).toBeNull();
        expect(screen.queryByText('Hidden Content')).toBeNull();
        expect(screen.queryByTitle('Pinned')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove from Favorites' })).toBeNull();
        expect(screen.queryByTitle('Collection Thumbnail')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Pin to Top' })).toBeNull();
        fireEvent.dragStart(root);

        rerender(<ImageCard image={image({ isDeleted: true, isPinned: true, isFavorite: true })} isSelected={false} isThumbnail onClick={vi.fn()} onToggleSelection={vi.fn()} onToggleFavorite={favorite} onTogglePin={vi.fn()} />);
        expect(screen.getByText('Trash')).toBeTruthy();
        expect(screen.getByTitle('Pinned')).toBeTruthy();
        expect(screen.getByRole('img', { name: 'Favorite' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove from Favorites' })).toBeTruthy();
        expect(screen.getByTitle('Collection Thumbnail')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Unpin' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Remove from Favorites' }));
        expect(favorite).toHaveBeenCalledOnce();
    });

    it('uses override, object, hash, and generic model labels in priority order', () => {
        const callbacks = { onClick: vi.fn(), onToggleSelection: vi.fn(), onToggleFavorite: vi.fn() };
        const { rerender } = render(<ImageCard image={image({ metadata: { ...image().metadata, overrideModel: 'override_model' } })} isSelected={false} {...callbacks} />);
        expect(screen.getByText('override_model')).toBeTruthy();

        rerender(<ImageCard image={image({ metadata: { ...image().metadata, model: { name: 'object-model' } as unknown as string } })} isSelected={false} {...callbacks} />);
        expect(screen.getByText('object-model')).toBeTruthy();

        rerender(<ImageCard image={image({ metadata: { ...image().metadata, model: 'Unknown', modelHash: '1234567890abcdef' } })} isSelected={false} {...callbacks} />);
        expect(screen.getByText('Hash: 12345678')).toBeTruthy();

        rerender(<ImageCard image={image({ metadata: { ...image().metadata, model: { name: '' } as unknown as string } })} isSelected={false} {...callbacks} />);
        expect(screen.getByText('Model')).toBeTruthy();

        rerender(<ImageCard image={image({ metadata: { ...image().metadata, model: null as unknown as string } })} isSelected={false} {...callbacks} />);
        expect(screen.getByText('Model')).toBeTruthy();
    });

    it('labels only known InvokeAI image asset categories', () => {
        const callbacks = { onClick: vi.fn(), onToggleSelection: vi.fn(), onToggleFavorite: vi.fn() };
        const { rerender } = render(
            <ImageCard image={image({ invokeImageCategory: ' CONTROL ' })} isSelected={false} {...callbacks} />
        );

        const marker = screen.getByText('Asset · Control');
        expect(marker.getAttribute('title')).toBe('InvokeAI image asset category: Control');
        expect(marker.getAttribute('aria-label')).toBe('InvokeAI image asset category: Control');
        expect(marker.className).toContain('top-2');
        expect(marker.className).toContain('left-1/2');
        expect(marker.className).toContain('-translate-x-1/2');

        rerender(<ImageCard image={image({ invokeImageCategory: 'general' })} isSelected={false} {...callbacks} />);
        expect(screen.queryByText('Asset · Control')).toBeNull();
        expect(screen.queryByText('General')).toBeNull();

        rerender(<ImageCard image={image({ invokeImageCategory: 'future-category' })} isSelected={false} {...callbacks} />);
        expect(screen.queryByText('future-category')).toBeNull();
    });
});
