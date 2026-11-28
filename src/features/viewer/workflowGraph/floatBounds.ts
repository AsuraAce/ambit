/** Where the floating image sits on the canvas: its left and top edges and its width, in canvas pixels. */
export interface FloatBox {
    x: number;
    y: number;
    w: number;
}

export interface Room {
    w: number;
    h: number;
}

/** How far inside the canvas's edges the window stays. */
export const FLOAT_MARGIN = 6;
/** The window's bar: the part that must stay on the canvas, so it can always be dragged back. */
export const FLOAT_BAR_H = 32;
/** The bar and the caption under the picture, which the picture's height adds to. */
export const FLOAT_CHROME_H = FLOAT_BAR_H + 26;
export const FLOAT_MIN_W = 160;
export const FLOAT_MAX_W = 520;
/** Top-left, under the search. */
export const FLOAT_START: FloatBox = { x: 14, y: 60, w: 200 };

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Keeps the window on the canvas: no wider than the canvas allows, and with its whole bar inside the margins. A canvas
 * smaller than the window pins it to the top-left corner; it never goes past the left or top edge. A canvas with no
 * size yet (not laid out) leaves the box as it is.
 */
export const placeFloat = (box: FloatBox, room: Room): FloatBox => {
    if (room.w <= 0 || room.h <= 0) return box;
    const w = clamp(box.w, FLOAT_MIN_W, Math.min(FLOAT_MAX_W, room.w - 2 * FLOAT_MARGIN));
    return {
        w,
        x: clamp(box.x, FLOAT_MARGIN, room.w - w - FLOAT_MARGIN),
        y: clamp(box.y, FLOAT_MARGIN, room.h - FLOAT_BAR_H - FLOAT_MARGIN),
    };
};

/** The window moved by a drag of its bar, kept on the canvas. */
export const moveFloat = (box: FloatBox, dx: number, dy: number, room: Room): FloatBox =>
    placeFloat({ ...box, x: box.x + dx, y: box.y + dy }, room);

/**
 * The window resized from its corner: its width, as far as the room to the canvas's right and bottom edges allows,
 * the picture keeping its shape (`aspect` is its width over its height). The top-left corner stays where it is.
 */
export const resizeFloat = (box: FloatBox, wanted: number, aspect: number, room: Room): FloatBox => {
    if (room.w <= 0 || room.h <= 0) return { ...box, w: clamp(wanted, FLOAT_MIN_W, FLOAT_MAX_W) };
    const byWidth = room.w - box.x - FLOAT_MARGIN;
    const byHeight = (room.h - box.y - FLOAT_MARGIN - FLOAT_CHROME_H) * aspect;
    return { ...box, w: clamp(wanted, FLOAT_MIN_W, Math.min(FLOAT_MAX_W, byWidth, byHeight)) };
};
