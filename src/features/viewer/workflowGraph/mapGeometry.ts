import type { Rect, View } from './geometry';

/** The map's canvas in backing pixels; it shows at half this size in CSS, so it stays sharp on a 2x screen. */
export const MAP_W = 424;
export const MAP_H = 264;
const MAP_PAD = 16;

/** How the graph sits on the map: map = world * k + offset. */
export interface MapFit {
    k: number;
    ox: number;
    oy: number;
}

/** Fits the graph's bounds inside the map's padding, centred. */
export const mapFit = (bounds: Rect): MapFit => {
    const w = Math.max(bounds.w, 1);
    const h = Math.max(bounds.h, 1);
    const roomW = MAP_W - 2 * MAP_PAD;
    const roomH = MAP_H - 2 * MAP_PAD;
    const k = Math.min(roomW / w, roomH / h);
    return { k, ox: MAP_PAD + (roomW - w * k) / 2 - bounds.x * k, oy: MAP_PAD + (roomH - h * k) / 2 - bounds.y * k };
};

/** The part of the graph the view shows, as a rectangle on the map. `room` is the canvas less the side panel. */
export const viewOnMap = (view: View, room: { w: number; h: number }, fit: MapFit): Rect => ({
    x: (-view.x / view.s) * fit.k + fit.ox,
    y: (-view.y / view.s) * fit.k + fit.oy,
    w: (room.w / view.s) * fit.k,
    h: (room.h / view.s) * fit.k,
});

/** The view, at the same zoom, centred in `room` on the world point under a map point. */
export const viewCentredOn = (point: { x: number; y: number }, fit: MapFit, view: View, room: { w: number; h: number }): View => {
    const wx = (point.x - fit.ox) / fit.k;
    const wy = (point.y - fit.oy) / fit.k;
    return { s: view.s, x: room.w / 2 - wx * view.s, y: room.h / 2 - wy * view.s };
};

/** A pointer position on the map's element, in its backing pixels. */
export const mapPoint = (clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }) => ({
    x: ((clientX - box.left) / (box.width || 1)) * MAP_W,
    y: ((clientY - box.top) / (box.height || 1)) * MAP_H,
});
