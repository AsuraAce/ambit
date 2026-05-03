import * as React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualGrid, VirtualGridHandle } from '../VirtualGrid';

interface TestItem {
    id: string;
    ratio?: number;
}

const createMatchMedia = () =>
    vi.fn((query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
    } as unknown as MediaQueryList));

const createItems = (count: number): TestItem[] =>
    Array.from({ length: count }, (_, index) => ({ id: `item-${index}` }));

const createScrollContainer = (clientHeight = 600, scrollHeight = 10000) => {
    const container = document.createElement('div');
    let scrollTop = 0;
    const scrollTo = vi.fn((options: ScrollToOptions) => {
        scrollTop = Number(options.top ?? 0);
    });

    Object.defineProperties(container, {
        clientHeight: { value: clientHeight, configurable: true },
        scrollHeight: { value: scrollHeight, configurable: true },
        scrollTop: {
            get: () => scrollTop,
            set: (value: number) => {
                scrollTop = value;
            },
            configurable: true
        },
        scrollTo: { value: scrollTo, configurable: true }
    });

    return { container, scrollTo };
};

let observedResizeTarget: Element | null = null;
let resizeObserverCallback: ResizeObserverCallback | null = null;
let resizeObserverInstance: ResizeObserver | null = null;

const emitResize = (target: Element, width: number) => {
    if (!resizeObserverCallback || !resizeObserverInstance) {
        throw new Error('ResizeObserver mock has not been initialized');
    }

    resizeObserverCallback([{
        target,
        contentRect: {
            x: 0,
            y: 0,
            width,
            height: 600,
            top: 0,
            right: width,
            bottom: 600,
            left: 0,
            toJSON: () => ({})
        }
    } as ResizeObserverEntry], resizeObserverInstance);
};

const renderItem = (item: TestItem, style: React.CSSProperties) => (
    <div data-testid={`grid-item-${item.id}`} style={style}>
        {item.id}
    </div>
);

describe('VirtualGrid gallery motion', () => {
    beforeEach(() => {
        observedResizeTarget = null;
        resizeObserverCallback = null;
        resizeObserverInstance = null;
        vi.stubGlobal('matchMedia', createMatchMedia());
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
            window.setTimeout(() => callback(performance.now()), 0)
        );
        vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
        vi.stubGlobal('ResizeObserver', class ResizeObserver {
            private readonly callback: ResizeObserverCallback;

            constructor(callback: ResizeObserverCallback) {
                this.callback = callback;
                resizeObserverCallback = callback;
                resizeObserverInstance = this as unknown as ResizeObserver;
            }

            observe(target: Element) {
                observedResizeTarget = target;
                emitResize(target, 400);
            }

            unobserve() {
                return undefined;
            }

            disconnect() {
                return undefined;
            }
        });
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('adds transform transition styles when the transition key changes', async () => {
        const { container } = createScrollContainer();
        const scrollContainerRef = { current: container };
        const items = createItems(8);
        const { rerender } = render(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                transitionKey="layout:grid"
            />
        );

        const firstItem = await screen.findByTestId('grid-item-item-0');
        expect(firstItem.style.transition).not.toContain('transform');

        rerender(
            <VirtualGrid<TestItem>
                items={items}
                layout="masonry"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                transitionKey="layout:masonry"
            />
        );

        const motionItem = screen.getByTestId('grid-item-item-0');
        expect(motionItem.style.transition).toContain('transform 220ms');
        expect(motionItem.style.transition).toContain('width 220ms');
        expect(motionItem.style.transition).toContain('height 220ms');
        expect(motionItem.style.willChange).toBe('transform');
        expect(motionItem.parentElement?.className).toContain('gallery-grid-settle');

        await waitFor(() => {
            expect(screen.getByTestId('grid-item-item-0').style.transition).not.toContain('transform');
        });

        expect(screen.getByTestId('grid-item-item-0').style.willChange).toBe('');
        expect(screen.getByTestId('grid-item-item-0').parentElement?.className).not.toContain('gallery-grid-settle');
    });

    it('does not add transform transition styles for scroll-only renders', async () => {
        const { container } = createScrollContainer();
        const scrollContainerRef = { current: container };
        const items = createItems(220);

        render(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                transitionKey="layout:grid"
            />
        );

        await screen.findByTestId('grid-item-item-0');

        act(() => {
            container.scrollTop = 5000;
            container.dispatchEvent(new Event('scroll'));
        });

        await waitFor(() => expect(screen.getByTestId('grid-item-item-180')).toBeTruthy());

        expect(screen.getByTestId('grid-item-item-180').style.transition).not.toContain('transform');
        expect(screen.getByTestId('grid-item-item-180').style.willChange).toBe('');
    });

    it('defers resize layout while suspended and animates one final commit', async () => {
        const { container } = createScrollContainer();
        const scrollContainerRef = { current: container };
        const items = createItems(12);
        const onLayoutChange = vi.fn();

        const { rerender } = render(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                transitionKey="layout:grid"
                onLayoutChange={onLayoutChange}
            />
        );

        await waitFor(() => expect(screen.getByTestId('grid-item-item-5').style.transform).toContain('100px, 100px'));
        const callsAfterInitialLayout = onLayoutChange.mock.calls.length;

        rerender(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                transitionKey="layout:grid"
                onLayoutChange={onLayoutChange}
                suspendResizeLayout
            />
        );

        act(() => {
            emitResize(observedResizeTarget as Element, 600);
        });

        expect(screen.getByTestId('grid-item-item-5').style.transform).toContain('100px, 100px');
        expect(onLayoutChange.mock.calls.length).toBe(callsAfterInitialLayout);

        rerender(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                transitionKey="layout:grid"
                onLayoutChange={onLayoutChange}
                suspendResizeLayout={false}
            />
        );

        await waitFor(() => expect(screen.getByTestId('grid-item-item-5').style.transform).toContain('500px, 0px'));

        expect(onLayoutChange.mock.calls.length).toBe(callsAfterInitialLayout + 1);
        expect(screen.getByTestId('grid-item-item-5').style.transition).toContain('transform 220ms');
        expect(screen.getByTestId('grid-item-item-5').style.willChange).toBe('transform');
    });

    it('preserves smooth scroll behavior for keyboard navigation', async () => {
        const { container, scrollTo } = createScrollContainer(100);
        const scrollContainerRef = { current: container };
        const gridRef = React.createRef<VirtualGridHandle>();

        render(
            <VirtualGrid<TestItem>
                ref={gridRef}
                items={createItems(12)}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                transitionKey="layout:grid"
            />
        );

        await screen.findByTestId('grid-item-item-0');

        act(() => {
            gridRef.current?.scrollToItem(5);
        });

        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    });
});
