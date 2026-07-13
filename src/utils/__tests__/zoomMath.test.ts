import { describe, expect, it } from 'vitest';
import {
    CENTER_ANCHOR,
    clampScale,
    getAnchoredPosition,
    getAnchorPoint,
    getZoomTransform
} from '../zoomMath';

describe('zoomMath', () => {
    it('clamps scale to the configured zoom bounds', () => {
        expect(clampScale(0.25, 1, 4)).toBe(1);
        expect(clampScale(2, 1, 4)).toBe(2);
        expect(clampScale(8, 1, 4)).toBe(4);
    });

    it('converts pointer coordinates into viewport-centered anchors', () => {
        expect(getAnchorPoint(
            { x: 150, y: 90 },
            { left: 10, top: 20, width: 200, height: 100 }
        )).toEqual({ x: 40, y: 20 });
    });

    it('keeps the current position when scale math would be invalid or unchanged', () => {
        const position = { x: 10, y: -5 };

        expect(getAnchoredPosition(position, 0, 2, { x: 100, y: 50 })).toBe(position);
        expect(getAnchoredPosition(position, 1, 0, { x: 100, y: 50 })).toBe(position);
        expect(getAnchoredPosition(position, 2, 2, { x: 100, y: 50 })).toBe(position);
    });

    it('anchors zoom around the requested point and resets at minimum scale', () => {
        expect(getZoomTransform({
            currentPosition: { x: 10, y: -10 },
            currentScale: 1,
            targetScale: 2,
            minScale: 1,
            maxScale: 4,
            anchor: { x: 100, y: 50 }
        })).toEqual({
            scale: 2,
            position: { x: -80, y: -70 }
        });

        expect(getZoomTransform({
            currentPosition: { x: -80, y: -70 },
            currentScale: 2,
            targetScale: 0.5,
            minScale: 1,
            maxScale: 4,
            anchor: { x: 100, y: 50 }
        })).toEqual({
            scale: 1,
            position: CENTER_ANCHOR
        });
    });
});
