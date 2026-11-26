import { describe, expect, it } from 'vitest';
import { DETAIL_FADE_SCALE, detailOpacity, FAR_EXIT_SCALE, FAR_SCALE, OVERVIEW_SCALE, viewLevel } from '../geometry';
import { dropOverlaps, fitOverviewTitle, GROUP_TITLE_CAP_PX, keepsEnough, OVERVIEW_TITLE_MIN_PX, placeGroupTitle } from '../groupTitles';

const group = { x: 100, y: 400, w: 300, h: 200 };

describe('placeGroupTitle', () => {
    // The owner's pick (2026-11-26): every group title is a pill inside its group, never a tab above it. After the
    // look pass the pill stays at the top-left: sliding along the band to dodge nodes read as inconsistent mid-zoom.
    it('puts the title in a pill at the group’s top-left, inside its insets', () => {
        expect(placeGroupTitle(group, 150, 24, 6)).toEqual({ x: 106, y: 406, w: 150, h: 24 });
    });

    it('never makes a title wider than its group, inside its insets', () => {
        expect(placeGroupTitle(group, 900, 24, 6).w).toBe(group.w - 12);
    });
});

describe('fitOverviewTitle', () => {
    const measure = (text: string, px: number) => text.length * px * 0.6;

    // The owner's look at Fit on Lily: overview titles stay small, 11 to 14 px on screen.
    it('keeps overview titles between 11 and 14 px', () => {
        expect(OVERVIEW_TITLE_MIN_PX).toBe(11);
        expect(GROUP_TITLE_CAP_PX).toBe(14);
    });

    it('caps the size, and shrinks a title to fit no further than the floor', () => {
        expect(fitOverviewTitle(measure, 'Upscale', 30, 1000)).toEqual({ text: 'Upscale', px: GROUP_TITLE_CAP_PX });
        const shrunk = fitOverviewTitle(measure, 'Upscale', 18, 7 * 12.5 * 0.6);
        expect(shrunk?.text).toBe('Upscale');
        expect(shrunk?.px).toBeCloseTo(12.5);
    });

    it('shortens a title that does not fit at the floor, and leaves out one cut too short to tell anything', () => {
        const cut = fitOverviewTitle(measure, 'A very long group title', 18, 10 * OVERVIEW_TITLE_MIN_PX * 0.6);
        expect(cut?.px).toBe(OVERVIEW_TITLE_MIN_PX);
        expect(cut?.text.endsWith('…')).toBe(true);
        expect(fitOverviewTitle(measure, 'A very long group title', 18, 3 * OVERVIEW_TITLE_MIN_PX * 0.6)).toBeNull();
    });

    // On Lily every group keeps ComfyUI's default "Group", and the owner wants group labels at Fit: they stay in, and
    // the node count beside them tells them apart.
    it('keeps ComfyUI’s default title', () => {
        expect(fitOverviewTitle(measure, 'Group', 18, 1000)).toEqual({ text: 'Group', px: GROUP_TITLE_CAP_PX });
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

describe('detailOpacity', () => {
    // The owner's look pass: body text should fade sooner, so it is gone or going before the canvas takes over
    // instead of switching in the swap. It steps, so a sweep restyles 500 nodes a few times, not every frame.
    it('fades body text out between DETAIL_FADE_SCALE and the switch, in a few steps', () => {
        expect(detailOpacity(1)).toBe(1);
        expect(detailOpacity(DETAIL_FADE_SCALE)).toBe(1);
        expect(detailOpacity(FAR_SCALE)).toBe(0);
        expect(DETAIL_FADE_SCALE).toBeGreaterThan(FAR_EXIT_SCALE);
        const steps = new Set<number>();
        for (let s = DETAIL_FADE_SCALE; s > FAR_SCALE; s -= 0.001) steps.add(detailOpacity(s));
        expect(steps.size).toBeLessThanOrEqual(4);
        expect([...steps].every((step) => step > 0 && step <= 1)).toBe(true);
        // Already partly faded where the view comes back from far mode.
        expect(detailOpacity(FAR_EXIT_SCALE)).toBeLessThan(1);
    });

    // The steps split the band evenly, so the view coming back from far mode at 55 % shows the text at a third.
    it('steps at even thirds of the band, float rounding aside', () => {
        expect(detailOpacity(0.55)).toBeCloseTo(1 / 3, 9);
        expect(detailOpacity(0.6)).toBeCloseTo(2 / 3, 9);
        expect(detailOpacity(0.5001)).toBeCloseTo(1 / 3, 9);
        expect(detailOpacity(0.6499)).toBe(1);
    });
});
