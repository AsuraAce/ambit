import * as React from 'react';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { ImageCanvas } from '../ImageCanvas';

vi.mock('framer-motion', () => ({ motion: { div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div> } }));
vi.mock('../../../library/components/SmartImage', () => ({ SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} /> }));

const image: AIImage = {
    id: 'a', url: 'a.png', thumbnailUrl: 'thumb.png', filename: 'a.png', timestamp: 1, width: 100, height: 100, isFavorite: false, isPinned: false,
    metadata: { tool: GeneratorTool.COMFYUI, model: '', seed: 1, steps: 1, cfg: 1, sampler: '', positivePrompt: 'prompt', negativePrompt: '' }
};

const setup = (overrides: Partial<React.ComponentProps<typeof ImageCanvas>> = {}) => {
    const handlers = { onWheel: vi.fn(), onMouseDown: vi.fn(), onMouseMove: vi.fn(), onMouseUp: vi.fn(), onMouseLeave: vi.fn(), onDoubleClick: vi.fn() };
    const props: React.ComponentProps<typeof ImageCanvas> = {
        image, scale: 1, position: { x: 2, y: 3 }, isDragging: false, showControls: true,
        onPrev: vi.fn(), onNext: vi.fn(), onClose: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(), onResetZoom: vi.fn(),
        isTheaterMode: false, onToggleTheater: vi.fn(), handlers, ...overrides
    };
    const result = render(<ImageCanvas {...props} />);
    return { ...result, props, handlers };
};

describe('ImageCanvas', () => {
    it('routes controls, navigation, and pointer handlers', () => {
        const { container, props, handlers } = setup();
        for (const [title, callback] of [['Zoom Out', props.onZoomOut], ['Zoom In', props.onZoomIn], ['Reset View', props.onResetZoom], ['Previous Image (Left Arrow)', props.onPrev], ['Next Image (Right Arrow)', props.onNext]] as const) {
            fireEvent.click(screen.getByTitle(title));
            expect(callback).toHaveBeenCalledTimes(1);
        }
        const area = screen.getByAltText('prompt').closest('.group') as HTMLElement;
        fireEvent.wheel(area); fireEvent.mouseDown(area); fireEvent.mouseUp(area); fireEvent.mouseLeave(area); fireEvent.doubleClick(area);
        fireEvent.mouseMove(container.firstElementChild as HTMLElement);
        for (const callback of Object.values(handlers)) expect(callback).toHaveBeenCalled();
        expect(screen.getByText('100%')).toBeTruthy();
    });

    it('closes or exits theater only for unzoomed background clicks', () => {
        const first = setup();
        const area = screen.getByAltText('prompt').closest('.group') as HTMLElement;
        fireEvent.click(area);
        expect(first.props.onClose).toHaveBeenCalledTimes(1);
        first.unmount();

        const theater = setup({ isTheaterMode: true });
        fireEvent.click(screen.getByAltText('prompt').closest('.group') as HTMLElement);
        expect(theater.props.onToggleTheater).toHaveBeenCalledTimes(1);
        theater.unmount();

        const zoomed = setup({ scale: 2, isDragging: true, showControls: false });
        fireEvent.click(screen.getByAltText('prompt').closest('.group') as HTMLElement);
        fireEvent.click(screen.getByAltText('prompt'));
        expect(zoomed.props.onClose).not.toHaveBeenCalled();
        expect(zoomed.container.querySelector('[style*="transition: none"]')).toBeTruthy();
    });
});
