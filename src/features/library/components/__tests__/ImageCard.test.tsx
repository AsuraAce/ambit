import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
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
        fireEvent.click(screen.getByTitle('Favorite'));
        fireEvent.click(screen.getByTitle('Pin to Top'));
        expect(props.onToggleSelection).toHaveBeenCalledTimes(1);
        expect(props.onToggleFavorite).toHaveBeenCalledTimes(1);
        expect(props.onTogglePin).toHaveBeenCalledTimes(1);
        expect(props.onClick).toHaveBeenCalledTimes(1);
    });

    it('reveals masked content and automatically hides it after leaving', () => {
        const { container, props } = setup({ isMasked: true, isSelected: true });
        const root = container.firstElementChild as HTMLElement;
        expect(screen.getByText('Hidden Content')).toBeTruthy();
        expect(screen.queryByTitle('Hide content')).toBeNull();
        fireEvent.mouseLeave(root);
        expect(screen.getByText('Hidden Content')).toBeTruthy();

        fireEvent.click(screen.getByText('Reveal'));
        expect(screen.queryByText('Hidden Content')).toBeNull();
        expect(screen.getByTitle('Hide content')).toBeTruthy();
        expect(root.className).toContain('border-sage-500');

        fireEvent.click(screen.getByTitle('Hide content'));
        expect(screen.getByText('Hidden Content')).toBeTruthy();
        fireEvent.click(screen.getByText('Reveal'));
        fireEvent.mouseLeave(root);
        expect(screen.getByText('Hidden Content')).toBeTruthy();
        expect(props.onClick).not.toHaveBeenCalled();
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
        expect(screen.queryByTitle('Unfavorite')).toBeNull();
        expect(screen.queryByTitle('Collection Thumbnail')).toBeNull();
        expect(screen.queryByTitle('Pin to Top')).toBeNull();
        fireEvent.dragStart(root);

        rerender(<ImageCard image={image({ isDeleted: true, isPinned: true, isFavorite: true })} isSelected={false} isThumbnail onClick={vi.fn()} onToggleSelection={vi.fn()} onToggleFavorite={favorite} onTogglePin={vi.fn()} />);
        expect(screen.getByText('Trash')).toBeTruthy();
        expect(screen.getByTitle('Pinned')).toBeTruthy();
        expect(screen.getAllByTitle('Unfavorite')).toHaveLength(2);
        expect(screen.getByTitle('Collection Thumbnail')).toBeTruthy();
        expect(screen.getByTitle('Unpin')).toBeTruthy();
        for (const control of screen.getAllByTitle('Unfavorite')) fireEvent.click(control);
        expect(favorite).toHaveBeenCalledTimes(2);
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
});
