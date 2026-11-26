import type { Rect } from './geometry';

/**
 * Where a group's title goes: a pill inside the group's top band (the owner's pick), drawn over the nodes, at the
 * first spot along the band with no node under it, or failing that no node text under it, or else at the left.
 */

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The leftmost x in [left, right] where a w×h box at y clears every rect, or null. */
const firstGap = (left: number, right: number, y: number, w: number, h: number, avoid: readonly Rect[], gap: number) => {
    if (right < left) return null;
    const inBand = avoid.filter((rect) => rect.y < y + h && y < rect.y + rect.h).sort((a, b) => a.x - b.x);
    let x = left;
    for (const rect of inBand) {
        if (rect.x >= x + w) break;
        x = Math.max(x, rect.x + rect.w + gap);
    }
    return x <= right ? x : null;
};

/**
 * @param group the group's box
 * @param w the title's full width, h its height (both in world units)
 * @param nodes the boxes of every shown node
 * @param texts where node text is drawn, the fallback for a band that nodes fill
 * @param inset the pill's distance from the group's edges
 */
export const placeGroupTitle = (group: Rect, w: number, h: number, nodes: readonly Rect[], texts: readonly Rect[], inset: number): Rect => {
    const pillW = Math.min(w, Math.max(0, group.w - inset * 2));
    const y = group.y + inset;
    const left = group.x + inset;
    const right = group.x + group.w - inset - pillW;
    const x = firstGap(left, right, y, pillW, h, nodes, inset / 2) ?? firstGap(left, right, y, pillW, h, texts, inset / 2) ?? left;
    return { x, y, w: pillW, h };
};

/** ComfyUI's name for a new group: it says nothing, so the overview leaves it out. */
export const isDefaultGroupTitle = (title: string): boolean => title.trim().toLowerCase() === 'group';

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
    if (isDefaultGroupTitle(title) || width <= 0) return null;
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
