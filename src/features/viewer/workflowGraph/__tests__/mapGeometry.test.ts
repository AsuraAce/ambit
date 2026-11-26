import { describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, mapFit, mapPoint, viewCentredOn, viewOnMap } from '../mapGeometry';

describe('the map', () => {
    const bounds = { x: -200, y: 100, w: 2000, h: 600 };
    const fit = mapFit(bounds);
    const room = { w: 1200, h: 800 };

    it('fits the whole level inside its padding, centred', () => {
        const left = bounds.x * fit.k + fit.ox;
        const right = (bounds.x + bounds.w) * fit.k + fit.ox;
        const top = bounds.y * fit.k + fit.oy;
        const bottom = (bounds.y + bounds.h) * fit.k + fit.oy;
        expect(left).toBeCloseTo(16);
        expect(right).toBeCloseTo(MAP_W - 16);
        // A wide level leaves equal room above and below.
        expect(top).toBeGreaterThan(16);
        expect(top).toBeCloseTo(MAP_H - bottom);
    });

    it('draws the view as the part of the level the canvas shows', () => {
        // At 100 %, panned so world (0, 100) is the canvas's top-left corner.
        const rect = viewOnMap({ x: 0, y: -100, s: 1 }, room, fit);
        expect(rect.x).toBeCloseTo(fit.ox);
        expect(rect.y).toBeCloseTo(100 * fit.k + fit.oy);
        expect(rect.w).toBeCloseTo(1200 * fit.k);
        // Zoomed in twice as far, the view covers half as much.
        expect(viewOnMap({ x: 0, y: 0, s: 2 }, room, fit).w).toBeCloseTo(600 * fit.k);
    });

    // A click on the map moves the view there: the clicked point comes to the middle of the canvas, at the same zoom.
    it('centres the view on the point clicked, keeping the zoom', () => {
        const point = { x: 300, y: 120 };
        const view = viewCentredOn(point, fit, { x: 40, y: -70, s: 0.8 }, room);
        expect(view.s).toBe(0.8);
        const rect = viewOnMap(view, room, fit);
        expect(rect.x + rect.w / 2).toBeCloseTo(point.x);
        expect(rect.y + rect.h / 2).toBeCloseTo(point.y);
    });

    it('reads a pointer on the half-size element in the canvas’s own pixels', () => {
        const box = { left: 1000, top: 600, width: MAP_W / 2, height: MAP_H / 2 };
        expect(mapPoint(1000, 600, box)).toEqual({ x: 0, y: 0 });
        expect(mapPoint(1000 + MAP_W / 4, 600 + MAP_H / 2, box)).toEqual({ x: MAP_W / 2, y: MAP_H });
    });

    it('never divides by zero for a level of one point', () => {
        const single = mapFit({ x: 50, y: 50, w: 0, h: 0 });
        expect(Number.isFinite(single.k)).toBe(true);
    });
});
