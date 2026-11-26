import type { Rect } from './geometry';

/** A title pill's width beyond its text: padding, gaps, the fold button and borders (see .wg-gtitle). */
export const TITLE_CHROME = 8 + 4 + 6 + 6 + 20 + 2;
/** A title pill's distance from its group's edges. */
export const TITLE_INSET = 6;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where a group's title goes: a pill at the top-left of the group (the owner's pick), drawn over the nodes. It never
 * moves to dodge them, so it sits in the same place at every zoom and in both views.
 *
 * @param group the group's box
 * @param w the title's full width, h its height (both in world units)
 * @param inset the pill's distance from the group's edges
 */
export const placeGroupTitle = (group: Rect, w: number, h: number, inset: number): Rect => ({
    x: group.x + inset,
    y: group.y + inset,
    w: Math.min(w, Math.max(0, group.w - inset * 2)),
    h,
});

/** The title gets a group label's room first: the node count shows only beside a whole title. */
export const countFits = (titleWidth: number, countWidth: number, room: number): boolean => titleWidth + countWidth <= room;

/** Measures text at a font size in screen pixels. */
export type Measure = (text: string, px: number) => number;

/** Cuts text to fit a width, ending it with an ellipsis; '' when not even one character fits. */
export const fitText = (measure: Measure, text: string, px: number, width: number): string => {
    if (measure(text, px) <= width) return text;
    let low = 0;
    let high = text.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (measure(`${text.slice(0, mid)}…`, px) <= width) low = mid;
        else high = mid - 1;
    }
    return low > 0 ? `${text.slice(0, low)}…` : '';
};

/** Overview titles on screen: never above the cap, shrunk as far as the floor to fit, then shortened. */
export const OVERVIEW_TITLE_MIN_PX = 13;
export const GROUP_TITLE_CAP_PX = 18;
/** A title cut shorter than this many characters tells nothing, so it is left out instead. */
const MIN_KEPT_CHARS = 4;
/** Whether `fitted`, cut from `full`, still keeps enough of it to say something. */
export const keepsEnough = (fitted: string, full: string): boolean =>
    fitted === full || fitted.length - 1 >= Math.min(MIN_KEPT_CHARS, full.length);

/**
 * The overview's title for a group whose box is `width` pixels wide on screen: the size and text that fit, or null
 * when the title is left out.
 */
export const fitOverviewTitle = (measure: Measure, title: string, px: number, width: number): { text: string; px: number } | null => {
    if (width <= 0) return null;
    const size = Math.min(px, GROUP_TITLE_CAP_PX);
    const full = measure(title, size);
    if (full <= width) return { text: title, px: size };
    const fitting = (size * width) / full;
    if (fitting >= OVERVIEW_TITLE_MIN_PX) return { text: title, px: fitting };
    const shrunk = OVERVIEW_TITLE_MIN_PX;
    const text = fitText(measure, title, shrunk, width);
    return keepsEnough(text, title) ? { text, px: shrunk } : null;
};

/**
 * Drops each label that overlaps one already kept. Labels go in order of their group's area, biggest first, so a
 * big group's title wins over a small one's.
 */
export const dropOverlaps = <T extends { rect: Rect; area: number }>(labels: readonly T[]): T[] => {
    const kept: T[] = [];
    for (const label of [...labels].sort((a, b) => b.area - a.area)) {
        if (!kept.some((other) => overlaps(label.rect, other.rect))) kept.push(label);
    }
    return kept;
};
