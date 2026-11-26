import { describe, expect, it } from 'vitest';
import { FAR_EXIT_SCALE, FAR_SCALE, OVERVIEW_SCALE, viewLevel } from '../geometry';
import {
    dropOverlaps,
    fitOverviewTitle,
    GROUP_TITLE_CAP_PX,
    isDefaultGroupTitle,
    keepsEnough,
    OVERVIEW_TITLE_MIN_PX,
    placeGroupTitle,
} from '../groupTitles';

const group = { x: 100, y: 400, w: 300, h: 200 };

describe('placeGroupTitle', () => {
    // The owner's pick: a tab above the group by default, so the group's own nodes never cover its title.
    it('puts the title on a tab above the group when no node covers that spot', () => {
        const ownNode = { x: 110, y: 430, w: 120, h: 80 };
        expect(placeGroupTitle(group, 150, 24, [ownNode], [], 6)).toEqual({ kind: 'tab', x: 100, y: 376, w: 150, h: 24 });
    });

    // Stacked groups: a node of the group above sits where the tab would go, so the title moves into the band.
    it('moves the title into a chip in the top band when a node would cover the tab', () => {
        const above = { x: 90, y: 300, w: 200, h: 90 };
        const slot = placeGroupTitle(group, 150, 24, [above], [], 6);
        expect(slot.kind).toBe('chip');
        expect(slot.y).toBe(406);
        // The band at y 406 is clear of that node, so the chip starts at the left.
        expect(slot.x).toBe(106);
    });

    it('slides the chip along the band to the first spot no node covers', () => {
        const above = { x: 90, y: 300, w: 200, h: 120 };
        const slot = placeGroupTitle(group, 80, 24, [above], [], 6);
        expect(slot).toMatchObject({ kind: 'chip', y: 406 });
        expect(slot.x).toBeGreaterThanOrEqual(above.x + above.w);
        expect(slot.x + slot.w).toBeLessThanOrEqual(group.x + group.w);
    });

    // Where nodes fill the band, the chip still avoids their titles.
    it('falls back to a spot clear of node text when nodes fill the band', () => {
        const filling = { x: 90, y: 300, w: 400, h: 200 };
        const title = { x: 90, y: 400, w: 150, h: 30 };
        const slot = placeGroupTitle(group, 80, 24, [filling], [title], 6);
        expect(slot.kind).toBe('chip');
        expect(slot.x).toBeGreaterThanOrEqual(title.x + title.w);
    });

    it('keeps the chip at the left when nothing in the band is clear', () => {
        const filling = { x: 0, y: 0, w: 1000, h: 1000 };
        expect(placeGroupTitle(group, 80, 24, [filling], [filling], 6)).toMatchObject({ kind: 'chip', x: 106 });
    });

    it('never makes a title wider than its group', () => {
        expect(placeGroupTitle(group, 900, 24, [], [], 6).w).toBe(group.w);
    });
});

describe('fitOverviewTitle', () => {
    const measure = (text: string, px: number) => text.length * px * 0.6;

    it('caps the size, and shrinks a title to fit no further than the floor', () => {
        expect(fitOverviewTitle(measure, 'Upscale', 30, 1000)).toEqual({ text: 'Upscale', px: GROUP_TITLE_CAP_PX });
        const shrunk = fitOverviewTitle(measure, 'Upscale', 18, 7 * 15 * 0.6);
        expect(shrunk?.text).toBe('Upscale');
        expect(shrunk?.px).toBeCloseTo(15);
    });

    it('shortens a title that does not fit at the floor, and leaves out one cut too short to tell anything', () => {
        const cut = fitOverviewTitle(measure, 'A very long group title', 18, 10 * OVERVIEW_TITLE_MIN_PX * 0.6);
        expect(cut?.px).toBe(OVERVIEW_TITLE_MIN_PX);
        expect(cut?.text.endsWith('…')).toBe(true);
        expect(fitOverviewTitle(measure, 'A very long group title', 18, 3 * OVERVIEW_TITLE_MIN_PX * 0.6)).toBeNull();
    });

    it('leaves out ComfyUI’s default title', () => {
        expect(isDefaultGroupTitle(' group ')).toBe(true);
        expect(isDefaultGroupTitle('Group 2')).toBe(false);
        expect(fitOverviewTitle(measure, 'Group', 18, 1000)).toBeNull();
    });
});

// Seen on Lily in the overview: a node title cut to "S…" tells nothing, so the canvas leaves it out instead.
describe('keepsEnough', () => {
    it('keeps a whole title or one cut to four characters or more, and drops a shorter cut', () => {
        expect(keepsEnough('Save', 'Save')).toBe(true);
        expect(keepsEnough('Save…', 'SaveImage')).toBe(true);
        expect(keepsEnough('Sav…', 'SaveImage')).toBe(false);
        expect(keepsEnough('S…', 'SaveImage')).toBe(false);
    });
});

describe('dropOverlaps', () => {
    it('keeps the bigger group’s label where two overlap, and both where they do not', () => {
        const label = (key: string, x: number, area: number) => ({ key, area, rect: { x, y: 0, w: 100, h: 20 } });
        expect(dropOverlaps([label('small', 50, 10), label('big', 0, 99)]).map((kept) => kept.key)).toEqual(['big']);
        expect(dropOverlaps([label('a', 0, 10), label('b', 200, 20)]).map((kept) => kept.key)).toEqual(['b', 'a']);
    });
});

describe('viewLevel', () => {
    // A small band: far mode starts below FAR_SCALE but holds until FAR_EXIT_SCALE, so a resting wheel cannot flicker.
    it('switches to far below FAR_SCALE and back to near only at FAR_EXIT_SCALE', () => {
        expect(viewLevel(FAR_SCALE, false)).toBe('near');
        expect(viewLevel(FAR_SCALE - 0.001, false)).toBe('far');
        const inBand = (FAR_SCALE + FAR_EXIT_SCALE) / 2;
        expect(viewLevel(inBand, true)).toBe('far');
        expect(viewLevel(inBand, false)).toBe('near');
        expect(viewLevel(FAR_EXIT_SCALE, true)).toBe('near');
    });

    it('shows the overview below OVERVIEW_SCALE', () => {
        expect(viewLevel(OVERVIEW_SCALE, true)).toBe('far');
        expect(viewLevel(OVERVIEW_SCALE - 0.001, true)).toBe('overview');
        expect(viewLevel(OVERVIEW_SCALE - 0.001, false)).toBe('overview');
    });
});
