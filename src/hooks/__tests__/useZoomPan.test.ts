
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useZoomPan } from '../useZoomPan';

describe('useZoomPan', () => {
    it('should initialize with default scale 1 and position 0,0', () => {
        const { result } = renderHook(() => useZoomPan());
        expect(result.current.scale).toBe(1);
        expect(result.current.position).toEqual({ x: 0, y: 0 });
    });

    it('should zoom in on wheel delta negative', () => {
        const { result } = renderHook(() => useZoomPan({ maxScale: 5 }));

        act(() => {
            result.current.handlers.onWheel({
                stopPropagation: () => { },
                deltaY: -100, // Up scroll = zoom in
            } as any);
        });

        expect(result.current.scale).toBeGreaterThan(1);
    });

    it('should clamp zoom between min and max', () => {
        const { result } = renderHook(() => useZoomPan({ minScale: 1, maxScale: 2 }));

        act(() => {
            result.current.handlers.onWheel({ stopPropagation: () => { }, deltaY: -5000 } as any);
        });
        expect(result.current.scale).toBe(2);

        act(() => {
            result.current.handlers.onWheel({ stopPropagation: () => { }, deltaY: 5000 } as any);
        });
        expect(result.current.scale).toBe(1);
    });

    it('should allow dragging only when scale > 1', () => {
        const { result } = renderHook(() => useZoomPan());

        // Try to drag at scale 1
        act(() => {
            result.current.handlers.onMouseDown({ clientX: 100, clientY: 100, preventDefault: () => { } } as any);
        });
        expect(result.current.isDragging).toBe(false);

        // Zoom in
        act(() => {
            result.current.setScale(2);
        });

        // Now drag
        act(() => {
            result.current.handlers.onMouseDown({ clientX: 100, clientY: 100, preventDefault: () => { } } as any);
        });
        expect(result.current.isDragging).toBe(true);

        act(() => {
            result.current.handlers.onMouseMove({ clientX: 150, clientY: 150, preventDefault: () => { } } as any);
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
            result.current.handlers.onDoubleClick({ stopPropagation: () => { } } as any);
        });
        expect(result.current.scale).toBe(2);

        act(() => {
            result.current.handlers.onDoubleClick({ stopPropagation: () => { } } as any);
        });
        expect(result.current.scale).toBe(1);
    });
});
