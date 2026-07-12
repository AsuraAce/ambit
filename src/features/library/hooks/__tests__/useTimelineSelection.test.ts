import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useTimelineSelection } from '../useTimelineSelection';
import type { LayoutItem } from '../useTimelineLayout';

const makeContainer = () => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        value: 20,
        writable: true
    });
    element.getBoundingClientRect = vi.fn(() => ({
        x: 0,
        y: 0,
        width: 400,
        height: 400,
        top: 10,
        right: 400,
        bottom: 410,
        left: 0,
        toJSON: () => ({})
    }));
    return element;
};

const makeMouseDown = (overrides: Partial<React.MouseEvent> = {}): React.MouseEvent => ({
    button: 0,
    clientX: 40,
    clientY: 60,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    ...overrides
} as React.MouseEvent);

const layoutItems: LayoutItem[] = [
    {
        type: 'header',
        y: 0,
        height: 40
    },
    {
        type: 'row',
        y: 80,
        height: 50,
        items: [
            {
                image: {} as LayoutItem['items'] extends Array<infer Item> ? Item extends { image: infer Image } ? Image : never : never,
                x: 30,
                width: 50,
                height: 50,
                globalIndex: 1
            },
            {
                image: {} as LayoutItem['items'] extends Array<infer Item> ? Item extends { image: infer Image } ? Image : never : never,
                x: 160,
                width: 50,
                height: 50,
                globalIndex: 2
            }
        ]
    },
    {
        type: 'shelf',
        y: 150,
        height: 20
    }
];

describe('useTimelineSelection', () => {
    it('ignores non-left clicks, item clicks, and missing containers', () => {
        const onBackgroundClick = vi.fn();
        const onRangeSelection = vi.fn();
        const containerRef = { current: makeContainer() };
        const { result } = renderHook(
            () => useTimelineSelection({
                containerRef,
                layoutItems,
                onBackgroundClick,
                onRangeSelection
            })
        );

        act(() => {
            result.current.handleMouseDown(makeMouseDown({ button: 2 }));
        });

        const image = document.createElement('img');
        act(() => {
            result.current.handleMouseDown(makeMouseDown({ target: image }));
        });

        const dragSource = document.createElement('button');
        dragSource.dataset.dragSource = 'true';
        const child = document.createElement('span');
        dragSource.appendChild(child);
        act(() => {
            result.current.handleMouseDown(makeMouseDown({ target: child }));
        });

        const nullContainer = renderHook(() => useTimelineSelection({
            containerRef: { current: null },
            layoutItems,
            onBackgroundClick,
            onRangeSelection
        }));
        act(() => {
            nullContainer.result.current.handleMouseDown(makeMouseDown());
        });

        expect(onBackgroundClick).not.toHaveBeenCalled();
        expect(onRangeSelection).not.toHaveBeenCalled();
        expect(result.current.dragBox).toBeNull();
    });

    it('treats small background clicks as background actions', () => {
        const onBackgroundClick = vi.fn();
        const containerRef = { current: makeContainer() };
        const { result } = renderHook(() => useTimelineSelection({
            containerRef,
            layoutItems,
            onBackgroundClick
        }));

        act(() => {
            result.current.handleMouseDown(makeMouseDown());
            window.dispatchEvent(new MouseEvent('mouseup', {
                clientX: 42,
                clientY: 62
            }));
        });

        expect(onBackgroundClick).toHaveBeenCalledTimes(1);
        expect(result.current.dragBox).toBeNull();
    });

    it('selects overlapping row item indexes and passes shift as additive mode', () => {
        const onRangeSelection = vi.fn();
        const containerRef = { current: makeContainer() };
        const { result } = renderHook(() => useTimelineSelection({
            containerRef,
            layoutItems,
            onRangeSelection
        }));

        act(() => {
            result.current.handleMouseDown(makeMouseDown({
                clientX: 20,
                clientY: 50
            }));
        });

        act(() => {
            window.dispatchEvent(new MouseEvent('mousemove', {
                clientX: 220,
                clientY: 130
            }));
        });

        expect(result.current.dragBox).toEqual({
            x: 20,
            y: 60,
            w: 200,
            h: 80
        });

        act(() => {
            window.dispatchEvent(new MouseEvent('mouseup', {
                clientX: 220,
                clientY: 130,
                shiftKey: true
            }));
        });

        expect(onRangeSelection).toHaveBeenCalledWith([1, 2], true);
        expect(result.current.dragBox).toBeNull();
    });

    it('ignores a stale move callback after the gesture has ended', () => {
        let moveListener: EventListener | undefined;
        const addEventListener = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
            if (type === 'mousemove') moveListener = listener as EventListener;
        });
        const { result } = renderHook(() => useTimelineSelection({
            containerRef: { current: makeContainer() },
            layoutItems,
        }));

        act(() => result.current.handleMouseDown(makeMouseDown()));
        const upListener = addEventListener.mock.calls.find(([type]) => type === 'mouseup')?.[1] as EventListener;
        act(() => upListener(new MouseEvent('mouseup', { clientX: 40, clientY: 60 })));

        expect(() => moveListener?.(new MouseEvent('mousemove'))).not.toThrow();
    });
});
