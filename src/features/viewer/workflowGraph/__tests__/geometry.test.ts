import { describe, expect, it } from 'vitest';
import { buildGraphModel, FOLDED_GROUP_H, FOLDED_GROUP_W, HEADER_H, savedPositions, type Positions } from '../graphModel';
import {
    boundsOf,
    endpoint,
    fitView,
    LOWEST_SCALE,
    MAX_SCALE,
    MIN_SCALE,
    sceneFor,
    startView,
    wirePaths,
    zoomAt,
    zoomFloor,
} from '../geometry';
import { canvasGroup, canvasLink, canvasNode, level, port } from './canvasFixtures';

const none = new Set<string>();

/** The x where a bundled wire turns: its first corner's control point, or the corner itself on a straight run. */
const trunkX = (d: string) => Number((/Q(-?[\d.]+) /.exec(d) ?? /L(-?[\d.]+) /.exec(d))![1]);

describe('bundled wires', () => {
    // One output feeding several nodes must read as one trunk that splits near its targets.
    const fanOut = () => {
        const source = canvasNode('src', { pos: { x: 0, y: 30 }, outputs: [port(0, 'MODEL'), port(1, 'CLIP')] });
        const near = canvasNode('near', { pos: { x: 400, y: 30 }, inputs: [port(0, 'MODEL')] });
        const far = canvasNode('far', { pos: { x: 900, y: 400 }, inputs: [port(0, 'MODEL'), port(1, 'CLIP')] });
        return buildGraphModel(
            level(
                [source, near, far],
                [canvasLink('src', 0, 'near', 0, 'MODEL'), canvasLink('src', 0, 'far', 0, 'MODEL'), canvasLink('src', 1, 'far', 1, 'CLIP')]
            )
        );
    };

    it('turns every wire from one output at the same x, just before its nearest target', () => {
        const model = fanOut();
        const wires = wirePaths(model, savedPositions(model), none, sceneFor(model, 'saved', none), 'bundled');
        const [toNear, toFar, clipWire] = wires;
        expect(trunkX(toNear.d)).toBe(400 - 28);
        expect(trunkX(toFar.d)).toBe(trunkX(toNear.d));
        // Another output of the same node has its own trunk.
        expect(trunkX(clipWire.d)).toBe(900 - 28);
    });

    it('builds trunks from an index: 10,000 wires from one output stay fast', () => {
        const targets = Array.from({ length: 10_000 }, (_, index) =>
            canvasNode(`t${index}`, { pos: { x: 500 + (index % 50) * 10, y: index * 5 }, inputs: [port(0, 'LATENT')] })
        );
        const model = buildGraphModel(
            level(
                [canvasNode('src', { outputs: [port(0, 'LATENT')] }), ...targets],
                targets.map((target) => canvasLink('src', 0, target.id, 0))
            )
        );
        const positions = savedPositions(model);
        const started = performance.now();
        const wires = wirePaths(model, positions, none, sceneFor(model, 'saved', none), 'bundled');
        // The piece's per-wire scan is 10^8 steps here, several seconds.
        expect(performance.now() - started).toBeLessThan(1_000);
        expect(new Set(wires.map((wire) => trunkX(wire.d)))).toEqual(new Set([500 - 28]));
    });

    it('meets an unlisted slot and a folded node at the title bar', () => {
        const model = buildGraphModel(level([canvasNode('n', { pos: { x: 10, y: 30 }, inputs: [port(0, 'LATENT')] })]));
        const node = model.byId.get('n')!;
        const at = { x: 10, y: 0 };
        expect(endpoint(node, at, 'in', 5, false, undefined)).toEqual({ x: 10, y: HEADER_H / 2 });
        expect(endpoint(node, at, 'in', 0, true, undefined)).toEqual({ x: 10, y: HEADER_H / 2 });
        expect(endpoint(node, at, 'in', 0, false, undefined).y).toBeGreaterThan(HEADER_H);
    });

    it('draws curves when asked, and dashes wires that touch a bypassed node', () => {
        const model = buildGraphModel(
            level(
                [
                    canvasNode('a', { outputs: [port(0, 'IMAGE')] }),
                    canvasNode('b', { pos: { x: 500, y: 30 }, mode: 'bypassed', inputs: [port(0, 'IMAGE')] }),
                ],
                [canvasLink('a', 0, 'b', 0, 'IMAGE')]
            )
        );
        const [wire] = wirePaths(model, savedPositions(model), none, sceneFor(model, 'saved', none), 'curved');
        expect(wire.d).toContain(' C');
        expect(wire.type).toBe('image');
        expect(wire.bypassed).toBe(true);
    });
});

describe('group fold', () => {
    const grouped = () =>
        buildGraphModel(
            level(
                [
                    canvasNode('outside', { pos: { x: -400, y: 60 }, outputs: [port(0, 'MODEL')] }),
                    canvasNode('in1', {
                        pos: { x: 20, y: 80 },
                        size: { width: 100, height: 40 },
                        inputs: [port(0, 'MODEL')],
                        outputs: [port(0, 'LATENT')],
                    }),
                    canvasNode('in2', {
                        pos: { x: 200, y: 80 },
                        size: { width: 100, height: 40 },
                        inputs: [port(0, 'LATENT')],
                        outputs: [port(0, 'LATENT')],
                    }),
                    canvasNode('after', { pos: { x: 800, y: 60 }, inputs: [port(0, 'LATENT')] }),
                ],
                [canvasLink('outside', 0, 'in1', 0, 'MODEL'), canvasLink('in1', 0, 'in2', 0), canvasLink('in2', 0, 'after', 0)],
                [canvasGroup('Sampling', 0, 0, 400, 200), canvasGroup('Inner', 190, 40, 150, 120)]
            )
        );

    it('hides the members of a folded group and the wires between them', () => {
        const model = grouped();
        const folded = new Set(['0']);
        const scene = sceneFor(model, 'saved', folded);
        expect([...scene.hiddenBy.keys()].sort()).toEqual(['in1', 'in2']);
        // A group inside a folded group folds away with it.
        expect(scene.hiddenGroups.has('1')).toBe(true);
        const wires = wirePaths(model, savedPositions(model), none, scene, 'bundled');
        expect(wires.map((wire) => wire.key)).toEqual(['0', '2']);
    });

    it('reroutes wires to the edges of the folded group', () => {
        const model = grouped();
        const scene = sceneFor(model, 'saved', new Set(['0']));
        const group = model.groups[0];
        const [into, outOf] = wirePaths(model, savedPositions(model), none, scene, 'curved');
        expect(into.d.endsWith(`${group.x.toFixed(1)} ${(group.y + FOLDED_GROUP_H / 2).toFixed(1)}`)).toBe(true);
        expect(outOf.d.startsWith(`M${(group.x + FOLDED_GROUP_W).toFixed(1)} ${(group.y + FOLDED_GROUP_H / 2).toFixed(1)}`)).toBe(true);
    });

    it('anchors at the outermost folded group when folds nest', () => {
        const model = grouped();
        const scene = sceneFor(model, 'saved', new Set(['0', '1']));
        expect(scene.hiddenBy.get('in2')?.key).toBe('0');
    });

    it('draws no groups in the Tidy layout, since their bounds belong to the saved one', () => {
        const model = grouped();
        const scene = sceneFor(model, 'tidy', new Set(['0']));
        expect(scene.hiddenBy.size).toBe(0);
        expect(scene.hiddenGroups.size).toBe(2);
    });
});

describe('fit and zoom', () => {
    const viewport = { w: 1000, h: 800 };

    it('centres the drawn bounds and never enlarges past the cap', () => {
        const view = fitView({ x: 100, y: 100, w: 200, h: 100 }, viewport);
        expect(view.s).toBe(1.05);
        expect(view.x + (100 + 100) * view.s).toBeCloseTo(viewport.w / 2);
        expect(view.y + (100 + 50) * view.s).toBeCloseTo(viewport.h / 2);
    });

    // Fit must show the whole graph: a graph that needs less than MIN_SCALE gets it, down to LOWEST_SCALE.
    it('fits a big graph below the usual zoom limit, so all of it is on screen', () => {
        const bounds = { x: -200, y: 50, w: 20_000, h: 3_000 };
        const view = fitView(bounds, viewport);
        expect(view.s).toBeLessThan(MIN_SCALE);
        expect(view.x + bounds.x * view.s).toBeGreaterThanOrEqual(0);
        expect(view.x + (bounds.x + bounds.w) * view.s).toBeLessThanOrEqual(viewport.w);
        expect(fitView({ x: 0, y: 0, w: 10_000_000, h: 100 }, viewport).s).toBe(LOWEST_SCALE);
    });

    // The graph opens showing all of it, but a small graph is not blown up past its real size.
    it('opens fitted, never above 100 %', () => {
        const big = { x: -200, y: 50, w: 20_000, h: 3_000 };
        expect(startView(big, viewport)).toEqual(fitView(big, viewport));
        expect(startView({ x: 0, y: 0, w: 200, h: 100 }, viewport).s).toBe(1);
    });

    it('fits only what is drawn: hidden members leave the bounds, the folded group box stays', () => {
        const model = buildGraphModel(
            level(
                [
                    canvasNode('in', { pos: { x: 20, y: 80 }, size: { width: 100, height: 40 } }),
                    canvasNode('out', { pos: { x: 3000, y: 80 } }),
                ],
                [],
                [canvasGroup('G', 0, 0, 2000, 1000)]
            )
        );
        const folded = new Set(['0']);
        const bounds = boundsOf(model, savedPositions(model), none, folded, sceneFor(model, 'saved', folded))!;
        expect(bounds.x).toBe(0);
        expect(bounds.y).toBe(0);
        expect(bounds.x + bounds.w).toBe(3000 + 200);
        const empty = buildGraphModel(level([]));
        expect(boundsOf(empty, new Map() as Positions, none, none, sceneFor(empty, 'saved', none))).toBeNull();
    });

    it('zooms around the pointer and stays within the zoom limits', () => {
        const view = zoomAt({ x: 0, y: 0, s: 1 }, 2, 100, 100);
        expect(view.s).toBe(2);
        // The world point under the pointer stays put.
        expect((100 - view.x) / view.s).toBe(100);
        expect(zoomAt(view, 10, 0, 0).s).toBe(MAX_SCALE);
        expect(zoomAt(view, 0.001, 0, 0).s).toBe(MIN_SCALE);
    });

    // Zooming out stops where Fit does for a graph too big for MIN_SCALE, and at MIN_SCALE for the rest.
    it('lets a graph too big for the usual limit zoom out as far as fitting it takes', () => {
        const big = { x: 0, y: 0, w: 20_000, h: 3_000 };
        const floor = zoomFloor(big, viewport);
        expect(floor).toBe(fitView(big, viewport).s);
        expect(zoomAt({ x: 0, y: 0, s: 0.2 }, 0.001, 0, 0, floor).s).toBe(floor);
        expect(zoomFloor({ x: 0, y: 0, w: 200, h: 100 }, viewport)).toBe(MIN_SCALE);
        expect(zoomFloor({ x: 0, y: 0, w: 10_000_000, h: 100 }, viewport)).toBe(LOWEST_SCALE);
        expect(zoomFloor(null, viewport)).toBe(MIN_SCALE);
    });
});
