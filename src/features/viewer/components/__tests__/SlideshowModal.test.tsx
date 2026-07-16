import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIImage, GeneratorTool } from '../../../../types';
import { SlideshowModal } from '../SlideshowModal';

const imageMocks = vi.hoisted(() => ({ preloadedSources: [] as string[] }));

vi.mock('framer-motion', async () => {
    const ReactModule = await import('react');
    type MotionDivProps = React.HTMLAttributes<HTMLDivElement> & {
        initial?: unknown;
        animate?: unknown;
        transition?: unknown;
    };
    return {
        motion: {
            div: ({ initial: _initial, animate: _animate, transition: _transition, ...props }: MotionDivProps) =>
                ReactModule.createElement('div', { ...props, 'data-testid': 'progress-bar' }),
        },
    };
});

vi.mock('../../../library/components/SmartImage', () => ({
    SmartImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const createImage = (index: number): AIImage => ({
    id: `image-${index}`,
    url: `asset://image-${index}.png`,
    thumbnailUrl: `asset://thumb-${index}.png`,
    filename: `image-${index}.png`,
    timestamp: Date.UTC(2025, 0, index + 1),
    width: 1024,
    height: 768,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: `Model ${index}`,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: `Prompt ${index}`,
        negativePrompt: '',
    },
});

const images = [createImage(0), createImage(1), createImage(2)];

const iconButton = (container: HTMLElement, iconClass: string): HTMLButtonElement => {
    const button = container.querySelector(`.${iconClass}`)?.closest('button');
    if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button for ${iconClass}`);
    return button;
};

describe('SlideshowModal', () => {
    const onClose = vi.fn();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        imageMocks.preloadedSources.length = 0;
        vi.stubGlobal('Image', class Image {
            set src(value: string) {
                imageMocks.preloadedSources.push(value);
            }
        });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('renders nothing while closed or when the requested image is missing', () => {
        const { container, rerender } = render(
            <SlideshowModal isOpen={false} images={images} initialIndex={0} onClose={onClose} />,
        );
        expect(container.innerHTML).toBe('');

        rerender(<SlideshowModal isOpen images={[]} initialIndex={0} onClose={onClose} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders the initial image and preloads the next sequential image', () => {
        render(<SlideshowModal isOpen images={images} initialIndex={1} onClose={onClose} />);

        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-1.png');
        expect(screen.getByText('Prompt 1')).toBeTruthy();
        expect(screen.getByText('Model 1')).toBeTruthy();
        expect(screen.getByTestId('progress-bar')).toBeTruthy();
        expect(imageMocks.preloadedSources).toEqual(['asset://image-2.png']);
    });

    it('navigates forward, backward, and wraps at the first image', () => {
        const { container } = render(
            <SlideshowModal isOpen images={images} initialIndex={0} onClose={onClose} />,
        );

        fireEvent.click(iconButton(container, 'lucide-chevron-right'));
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-1.png');

        fireEvent.click(iconButton(container, 'lucide-chevron-left'));
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-0.png');

        fireEvent.click(iconButton(container, 'lucide-chevron-left'));
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-2.png');
    });

    it('supports keyboard playback, navigation, info, and close controls', () => {
        render(<SlideshowModal isOpen images={images} initialIndex={0} onClose={onClose} />);

        const dialog = screen.getByRole('dialog', { name: 'Slideshow' });
        expect(document.activeElement).toBe(dialog);

        const spaceEvent = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        fireEvent(dialog, spaceEvent);
        expect(spaceEvent.defaultPrevented).toBe(true);
        expect(screen.queryByTestId('progress-bar')).toBeNull();

        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-1.png');
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-0.png');

        fireEvent.keyDown(window, { key: 'i' });
        expect(screen.queryByText('Prompt 0')).toBeNull();
        fireEvent.keyDown(window, { key: 'i' });
        expect(screen.getByText('Prompt 0')).toBeTruthy();

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('advances on the playback timer and pauses when the backdrop is clicked', () => {
        const { container } = render(
            <SlideshowModal isOpen images={images} initialIndex={0} onClose={onClose} />,
        );

        act(() => vi.advanceTimersByTime(5000));
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-1.png');

        const backdrop = container.firstElementChild;
        if (!(backdrop instanceof HTMLElement)) throw new Error('Missing slideshow backdrop');
        fireEvent.click(backdrop);
        expect(screen.queryByTestId('progress-bar')).toBeNull();

        act(() => vi.advanceTimersByTime(10000));
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-1.png');
    });

    it('cycles through every duration and keeps control clicks from pausing playback', () => {
        const { container } = render(
            <SlideshowModal isOpen images={images} initialIndex={0} onClose={onClose} />,
        );
        const durationButton = screen.getByTitle('Toggle Duration');

        expect(durationButton.textContent).toContain('5s');
        fireEvent.click(durationButton);
        expect(durationButton.textContent).toContain('10s');
        fireEvent.click(durationButton);
        expect(durationButton.textContent).toContain('30s');
        fireEvent.click(durationButton);
        expect(durationButton.textContent).toContain('3s');
        fireEvent.click(durationButton);
        expect(durationButton.textContent).toContain('5s');
        expect(screen.getByTestId('progress-bar')).toBeTruthy();

        fireEvent.click(iconButton(container, 'lucide-pause'));
        expect(screen.queryByTestId('progress-bar')).toBeNull();
        fireEvent.click(iconButton(container, 'lucide-play'));
        expect(screen.getByTestId('progress-bar')).toBeTruthy();
    });

    it('hides an idle HUD, restores it on movement, and closes from the HUD button', () => {
        const { container } = render(
            <SlideshowModal isOpen images={images} initialIndex={0} onClose={onClose} />,
        );
        const backdrop = container.firstElementChild;
        if (!(backdrop instanceof HTMLElement)) throw new Error('Missing slideshow backdrop');

        act(() => vi.advanceTimersByTime(3500));
        expect(backdrop.className).toContain('cursor-none');

        fireEvent.mouseMove(backdrop);
        expect(backdrop.className).not.toContain('cursor-none');
        fireEvent.mouseMove(backdrop);

        fireEvent.click(iconButton(container, 'lucide-x'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('uses shuffled navigation without repeating the current preloaded image', () => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        const { container } = render(
            <SlideshowModal
                isOpen
                images={images}
                initialIndex={0}
                onClose={onClose}
                isShuffleDefault
            />,
        );

        expect(random).toHaveBeenCalled();
        expect(imageMocks.preloadedSources.at(-1)).toBe('asset://image-1.png');
        fireEvent.click(iconButton(container, 'lucide-chevron-right'));
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-1.png');

        random.mockReturnValue(0.9);
        fireEvent.click(iconButton(container, 'lucide-chevron-left'));
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-2.png');

        fireEvent.click(screen.getByRole('button', { name: 'Disable Shuffle' }));
        expect(screen.getByRole('button', { name: 'Enable Shuffle' }).className).toContain('text-white/50');
    });

    it('uses navigation fallback logic when a single image cannot be preloaded', () => {
        const singleImage = [images[0]];
        const { container } = render(
            <SlideshowModal isOpen images={singleImage} initialIndex={0} onClose={onClose} />,
        );

        expect(imageMocks.preloadedSources).toEqual([]);
        fireEvent.click(iconButton(container, 'lucide-chevron-right'));
        expect(screen.getByAltText('slideshow').getAttribute('src')).toBe('asset://image-0.png');
    });
});
