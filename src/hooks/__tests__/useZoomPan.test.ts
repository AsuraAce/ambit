
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import type React from 'react';
import { useZoomPan } from '../useZoomPan';

const createRect = (overrides: Partial<DOMRect> = {}): DOMRect => ({
    bottom: 300,
    height: 300,
    left: 0,
    right: 400,
    top: 0,
    width: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
    ...overrides
} as DOMRect);

const wheelEvent = ({
    deltaY,
    clientX = 200,
    clientY = 150,
    rect = createRect()
}: {
    deltaY: number;
    clientX?: number;
    clientY?: number;
    rect?: DOMRect;
}): React.WheelEvent<Element> => ({
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    deltaY,
    clientX,
    clientY,
    currentTarget: {
        getBoundingClientRect: () => rect
    }
} as unknown as React.WheelEvent<Element>);

const mouseEvent = ({
    clientX = 100,
    clientY = 100,
    rect = createRect()
}: {
    clientX?: number;
    clientY?: number;
    rect?: DOMRect;
} = {}): React.MouseEvent<Element> => ({
    preventDefault: () => undefined,
    stopPropagation: () => undefined,
    clientX,
    clientY,
    currentTarget: {
        getBoundingClientRect: () => rect
    }
} as unknown as React.MouseEvent<Element>);

describe('useZoomPan', () => {
    it('should initialize with default scale 1 and position 0,0', () => {
        const { result } = renderHook(() => useZoomPan());
        expect(result.current.scale).toBe(1);
        expect(result.current.position).toEqual({ x: 0, y: 0 });
    });

    it('should zoom in on wheel delta negative', () => {
        const { result } = renderHook(() => useZoomPan({ maxScale: 5 }));

        act(() => {
            result.current.handlers.onWheel(wheelEvent({ deltaY: -100 }));
        });

        expect(result.current.scale).toBeGreaterThan(1);
    });

    it('should zoom toward an off-center cursor on wheel', () => {
        const { result } = renderHook(() => useZoomPan());

        act(() => {
            result.current.handlers.onWheel(wheelEvent({
                deltaY: -100,
                clientX: 300,
                clientY: 150
            }));
        });

        expect(result.current.scale).toBeCloseTo(1.1);
        expect(result.current.position.x).toBeCloseTo(-10);
        expect(result.current.position.y).toBeCloseTo(0);
    });

    it('should preserve the anchored content point while zooming in and out', () => {
        const { result } = renderHook(() => useZoomPan());
        const anchor = { x: 100, y: 60 };

        act(() => {
            result.current.setScale(2);
        });

        const contentXBefore = (anchor.x - result.current.position.x) / result.current.scale;
        const contentYBefore = (anchor.y - result.current.position.y) / result.current.scale;

        act(() => {
            result.current.handlers.onWheel(wheelEvent({
                deltaY: 500,
                clientX: 300,
                clientY: 210
            }));
        });

        const contentXAfter = (anchor.x - result.current.position.x) / result.current.scale;
        const contentYAfter = (anchor.y - result.current.position.y) / result.current.scale;

        expect(result.current.scale).toBeCloseTo(1.5);
        expect(contentXAfter).toBeCloseTo(contentXBefore);
        expect(contentYAfter).toBeCloseTo(contentYBefore);
    });

    it('should clamp zoom between min and max', () => {
        const { result } = renderHook(() => useZoomPan({ minScale: 1, maxScale: 2 }));

        act(() => {
            result.current.handlers.onWheel(wheelEvent({ deltaY: -5000 }));
        });
        expect(result.current.scale).toBe(2);

        act(() => {
            result.current.handlers.onWheel(wheelEvent({ deltaY: 5000 }));
        });
        expect(result.current.scale).toBe(1);
    });

    it('should reset position when zooming back to min scale', () => {
        const { result } = renderHook(() => useZoomPan());

        act(() => {
            result.current.handlers.onWheel(wheelEvent({
                deltaY: -100,
                clientX: 300,
                clientY: 150
            }));
        });
        expect(result.current.position.x).not.toBe(0);

        act(() => {
            result.current.handlers.onWheel(wheelEvent({
                deltaY: 5000,
                clientX: 300,
                clientY: 150
            }));
        });

        expect(result.current.scale).toBe(1);
        expect(result.current.position).toEqual({ x: 0, y: 0 });
    });

    it('should allow dragging only when scale > 1', () => {
        const { result } = renderHook(() => useZoomPan());

        // Try to drag at scale 1
        act(() => {
            result.current.handlers.onMouseDown(mouseEvent({ clientX: 100, clientY: 100 }));
        });
        expect(result.current.isDragging).toBe(false);

        // Zoom in
        act(() => {
            result.current.setScale(2);
        });

        // Now drag
        act(() => {
            result.current.handlers.onMouseDown(mouseEvent({ clientX: 100, clientY: 100 }));
        });
        expect(result.current.isDragging).toBe(true);

        act(() => {
            result.current.handlers.onMouseMove(mouseEvent({ clientX: 150, clientY: 150 }));
        });
        expect(result.current.position).toEqual({ x: 50, y: 50 });

        act(() => {
            result.current.handlers.onMouseUp();
        });
        expect(result.current.isDragging).toBe(false);
    });

    it('should reset on double click if zoomed, or zoom to 2x if not', () => {
        const { result } = renderHook(() => useZoomPan());

        act(() => {
            result.current.handlers.onDoubleClick(mouseEvent({
                clientX: 300,
                clientY: 150
            }));
        });
        expect(result.current.scale).toBe(2);
        expect(result.current.position).toEqual({ x: -100, y: 0 });

        act(() => {
            result.current.handlers.onDoubleClick(mouseEvent());
        });
        expect(result.current.scale).toBe(1);
        expect(result.current.position).toEqual({ x: 0, y: 0 });
    });

    it('supports direct zoom controls, functional setters, reset, and anchor fallback', () => {
        const { result } = renderHook(() => useZoomPan({ initialScale: 1.5, minScale: 1, maxScale: 3 }));

        act(() => {
            result.current.setScale(scale => scale + 0.5);
            result.current.setPosition(position => ({ x: position.x + 10, y: position.y + 20 }));
        });
        expect(result.current.scale).toBe(2);
        expect(result.current.position).toEqual({ x: 10, y: 20 });

        act(() => result.current.zoomIn());
        expect(result.current.scale).toBeCloseTo(2.1);
        act(() => result.current.zoomOut());
        expect(result.current.scale).toBeCloseTo(2);
        act(() => result.current.zoomAt({ x: 20, y: 20 }, 2.5));
        expect(result.current.scale).toBe(2.5);
        act(() => result.current.resetZoom());
        expect(result.current).toMatchObject({ scale: 1, position: { x: 0, y: 0 } });

        const fallbackEvent = {
            preventDefault: () => undefined,
            stopPropagation: () => undefined,
            deltaY: -100,
            clientX: 10,
            clientY: 10,
            currentTarget: {},
        } as unknown as React.WheelEvent<Element>;
        act(() => result.current.handlers.onWheel(fallbackEvent));
        expect(result.current.scale).toBeCloseTo(1.1);
    });
});
