import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    drawFarScene,
    farGroupTitlePx,
    farSceneFor,
    groupPillAt,
    layoutGroupLabels,
    NEAR_GROUP_TITLE_PX,
    NO_FAR_MARKS,
    prepareFarArrival,
    prepareFarDrawing,
    readFarPalette,
    type FarPalette,
} from '../farCanvas';
import { ARRIVE_STEPS, planEntrance } from '../entrance';
import { FAR_SCALE, groupBox, LOWEST_SCALE, OVERVIEW_SCALE, nodeHeight, sceneFor, wirePaths } from '../geometry';
import { GROUP_TITLE_CAP_PX, OVERVIEW_TITLE_MIN_PX, TITLE_CHROME, TITLE_INSET } from '../groupTitles';
import { buildGraphModel, savedPositions } from '../graphModel';
import { canvasGroup, canvasLink, canvasNode, level, port } from './canvasFixtures';

const model = buildGraphModel(
    level(
        [
            canvasNode('1', { title: 'Load', nodeType: 'CheckpointLoader', pos: { x: 20, y: 80 }, outputs: [port(0, 'LATENT')] }),
            canvasNode('2', { title: 'KSampler', pos: { x: 400, y: 80 }, inputs: [port(0, 'LATENT')], mode: 'bypassed' }),
            canvasNode('3', { title: 'Old', pos: { x: 400, y: 400 }, mode: 'muted' }),
            canvasNode('4', { kind: 'reroute', pos: { x: 700, y: 120 } }),
        ],
        [canvasLink('1', 0, '2', 0)],
        [canvasGroup('Loaders', 0, 0, 300, 300)]
    )
);
const positions = savedPositions(model);
const groupKey = model.groups[0].key;

const farScene = (foldedNodes: ReadonlySet<string>, foldedGroups: ReadonlySet<string>) => {
    const scene = sceneFor(model, 'saved', foldedGroups);
    const wires = wirePaths(model, positions, foldedNodes, scene, 'bundled');
    return { far: farSceneFor(model, positions, foldedNodes, foldedGroups, scene, wires), wires };
};

describe('farSceneFor', () => {
    // Far mode is presentation only: a box sits exactly where the HTML node does, at the height the view uses.
    it('draws every shown node at its position and height, with the same wires', () => {
        const folded = new Set(['3']);
        const { far, wires } = farScene(folded, new Set());
        expect(far.nodes.map((node) => node.id)).toEqual(['1', '2', '3', '4']);
        for (const box of far.nodes) {
            const node = model.nodes.find((candidate) => candidate.id === box.id)!;
            expect({ x: box.x, y: box.y, w: box.w, h: box.h }).toEqual({
                ...positions.get(box.id),
                w: node.width,
                h: nodeHeight(node, folded.has(node.id)),
            });
        }
        expect(far.wires).toBe(wires);
        expect(far.nodes.map((node) => node.variant)).toEqual(['plain', 'bypass', 'mute', 'reroute']);
    });

    // The HTML only sets a minimum height, so a node can lay out shorter than the model estimates.
    it('uses the laid-out height of a node when the view measured one', () => {
        const scene = sceneFor(model, 'saved', new Set());
        const far = farSceneFor(model, positions, new Set(), new Set(), scene, [], new Map([['2', 77]]));
        expect(far.nodes.find((node) => node.id === '2')?.h).toBe(77);
        expect(far.nodes.find((node) => node.id === '1')?.h).toBe(nodeHeight(model.nodes[0], false));
    });

    it('leaves out the members of a folded group and draws the group shut', () => {
        const { far } = farScene(new Set(), new Set([groupKey]));
        expect(far.nodes.map((node) => node.id)).toEqual(['2', '3', '4']);
        expect(far.groups).toEqual([{ key: groupKey, title: 'Loaders', count: 1, shut: true, ...groupBox(model.groups[0], true) }]);
    });

    // The overview tints each node toward its group.
    it('marks each node with its innermost open group', () => {
        const scene = sceneFor(model, 'saved', new Set());
        const far = farSceneFor(model, positions, new Set(), new Set(), scene, []);
        expect(far.nodes.map((node) => [node.id, node.group])).toEqual([
            ['1', groupKey],
            ['2', null],
            ['3', null],
            ['4', null],
        ]);
    });
});

describe('readFarPalette', () => {
    // A workflow often starts with a Note: its colours must not paint every other far box.
    it('takes the node looks from real nodes, never from a note', () => {
        const layer = document.createElement('div');
        layer.innerHTML = [
            '<div class="wg-node note" style="background-color: rgb(1, 1, 1)"></div>',
            '<div class="wg-node note bypass" style="background-color: rgb(2, 2, 2)"></div>',
            '<div class="wg-node note mute" style="background-color: rgb(3, 3, 3)"></div>',
            '<div class="wg-node" style="background-color: rgb(10, 10, 10)"></div>',
            '<div class="wg-node bypass" style="background-color: rgb(20, 20, 20)"></div>',
            '<div class="wg-node mute" style="background-color: rgb(30, 30, 30)"></div>',
        ].join('');
        document.body.appendChild(layer);
        try {
            const palette = readFarPalette(layer);
            expect(palette.node.plain.fill).toBe('rgb(10, 10, 10)');
            expect(palette.node.bypass.fill).toBe('rgb(20, 20, 20)');
            expect(palette.node.mute.fill).toBe('rgb(30, 30, 30)');
        } finally {
            layer.remove();
        }
    });
});

/** A canvas that records what is painted: each paint tagged with the colour it used, and the alpha at the time. */
const recordingCanvas = () => {
    const calls: string[] = [];
    const texts: string[] = [];
    const paints: string[] = [];
    const style = { fill: '', stroke: '', alpha: 1 };
    const ctx = new Proxy(
        { canvas: { width: 800, height: 600 }, measureText: (text: string) => ({ width: text.length }) },
        {
            get: (target, key) =>
                key in target
                    ? target[key as keyof typeof target]
                    : (...args: unknown[]) => {
                          calls.push(String(key));
                          if (key === 'fillText') texts.push(String(args[0]));
                          if (key === 'fill' || key === 'fillText') paints.push(`${String(key)}:${style.fill}@${style.alpha}`);
                          if (key === 'stroke') paints.push(`stroke:${style.stroke}@${style.alpha}`);
                      },
            set: (_target, key, value) => {
                if (key === 'fillStyle') style.fill = String(value);
                if (key === 'strokeStyle') style.stroke = String(value);
                if (key === 'globalAlpha') style.alpha = Number(value);
                return true;
            },
        }
    ) as unknown as CanvasRenderingContext2D;
    return { ctx, calls, texts, paints };
};

const look = { fill: 'a', stroke: 'b', alpha: 1, dashed: false };
const palette: FarPalette = {
    font: 'f',
    text: 't',
    muted: 'm',
    accent: 'sage',
    node: { plain: look, bypass: look, mute: look, reroute: look },
    wire: { latent: 'w' },
    wireWidth: 2.2,
    group: new Map([[groupKey, { fill: 'g', stroke: 'g', titleColour: 'g', pillFill: 'g', pillStroke: 'g' }]]),
};

describe('drawFarScene', () => {
    const boxes: number[] = [];
    beforeEach(() => {
        boxes.length = 0;
        vi.stubGlobal(
            'Path2D',
            class {
                constructor(readonly d = '') {}
                roundRect() {
                    boxes.push(1);
                }
            }
        );
    });
    afterEach(() => vi.unstubAllGlobals());

    // The owner's ladder: far shows group titles and node titles, nothing more, so no node type line.
    it('paints each group, wire and node, the group title in its pill, and the title of each node that is not a reroute', () => {
        const { ctx, calls, texts, paints } = recordingCanvas();
        const { far } = farScene(new Set(), new Set());
        // Paths are built once; a frame replays them, one batch per look. Node 1 also has its group's tint.
        const drawing = prepareFarDrawing(far, palette);
        expect(boxes).toHaveLength(far.groups.length + far.nodes.length + 1);
        drawFarScene(ctx, drawing, { x: 0, y: 0, s: 0.4 }, 2);
        // The group, the four node looks and the title pill's backing.
        expect(calls.filter((call) => call === 'fill')).toHaveLength(far.groups.length + 4 + 1);
        expect(texts).toEqual(['Load', 'KSampler', 'Old', 'Loaders', '1 node']);

        // Far mode stacks like the HTML view: wires under groups, the group's box under every node, and its title
        // pill over the nodes, so a node in the band never hides the title.
        const lastWire = paints.lastIndexOf('stroke:w@1');
        const groupPaints = paints.flatMap((paint, index) => (paint.includes(':g@') ? [index] : []));
        const firstNode = paints.indexOf('fill:a@1');
        // Node titles (the first three texts) are muted, a step below the group title.
        const textPaints = paints.flatMap((paint, index) => (paint.startsWith('fillText') ? [index] : []));
        expect(textPaints.slice(0, 3).map((index) => paints[index])).toEqual(['fillText:m@1', 'fillText:m@1', 'fillText:m@1']);
        const lastNodeText = textPaints[2];
        expect(lastWire).toBeGreaterThanOrEqual(0);
        expect(groupPaints.length).toBe(5);
        const [boxFill, boxStroke, ...pill] = groupPaints;
        expect(boxFill).toBeGreaterThan(lastWire);
        expect(boxStroke).toBeLessThan(firstNode);
        expect(Math.min(...pill)).toBeGreaterThan(lastNodeText);
    });

    // The overview: soft shapes without borders, faint wires and group titles as the only text. The owner read a lone
    // output's title there ("SaveI…") as a bug.
    it('draws the overview with no node text, faint wires and borderless nodes', () => {
        const { ctx, texts, paints } = recordingCanvas();
        const { far } = farScene(new Set(), new Set());
        drawFarScene(ctx, prepareFarDrawing(far, palette), { x: 0, y: 0, s: 0.15 }, 1, 'overview');
        expect(texts).toEqual(['Loaders']);
        expect(paints).toContain('stroke:w@0.4');
        expect(paints).not.toContain('stroke:w@1');
        expect(paints.filter((paint) => paint.startsWith('stroke:b'))).toEqual([]);
        // Node 1 is tinted toward its group's colour.
        expect(paints.filter((paint) => paint === 'fill:g@0.35')).toHaveLength(1);
    });

    // Fitting every node's title is the costly step of a far frame. A zoom sweep must reuse a few fitted sizes rather
    // than fit all nodes again on nearly every wheel step, and the overview, which shows no node text, fits none (the
    // review found hundreds of full sets cached after one sweep of a 500-node graph).
    it('fits node titles at a few sizes over a far sweep, and none in the overview', () => {
        const { ctx } = recordingCanvas();
        const { far } = farScene(new Set(), new Set());
        const drawing = prepareFarDrawing(far, palette);
        for (let s = FAR_SCALE; s > OVERVIEW_SCALE; s *= 0.98) drawFarScene(ctx, drawing, { x: 0, y: 0, s }, 1, 'far');
        const farSizes = drawing.labels.size;
        expect(farSizes).toBeGreaterThan(0);
        expect(farSizes).toBeLessThanOrEqual(8);
        for (let s = OVERVIEW_SCALE; s > LOWEST_SCALE; s *= 0.98) drawFarScene(ctx, drawing, { x: 0, y: 0, s }, 1, 'overview');
        expect(drawing.labels.size).toBe(farSizes);
    });
});

// A click on a far pill zooms to its group, so the canvas hands back the pills it drew and strokes the hovered one.
describe('far title pills', () => {
    beforeEach(() =>
        vi.stubGlobal(
            'Path2D',
            class {
                roundRect() {}
            }
        )
    );
    afterEach(() => vi.unstubAllGlobals());
    const hoverPalette: FarPalette = {
        ...palette,
        group: new Map([[groupKey, { fill: 'g', stroke: 'g', titleColour: 'title', pillFill: 'g', pillStroke: 'edge' }]]),
    };

    it('returns the pills it drew, and strokes the hovered pill in its title colour', () => {
        const { far } = farScene(new Set(), new Set());
        const drawing = prepareFarDrawing(far, hoverPalette);
        const plain = recordingCanvas();
        const pills = drawFarScene(plain.ctx, drawing, { x: 0, y: 0, s: 0.4 }, 1);
        expect(pills.map((pill) => pill.key)).toEqual([groupKey]);
        expect(plain.paints).toContain('stroke:edge@1');
        expect(plain.paints).not.toContain('stroke:title@1');
        const hovered = recordingCanvas();
        drawFarScene(hovered.ctx, drawing, { x: 0, y: 0, s: 0.4 }, 1, 'far', groupKey);
        expect(hovered.paints).toContain('stroke:title@1');
        expect(hovered.paints).not.toContain('stroke:edge@1');
    });

    it('finds the pill under a world point, edges included, and none outside every pill', () => {
        const pill = (key: string, x: number) => ({ key, rect: { x, y: 0, w: 100, h: 20 } }) as Parameters<typeof groupPillAt>[0][number];
        const pills = [pill('a', 0), pill('b', 200)];
        expect(groupPillAt(pills, 50, 10)).toBe('a');
        expect(groupPillAt(pills, 300, 20)).toBe('b');
        expect(groupPillAt(pills, 150, 10)).toBeNull();
        expect(groupPillAt(pills, 50, 21)).toBeNull();
    });
});

describe('layoutGroupLabels', () => {
    const group = (key: string, title: string, x: number, y: number, w: number, h: number) => ({
        key,
        title,
        count: 2,
        shut: false,
        x,
        y,
        w,
        h,
    });
    const measure = (text: string, px: number) => text.length * px * 0.6;

    // On Lily every group keeps ComfyUI's default "Group". The owner wants group labels at Fit, so the overview keeps
    // them, and the node count beside a whole title is what tells such groups apart.
    it('keeps default "Group" titles in the overview, with the node count where it fits', () => {
        const drawing = { groups: [group('a', 'Group', 0, 0, 2000, 1000), group('b', 'Upscale', 0, 2000, 2000, 1000)] };
        expect(layoutGroupLabels(drawing, 0.1, 'overview', measure).map((label) => [label.text, label.count])).toEqual([
            ['Group', '2 nodes'],
            ['Upscale', '2 nodes'],
        ]);
        // A group with room for its title only drops the count, not the title.
        const s = 0.1;
        const titleOnly = (measure('Group', GROUP_TITLE_CAP_PX) + 2 * GROUP_TITLE_CAP_PX * 0.6 + 12 + 4) / s;
        const [narrow] = layoutGroupLabels({ groups: [group('a', 'Group', 0, 0, titleOnly, 1000)] }, s, 'overview', measure);
        expect(narrow).toMatchObject({ text: 'Group', count: null });
    });

    // Every pill sits at its group's top-left at every level, so it never moves while the view zooms.
    it('puts every pill at its group’s top-left, at every zoom', () => {
        const box = group('a', 'Upscale', 300, 100, 2000, 1000);
        for (const [s, level] of [
            [0.45, 'far'],
            [0.3, 'far'],
            [0.15, 'overview'],
        ] as const) {
            const [label] = layoutGroupLabels({ groups: [box] }, s, level, measure);
            // Inset from the corner by at most 6 px on screen, the same along both edges.
            const inset = label.rect.x - box.x;
            expect(inset).toBeGreaterThan(0);
            expect(inset * s).toBeLessThanOrEqual(6 + 1e-9);
            expect(label.rect.y - box.y).toBeCloseTo(inset, 9);
        }
    });

    // Titles that would overlap: the bigger group's wins.
    it('keeps the bigger group’s title where two overlap in the overview', () => {
        const big = group('big', 'Sampling', 0, 0, 3000, 2000);
        const small = group('small', 'Loaders', 40, 0, 1000, 500);
        const labels = layoutGroupLabels({ groups: [small, big] }, 0.1, 'overview', measure);
        expect(labels.map((label) => label.key)).toEqual(['big']);
    });

    // At Fit on Lily a short group's pill, a few hundred world units tall that far out, ran over the group below and
    // read as its title. A pill has to stay inside its own group and off the others: it shrinks to the floor first,
    // and a group it still won't fit goes without a title.
    describe('a short group above another', () => {
        const below = group('below', 'Sampling', 0, 340, 3000, 2000);
        const keys = (labels: readonly { key: string }[]) => labels.map((label) => label.key);

        it('drops the short group’s overview pill when not even the floor size fits', () => {
            const short = group('short', 'Loaders', 0, 0, 3000, 200);
            expect(keys(layoutGroupLabels({ groups: [short, below] }, 0.1, 'overview', measure))).toEqual(['below']);
        });

        it('shrinks the overview pill to the floor when that fits, without its count', () => {
            // At 10 % the pill's bottom sits about 318 world units down at the cap and 263 at the floor.
            const short = group('short', 'Loaders', 0, 0, 3000, 280);
            const labels = layoutGroupLabels({ groups: [short, below] }, 0.1, 'overview', measure);
            const pill = labels.find((label) => label.key === 'short');
            expect(pill).toMatchObject({ text: 'Loaders', count: null, px: OVERVIEW_TITLE_MIN_PX });
            expect(pill!.rect.y + pill!.rect.h).toBeLessThanOrEqual(280);
            expect(pill!.rect.y + pill!.rect.h).toBeLessThan(below.y);
        });

        it('drops a far pill taller than its group', () => {
            const short = group('short', 'Loaders', 0, 0, 3000, 60);
            expect(keys(layoutGroupLabels({ groups: [short, below] }, 0.3, 'far', measure))).toEqual(['below']);
        });

        it('keeps the pill of a group around a nested one', () => {
            const inner = group('inner', 'Loaders', 40, 40, 400, 300);
            const outer = group('outer', 'Sampling', 0, 0, 3000, 2000);
            expect(keys(layoutGroupLabels({ groups: [inner, outer] }, 0.3, 'far', measure))).toContain('outer');
        });
    });

    it('shows each far title with its node count, in a pill inside the group’s top band', () => {
        const [label] = layoutGroupLabels({ groups: [group('a', 'Upscale', 0, 100, 2000, 1000)] }, 0.3, 'far', measure);
        expect(label).toMatchObject({ kind: 'pill', text: 'Upscale', count: '2 nodes' });
        expect(label.rect.y).toBeGreaterThan(100);
    });

    // In a narrow group the title gets the room first: the count goes before the title is cut. On 152349 the
    // pill read "Step1 - L… 2 nodes", which kept the count and lost the group's name.
    it('drops the node count before cutting the title in a narrow group', () => {
        const s = 0.3;
        // The far pill is the near pill scaled by k, so the room is reckoned in near-pill units.
        const k = farGroupTitlePx(s) / (NEAR_GROUP_TITLE_PX * s);
        const title = 'Step1 - Load models';
        // Room for the whole title, but not for the title and its count.
        const w = k * (2 * TITLE_INSET + TITLE_CHROME + measure(title, NEAR_GROUP_TITLE_PX) + measure('2 nodes', 11) / 2);
        const [narrow] = layoutGroupLabels({ groups: [group('a', title, 0, 100, w, 1000)] }, s, 'far', measure);
        expect(narrow).toMatchObject({ text: title, count: null });
        // Narrower still, the title is cut, and the count still stays out.
        const [cut] = layoutGroupLabels({ groups: [group('a', title, 0, 100, w * 0.6, 1000)] }, s, 'far', measure);
        expect(cut.text.endsWith('…')).toBe(true);
        expect(cut.count).toBeNull();
    });
});

describe('farGroupTitlePx', () => {
    // At the switch a far title is exactly as big on screen as the near pill's, so nothing jumps; it then grows to the cap.
    it('starts at the near title size and grows to the cap', () => {
        expect(farGroupTitlePx(FAR_SCALE)).toBeCloseTo(NEAR_GROUP_TITLE_PX * FAR_SCALE);
        expect(farGroupTitlePx(0.3)).toBeGreaterThan(farGroupTitlePx(0.4));
        expect(farGroupTitlePx(0.05)).toBe(GROUP_TITLE_CAP_PX);
    });
});

describe('the far canvas entrance', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'Path2D',
            class {
                constructor(readonly d = '') {}
                roundRect() {}
            }
        );
    });
    afterEach(() => vi.unstubAllGlobals());

    const { far } = farScene(new Set(), new Set());
    const plan = planEntrance(far.nodes, false);

    // Each node and wire is drawn exactly once a frame, in the step its start falls in, so nothing doubles up.
    it('splits the nodes and wires into a few steps, each in exactly one', () => {
        const arrival = prepareFarArrival(far, palette, plan);
        expect(arrival.nodes.length).toBeLessThanOrEqual(ARRIVE_STEPS);
        const ids = arrival.nodes.flatMap((step) => step.drawing.sceneNodes.map((node) => node.id));
        expect([...ids].sort()).toEqual(far.nodes.map((node) => node.id).sort());
        const delays = arrival.nodes.map((step) => step.delay);
        expect(delays).toEqual([...delays].sort((a, b) => a - b));
        expect(arrival.wires.reduce((sum, step) => sum + step.drawing.wires.length, 0)).toBeGreaterThan(0);
    });

    it('paints no node at the start, the leftmost first, and every node in full at the end', () => {
        const arrival = prepareFarArrival(far, palette, plan);
        const at = (t: number) => {
            const { ctx, paints } = recordingCanvas();
            drawFarScene(ctx, prepareFarDrawing(far, palette), { x: 0, y: 0, s: 0.4 }, 1, 'far', null, NO_FAR_MARKS, { steps: arrival, t });
            return paints.filter((paint) => paint.startsWith('fill:a@'));
        };
        expect(at(0)).toEqual([]);
        // Early on, only the first step has started, and it is not yet in full.
        const early = at(60);
        expect(early.length).toBeGreaterThan(0);
        expect(early.length).toBeLessThan(arrival.nodes.length);
        expect(early.every((paint) => Number(paint.split('@')[1]) < 1)).toBe(true);
        expect(at(plan.end).every((paint) => paint.endsWith('@1'))).toBe(true);
        expect(at(plan.end)).toHaveLength(arrival.nodes.reduce((sum, step) => sum + step.drawing.nodes.length, 0));
    });

    // A ring at full strength around a node not yet drawn reads as a stray mark: it fades in with its node.
    it('fades the picked node’s ring in with its node', () => {
        const arrival = prepareFarArrival(far, palette, plan);
        const ringAt = (t: number) => {
            const { ctx, paints } = recordingCanvas();
            const marks = { ...NO_FAR_MARKS, selected: '1' };
            drawFarScene(ctx, prepareFarDrawing(far, palette), { x: 0, y: 0, s: 0.4 }, 1, 'far', null, marks, { steps: arrival, t });
            return paints.filter((paint) => paint.startsWith('stroke:sage@')).map((paint) => Number(paint.split('@')[1]));
        };
        expect(ringAt(0)).toEqual([0]);
        const [early] = ringAt(60);
        expect(early).toBeGreaterThan(0);
        expect(early).toBeLessThan(1);
        expect(ringAt(plan.end)).toEqual([1]);
    });
});

// A subgraph's open row must still read as a door when the graph is too far out for its text.
describe('the open row at far and overview', () => {
    beforeEach(() =>
        vi.stubGlobal(
            'Path2D',
            class {
                roundRect() {}
            }
        )
    );
    afterEach(() => vi.unstubAllGlobals());
    const withDoor = buildGraphModel(
        level([
            canvasNode('s', { kind: 'subgraph', subgraphId: 'def', pos: { x: 0, y: 30 } }),
            canvasNode('x', { kind: 'subgraph', subgraphId: 'gone', pos: { x: 400, y: 30 } }),
        ]),
        new Map([['def', { name: 'Stage', nodes: 3 }]])
    );
    const doorScene = (foldedNodes: ReadonlySet<string>) =>
        farSceneFor(withDoor, savedPositions(withDoor), foldedNodes, new Set(), sceneFor(withDoor, 'saved', new Set()), []);

    it('marks only a subgraph that can open, and not while it is folded', () => {
        expect(doorScene(new Set()).nodes.map((node) => [node.id, node.door])).toEqual([
            ['s', true],
            ['x', false],
        ]);
        expect(doorScene(new Set(['s'])).nodes.every((node) => !node.door)).toBe(true);
    });

    it('draws the band in the accent at both far levels', () => {
        for (const level of ['far', 'overview'] as const) {
            const { ctx, paints } = recordingCanvas();
            drawFarScene(ctx, prepareFarDrawing(doorScene(new Set()), palette), { x: 0, y: 0, s: 0.2 }, 1, level);
            expect(paints).toContain('fill:sage@0.3');
        }
        const { ctx, paints } = recordingCanvas();
        drawFarScene(ctx, prepareFarDrawing(doorScene(new Set(['s'])), palette), { x: 0, y: 0, s: 0.2 }, 1, 'far');
        expect(paints).not.toContain('fill:sage@0.3');
    });
});
