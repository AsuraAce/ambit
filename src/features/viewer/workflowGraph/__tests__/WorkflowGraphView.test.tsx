import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowGraphStore } from '../../../../stores/workflowGraphStore';
import { farSceneFor, layoutGroupLabels } from '../farCanvas';
import {
    DETAIL_FADE_SCALE,
    DETAIL_STEPS,
    FAR_EXIT_SCALE,
    FAR_SCALE,
    fitView,
    FOLD_MS,
    groupBox,
    LOWEST_SCALE,
    MIN_SCALE,
    sceneFor,
    wirePaths,
} from '../geometry';
import { buildGraphModel, savedPositions } from '../graphModel';
import { handleLayoutRequest, type LayoutRequest, type LayoutResponse } from '../tidyLayout';
import { LAYOUT_TIME_CAP_MS } from '../useTidyPositions';
import WorkflowGraphView from '../WorkflowGraphView';
import { canvasGroup, canvasLink, canvasNode, level, port, report } from './canvasFixtures';

/** Runs the real layout on the main thread, answering like the worker does. */
class FakeLayoutWorker {
    onmessage: ((event: MessageEvent<LayoutResponse>) => void) | null = null;
    onerror: (() => void) | null = null;
    terminated = false;
    postMessage(request: LayoutRequest) {
        queueMicrotask(() => {
            if (!this.terminated) this.onmessage?.({ data: handleLayoutRequest(request) } as MessageEvent<LayoutResponse>);
        });
    }
    terminate() {
        this.terminated = true;
    }
}
const fakeWorker = () => new FakeLayoutWorker() as unknown as Worker;

const UNSAFE_TITLE = '<img src=x onerror="alert(1)">';

const graph = report(
    level(
        [
            canvasNode('1', { title: UNSAFE_TITLE, pos: { x: 20, y: 80 }, outputs: [port(0, 'LATENT')] }),
            canvasNode('2', { title: 'Decode', pos: { x: 400, y: 80 }, inputs: [port(0, 'LATENT')] }),
        ],
        [canvasLink('1', 0, '2', 0)],
        [canvasGroup('Sampling', 0, 0, 300, 300)]
    )
);

const shown = (text: string) => screen.queryAllByText(text).length > 0;

const renderGraph = (onClose = vi.fn()) => {
    const view = render(<WorkflowGraphView report={graph} fileName="render.png" onClose={onClose} makeLayoutWorker={fakeWorker} />);
    return { ...view, onClose };
};

afterEach(() => useWorkflowGraphStore.setState({ open: false }));

describe('WorkflowGraphView', () => {
    // Titles, settings and group names come from the file: they must never become markup.
    it('shows text from the file as plain text', () => {
        const { container } = renderGraph();
        expect(shown(UNSAFE_TITLE)).toBe(true);
        expect(container.querySelector('img')).toBeNull();
    });

    it('owns the keyboard while open and hands it back on close', () => {
        const { unmount } = renderGraph();
        expect(useWorkflowGraphStore.getState().open).toBe(true);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: /back to image/i }));
        unmount();
        expect(useWorkflowGraphStore.getState().open).toBe(false);
    });

    it('counts one group member as "1 node"', () => {
        renderGraph();
        expect(shown('1 node')).toBe(true);
        expect(shown('1 nodes')).toBe(false);
    });

    it('closes on Escape', () => {
        const { onClose } = renderGraph();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('hides the members of a folded group and shows them again on unfold', () => {
        vi.useFakeTimers();
        try {
            renderGraph();
            expect(shown('Decode')).toBe(true);
            fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
            act(() => {
                vi.advanceTimersByTime(FOLD_MS);
            });
            expect(shown(UNSAFE_TITLE)).toBe(false);
            expect(shown('Decode')).toBe(true);
            fireEvent.click(screen.getByRole('button', { name: 'Unfold group Sampling' }));
            expect(shown(UNSAFE_TITLE)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    // Folding a second group while the first is still fading must not cut the first fade short: each group's
    // members stay drawn for the whole fold time (the review found one shared timer unmounting them mid-fade).
    it('lets two folds in a row each finish their own fade', () => {
        vi.useFakeTimers();
        try {
            const two = report(
                level(
                    [
                        canvasNode('a', { title: 'First member', pos: { x: 20, y: 60 } }),
                        canvasNode('b', { title: 'Second member', pos: { x: 520, y: 60 } }),
                    ],
                    [],
                    [canvasGroup('First', 0, 0, 400, 300), canvasGroup('Second', 500, 0, 400, 300)]
                )
            );
            render(<WorkflowGraphView report={two} fileName="two.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
            const leaving = (title: string) => screen.queryByText(title)?.closest('.wg-node')?.classList.contains('leaving') ?? false;
            fireEvent.click(screen.getByRole('button', { name: 'Fold group First' }));
            act(() => {
                vi.advanceTimersByTime(FOLD_MS / 2);
            });
            fireEvent.click(screen.getByRole('button', { name: 'Fold group Second' }));
            // The first group's member is still fading out alongside the second's.
            expect(leaving('First member')).toBe(true);
            expect(leaving('Second member')).toBe(true);
            act(() => {
                vi.advanceTimersByTime(FOLD_MS / 2);
            });
            // The first fade is over; the second still has half its time to go.
            expect(shown('First member')).toBe(false);
            expect(leaving('Second member')).toBe(true);
            act(() => {
                vi.advanceTimersByTime(FOLD_MS / 2);
            });
            expect(shown('Second member')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    // The fold button lives on the title pill while open and inside the box while folded, so a keyboard user
    // would lose their place if focus did not move with it.
    it('keeps keyboard focus on the group’s fold button across fold and unfold', () => {
        renderGraph();
        const fold = screen.getByRole('button', { name: 'Fold group Sampling' });
        act(() => fold.focus());
        fireEvent.click(fold);
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Unfold group Sampling' }));
        fireEvent.click(screen.getByRole('button', { name: 'Unfold group Sampling' }));
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fold group Sampling' }));
    });

    it('lays the graph out tidily in the worker, and drops the saved groups', async () => {
        renderGraph();
        fireEvent.click(screen.getByRole('button', { name: 'Tidy' }));
        expect(screen.getByRole('button', { name: 'Tidy' }).getAttribute('aria-pressed')).toBe('true');
        await waitFor(() => expect(shown('Sampling')).toBe(false));
        expect(shown('Decode')).toBe(true);
    });

    it('starts in Tidy, with As saved unavailable, when the file saved no positions', async () => {
        const promptOnly = report(level([canvasNode('1', { pos: null }), canvasNode('2', { pos: null })]), {
            source: 'api_prompt',
            hasSavedLayout: false,
        });
        render(<WorkflowGraphView report={promptOnly} fileName="api.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
        expect((screen.getByRole('button', { name: 'As saved' }) as HTMLButtonElement).disabled).toBe(true);
        await act(async () => {
            await Promise.resolve();
        });
        expect(shown('Node 1')).toBe(true);
    });

    // The viewer's own listener closes the viewer on Escape: one press must close the graph only.
    it('keeps the keys it handles from listeners added after it', () => {
        const { onClose } = renderGraph();
        const later = vi.fn();
        window.addEventListener('keydown', later);
        try {
            fireEvent.keyDown(document.body, { key: 'Escape' });
            fireEvent.keyDown(document.body, { key: 'f' });
            expect(onClose).toHaveBeenCalledTimes(1);
            expect(later).not.toHaveBeenCalled();
            fireEvent.keyDown(document.body, { key: 'x' });
            expect(later).toHaveBeenCalledTimes(1);
        } finally {
            window.removeEventListener('keydown', later);
        }
    });

    // A click on empty canvas must not drop focus to the page behind, or Tab would leave the graph.
    it('keeps Tab inside the graph after a click on the canvas', () => {
        renderGraph();
        const dialog = screen.getByRole('dialog', { name: 'Workflow graph' });
        fireEvent.pointerDown(screen.getByTestId('workflow-graph-world'), { button: 0 });
        expect(document.activeElement).toBe(dialog);
        fireEvent.keyDown(dialog, { key: 'Tab' });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: /back to image/i }));
        fireEvent.pointerDown(screen.getByTestId('workflow-graph-world'), { button: 0 });
        fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Tidy' }));
    });

    // Focus on an off-screen fold button scrolls an `overflow: hidden` box, which shifts the toolbar and the
    // view. Checked in the real WebView too; jsdom does not scroll on focus, so this guards the rule itself.
    it('clips the canvas instead of letting focus scroll it', () => {
        const graphCss = readFileSync('src/features/viewer/workflowGraph/workflowGraph.css', 'utf8');
        const canvasRule = /\.wg-canvas\s*\{([^}]*)\}/.exec(graphCss)?.[1] ?? '';
        expect(canvasRule).toMatch(/overflow:\s*clip;/);
    });

    it('says when a level has no nodes, rather than that the file has no positions', () => {
        const empty = report(level([]), { hasSavedLayout: false });
        render(<WorkflowGraphView report={empty} fileName="empty.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
        expect(screen.getByRole('status').textContent).toBe('This level of the workflow has no nodes.');
    });

    // A layout that never answers must not leave the view waiting: it stops, and the saved layout stays.
    it('stops a layout that runs past the time cap and keeps the saved positions', () => {
        vi.useFakeTimers();
        try {
            let stuck: { terminated: boolean } | null = null;
            const neverAnswers = () => {
                const worker = {
                    onmessage: null,
                    onerror: null,
                    terminated: false,
                    postMessage() {},
                    terminate() {
                        worker.terminated = true;
                    },
                };
                stuck = worker;
                return worker as unknown as Worker;
            };
            render(<WorkflowGraphView report={graph} fileName="render.png" onClose={vi.fn()} makeLayoutWorker={neverAnswers} />);
            fireEvent.click(screen.getByRole('button', { name: 'Tidy' }));
            expect(screen.getByRole('status').textContent).toBe('Laying out the workflow…');
            act(() => {
                vi.advanceTimersByTime(LAYOUT_TIME_CAP_MS);
            });
            expect(screen.getByRole('status').textContent).toBe('Ambit could not lay out this workflow.');
            expect(stuck).toMatchObject({ terminated: true });
            // Still the saved layout: its group is drawn, which Tidy would drop.
            expect(shown('Sampling')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    // Wheel events come faster than frames: the view is drawn once per frame.
    it('draws wheel zoom once per frame', () => {
        const frames: FrameRequestCallback[] = [];
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
        try {
            const { container } = renderGraph();
            const world = screen.getByTestId('workflow-graph-world');
            const before = world.style.transform;
            const canvas = container.ownerDocument.querySelector('.wg-canvas') as HTMLElement;
            for (let i = 0; i < 10; i++) fireEvent.wheel(canvas, { deltaY: -20, clientX: 100, clientY: 100 });
            expect(world.style.transform).toBe(before);
            const pending = frames.splice(0);
            expect(pending).toHaveLength(1);
            act(() => pending[0](performance.now()));
            expect(world.style.transform).not.toBe(before);
        } finally {
            raf.mockRestore();
        }
    });

    // The far canvas replaces how the graph is drawn, never when: far mode starts below FAR_SCALE exactly, and
    // holds until FAR_EXIT_SCALE on the way back, so a zoom resting near the line does not flicker.
    it('switches to far mode below FAR_SCALE and back at FAR_EXIT_SCALE, with the far canvas hidden from assistive technology', () => {
        const { container } = renderGraph();
        const world = screen.getByTestId('workflow-graph-world');
        const scale = () => Number(/scale\(([\d.e-]+)\)/.exec(world.style.transform)?.[1]);
        for (let i = 0; i < 14; i++) {
            fireEvent.keyDown(document.body, { key: '-' });
            expect(world.classList.contains('far')).toBe(scale() < FAR_SCALE);
        }
        expect(world.classList.contains('far')).toBe(true);
        expect(container.ownerDocument.querySelector('.wg-farcanvas')?.getAttribute('aria-hidden')).toBe('true');
        let sawBand = false;
        for (let i = 0; i < 14; i++) {
            fireEvent.keyDown(document.body, { key: '+' });
            sawBand ||= scale() >= FAR_SCALE && scale() < FAR_EXIT_SCALE;
            expect(world.classList.contains('far')).toBe(scale() < FAR_EXIT_SCALE);
        }
        // The steps from 12 % pass through the band (51.6 %), so the hold is exercised.
        expect(sawBand).toBe(true);
        expect(world.classList.contains('far')).toBe(false);
    });

    // A fold eases: the members fade toward the box and stay mounted, unfocusable, until the fade has ended.
    it('keeps a folded group’s members mounted and inert until the fold has finished', () => {
        vi.useFakeTimers();
        try {
            renderGraph();
            fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
            const member = screen.getByText(UNSAFE_TITLE).closest('.wg-node');
            expect(member?.classList.contains('leaving')).toBe(true);
            expect(member?.hasAttribute('inert')).toBe(true);
            act(() => {
                vi.advanceTimersByTime(FOLD_MS - 1);
            });
            expect(shown(UNSAFE_TITLE)).toBe(true);
            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(shown(UNSAFE_TITLE)).toBe(false);
            // Unfolding brings them back at once, fading in.
            fireEvent.click(screen.getByRole('button', { name: 'Unfold group Sampling' }));
            expect(screen.getByText(UNSAFE_TITLE).closest('.wg-node')?.classList.contains('arriving')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    // A group with a wire inside it (a→b), one leaving it (b→c), and one elsewhere (d→e).
    const wired = () =>
        render(
            <WorkflowGraphView
                report={report(
                    level(
                        [
                            canvasNode('a', { title: 'A', pos: { x: 20, y: 80 }, outputs: [port(0, 'LATENT')] }),
                            canvasNode('b', {
                                title: 'B',
                                pos: { x: 260, y: 80 },
                                inputs: [port(0, 'LATENT')],
                                outputs: [port(0, 'LATENT')],
                            }),
                            canvasNode('c', { title: 'C', pos: { x: 800, y: 80 }, inputs: [port(0, 'LATENT')] }),
                            canvasNode('d', { title: 'D', pos: { x: 20, y: 600 }, outputs: [port(0, 'LATENT')] }),
                            canvasNode('e', { title: 'E', pos: { x: 500, y: 600 }, inputs: [port(0, 'LATENT')] }),
                        ],
                        [canvasLink('a', 0, 'b', 0), canvasLink('b', 0, 'c', 0), canvasLink('d', 0, 'e', 0)],
                        [canvasGroup('Sampling', 0, 0, 520, 400)]
                    )
                )}
                fileName="wired.png"
                onClose={vi.fn()}
                makeLayoutWorker={fakeWorker}
            />
        ).container;
    const wireEls = (container: HTMLElement) => Array.from(container.querySelectorAll<SVGPathElement>('.wg-wire'));
    const motionOf = (wire: SVGPathElement) => ['morph', 'arriving', 'leaving'].find((motion) => wire.classList.contains(motion)) ?? null;

    // The owner saw every wire in the graph blink off and back on at each fold. A fold now moves only the wires it
    // touches, easing them to the folded box, and leaves the rest of the graph alone.
    it('eases the wires a fold touches and leaves every other wire alone', () => {
        vi.useFakeTimers();
        try {
            const container = wired();
            const [inside, crossing, elsewhere] = wireEls(container);
            const before = { crossing: crossing.getAttribute('d'), elsewhere: elsewhere.getAttribute('d') };
            fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
            // Same elements in the same DOM order: each wire changes in place, and Chromium cancels the transition
            // of an element that moves, so none may move while it eases.
            expect(wireEls(container)).toEqual([inside, crossing, elsewhere]);
            expect(motionOf(crossing)).toBe('morph');
            expect(crossing.getAttribute('d')).not.toBe(before.crossing);
            expect(motionOf(elsewhere)).toBeNull();
            expect(elsewhere.getAttribute('d')).toBe(before.elsewhere);
            // The wire inside the group fades out with the members, then goes.
            expect(motionOf(inside)).toBe('leaving');
            act(() => {
                vi.advanceTimersByTime(FOLD_MS);
            });
            expect(wireEls(container)).toEqual([crossing, elsewhere]);
            expect(wireEls(container).map(motionOf)).toEqual([null, null]);
            // Unfolding brings the inside wire back, fading in after the wires already drawn, and eases the crossing
            // one back.
            fireEvent.click(screen.getByRole('button', { name: 'Unfold group Sampling' }));
            const unfolded = wireEls(container);
            expect(unfolded.slice(0, 2)).toEqual([crossing, elsewhere]);
            expect(unfolded.map(motionOf)).toEqual(['morph', null, 'arriving']);
            expect(crossing.getAttribute('d')).toBe(before.crossing);
        } finally {
            vi.useRealTimers();
        }
    });

    // An unfold that lands mid-fold must not move a wire either: the leaving one fades back in where it stands.
    it('keeps every drawn wire in place when an unfold follows a fold at once', () => {
        vi.useFakeTimers();
        try {
            const container = wired();
            const drawn = wireEls(container);
            fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
            act(() => {
                vi.advanceTimersByTime(FOLD_MS / 2);
            });
            fireEvent.click(screen.getByRole('button', { name: 'Unfold group Sampling' }));
            expect(wireEls(container)).toEqual(drawn);
            act(() => {
                vi.advanceTimersByTime(FOLD_MS / 2);
            });
            // Past the fold's own end time the unfold is still easing, and still nothing moves.
            expect(wireEls(container)).toEqual(drawn);
            act(() => {
                vi.advanceTimersByTime(FOLD_MS);
            });
            expect(wireEls(container).map(motionOf)).toEqual([null, null, null]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('folds at once, with no motion, under reduced motion', () => {
        const original = window.matchMedia;
        window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
        try {
            const container = wired();
            fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
            expect(shown('A')).toBe(false);
            // The wires snap to their new routes: no easing, no fade, and the inside wire is gone at once.
            expect(wireEls(container)).toHaveLength(2);
            expect(wireEls(container).map(motionOf)).toEqual([null, null]);
            expect(wireEls(container).some((wire) => wire.getAttribute('style'))).toBe(false);
        } finally {
            window.matchMedia = original;
        }
    });

    // Reduced motion turns every transition and animation in the graph off: each rule that moves something must be
    // switched off in the reduced-motion block. Checked on the stylesheet, as jsdom applies no media queries.
    it('switches off every transition and animation under reduced motion', () => {
        const graphCss = readFileSync('src/features/viewer/workflowGraph/workflowGraph.css', 'utf8');
        const reducedAt = graphCss.indexOf('@media (prefers-reduced-motion: reduce)');
        expect(reducedAt).toBeGreaterThan(0);
        const reduced = graphCss.slice(reducedAt);
        const switchedOff = new Set(
            [...reduced.matchAll(/([^{}]+)\{\s*(?:transition|animation):\s*none;/g)].flatMap((match) =>
                match[1].split(',').map((selector) => selector.trim())
            )
        );
        const moving = [...graphCss.slice(0, reducedAt).matchAll(/([^{}]+)\{([^}]*)\}/g)]
            .filter((match) => /(?:^|;|\s)(?:transition|animation):/.test(match[2]) && !/(?:transition|animation):\s*none/.test(match[2]))
            .flatMap((match) => match[1].split(',').map((selector) => selector.trim()))
            .filter((selector) => selector.startsWith('.'));
        expect(moving.length).toBeGreaterThan(5);
        // Toolbar hover colours are not motion: they change colour in place.
        const hoverOnly = new Set(['.wg-tbtn', '.wg-seg button']);
        for (const selector of moving) if (!hoverOnly.has(selector)) expect(switchedOff, selector).toContain(selector);
    });

    // The owner's pick: every group title is a pill inside its group's top band, drawn over the nodes.
    it('draws every group title as a pill in its top band, over the nodes', () => {
        const stacked = report(
            level(
                [canvasNode('top', { title: 'Above', pos: { x: 20, y: 60 }, size: { width: 200, height: 200 } })],
                [],
                [canvasGroup('Upper', 0, 0, 400, 150), canvasGroup('Lower', 0, 250, 400, 150)]
            )
        );
        const { container } = render(
            <WorkflowGraphView report={stacked} fileName="stacked.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />
        );
        const world = screen.getByTestId('workflow-graph-world');
        const order = Array.from(world.children);
        const [upper, lower] = Array.from(container.querySelectorAll<HTMLElement>('.wg-gtitle'));
        const node = container.querySelector('[data-node-id="top"]');
        expect(upper.textContent).toContain('Upper');
        expect(lower.textContent).toContain('Lower');
        const at = (pill: HTMLElement) => /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(pill.style.transform)!.slice(1).map(Number);
        // Each pill is inside its own group's top band, never above the group's edge.
        expect(at(upper)[1]).toBe(6);
        expect(at(lower)[1]).toBe(256);
        for (const pill of [upper, lower]) expect(order.indexOf(pill)).toBeGreaterThan(order.indexOf(node!));
        // Only the group's right inset caps a title, never the measured text width: a short measurement (seen on
        // Lily while the web font loaded) cut "Group" to "Gro…".
        for (const pill of [upper, lower]) expect(at(pill)[0] + parseFloat(pill.style.maxWidth)).toBe(394);
    });

    // At the switch the far pill must sit exactly where the near pill does, or it slides during the cross-fade. Both
    // stay at the group's top-left over the nodes: the owner read a pill sliding to dodge a node as inconsistent.
    it('places the far pill where the near pill is at the switch, at the top-left over a node in the band', () => {
        const root = level(
            [canvasNode('n', { title: 'Loader', pos: { x: 20, y: 20 }, size: { width: 200, height: 120 } })],
            [],
            [canvasGroup('Sampling', 0, 0, 600, 300)]
        );
        const { container } = render(
            <WorkflowGraphView report={report(root)} fileName="band.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />
        );
        const pill = container.querySelector<HTMLElement>('.wg-gtitle')!;
        const [nearX, nearY] = /translate\(([\d.]+)px, ([\d.]+)px\)/.exec(pill.style.transform)!.slice(1).map(Number);
        // A node sits in the band, and the pill stays at the corner over it.
        expect([nearX, nearY]).toEqual([6, 6]);

        const model = buildGraphModel(root);
        const positions = savedPositions(model);
        const scene = sceneFor(model, 'saved', new Set());
        const far = farSceneFor(model, positions, new Set(), new Set(), scene, wirePaths(model, positions, new Set(), scene, 'bundled'));
        // The near view's fallback measure in tests: an average glyph is 0.6 of the font size.
        const measure = (text: string, px: number) => text.length * px * 0.6;
        const [label] = layoutGroupLabels({ groups: far.groups }, FAR_SCALE, 'far', measure);
        expect(label.rect.x).toBeCloseTo(nearX);
        expect(label.rect.y).toBeCloseTo(nearY);
    });

    // A narrow pill or a folded box gives its room to the title first: the count goes before the title is cut
    // (the smoke on 152349 showed "Step1 - L… 2 nodes" and a folded "Step1 - Load mo…").
    it('drops the node count, not the title, where a group label is short of room', () => {
        const title = 'Step1 - Load models';
        const members = [
            canvasNode('a', { title: 'CLIPLoader', pos: { x: 20, y: 60 }, size: { width: 80, height: 40 } }),
            canvasNode('b', { title: 'VAELoader', pos: { x: 20, y: 140 }, size: { width: 80, height: 40 } }),
        ];
        const labels = (width: number) => {
            const { container, unmount } = render(
                <WorkflowGraphView
                    report={report(level(members, [], [canvasGroup(title, 0, 0, width, 220)]))}
                    fileName="narrow.png"
                    onClose={vi.fn()}
                    makeLayoutWorker={fakeWorker}
                />
            );
            const pill = container.querySelector('.wg-gtitle')!;
            const result = { title: pill.querySelector('.wg-gt')?.textContent, count: pill.querySelector('.wg-gn')?.textContent ?? null };
            fireEvent.click(screen.getByRole('button', { name: `Fold group ${title}` }));
            const box = container.querySelector('.wg-group.shut')!;
            const folded = { title: box.querySelector('.wg-gt')?.textContent, count: box.querySelector('.wg-gn')?.textContent ?? null };
            unmount();
            return { pill: result, folded };
        };
        // A wide group has room for both.
        expect(labels(400).pill).toEqual({ title, count: '2 nodes' });
        // A narrow one keeps the whole title and drops the count, open and folded alike.
        const narrow = labels(230);
        expect(narrow.pill).toEqual({ title, count: null });
        expect(narrow.folded).toEqual({ title, count: null });
    });

    // A graph too wide for the usual 12 % limit opens showing all of it, and zooming out reaches that view again.
    it('opens a very wide graph fitted below 12 % and lets zoom-out reach it', () => {
        const wide = report(level([canvasNode('a', { pos: { x: 0, y: 30 } }), canvasNode('b', { pos: { x: 40_000, y: 30 } })]));
        render(<WorkflowGraphView report={wide} fileName="wide.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
        const world = screen.getByTestId('workflow-graph-world');
        const scale = () => Number(/scale\(([\d.e-]+)\)/.exec(world.style.transform)?.[1]);
        const opened = scale();
        expect(opened).toBeLessThan(MIN_SCALE);
        expect(opened).toBeGreaterThanOrEqual(LOWEST_SCALE);
        fireEvent.keyDown(document.body, { key: '+' });
        for (let i = 0; i < 30; i++) fireEvent.keyDown(document.body, { key: '-' });
        expect(scale()).toBeCloseTo(opened, 6);
    });

    // Zooming out toward far mode fades the body text through the world's data-detail step, before the switch.
    it('fades node body text in steps as the view zooms toward far mode', () => {
        renderGraph();
        const world = screen.getByTestId('workflow-graph-world');
        const scale = () => Number(/scale\(([\d.e-]+)\)/.exec(world.style.transform)?.[1]);
        const graphCss = readFileSync('src/features/viewer/workflowGraph/workflowGraph.css', 'utf8');
        const seen: string[] = [];
        for (let i = 0; i < 14 && !world.classList.contains('far'); i++) {
            fireEvent.keyDown(document.body, { key: '-' });
            const detail = world.dataset.detail ?? '';
            if (scale() < DETAIL_FADE_SCALE && !world.classList.contains('far')) seen.push(detail);
        }
        expect(seen.length).toBeGreaterThan(0);
        // Fading, not yet gone: the near view still shows a trace of the text there, and the stylesheet dims it.
        for (const detail of seen) {
            expect(Number(detail)).toBeLessThan(DETAIL_STEPS);
            expect(Number(detail)).toBeGreaterThan(0);
            expect(graphCss).toMatch(new RegExp(`\\.wg-world\\[data-detail='${detail}'\\] \\.wg-nb \\{\\s*opacity: 0\\.\\d+;`));
        }
        expect(world.classList.contains('far')).toBe(true);
    });

    // Far mode shows no controls, so keyboard focus on a fold button there zooms in to what it folds.
    it('zooms in to a node or group when its fold button gets focus in far mode', () => {
        const original = window.matchMedia;
        window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
        try {
            renderGraph();
            const world = screen.getByTestId('workflow-graph-world');
            const zoomOut = () => {
                for (let i = 0; i < 14; i++) fireEvent.keyDown(document.body, { key: '-' });
                expect(world.classList.contains('far')).toBe(true);
            };
            zoomOut();
            act(() => screen.getByRole('button', { name: 'Fold Decode' }).focus());
            expect(world.classList.contains('far')).toBe(false);
            expect(world.style.transform).toMatch(/scale\(1\)$/);
            // Focus moving within near mode leaves the view alone.
            const near = world.style.transform;
            act(() => screen.getByRole('button', { name: 'Fold group Sampling' }).focus());
            expect(world.style.transform).toBe(near);
            zoomOut();
            act(() => screen.getByRole('button', { name: 'Fold Decode' }).focus());
            act(() => screen.getByRole('button', { name: 'Fold group Sampling' }).focus());
            expect(world.classList.contains('far')).toBe(false);
        } finally {
            window.matchMedia = original;
        }
    });
    // The owner's ask at Fit on Lily: a group's title pill takes the view to that group. One click (or Enter on the
    // title) fits the group, a drag that starts on the pill still pans, and the fold button in it still folds.
    describe('a click on a group’s title pill', () => {
        const root = level(
            [
                canvasNode('1', { title: 'Load', pos: { x: 20, y: 80 }, outputs: [port(0, 'LATENT')] }),
                canvasNode('2', { title: 'Decode', pos: { x: 900, y: 600 }, inputs: [port(0, 'LATENT')] }),
            ],
            [canvasLink('1', 0, '2', 0)],
            [canvasGroup('Sampling', 0, 0, 300, 300)]
        );
        const sampling = buildGraphModel(root).groups[0];
        const viewOf = ({ x, y, s }: { x: number; y: number; s: number }) => `translate(${x}px, ${y}px) scale(${s})`;
        // jsdom's canvas has no size, so the view fits to the window, 1024 × 768.
        const groupFit = viewOf(fitView(groupBox(sampling, false), { w: window.innerWidth, h: window.innerHeight }));
        const withReducedMotion = (run: () => void) => {
            const original = window.matchMedia;
            window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
            try {
                run();
            } finally {
                window.matchMedia = original;
            }
        };
        const renderRoot = () =>
            render(<WorkflowGraphView report={report(root)} fileName="pill.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);

        it('fits the view to that group, from a click on the pill or Enter on its title', () => {
            withReducedMotion(() => {
                const { container } = renderRoot();
                const world = screen.getByTestId('workflow-graph-world');
                // The whole graph's fit is not the group's, so the zoom is to the group.
                expect(world.style.transform).not.toBe(groupFit);
                fireEvent.click(container.querySelector('.wg-gtitle')!, { detail: 1 });
                expect(world.style.transform).toBe(groupFit);
                fireEvent.keyDown(document.body, { key: '-' });
                expect(world.style.transform).not.toBe(groupFit);
                // The title is a named button, so Tab reaches it and Enter clicks it (a click with no press, detail 0).
                fireEvent.click(screen.getByRole('button', { name: 'Zoom to group Sampling' }), { detail: 0 });
                expect(world.style.transform).toBe(groupFit);
            });
        });

        it('folds, without zooming, from the fold button in the pill', () => {
            withReducedMotion(() => {
                renderRoot();
                const world = screen.getByTestId('workflow-graph-world');
                const before = world.style.transform;
                fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }), { detail: 1 });
                expect(screen.getByRole('button', { name: 'Unfold group Sampling' })).toBeTruthy();
                expect(world.style.transform).toBe(before);
            });
        });

        it('pans, without zooming, when a drag starts on the pill', () => {
            const frames: FrameRequestCallback[] = [];
            const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
            try {
                withReducedMotion(() => {
                    renderRoot();
                    const world = screen.getByTestId('workflow-graph-world');
                    const before = world.style.transform;
                    const title = screen.getByRole('button', { name: 'Zoom to group Sampling' });
                    fireEvent.pointerDown(title, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
                    fireEvent.pointerMove(title, { pointerId: 1, clientX: 140, clientY: 130 });
                    fireEvent.pointerUp(title, { pointerId: 1, clientX: 140, clientY: 130 });
                    fireEvent.click(title, { detail: 1 });
                    act(() => frames.splice(0).forEach((frame) => frame(performance.now())));
                    expect(world.style.transform).not.toBe(groupFit);
                    expect(world.style.transform).not.toBe(before);
                    // The next press starts afresh: a plain click zooms.
                    fireEvent.pointerDown(title, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
                    fireEvent.pointerUp(title, { pointerId: 2, clientX: 100, clientY: 100 });
                    fireEvent.click(title, { detail: 1 });
                    expect(world.style.transform).toBe(groupFit);
                });
            } finally {
                raf.mockRestore();
            }
        });

        // Far mode draws the pills on a canvas, so the view hit-tests the rects it drew.
        it('zooms to the group from its pill on the far canvas, with a pointer cursor over it', () => {
            const font = { value: '' };
            const ctx = new Proxy(
                {},
                {
                    get: (_target, key) =>
                        key === 'measureText'
                            ? (text: string) => ({ width: text.length * Number(/([\d.]+)px/.exec(font.value)?.[1] ?? 10) * 0.6 })
                            : () => undefined,
                    set: (_target, key, value) => {
                        if (key === 'font') font.value = String(value);
                        return true;
                    },
                }
            );
            vi.stubGlobal(
                'Path2D',
                class {
                    roundRect() {}
                    rect() {}
                    moveTo() {}
                    lineTo() {}
                    bezierCurveTo() {}
                    addPath() {}
                    closePath() {}
                }
            );
            const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
            const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
            try {
                withReducedMotion(() => {
                    const { container } = renderRoot();
                    const world = screen.getByTestId('workflow-graph-world');
                    const canvas = container.ownerDocument.querySelector<HTMLElement>('.wg-canvas')!;
                    const fitted = viewOf(fitView(groupBox(sampling, false), { w: 1024, h: 768 }));
                    for (let i = 0; i < 14 && !world.classList.contains('far'); i++) fireEvent.keyDown(document.body, { key: '-' });
                    expect(world.classList.contains('far')).toBe(true);
                    const [x, y, s] = /translate\(([\d.e-]+)px, ([\d.e-]+)px\) scale\(([\d.e-]+)\)/
                        .exec(world.style.transform)!
                        .slice(1)
                        .map(Number);
                    // A point a little in from the group's top-left corner on screen: the pill sits 6 px in.
                    const onPill = { clientX: x + sampling.x * s + 12, clientY: y + sampling.y * s + 12 };
                    fireEvent.pointerMove(canvas, { pointerId: 1, ...onPill });
                    expect(canvas.classList.contains('on-pill')).toBe(true);
                    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 1000, clientY: 700 });
                    expect(canvas.classList.contains('on-pill')).toBe(false);
                    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, ...onPill });
                    fireEvent.pointerUp(canvas, { pointerId: 1, ...onPill });
                    expect(world.style.transform).toBe(fitted);
                    // Back in near mode the canvas has no pill under the pointer.
                    expect(canvas.classList.contains('on-pill')).toBe(false);
                });
            } finally {
                context.mockRestore();
                box.mockRestore();
                vi.unstubAllGlobals();
            }
        });
    });
});
