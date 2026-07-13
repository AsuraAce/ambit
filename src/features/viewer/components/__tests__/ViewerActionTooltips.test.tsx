import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '../../../../test/testUtils';
import { GeneratorTool, type AIImage } from '../../../../types';
import { CompareModal } from '../CompareModal';
import { SlideshowModal } from '../SlideshowModal';

const createImage = (id: string, isFavorite = false): AIImage => ({
    id,
    url: `asset://${id}.png`,
    thumbnailUrl: `asset://${id}.webp`,
    filename: `${id}.png`,
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: '',
        negativePrompt: '',
    },
});

const SlideshowFocusHarness = () => {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
        <>
            <button type="button" onClick={() => setIsOpen(true)}>Open slideshow</button>
            <SlideshowModal
                isOpen={isOpen}
                images={[createImage('one'), createImage('two')]}
                initialIndex={0}
                onClose={() => setIsOpen(false)}
            />
        </>
    );
};

const CompareFocusHarness = () => {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
        <>
            <button type="button" onClick={() => setIsOpen(true)}>Open comparison</button>
            {isOpen && (
                <CompareModal
                    imageA={createImage('one')}
                    imageB={createImage('two')}
                    onClose={() => setIsOpen(false)}
                    onToggleFavorite={vi.fn()}
                    onTogglePin={vi.fn()}
                />
            )}
        </>
    );
};

describe('specialized viewer action tooltips', () => {
    it('returns focus to the slideshow launcher after closing', () => {
        render(<SlideshowFocusHarness />);
        const launcher = screen.getByRole('button', { name: 'Open slideshow' });
        launcher.focus();

        fireEvent.click(launcher);
        const closeButton = screen.getByRole('button', { name: 'Close Slideshow' });
        expect(document.activeElement).toBe(closeButton);

        fireEvent.click(closeButton);
        expect(document.activeElement).toBe(launcher);
    });

    it('returns focus to the comparison launcher after closing', () => {
        render(<CompareFocusHarness />);
        const launcher = screen.getByRole('button', { name: 'Open comparison' });
        launcher.focus();

        fireEvent.click(launcher);
        const closeButton = screen.getByRole('button', { name: 'Close Comparison' });
        expect(document.activeElement).toBe(closeButton);

        fireEvent.click(closeButton);
        expect(document.activeElement).toBe(launcher);
    });

    it('exposes slideshow shuffle state while keeping conventional transport controls named', () => {
        render(
            <SlideshowModal
                isOpen
                images={[createImage('one'), createImage('two')]}
                initialIndex={0}
                onClose={vi.fn()}
            />
        );

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Slideshow' }));
        const shuffleButton = screen.getByRole('button', { name: 'Enable Shuffle' });
        expect(shuffleButton.getAttribute('aria-pressed')).toBe('false');
        expect(shuffleButton.getAttribute('title')).toBeNull();
        fireEvent.focus(shuffleButton);
        expect(screen.getByRole('tooltip').textContent).toBe('Enable Shuffle');
        fireEvent.click(shuffleButton);

        expect(screen.getByRole('button', { name: 'Disable Shuffle' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Previous Image' }).getAttribute('title')).toBeNull();
        expect(screen.getByRole('button', { name: 'Next Image' }).getAttribute('title')).toBeNull();
    });

    it('keeps Space activation local to the focused slideshow control', () => {
        render(
            <SlideshowModal
                isOpen
                images={[createImage('one'), createImage('two')]}
                initialIndex={0}
                onClose={vi.fn()}
            />
        );
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        try {
            const pauseButton = screen.getByRole('button', { name: 'Pause Slideshow' });
            const spaceEvent = new KeyboardEvent('keydown', {
                key: ' ',
                code: 'Space',
                bubbles: true,
                cancelable: true,
            });

            fireEvent(pauseButton, spaceEvent);

            expect(spaceEvent.defaultPrevented).toBe(false);
            expect(onWindowKeyDown).not.toHaveBeenCalled();
            expect(screen.getByRole('button', { name: 'Pause Slideshow' }).getAttribute('aria-pressed')).toBe('true');

            fireEvent.click(pauseButton);

            expect(screen.getByRole('button', { name: 'Play Slideshow' }).getAttribute('aria-pressed')).toBe('false');
        } finally {
            window.removeEventListener('keydown', onWindowKeyDown);
        }
    });

    it('keeps the focused HUD visible after its inactivity timeout', () => {
        vi.useFakeTimers();
        const { unmount } = render(
            <SlideshowModal
                isOpen
                images={[createImage('one'), createImage('two')]}
                initialIndex={0}
                onClose={vi.fn()}
            />
        );

        try {
            const closeButton = screen.getByRole('button', { name: 'Close Slideshow' });
            const hud = closeButton.parentElement?.parentElement;
            expect(document.activeElement).toBe(closeButton);

            act(() => vi.advanceTimersByTime(3500));

            expect(hud?.className.split(/\s+/)).toContain('opacity-0');
            expect(hud?.className.split(/\s+/)).toContain('focus-within:opacity-100');
        } finally {
            unmount();
            vi.useRealTimers();
        }
    });

    it('provides accessible compare zoom and diff controls without native titles', () => {
        const onToggleFavorite = vi.fn();
        render(
            <CompareModal
                imageA={createImage('one', true)}
                imageB={createImage('two')}
                onClose={vi.fn()}
                onToggleFavorite={onToggleFavorite}
                onTogglePin={vi.fn()}
            />
        );

        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Comparison' }));
        const zoomIn = screen.getByRole('button', { name: 'Zoom In' });
        expect(zoomIn.getAttribute('title')).toBeNull();
        fireEvent.focus(zoomIn);
        expect(screen.getByRole('tooltip').textContent).toBe('Zoom In');

        const favoriteButton = screen.getByRole('button', { name: 'Remove from Favorites' });
        expect(favoriteButton.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(favoriteButton);
        expect(onToggleFavorite).toHaveBeenCalledWith('one');

        expect(screen.getByRole('button', { name: 'Show Diff View' }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Close Comparison' }).getAttribute('title')).toBeNull();
    });

    it('removes collapsed diff controls from keyboard and accessibility interaction until reopened', () => {
        render(
            <CompareModal
                imageA={createImage('one')}
                imageB={createImage('two')}
                onClose={vi.fn()}
                onToggleFavorite={vi.fn()}
                onTogglePin={vi.fn()}
            />
        );

        const diffHeading = screen.getByRole('heading', { name: 'Differences' });
        const panel = diffHeading.parentElement?.parentElement;
        expect(panel).not.toBeNull();
        expect(panel?.hasAttribute('inert')).toBe(false);
        expect(panel?.getAttribute('aria-hidden')).toBe('false');
        expect(screen.getByRole('button', { name: 'Show Raw View' })).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Hide Diff Sidebar' }));

        expect(panel?.hasAttribute('inert')).toBe(true);
        expect(panel?.getAttribute('aria-hidden')).toBe('true');
        expect(screen.queryByRole('button', { name: 'Show Raw View' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Show Diff Sidebar' }));

        expect(panel?.hasAttribute('inert')).toBe(false);
        expect(panel?.getAttribute('aria-hidden')).toBe('false');
        expect(screen.getByRole('button', { name: 'Show Raw View' })).not.toBeNull();
    });
});
