import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '../../../../test/testUtils';
import { GeneratorTool, type AIImage } from '../../../../types';
import { ImageCanvas } from '../ImageCanvas';
import { VersionSelector } from '../VersionSelector';

const createImage = (id: string, width = 512, height = 512): AIImage => ({
    id,
    url: `asset://${id}.png`,
    thumbnailUrl: `asset://${id}.webp`,
    filename: `${id}.png`,
    timestamp: 1,
    width,
    height,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: '',
        negativePrompt: ''
    }
});

const handlers = {
    onWheel: vi.fn(),
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
    onMouseLeave: vi.fn(),
    onDoubleClick: vi.fn()
};

describe('viewer keyboard controls', () => {
    it('reveals the version selector on focus and keeps Enter and Space local without blocking activation', () => {
        const onVersionSelect = vi.fn();
        render(
            <VersionSelector
                versions={[createImage('original'), createImage('upscaled', 1024, 1024)]}
                activeVersionId="original"
                onVersionSelect={onVersionSelect}
                showControls={false}
            />
        );
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        try {
            const versionButton = screen.getByRole('button', { name: 'View upscaled version at 1024 by 1024' });
            const selector = versionButton.parentElement as HTMLElement;
            expect(selector.className).toContain('opacity-0');
            expect(selector.className).toContain('focus-within:opacity-100');
            expect(selector.className).toContain('focus-within:pointer-events-auto');

            versionButton.focus();
            expect(document.activeElement).toBe(versionButton);

            for (const key of ['Enter', ' ']) {
                const keyEvent = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
                fireEvent(versionButton, keyEvent);
                expect(keyEvent.defaultPrevented).toBe(false);
            }

            expect(onWindowKeyDown).not.toHaveBeenCalled();
            fireEvent.click(versionButton);
            expect(onVersionSelect).toHaveBeenCalledTimes(1);
            expect(onVersionSelect).toHaveBeenCalledWith('upscaled');
        } finally {
            window.removeEventListener('keydown', onWindowKeyDown);
        }
    });

    it.each([
        ['Enter', 'Previous Image (Left Arrow)', 'previous'],
        [' ', 'Next Image (Right Arrow)', 'next']
    ])('keeps %s navigation activation on the local %s control', (key, accessibleName, direction) => {
        const onPrev = vi.fn();
        const onNext = vi.fn();
        render(
            <ImageCanvas
                image={createImage('current')}
                scale={1}
                position={{ x: 0, y: 0 }}
                isDragging={false}
                showControls
                onPrev={onPrev}
                onNext={onNext}
                onClose={vi.fn()}
                onZoomIn={vi.fn()}
                onZoomOut={vi.fn()}
                onResetZoom={vi.fn()}
                isTheaterMode={false}
                onToggleTheater={vi.fn()}
                handlers={handlers}
            />
        );
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        try {
            const navigationButton = screen.getByRole('button', { name: accessibleName });
            const keyEvent = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

            fireEvent(navigationButton, keyEvent);

            expect(keyEvent.defaultPrevented).toBe(false);
            expect(onWindowKeyDown).not.toHaveBeenCalled();

            fireEvent.click(navigationButton);

            expect(direction === 'previous' ? onPrev : onNext).toHaveBeenCalledTimes(1);
            expect(direction === 'previous' ? onNext : onPrev).not.toHaveBeenCalled();
        } finally {
            window.removeEventListener('keydown', onWindowKeyDown);
        }
    });
});
