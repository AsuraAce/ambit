import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { CompareModal } from '../CompareModal';

const resizeMocks = vi.hoisted(() => ({
    observe: vi.fn(),
    disconnect: vi.fn(),
    callbacks: [] as ResizeObserverCallback[]
}));

vi.mock('../../../library/components/SmartImage', () => ({
    SmartImage: ({ src, alt, style }: { src: string; alt: string; style?: React.CSSProperties }) => (
        <img src={src} alt={alt} style={style} />
    )
}));

const originalResizeObserverDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');

const createImage = (id: string, overrides: Partial<AIImage> = {}): AIImage => ({
    id,
    url: `file:///${id}.png`,
    thumbnailUrl: `file:///${id}-thumb.png`,
    filename: `C:/images/${id}.png`,
    timestamp: 1,
    width: 800,
    height: 600,
    isFavorite: false,
    isPinned: false,
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: id === 'a' ? 'Model A' : 'Model B',
        seed: id === 'a' ? 1 : 2,
        steps: id === 'a' ? 20 : 30,
        cfg: id === 'a' ? 7 : 8,
        sampler: 'Euler',
        positivePrompt: id === 'a' ? 'red sunset over ocean' : 'blue sunrise above mountains',
        negativePrompt: ''
    },
    ...overrides
});

const rect = (overrides: Partial<DOMRect> = {}): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1000,
    bottom: 600,
    width: 1000,
    height: 600,
    toJSON: () => ({}),
    ...overrides
});

const renderModal = (overrides: Partial<React.ComponentProps<typeof CompareModal>> = {}) => {
    const props: React.ComponentProps<typeof CompareModal> = {
        imageA: createImage('a'),
        imageB: createImage('b', { isPinned: true }),
        onClose: vi.fn(),
        onToggleFavorite: vi.fn(),
        onTogglePin: vi.fn(),
        ...overrides
    };
    return { props, ...render(<CompareModal {...props} />) };
};

describe('CompareModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resizeMocks.callbacks.length = 0;
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect());
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (originalResizeObserverDescriptor) {
            Object.defineProperty(globalThis, 'ResizeObserver', originalResizeObserverDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, 'ResizeObserver');
        }
    });

    it('renders metadata and prompt differences and forwards image actions', () => {
        const onToggleFavorite = vi.fn();
        const onTogglePin = vi.fn();
        renderModal({ onToggleFavorite, onTogglePin });

        expect(screen.getByText('Comparison')).toBeTruthy();
        expect(screen.getByText('a.png')).toBeTruthy();
        expect(screen.getByText('b.png')).toBeTruthy();
        expect(screen.getByText('Model A')).toBeTruthy();
        expect(screen.getByText('Model B')).toBeTruthy();
        expect(screen.getByText('Removed')).toBeTruthy();
        expect(screen.getByText('Added')).toBeTruthy();

        const favorites = screen.getAllByTitle('Add to favorites');
        fireEvent.mouseDown(favorites[0]);
        fireEvent.click(favorites[0]);
        fireEvent.click(favorites[1]);
        expect(onToggleFavorite).toHaveBeenNthCalledWith(1, 'a');
        expect(onToggleFavorite).toHaveBeenNthCalledWith(2, 'b');

        const pinButton = screen.getByTitle('Pin to top');
        fireEvent.mouseDown(pinButton);
        fireEvent.click(pinButton);
        fireEvent.click(screen.getByTitle('Unpin'));
        expect(onTogglePin).toHaveBeenNthCalledWith(1, 'a', true);
        expect(onTogglePin).toHaveBeenNthCalledWith(2, 'b', false);
    });

    it('zooms, pans, resets, and drives swipe and overlay pointer modes', async () => {
        const { container } = renderModal();
        const root = container.firstElementChild as HTMLElement;
        const canvas = container.querySelector('.select-none') as HTMLElement;
        expect(canvas).toBeTruthy();

        fireEvent.wheel(canvas, { clientX: 250, clientY: 200, deltaY: -500 });
        await waitFor(() => expect(screen.getByText('150%')).toBeTruthy());
        fireEvent.mouseDown(canvas, { clientX: 300, clientY: 250 });
        fireEvent.mouseMove(root, { clientX: 360, clientY: 290 });
        fireEvent.mouseUp(root);

        fireEvent.doubleClick(canvas, { clientX: 300, clientY: 250 });
        await waitFor(() => expect(screen.getByText('100%')).toBeTruthy());
        fireEvent.doubleClick(canvas, { clientX: 750, clientY: 250 });
        await waitFor(() => expect(screen.getByText('200%')).toBeTruthy());
        fireEvent.click(screen.getByTitle('Reset Zoom'));
        expect(screen.getByText('100%')).toBeTruthy();
        const zoomControls = screen.getByTitle('Reset Zoom').parentElement;
        if (!zoomControls) throw new Error('Zoom controls were not rendered');
        const zoomButtons = zoomControls.querySelectorAll('button');
        fireEvent.click(zoomButtons[0]);
        fireEvent.click(zoomButtons[1]);

        fireEvent.click(screen.getByText('Swipe'));
        fireEvent.wheel(canvas, { clientX: 500, clientY: 300, deltaY: -100 });
        const sliderHandle = container.querySelector('.group.cursor-ew-resize') as HTMLElement;
        expect(sliderHandle).toBeTruthy();
        fireEvent.mouseDown(sliderHandle, { clientX: 500, clientY: 300 });
        fireEvent.mouseMove(root, { clientX: 850, clientY: 300 });
        fireEvent.mouseUp(root);

        fireEvent.click(screen.getByText('Overlay'));
        fireEvent.mouseMove(root, { clientX: 500, clientY: 300 });
        expect(screen.getByText('Hover to reveal comparison')).toBeTruthy();
        fireEvent.mouseLeave(root);
        fireEvent.click(screen.getByText('Split'));
    });

    it('switches prompt modes, toggles and resizes the sidebar, and handles identical prompts', () => {
        const identical = createImage('b', {
            metadata: {
                ...createImage('b').metadata,
                positivePrompt: 'red sunset over ocean'
            }
        });
        const { container } = renderModal({ imageB: identical });

        expect(screen.getByText('Prompts are identical')).toBeTruthy();
        fireEvent.click(screen.getByTitle('Raw View'));
        fireEvent.click(screen.getByTitle('Diff View'));

        const panelToggle = screen.getByTitle('Toggle Diff Sidebar');
        fireEvent.click(panelToggle);
        fireEvent.click(panelToggle);

        const resizeHandle = container.querySelector('.cursor-ew-resize:not(.group)') as HTMLElement;
        expect(resizeHandle).toBeTruthy();
        fireEvent.mouseDown(resizeHandle, { clientX: 600 });
        fireEvent.mouseMove(window, { clientX: 300 });
        fireEvent.mouseUp(window);
    });

    it('shows raw prompt text and keeps canvas clicks from closing the modal', () => {
        const onClose = vi.fn();
        const { container } = renderModal({ onClose, onTogglePin: undefined });
        fireEvent.click(screen.getByTitle('Raw View'));

        expect(screen.getByText('red sunset over ocean')).toBeTruthy();
        expect(screen.getByText('blue sunrise above mountains')).toBeTruthy();
        expect(screen.queryByTitle('Pin to top')).toBeNull();

        const canvas = container.querySelector('.select-none') as HTMLElement;
        fireEvent.click(canvas);
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(container.firstElementChild as HTMLElement);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('uses ResizeObserver when available and disconnects it on unmount', async () => {
        class MockResizeObserver {
            constructor(callback: ResizeObserverCallback) {
                resizeMocks.callbacks.push(callback);
            }

            observe = resizeMocks.observe;
            disconnect = resizeMocks.disconnect;
            unobserve = vi.fn();
        }
        Object.defineProperty(globalThis, 'ResizeObserver', {
            configurable: true,
            writable: true,
            value: MockResizeObserver
        });

        const view = renderModal({
            imageA: createImage('a', { width: 0, height: 0 }),
            imageB: createImage('b', { width: 0, height: 0 })
        });
        expect(resizeMocks.observe).toHaveBeenCalled();

        await act(async () => {
            resizeMocks.callbacks[0]?.([], {} as ResizeObserver);
        });
        view.unmount();
        expect(resizeMocks.disconnect).toHaveBeenCalled();
    });
});
