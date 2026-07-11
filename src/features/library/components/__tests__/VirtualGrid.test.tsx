import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const getGridRoot = () => {
    const root = screen.getByTestId('grid-item-item-0').parentElement;
    if (!(root instanceof HTMLDivElement)) throw new Error('Expected VirtualGrid root');
    return root;
};

const gridRect = (width = 400, height = 600): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    toJSON: () => ({}),
});

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
        expect(motionItem.style.transition).toContain('transform 260ms');
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

        await waitFor(() => {
            expect(screen.getByTestId('grid-item-item-5').style.transform).toContain('100px, 100px');
            expect(onLayoutChange).toHaveBeenLastCalledWith(4, 100);
        });
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
        expect(screen.getByTestId('grid-item-item-5').style.transition).toContain('transform 260ms');
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
            gridRef.current?.scrollToItem(11);
        });

        expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    });

    it('navigates sequentially and spatially with boundary protection', async () => {
        const { container, scrollTo } = createScrollContainer(300);
        const scrollContainerRef = { current: container };
        const gridRef = React.createRef<VirtualGridHandle>();

        render(
            <VirtualGrid<TestItem>
                ref={gridRef}
                items={createItems(100)}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
            />
        );
        await screen.findByTestId('grid-item-item-0');

        expect(gridRef.current?.navigate(-1, 'ArrowRight')).toBe(0);
        expect(gridRef.current?.navigate(1000, 'ArrowLeft')).toBe(99);
        expect(gridRef.current?.navigate(0, 'ArrowLeft')).toBe(0);
        expect(gridRef.current?.navigate(99, 'ArrowRight')).toBe(99);
        expect(gridRef.current?.navigate(5, 'ArrowLeft')).toBe(4);
        expect(gridRef.current?.navigate(5, 'ArrowRight')).toBe(6);
        expect(gridRef.current?.navigate(5, 'ArrowUp')).toBe(1);
        expect(gridRef.current?.navigate(5, 'ArrowDown')).toBe(9);
        expect(gridRef.current?.navigate(0, 'ArrowUp')).toBe(0);
        expect(gridRef.current?.navigate(5, 'Home')).toBe(5);

        act(() => gridRef.current?.scrollToItem(4));
        expect(container.scrollTo).not.toHaveBeenCalled();
        act(() => gridRef.current?.scrollToItem(-1));
        expect(container.scrollTo).not.toHaveBeenCalled();

        container.scrollTop = 500;
        act(() => gridRef.current?.scrollToItem(0));
        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('handles an empty layout and a missing scroll container safely', async () => {
        const gridRef = React.createRef<VirtualGridHandle>();
        const scrollContainerRef: React.RefObject<HTMLElement | null> = { current: null };
        const { container } = render(
            <VirtualGrid<TestItem>
                ref={gridRef}
                items={[]}
                layout="grid"
                minItemWidth={100}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                className="custom-grid"
            />
        );

        await waitFor(() => expect(gridRef.current).toBeTruthy());
        expect(gridRef.current?.navigate(0, 'ArrowDown')).toBe(0);
        expect(() => gridRef.current?.scrollToItem(0)).not.toThrow();
        expect(container.firstElementChild?.className).toContain('custom-grid');
        expect((container.firstElementChild as HTMLElement).style.height).toBe('100px');
    });

    it('throttles near-end notifications and uses the latest callback', async () => {
        const { container } = createScrollContainer();
        const scrollContainerRef = { current: container };
        const firstEndReached = vi.fn();
        const latestEndReached = vi.fn();
        const { rerender } = render(
            <VirtualGrid<TestItem>
                items={createItems(220)}
                layout="grid"
                minItemWidth={100}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                onEndReached={firstEndReached}
            />
        );
        await screen.findByTestId('grid-item-item-0');
        const now = vi.spyOn(Date, 'now').mockReturnValue(1000);

        act(() => {
            container.scrollTop = 3500;
            container.dispatchEvent(new Event('scroll'));
        });
        await waitFor(() => expect(firstEndReached).toHaveBeenCalledOnce());

        act(() => container.dispatchEvent(new Event('scroll')));
        await new Promise(resolve => window.setTimeout(resolve, 10));
        expect(firstEndReached).toHaveBeenCalledOnce();

        rerender(
            <VirtualGrid<TestItem>
                items={createItems(220)}
                layout="grid"
                minItemWidth={100}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                onEndReached={latestEndReached}
            />
        );
        now.mockReturnValue(1301);
        act(() => container.dispatchEvent(new Event('scroll')));
        await waitFor(() => expect(latestEndReached).toHaveBeenCalledOnce());
        expect(firstEndReached).toHaveBeenCalledOnce();
        now.mockRestore();
    });

    it('commits the measured fallback width after resize suspension', async () => {
        const { container } = createScrollContainer();
        const scrollContainerRef = { current: container };
        const items = createItems(12);
        const { rerender } = render(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
            />
        );
        await screen.findByTestId('grid-item-item-0');
        const root = getGridRoot();
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(gridRect(550));

        rerender(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                suspendResizeLayout
            />
        );
        rerender(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                suspendResizeLayout={false}
            />
        );

        await waitFor(() => expect(screen.getByTestId('grid-item-item-5').style.transform).toContain('0px, 110px'));
        expect(screen.getByTestId('grid-item-item-5').style.transition).toContain('transform');

        await new Promise(resolve => window.setTimeout(resolve, 40));
        act(() => emitResize(observedResizeTarget as Element, Number.NaN));
        await new Promise(resolve => window.setTimeout(resolve, 10));
        await new Promise(resolve => window.setTimeout(resolve, 40));
        act(() => emitResize(observedResizeTarget as Element, 550));
        await new Promise(resolve => window.setTimeout(resolve, 10));
        expect(screen.getByTestId('grid-item-item-5').style.transform).toContain('0px, 110px');
    });

    it('handles empty resize observations and clears scroll-motion suppression', async () => {
        const { container } = createScrollContainer();
        const scrollContainerRef = { current: container };
        render(
            <VirtualGrid<TestItem>
                items={createItems(12)}
                layout="grid"
                minItemWidth={100}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
            />
        );
        await screen.findByTestId('grid-item-item-0');
        const root = getGridRoot();
        Object.defineProperty(root, 'offsetTop', { value: 75, configurable: true });

        act(() => resizeObserverCallback?.([], resizeObserverInstance as ResizeObserver));
        act(() => container.dispatchEvent(new Event('scroll')));
        act(() => container.dispatchEvent(new Event('scroll')));
        await new Promise(resolve => window.setTimeout(resolve, 150));

        expect(screen.getByTestId('grid-item-item-0')).toBeTruthy();
    });

    it('replaces queued resize frames and defers their width while suspended', async () => {
        let nextFrameId = 1;
        const frameCallbacks = new Map<number, FrameRequestCallback>();
        const cancelFrame = vi.fn((id: number) => frameCallbacks.delete(id));
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            const id = nextFrameId++;
            frameCallbacks.set(id, callback);
            return id;
        }));
        vi.stubGlobal('cancelAnimationFrame', cancelFrame);
        const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
        const { container } = createScrollContainer();
        const scrollContainerRef = { current: container };
        const items = createItems(12);
        const { rerender } = render(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
            />
        );

        now.mockReturnValue(1040);
        act(() => emitResize(observedResizeTarget as Element, 500));
        expect(cancelFrame).toHaveBeenCalled();
        act(() => emitResize(observedResizeTarget as Element, 501));

        rerender(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                suspendResizeLayout
            />
        );
        act(() => {
            for (const [id, callback] of [...frameCallbacks]) {
                frameCallbacks.delete(id);
                callback(performance.now());
            }
        });
        rerender(
            <VirtualGrid<TestItem>
                items={items}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                suspendResizeLayout={false}
            />
        );

        await waitFor(() => expect(screen.getByTestId('grid-item-item-5').style.transform).toContain('0px, 100px'));
        now.mockRestore();
    });

    it('supports background clicks and additive drag-range selection', async () => {
        const { container } = createScrollContainer();
        const scrollContainerRef = { current: container };
        const onRangeSelection = vi.fn();
        const onBackgroundClick = vi.fn();
        render(
            <VirtualGrid<TestItem>
                items={createItems(12)}
                layout="grid"
                minItemWidth={100}
                gap={0}
                padding={0}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
                onRangeSelection={onRangeSelection}
                onBackgroundClick={onBackgroundClick}
            />
        );
        await screen.findByTestId('grid-item-item-0');
        const root = getGridRoot();
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(gridRect());

        fireEvent.mouseDown(root, { button: 0, clientX: 10, clientY: 10 });
        fireEvent.mouseMove(window, { clientX: 14, clientY: 14 });
        fireEvent.mouseUp(window, { clientX: 14, clientY: 14 });
        expect(onBackgroundClick).toHaveBeenCalledOnce();

        fireEvent.mouseDown(root, { button: 0, clientX: 0, clientY: 0 });
        fireEvent.mouseMove(window, { clientX: 150, clientY: 150 });
        fireEvent.mouseMove(window, { clientX: 140, clientY: 140 });
        expect(document.querySelector('.border-sage-400')).toBeTruthy();
        fireEvent.mouseUp(window, { clientX: 150, clientY: 150, shiftKey: true });

        expect(onRangeSelection).toHaveBeenCalledWith([0, 1, 4, 5], true);
        expect(document.querySelector('.border-sage-400')).toBeNull();
    });

    it('does not start selection from non-primary or interactive item targets', async () => {
        const { container } = createScrollContainer();
        const scrollContainerRef = { current: container };
        const onBackgroundClick = vi.fn();
        const interactiveRender = (item: TestItem, style: React.CSSProperties, index: number) => (
            <div data-testid={`interactive-${index}`} style={style}>
                <button>Button</button>
                <input aria-label="input" />
                <span role="button" tabIndex={0}>Role</span>
                <span data-drag-source="true">Drag</span>
                <img alt="item" />
            </div>
        );
        render(
            <VirtualGrid<TestItem>
                items={createItems(2)}
                layout="grid"
                minItemWidth={100}
                scrollContainerRef={scrollContainerRef}
                renderItem={interactiveRender}
                onBackgroundClick={onBackgroundClick}
            />
        );
        await screen.findByTestId('interactive-0');
        const root = screen.getByTestId('interactive-0').parentElement as HTMLDivElement;
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(gridRect());

        fireEvent.mouseDown(root, { button: 2 });
        fireEvent.mouseDown(screen.getAllByRole('button', { name: 'Button' })[0], { button: 0 });
        fireEvent.mouseDown(screen.getAllByLabelText('input')[0], { button: 0 });
        fireEvent.mouseDown(screen.getAllByRole('button', { name: 'Role' })[0], { button: 0 });
        fireEvent.mouseDown(screen.getAllByText('Drag')[0], { button: 0 });
        fireEvent.mouseDown(screen.getAllByAltText('item')[0], { button: 0 });
        fireEvent.mouseUp(window);

        expect(onBackgroundClick).not.toHaveBeenCalled();
    });

    it('tolerates missing selection callbacks and refs lost before queued movement', async () => {
        const { container } = createScrollContainer();
        const scrollContainerRef: React.RefObject<HTMLElement | null> = { current: container };
        const addedListeners = new Map<string, EventListener>();
        const addListener = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
            if (type === 'mousemove' || type === 'mouseup') {
                addedListeners.set(type, listener as EventListener);
            }
        });
        const { unmount } = render(
            <VirtualGrid<TestItem>
                items={createItems(2)}
                layout="grid"
                minItemWidth={100}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
            />
        );
        await screen.findByTestId('grid-item-item-0');
        const root = getGridRoot();
        vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(gridRect());

        fireEvent.mouseDown(root, { button: 0, clientX: 10, clientY: 10 });
        addedListeners.get('mouseup')?.(new MouseEvent('mouseup'));

        fireEvent.mouseDown(root, { button: 0, clientX: 10, clientY: 10 });
        unmount();
        scrollContainerRef.current = null;
        addedListeners.get('mousemove')?.(new MouseEvent('mousemove', { clientX: 30, clientY: 30 }));

        expect(addListener).toHaveBeenCalled();
    });

    it('does not begin background selection without a scroll container', async () => {
        const scrollContainerRef: React.RefObject<HTMLElement | null> = { current: null };
        const { container } = render(
            <VirtualGrid<TestItem>
                items={[]}
                layout="grid"
                minItemWidth={100}
                scrollContainerRef={scrollContainerRef}
                renderItem={renderItem}
            />
        );

        fireEvent.mouseDown(container.firstElementChild as Element, { button: 0 });
        expect(container.firstElementChild).toBeTruthy();
    });
});
