import { readFileSync } from 'node:fs';
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGlobalShortcuts } from '../../../../hooks/useGlobalShortcuts';
import { createDefaultAppSettings } from '../../../../constants/defaultSettings';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { useWorkflowGraphStore } from '../../../../stores/workflowGraphStore';
import { useViewerKeyboard } from '../../hooks/useViewerKeyboard';
import { WIRE_DRAW_LIMIT } from '../entrance';
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
    nodeHeight,
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

/** Canvas 2D contexts and Path2D, which jsdom lacks: every call is a mock, kept per canvas. */
const fakeCanvases = () => {
    vi.stubGlobal(
        'Path2D',
        class {
            roundRect() {}
            rect() {}
            moveTo() {}
            lineTo() {}
            bezierCurveTo() {}
            quadraticCurveTo() {}
            arcTo() {}
            addPath() {}
            closePath() {}
        }
    );
    const contexts = new Map<HTMLCanvasElement, Record<string | symbol, unknown>>();
    const makeContext = () =>
        new Proxy({} as Record<string | symbol, unknown>, {
            get(target, key) {
                if (!(key in target)) target[key] = key === 'measureText' ? vi.fn(() => ({ width: 10 })) : vi.fn();
                return target[key];
            },
            set(target, key, value) {
                target[key] = value;
                return true;
            },
        });
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
        let context = contexts.get(this);
        if (!context) {
            context = makeContext();
            contexts.set(this, context);
        }
        return context as unknown as CanvasRenderingContext2D;
    } as unknown as HTMLCanvasElement['getContext']);
    const restore = () => {
        spy.mockRestore();
        vi.unstubAllGlobals();
    };
    return { contexts, restore };
};

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

    // The source is told in words on the right of the bar, with the level's counts.
    it('names the source with the counts, and says when the workflow is only partly shown', () => {
        const two = level([canvasNode('1'), canvasNode('2')], [canvasLink('1', 0, '2', 0)]);
        const { unmount } = render(
            <WorkflowGraphView report={report(two)} fileName="a.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />
        );
        expect(document.querySelector('.wg-facts')?.textContent).toBe('ComfyUI · 2 nodes · 1 wire');
        unmount();
        render(
            <WorkflowGraphView
                report={report(two, { source: 'api_prompt', truncated: true })}
                fileName="b.png"
                onClose={vi.fn()}
                makeLayoutWorker={fakeWorker}
            />
        );
        const badge = screen.getByText('Partly shown');
        expect(badge.getAttribute('title')).toMatch(/part of it is not shown/);
        expect(document.querySelector('.wg-count')?.textContent).toBe('ComfyUI API prompt · 2 nodes · 1 wire');
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
        // The map's fold button is the last control in the layer.
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide the map' }));
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

    // Outside near view the HTML is unseen, so nothing in it may take Tab focus (it used to land on hidden fold
    // buttons). Focus already in it moves to the canvas, where the arrow keys carry on.
    it('takes the hidden HTML out of the Tab order outside near view, moving focus in it to the canvas', () => {
        renderGraph();
        const world = screen.getByTestId('workflow-graph-world');
        const fold = screen.getByRole('button', { name: 'Fold group Sampling' });
        act(() => fold.focus());
        for (let i = 0; i < 14; i++) fireEvent.keyDown(document.body, { key: '-' });
        expect(world.classList.contains('far')).toBe(true);
        expect(world.hasAttribute('inert')).toBe(true);
        expect(document.activeElement).toBe(screen.getByRole('application', { name: 'Workflow canvas' }));
        for (let i = 0; i < 14; i++) fireEvent.keyDown(document.body, { key: '+' });
        expect(world.hasAttribute('inert')).toBe(false);
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
    // P3a: reading the graph. The side panel, the search, subgraph levels and the arrow keys.
    describe('reading the graph', () => {
        const root = level(
            [
                canvasNode('1', { title: 'Load', pos: { x: 20, y: 80 }, outputs: [port(0, 'LATENT')], rawJson: '{"id":1}' }),
                canvasNode('2', {
                    title: 'Decode',
                    nodeType: 'VAEDecode',
                    pos: { x: 400, y: 80 },
                    inputs: [port(0, 'LATENT')],
                    widgets: [{ name: null, value: 'tiled', isLongText: false }],
                }),
                canvasNode('3', { title: 'Stage', kind: 'subgraph', subgraphId: 'def', pos: { x: 400, y: 400 } }),
                canvasNode('4', {
                    title: 'Read me',
                    kind: 'note',
                    nodeType: 'MarkdownNote',
                    pos: { x: 800, y: 80 },
                    widgets: [{ name: null, value: '**Bold** [link](https://example.com)', isLongText: true }],
                }),
                canvasNode('5', {
                    title: 'Plain',
                    kind: 'note',
                    nodeType: 'Note',
                    pos: { x: 800, y: 400 },
                    widgets: [{ name: null, value: '**not bold**', isLongText: true }],
                }),
            ],
            [canvasLink('1', 0, '2', 0)],
            [canvasGroup('Sampling', 0, 0, 300, 300)]
        );
        const withSubgraph = report(root, {
            subgraphs: [{ id: 'def', name: 'Upscale stage', level: level([canvasNode('u1', { title: 'Inner', pos: { x: 0, y: 30 } })]) }],
            selectedOutputPaths: [['2']],
        });
        const renderReading = (onClose = vi.fn()) => {
            const view = render(
                <WorkflowGraphView report={withSubgraph} fileName="read.png" onClose={onClose} makeLayoutWorker={fakeWorker} />
            );
            return { ...view, onClose };
        };
        const nodeElement = (id: string) => document.querySelector<HTMLElement>(`.wg-world [data-node-id="${id}"]`)!;
        const click = (element: Element) => {
            fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
            fireEvent.pointerUp(element, { pointerId: 1, clientX: 10, clientY: 10 });
        };
        const panel = () => document.querySelector('.wg-panel');
        const canvas = () => screen.getByRole('application', { name: 'Workflow canvas' });
        const announced = () => screen.getByTestId('graph-announcer').textContent;
        const escape = (target: Element = document.body) => fireEvent.keyDown(target, { key: 'Escape' });

        it('opens the side panel from a click on a node, and closes it from empty space', () => {
            renderReading();
            click(nodeElement('1'));
            expect(panel()?.getAttribute('aria-label')).toBe('Node Load');
            expect(nodeElement('1').classList.contains('sel')).toBe(true);
            click(canvas());
            expect(panel()).toBeNull();
        });

        it('goes to the other node from a wire row in the panel, and selects it', () => {
            renderReading();
            click(nodeElement('1'));
            fireEvent.click(screen.getByRole('button', { name: /^latent to Decode/ }));
            expect(panel()?.getAttribute('aria-label')).toBe('Node Decode');
            expect(nodeElement('2').classList.contains('sel')).toBe(true);
        });

        // Escape steps back one thing at a time, so it never throws away more than the user meant.
        it('steps back with Escape: the search, the panel, the subgraph level, then the graph', () => {
            const { onClose } = renderReading();
            fireEvent.click(screen.getByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' }));
            expect(screen.getByRole('navigation', { name: 'Workflow levels' }).textContent).toContain('Upscale stage');
            expect(shown('Inner')).toBe(true);
            click(nodeElement('u1'));
            fireEvent.keyDown(document.body, { key: '/' });
            const box = screen.getByRole('combobox', { name: 'Find a node or value' });
            fireEvent.change(box, { target: { value: 'inner' } });
            escape(box);
            expect((box as HTMLInputElement).value).toBe('');
            expect(panel()).not.toBeNull();
            escape();
            expect(panel()).toBeNull();
            expect(shown('Inner')).toBe(true);
            escape();
            expect(shown('Inner')).toBe(false);
            expect(screen.getByRole('navigation', { name: 'Workflow levels' }).querySelector('[aria-current]')?.textContent).toBe(
                'read.png'
            );
            expect(onClose).not.toHaveBeenCalled();
            escape();
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('keeps a level’s folds while a subgraph is open, and goes back from the breadcrumb', () => {
            renderReading();
            fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
            fireEvent.click(screen.getByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' }));
            expect(shown('Load')).toBe(false);
            fireEvent.click(screen.getByRole('button', { name: 'read.png' }));
            expect(screen.getByRole('button', { name: 'Unfold group Sampling' })).toBeTruthy();
        });

        // The owner's pick: a row under the subgraph's body says what opening it leads to.
        it('opens a subgraph from the row under its body, which counts the nodes inside', () => {
            renderReading();
            const row = screen.getByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' });
            expect(row.classList.contains('wg-door')).toBe(true);
            expect(row.textContent).toBe('Open subgraph · 1 node inside');
            fireEvent.click(row);
            expect(shown('Inner')).toBe(true);
            expect(screen.getByRole('navigation', { name: 'Workflow levels' }).querySelector('[aria-current]')?.textContent).toBe(
                'Upscale stage'
            );
        });

        it('hides the open row with the body when the subgraph node is folded', () => {
            renderReading();
            fireEvent.click(screen.getByRole('button', { name: 'Fold Upscale stage' }));
            expect(screen.queryByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' })).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Unfold Upscale stage' }));
            expect(screen.getByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' })).toBeTruthy();
        });

        // A row that cannot open would be a dead control.
        it('shows no open row for a subgraph the report has no definition for', () => {
            const missing = report(level([canvasNode('3', { title: 'Lost', kind: 'subgraph', subgraphId: 'gone', pos: { x: 0, y: 30 } })]));
            render(<WorkflowGraphView report={missing} fileName="lost.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
            expect(shown('Lost')).toBe(true);
            expect(document.querySelector('.wg-door')).toBeNull();
        });

        // The top bar is one path from the image down: the file name is its first step, and goes back up.
        it('starts the path with the file name, which goes back up from inside a subgraph', () => {
            renderReading();
            const levels = () => screen.getByRole('navigation', { name: 'Workflow levels' });
            expect(levels().querySelector('[aria-current]')?.textContent).toBe('read.png');
            expect(levels().querySelector('button')).toBeNull();
            fireEvent.click(screen.getByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' }));
            expect(levels().textContent).toBe('read.pngUpscale stage');
            fireEvent.click(screen.getByRole('button', { name: 'read.png' }));
            expect(shown('Load')).toBe(true);
            expect(levels().querySelector('[aria-current]')?.textContent).toBe('read.png');
        });

        // A level's Tidy layout is kept like its folds: going back up shows it at once, as the user left it, with no
        // new layout run (up to 10 s on a large root) and no glide or refit that would throw away their view.
        it('keeps a level’s Tidy layout and view while a subgraph is open, with no new layout run', async () => {
            const made: FakeLayoutWorker[] = [];
            const countingWorker = () => {
                const worker = new FakeLayoutWorker();
                made.push(worker);
                return worker as unknown as Worker;
            };
            render(<WorkflowGraphView report={withSubgraph} fileName="read.png" onClose={vi.fn()} makeLayoutWorker={countingWorker} />);
            fireEvent.click(screen.getByRole('button', { name: 'Tidy' }));
            await waitFor(() => expect(shown('Sampling')).toBe(false));
            const world = screen.getByTestId('workflow-graph-world');
            fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
            const left = world.style.transform;
            expect(made).toHaveLength(1);

            fireEvent.click(screen.getByRole('button', { name: /^Open subgraph/ }));
            fireEvent.click(screen.getByRole('button', { name: 'read.png' }));
            await act(async () => {
                await Promise.resolve();
            });

            expect(made).toHaveLength(1);
            expect(screen.getByRole('button', { name: 'Tidy' }).getAttribute('aria-pressed')).toBe('true');
            expect(shown('Sampling')).toBe(false);
            const back = screen.getByTestId('workflow-graph-world');
            expect(back.classList.contains('moving')).toBe(false);
            expect(back.style.transform).toBe(left);
        });

        it('finds nodes with "/", dims the rest, and opens the one picked', () => {
            renderReading();
            fireEvent.keyDown(document.body, { key: '/' });
            const box = screen.getByRole('combobox', { name: 'Find a node or value' });
            expect(document.activeElement).toBe(box);
            fireEvent.change(box, { target: { value: 'TILED' } });
            expect(nodeElement('2').classList.contains('hit')).toBe(true);
            expect(nodeElement('1').classList.contains('miss')).toBe(true);
            expect(screen.getByTestId('workflow-graph-world').hasAttribute('data-searching')).toBe(true);
            expect(screen.getByRole('option').textContent).toContain('Decode');
            fireEvent.keyDown(box, { key: 'Enter' });
            expect(panel()?.getAttribute('aria-label')).toBe('Node Decode');
            expect((box as HTMLInputElement).value).toBe('');
            expect(nodeElement('1').classList.contains('miss')).toBe(false);
        });

        it('unfolds the group a picked node is folded into', () => {
            renderReading();
            fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
            fireEvent.keyDown(document.body, { key: '/' });
            const box = screen.getByRole('combobox', { name: 'Find a node or value' });
            fireEvent.change(box, { target: { value: 'load' } });
            fireEvent.keyDown(box, { key: 'Enter' });
            expect(screen.getByRole('button', { name: 'Fold group Sampling' })).toBeTruthy();
            expect(panel()?.getAttribute('aria-label')).toBe('Node Load');
        });

        // The canvas is one Tab stop; the arrows move between nodes along the wires and Enter opens one.
        it('moves between nodes with the arrow keys from the canvas, saying where it is', () => {
            renderReading();
            act(() => canvas().focus());
            // It starts on the image's output node.
            expect(nodeElement('2').classList.contains('kf')).toBe(true);
            expect(announced()).toBe('Decode, VAEDecode');
            fireEvent.keyDown(canvas(), { key: 'ArrowLeft' });
            expect(nodeElement('1').classList.contains('kf')).toBe(true);
            expect(nodeElement('2').classList.contains('kf')).toBe(false);
            expect(announced()).toBe('Load, KSampler');
            fireEvent.keyDown(canvas(), { key: 'ArrowUp' });
            expect(announced()).toBe('No node above');
            expect(nodeElement('1').classList.contains('kf')).toBe(true);
            fireEvent.keyDown(canvas(), { key: 'Enter' });
            expect(panel()?.getAttribute('aria-label')).toBe('Node Load');
            act(() => screen.getByRole('button', { name: 'Back to image' }).focus());
            expect(nodeElement('1').classList.contains('kf')).toBe(false);
        });

        it('opens a subgraph with a second Enter, and comes back to it with Escape', () => {
            renderReading();
            act(() => canvas().focus());
            fireEvent.keyDown(canvas(), { key: 'ArrowDown' });
            // The instance is named by its definition, as the breadcrumb names it.
            expect(announced()).toBe('Upscale stage, KSampler');
            fireEvent.keyDown(canvas(), { key: 'Enter' });
            expect(panel()?.getAttribute('aria-label')).toBe('Node Upscale stage');
            expect(within(panel() as HTMLElement).getByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' })).toBeTruthy();
            fireEvent.keyDown(canvas(), { key: 'Enter' });
            expect(shown('Inner')).toBe(true);
            expect(document.activeElement).toBe(canvas());
            escape();
            expect(shown('Inner')).toBe(false);
            expect(document.activeElement).toBe(canvas());
            expect(nodeElement('3').classList.contains('kf')).toBe(true);
        });

        it('keeps the nodes’ own buttons out of the Tab order, and names the canvas for screen readers', () => {
            renderReading();
            expect(screen.getByRole('button', { name: 'Fold Load' }).tabIndex).toBe(-1);
            expect(screen.getByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' }).tabIndex).toBe(-1);
            expect(canvas().tabIndex).toBe(0);
            expect(document.getElementById(canvas().getAttribute('aria-describedby')!)?.textContent).toMatch(/Arrow keys/);
        });

        it('reads a MarkdownNote as markdown, with no link, and a plain Note as written', () => {
            renderReading();
            expect(nodeElement('4').querySelector('strong')?.textContent).toBe('Bold');
            expect(nodeElement('4').querySelector('a')).toBeNull();
            expect(nodeElement('5').textContent).toContain('**not bold**');
        });

        it('shows a value the file does not name on its own, with no made-up name', () => {
            renderReading();
            const row = nodeElement('2').querySelector('.wg-wg.bare');
            expect(row?.textContent).toBe('tiled');
            expect(row?.getAttribute('title')).toBe('The file does not name this setting.');
            expect(shown('Value 1')).toBe(false);
        });
    });

    // The planner's condition: "/" opens the graph's search and nothing else, and typing in it reaches neither the
    // viewer's keys nor the app's shortcuts.
    describe('keyboard ownership with the search box', () => {
        const Harness: React.FC<{ onViewerKey: (event: KeyboardEvent) => void; appSearch: React.RefObject<HTMLInputElement | null> }> = ({
            onViewerKey,
            appSearch,
        }) => {
            useViewerKeyboard({ onKeyDown: onViewerKey });
            useGlobalShortcuts({ ...appShortcuts, isViewerOpen: true, searchInputRef: appSearch });
            return (
                <>
                    <input ref={appSearch} aria-label="Library search" />
                    <WorkflowGraphView report={graph} fileName="render.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />
                </>
            );
        };
        const appShortcuts = {
            setSelectedImageIndex: vi.fn(),
            setSelectedIds: vi.fn(),
            setLastSelectedId: vi.fn(),
            clearSelection: vi.fn(),
            handleBulkDelete: vi.fn(),
            togglePrivacyMode: vi.fn(),
            toggleMasking: vi.fn(),
            toggleFavorite: vi.fn(),
            togglePin: vi.fn(),
            openCollection: vi.fn(),
            openSettings: vi.fn(),
            openImport: vi.fn(),
            closeAllModals: vi.fn(),
            toggleShortcuts: vi.fn(),
            toggleCommandPalette: vi.fn(),
            viewMode: 'grid' as const,
            selectedIds: new Set<string>(),
            filteredImages: [],
            lastSelectedId: null,
            gridRef: { current: null },
            isModalOpen: false,
        };

        it('focuses the graph’s search on "/", never the app’s, and keeps typed keys from the viewer and app', () => {
            const onViewerKey = vi.fn();
            const appSearch = React.createRef<HTMLInputElement>();
            render(<Harness onViewerKey={onViewerKey} appSearch={appSearch} />);
            fireEvent.keyDown(document.body, { key: '/' });
            const box = screen.getByRole('combobox', { name: 'Find a node or value' });
            expect(document.activeElement).toBe(box);
            expect(document.activeElement).not.toBe(appSearch.current);
            for (const key of ['Delete', 'Backspace', 'f', ' ', 'ArrowRight', 'ArrowLeft', 'p', 'i', 'z', '?', 'h'])
                fireEvent.keyDown(box, { key });
            fireEvent.keyDown(box, { key: 'f', ctrlKey: true });
            fireEvent.keyDown(box, { key: 'k', ctrlKey: true });
            expect(onViewerKey).not.toHaveBeenCalled();
            for (const [name, action] of Object.entries(appShortcuts))
                if (typeof action === 'function') expect(action, name).not.toHaveBeenCalled();
            expect(document.activeElement).not.toBe(appSearch.current);
        });
    });

    // On the far canvas a node is a painted box, so the view hit-tests the boxes it drew.
    it('opens a node from a click on the far canvas, and rings it there', () => {
        const strokes: string[] = [];
        const ctx = new Proxy(
            {},
            {
                get: (target: Record<string, unknown>, key) =>
                    key === 'measureText'
                        ? (text: string) => ({ width: text.length * 6 })
                        : key === 'stroke'
                          ? () => strokes.push(String(target.strokeStyle))
                          : key in target
                            ? target[key as string]
                            : () => undefined,
                set: (target: Record<string, unknown>, key, value) => {
                    target[key as string] = value;
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
            renderGraph();
            const world = screen.getByTestId('workflow-graph-world');
            const canvasElement = document.querySelector<HTMLElement>('.wg-canvas')!;
            for (let i = 0; i < 14 && !world.classList.contains('far'); i++) fireEvent.keyDown(document.body, { key: '-' });
            expect(world.classList.contains('far')).toBe(true);
            const [x, y, s] = /translate\(([\d.e-]+)px, ([\d.e-]+)px\) scale\(([\d.e-]+)\)/
                .exec(world.style.transform)!
                .slice(1)
                .map(Number);
            const decode = savedPositions(buildGraphModel(graph.root)).get('2')!;
            const onDecode = { pointerId: 1, clientX: x + (decode.x + 100) * s, clientY: y + (decode.y + 60) * s };
            strokes.length = 0;
            fireEvent.pointerDown(canvasElement, { button: 0, ...onDecode });
            fireEvent.pointerUp(canvasElement, onDecode);
            expect(document.querySelector('.wg-panel')?.getAttribute('aria-label')).toBe('Node Decode');
            // The far palette's accent is read from the layer; jsdom has no custom properties, so it falls back.
            expect(strokes.length).toBeGreaterThan(0);
            fireEvent.pointerDown(canvasElement, { button: 0, pointerId: 2, clientX: 2, clientY: 2 });
            fireEvent.pointerUp(canvasElement, { pointerId: 2, clientX: 2, clientY: 2 });
            expect(document.querySelector('.wg-panel')).toBeNull();
        } finally {
            context.mockRestore();
            box.mockRestore();
            vi.unstubAllGlobals();
        }
    });

    // P3b: the Wires and Types menus, the map, and the view preferences they save.
    describe('wires, colours and the map', () => {
        const twoWires = report(
            level(
                [
                    canvasNode('1', { title: 'Sampler', pos: { x: 20, y: 80 }, outputs: [port(0, 'LATENT')] }),
                    canvasNode('2', { title: 'Decode', pos: { x: 400, y: 80 }, inputs: [port(0, 'LATENT')], outputs: [port(0, 'IMAGE')] }),
                    canvasNode('3', { title: 'Save', pos: { x: 800, y: 80 }, inputs: [port(0, 'IMAGE')] }),
                ],
                [canvasLink('1', 0, '2', 0, 'LATENT'), canvasLink('2', 0, '3', 0, 'IMAGE')]
            )
        );
        const prefs = () => useSettingsStore.getState().settings.workflowGraph;
        afterEach(() => useSettingsStore.setState({ settings: createDefaultAppSettings() }));
        const renderWires = (onClose = vi.fn()) => {
            const view = render(
                <WorkflowGraphView report={twoWires} fileName="wires.png" onClose={onClose} makeLayoutWorker={fakeWorker} />
            );
            return { ...view, onClose };
        };
        const wires = () => Array.from(document.querySelectorAll<SVGPathElement>('.wg-world .wg-wire'));
        const drawnWires = () => wires().filter((wire) => !wire.classList.contains('gone'));
        const pickNode = (id: string) => {
            const element = document.querySelector<HTMLElement>(`.wg-world [data-node-id="${id}"]`)!;
            fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
            fireEvent.pointerUp(element, { pointerId: 1, clientX: 10, clientY: 10 });
        };
        const openMenu = (name: 'Wires' | 'Types') => fireEvent.click(screen.getByRole('button', { name }));
        const choose = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

        it('opens with the saved defaults: bundled wires of normal width, quiet colours, the map shown', () => {
            renderWires();
            const layer = screen.getByRole('dialog', { name: 'Workflow graph' });
            expect(layer.getAttribute('data-wire-width')).toBe('normal');
            expect(layer.classList.contains('wire-familiar')).toBe(false);
            expect(drawnWires()).toHaveLength(2);
            expect(wires()[0].getAttribute('d')).toContain('Q');
            expect(screen.getByTestId('graph-map')).toBeTruthy();
        });

        it('draws and saves the wire shape and width chosen in the Wires menu', () => {
            renderWires();
            openMenu('Wires');
            choose(/^Straight/);
            expect(prefs()?.wireShape).toBe('straight');
            expect(wires()[0].getAttribute('d')).not.toMatch(/[CQ]/);
            expect(screen.getByRole('button', { name: /^Straight/ }).getAttribute('aria-pressed')).toBe('true');
            fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
            expect(prefs()?.wireWidth).toBe('thick');
            expect(screen.getByRole('dialog', { name: 'Workflow graph' }).getAttribute('data-wire-width')).toBe('thick');
        });

        // Hidden clears the canvas of wires but keeps the picked node's, so its connections can still be read.
        it('with Hidden wires, shows only the picked node’s wires, with moving dots on them', () => {
            renderWires();
            openMenu('Wires');
            choose(/^Hidden/);
            expect(drawnWires()).toHaveLength(0);
            pickNode('1');
            expect(drawnWires().map((wire) => wire.classList.contains('t-latent'))).toEqual([true]);
            expect(document.querySelectorAll('.wg-flow')).toHaveLength(1);
            pickNode('2');
            expect(drawnWires()).toHaveLength(2);
            expect(document.querySelectorAll('.wg-flow')).toHaveLength(2);
        });

        it('runs moving dots only on the picked node’s wires, and stops them when switched off', () => {
            renderWires();
            expect(document.querySelectorAll('.wg-flow')).toHaveLength(0);
            pickNode('3');
            expect(document.querySelectorAll('.wg-flow')).toHaveLength(1);
            openMenu('Wires');
            choose(/^Moving dots/);
            expect(prefs()?.movingDots).toBe(false);
            expect(document.querySelectorAll('.wg-flow')).toHaveLength(0);
        });

        it('lists the wire types here with their counts, and switches the colours', () => {
            renderWires();
            openMenu('Types');
            const rows = Array.from(document.querySelectorAll('.wg-mrow')).map((row) => row.textContent);
            expect(rows).toEqual(['IMAGE1', 'LATENT1']);
            // A click focuses the button in a browser; jsdom's click does not.
            const familiar = screen.getByRole('button', { name: /^Familiar/ });
            familiar.focus();
            fireEvent.click(familiar);
            expect(prefs()?.palette).toBe('familiar');
            expect(screen.getByRole('dialog', { name: 'Workflow graph' }).classList.contains('wire-familiar')).toBe(true);
            // The pick closes the menu and hands focus back to its button.
            expect(document.getElementById('wg-menu-types')).toBeNull();
            expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Types' }));
        });

        it('closes an open menu on the first Escape, before anything else', () => {
            const { onClose } = renderWires();
            openMenu('Wires');
            fireEvent.click(screen.getByRole('button', { name: 'Thin' }));
            fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
            expect(document.getElementById('wg-menu-wires')).toBeNull();
            expect(onClose).not.toHaveBeenCalled();
            fireEvent.keyDown(document.body, { key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('hides and shows the map with M or its fold button, and saves that', () => {
            renderWires();
            fireEvent.keyDown(document.body, { key: 'm' });
            expect(screen.queryByTestId('graph-map')).toBeNull();
            expect(prefs()?.showMap).toBe(false);
            fireEvent.click(screen.getByRole('button', { name: 'Show the map' }));
            expect(screen.getByTestId('graph-map')).toBeTruthy();
            expect(prefs()?.showMap).toBe(true);
        });

        // A drag on the map moves the view; it must not also start a pan of the canvas under it.
        it('moves the view to the point pressed on the map', async () => {
            renderWires();
            const world = screen.getByTestId('workflow-graph-world');
            const before = world.style.transform;
            const map = screen.getByTestId('graph-map');
            const box = vi.spyOn(map, 'getBoundingClientRect').mockReturnValue(new DOMRect(800, 600, 212, 132));
            try {
                fireEvent.pointerDown(map, { button: 0, pointerId: 7, clientX: 990, clientY: 720 });
                await waitFor(() => expect(world.style.transform).not.toBe(before));
                const moved = world.style.transform;
                fireEvent.pointerMove(map, { pointerId: 7, clientX: 810, clientY: 610 });
                await waitFor(() => expect(world.style.transform).not.toBe(moved));
                fireEvent.pointerUp(map, { pointerId: 7, clientX: 810, clientY: 610 });
                expect(document.querySelector('.wg-canvas')?.classList.contains('panning')).toBe(false);
            } finally {
                box.mockRestore();
            }
        });

        // jsdom has no 2D canvas: each canvas gets a context whose every call is a recorded no-op, and the far view's
        // paths get a Path2D.
        // The map and the menus sit over the canvas: a press on their frame, caption or rows is theirs, and must not
        // close the side panel, pan the graph or pick a node hidden under them.
        it('keeps a press on the map’s caption or frame from reaching the canvas, in near view', () => {
            renderWires();
            pickNode('2');
            const caption = document.querySelector('.wg-map .wg-cap')!;
            fireEvent.pointerDown(caption, { button: 0, pointerId: 3, clientX: 900, clientY: 700 });
            fireEvent.pointerUp(caption, { pointerId: 3, clientX: 900, clientY: 700 });
            expect(document.querySelector('.wg-panel')?.getAttribute('aria-label')).toBe('Node Decode');
            const frame = document.querySelector('.wg-map')!;
            fireEvent.pointerDown(frame, { button: 0, pointerId: 4, clientX: 900, clientY: 700 });
            fireEvent.pointerMove(frame, { pointerId: 4, clientX: 700, clientY: 500 });
            expect(document.querySelector('.wg-canvas')?.classList.contains('panning')).toBe(false);
            fireEvent.pointerUp(frame, { pointerId: 4, clientX: 700, clientY: 500 });
            expect(document.querySelector('.wg-panel')?.getAttribute('aria-label')).toBe('Node Decode');
        });

        it('keeps a press on the map or a menu row from picking or clearing a node, in far view', () => {
            const canvases = fakeCanvases();
            const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
            try {
                renderWires();
                pickNode('2');
                const world = screen.getByTestId('workflow-graph-world');
                for (let i = 0; i < 20 && !world.classList.contains('far'); i++) fireEvent.keyDown(document.body, { key: '-' });
                expect(world.classList.contains('far')).toBe(true);
                const press = (target: Element, pointerId: number) => {
                    fireEvent.pointerDown(target, { button: 0, pointerId, clientX: 900, clientY: 700 });
                    fireEvent.pointerUp(target, { pointerId, clientX: 900, clientY: 700 });
                };
                press(document.querySelector('.wg-map .wg-cap')!, 5);
                expect(document.querySelector('.wg-panel')?.getAttribute('aria-label')).toBe('Node Decode');
                openMenu('Types');
                press(document.querySelector('.wg-mrow')!, 6);
                expect(document.querySelector('.wg-panel')?.getAttribute('aria-label')).toBe('Node Decode');
            } finally {
                box.mockRestore();
                canvases.restore();
            }
        });

        // Far mode leaves the world unpainted; dots still animating there would cost frames for nothing.
        it('stops the moving dots in far view', () => {
            const graphCss = readFileSync('src/features/viewer/workflowGraph/workflowGraph.css', 'utf8');
            const farFlow = /\.wg-world\.far \.wg-flow\s*\{([^}]*)\}/.exec(graphCss)?.[1] ?? '';
            expect(farFlow).toMatch(/display:\s*none;/);
            expect(farFlow).toMatch(/animation:\s*none;/);
        });

        it('leaves M to the search box while it is being typed in', () => {
            renderWires();
            fireEvent.keyDown(document.body, { key: '/' });
            const search = screen.getByRole('combobox', { name: 'Find a node or value' });
            fireEvent.keyDown(search, { key: 'm' });
            expect(screen.getByTestId('graph-map')).toBeTruthy();
            expect(prefs()?.showMap).toBe(true);
        });

        // The viewer and the library have their own keys: the graph's M must not also reach them.
        it('keeps M from listeners added after it', () => {
            renderWires();
            const later = vi.fn();
            window.addEventListener('keydown', later);
            try {
                fireEvent.keyDown(document.body, { key: 'm' });
                expect(prefs()?.showMap).toBe(false);
                expect(later).not.toHaveBeenCalled();
            } finally {
                window.removeEventListener('keydown', later);
            }
        });

        it('under reduced motion, swaps wire shapes without a fade and runs no moving dots', () => {
            const { unmount } = renderWires();
            openMenu('Wires');
            choose(/^Straight/);
            expect(document.querySelector('.wg-wires')?.classList.contains('swap')).toBe(true);
            unmount();
            const original = window.matchMedia;
            window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
            try {
                renderWires();
                openMenu('Wires');
                choose(/^Curved/);
                expect(document.querySelector('.wg-wires')?.classList.contains('swap')).toBe(false);
                pickNode('2');
                expect(drawnWires()).toHaveLength(2);
                expect(document.querySelectorAll('.wg-flow')).toHaveLength(0);
            } finally {
                window.matchMedia = original;
            }
        });

        // The map's nodes are drawn once on their own canvas: a pan or zoom redraws only the view rectangle.
        it('redraws only the map’s view rectangle on a zoom or pan, not its nodes', async () => {
            const { contexts, restore } = fakeCanvases();
            try {
                renderWires();
                const [base, rect] = Array.from(document.querySelectorAll<HTMLCanvasElement>('.wg-map-c canvas'));
                const fills = (canvas: HTMLCanvasElement) => (contexts.get(canvas)?.fillRect as ReturnType<typeof vi.fn>).mock.calls.length;
                const baseFills = fills(base);
                const rectFills = fills(rect);
                expect(baseFills).toBeGreaterThan(0);
                fireEvent.keyDown(document.body, { key: '=' });
                const zoomed = fills(rect);
                expect(zoomed).toBeGreaterThan(rectFills);
                const canvas = document.querySelector('.wg-canvas')!;
                fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 300, clientY: 300 });
                fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 200, clientY: 250 });
                fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 200, clientY: 250 });
                await waitFor(() => expect(fills(rect)).toBeGreaterThan(zoomed));
                expect(fills(base)).toBe(baseFills);
            } finally {
                restore();
            }
        });
    });
    // P4: the saved image floats over the graph. It is the viewer's own picture, kept on the canvas, and points at
    // the node that saved it.
    describe('the floating image', () => {
        const root = level(
            [
                canvasNode('1', { title: 'Load', pos: { x: 20, y: 80 }, outputs: [port(0, 'LATENT')] }),
                canvasNode('2', { title: 'Decode', nodeType: 'VAEDecode', pos: { x: 400, y: 80 }, inputs: [port(0, 'LATENT')] }),
                canvasNode('3', { title: 'Stage', kind: 'subgraph', subgraphId: 'def', pos: { x: 400, y: 400 } }),
            ],
            [canvasLink('1', 0, '2', 0)]
        );
        const subgraphs = [
            { id: 'def', name: 'Upscale stage', level: level([canvasNode('u1', { title: 'Inner', pos: { x: 0, y: 30 } })]) },
        ];
        const savedAtRoot = report(root, { subgraphs, selectedOutputPaths: [['2']] });
        const savedInside = report(root, { subgraphs, selectedOutputPaths: [['3', 'u1']] });
        const picture = { src: 'asset://localhost/render.png', fallbackSrc: 'asset://localhost/thumb.webp', width: 1024, height: 768 };
        const renderFloat = (shown = savedAtRoot, image: typeof picture | null = picture, onClose = vi.fn()) => {
            const view = render(
                <WorkflowGraphView report={shown} fileName="render.png" image={image} onClose={onClose} makeLayoutWorker={fakeWorker} />
            );
            return { ...view, onClose };
        };
        const win = () => document.querySelector<HTMLElement>('.wg-float');
        const bar = () => win()!.querySelector('.wg-fh')!;
        const pic = () => screen.getByRole('button', { name: /saved this image|^This image$/ });
        const imageButton = () => screen.getByRole('button', { name: /^Image/ });
        const node = (id: string) => document.querySelector<HTMLElement>(`.wg-world [data-node-id="${id}"]`)!;
        const lit = () =>
            Array.from(document.querySelectorAll<HTMLElement>('.wg-world [data-node-id]'))
                .filter((element) => element.classList.contains('hit'))
                .map((element) => element.dataset.nodeId);
        const panel = () => document.querySelector('.wg-panel')?.getAttribute('aria-label');
        const dragBy = (handle: Element, dx: number, dy: number, pointerId = 7) => {
            fireEvent.pointerDown(handle, { button: 0, pointerId, clientX: 100, clientY: 100 });
            fireEvent.pointerMove(handle, { pointerId, clientX: 100 + dx, clientY: 100 + dy });
            fireEvent.pointerUp(handle, { pointerId, clientX: 100 + dx, clientY: 100 + dy });
        };
        const place = () => ({ left: win()!.style.left, top: win()!.style.top, width: win()!.style.width });
        const withCanvas = (w: number, h: number) =>
            vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, w, h));

        /** Element.animate, which jsdom lacks: each call is kept, to finish or check by hand. */
        const fakeAnimate = () => {
            const calls: { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; animation: Animation }[] = [];
            const original = (HTMLElement.prototype as { animate?: unknown }).animate;
            HTMLElement.prototype.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
                const animation = { onfinish: null, cancel: vi.fn() } as unknown as Animation;
                calls.push({ element: this, keyframes, options, animation });
                return animation;
            } as unknown as HTMLElement['animate'];
            const finish = (animation: Animation) =>
                act(() => animation.onfinish?.call(animation, new Event('finish') as AnimationPlaybackEvent));
            const restore = () => {
                if (original === undefined) delete (HTMLElement.prototype as { animate?: unknown }).animate;
                else HTMLElement.prototype.animate = original as HTMLElement['animate'];
            };
            return { calls, finish, restore };
        };

        it('floats the viewer’s own picture, with the file’s name and size, and the Image button pressed', () => {
            renderFloat();
            expect(win()).not.toBeNull();
            expect(win()!.querySelector('img')?.getAttribute('src')).toContain('render.png');
            expect(win()!.textContent).toContain('render.png');
            expect(win()!.textContent).toContain('1024 × 768');
            expect(imageButton().getAttribute('aria-pressed')).toBe('true');
        });

        it('offers no window, and a disabled Image button that I leaves alone, when the viewer has no picture', () => {
            renderFloat(savedAtRoot, null);
            expect(win()).toBeNull();
            expect((imageButton() as HTMLButtonElement).disabled).toBe(true);
            const event = new KeyboardEvent('keydown', { key: 'i', cancelable: true, bubbles: true });
            document.body.dispatchEvent(event);
            expect(event.defaultPrevented).toBe(false);
            expect(win()).toBeNull();
        });

        it('folds to its bar and unfolds to the width it had', () => {
            const box = withCanvas(1024, 768);
            try {
                renderFloat();
                const grip = win()!.querySelector('.wg-grip')!;
                dragBy(grip, 100, 0);
                const before = place();
                expect(before.width).toBe('300px');
                fireEvent.click(screen.getByRole('button', { name: 'Fold the image' }));
                expect(win()!.classList.contains('shut')).toBe(true);
                fireEvent.click(screen.getByRole('button', { name: 'Unfold the image' }));
                expect(win()!.classList.contains('shut')).toBe(false);
                expect(place()).toEqual(before);
            } finally {
                box.mockRestore();
            }
        });

        // Reopening must bring the window back as it was left: folded or not, where it was, its size, and fully
        // visible; a fade-out that held its last frame would leave it invisible.
        it('comes back from Close as it was left, from the Image button and from I', () => {
            const box = withCanvas(1024, 768);
            const motion = fakeAnimate();
            try {
                renderFloat();
                dragBy(bar(), 120, 80);
                fireEvent.click(screen.getByRole('button', { name: 'Fold the image' }));
                const before = place();
                fireEvent.click(screen.getByRole('button', { name: 'Close the image' }));
                const fade = motion.calls.at(-1)!;
                expect(fade.keyframes.at(-1)).toMatchObject({ opacity: 0 });
                motion.finish(fade.animation);
                expect(win()).toBeNull();
                expect(imageButton().getAttribute('aria-pressed')).toBe('false');

                fireEvent.click(imageButton());
                expect(place()).toEqual(before);
                expect(win()!.classList.contains('shut')).toBe(true);
                expect(motion.calls.at(-1)!.keyframes.at(-1)).toMatchObject({ opacity: 1 });

                fireEvent.keyDown(document.body, { key: 'i' });
                motion.finish(motion.calls.at(-1)!.animation);
                expect(win()).toBeNull();
                fireEvent.keyDown(document.body, { key: 'I' });
                expect(place()).toEqual(before);
            } finally {
                motion.restore();
                box.mockRestore();
            }
        });

        it('drops a half-run fade when it is reopened before the fade ends, so nothing holds it invisible', () => {
            const motion = fakeAnimate();
            try {
                renderFloat();
                const element = win();
                fireEvent.click(screen.getByRole('button', { name: 'Close the image' }));
                const fade = motion.calls.at(-1)!.animation;
                fireEvent.click(imageButton());
                expect(fade.cancel).toHaveBeenCalled();
                expect(win()).toBe(element);
            } finally {
                motion.restore();
            }
        });

        it('stays on the canvas while dragged past any edge, and when the window shrinks', () => {
            const box = withCanvas(1024, 768);
            try {
                renderFloat();
                dragBy(bar(), -900, -900);
                expect(place()).toMatchObject({ left: '6px', top: '6px' });
                dragBy(bar(), 5000, 5000, 8);
                expect(place()).toMatchObject({ left: `${1024 - 200 - 6}px`, top: `${768 - 32 - 6}px` });
                box.mockReturnValue(new DOMRect(0, 0, 600, 400));
                act(() => {
                    window.dispatchEvent(new Event('resize'));
                });
                expect(place()).toMatchObject({ left: `${600 - 200 - 6}px`, top: `${400 - 32 - 6}px` });
            } finally {
                box.mockRestore();
            }
        });

        it('resizes from its corner no wider than its largest width or the canvas allows', () => {
            const box = withCanvas(1024, 768);
            try {
                renderFloat();
                dragBy(win()!.querySelector('.wg-grip')!, 2000, 0);
                expect(place().width).toBe('520px');
                dragBy(win()!.querySelector('.wg-grip')!, -2000, 0, 8);
                expect(place().width).toBe('160px');
            } finally {
                box.mockRestore();
            }
        });

        it('lights the node that saved the image while pointed at, and goes to it on a click', () => {
            renderFloat();
            fireEvent.pointerEnter(pic());
            expect(lit()).toEqual(['2']);
            expect(node('1').classList.contains('miss')).toBe(true);
            fireEvent.pointerLeave(pic());
            expect(lit()).toEqual([]);
            expect(node('1').classList.contains('miss')).toBe(false);
            fireEvent.click(pic());
            expect(panel()).toBe('Node Decode');
        });

        // WebView2 draws a native title as its own window under the pointer: moving onto it leaves the picture, so the
        // lit node went dark and came back as the tooltip showed and hid. Nothing over the picture may carry one.
        it('puts no native tooltip on the picture, so pointing at it keeps the node lit', () => {
            renderFloat();
            expect(pic().hasAttribute('title')).toBe(false);
            expect(pic().querySelector('[title]')).toBeNull();
            expect(pic().getAttribute('aria-label')).toBe('Go to the node that saved this image');
            expect(win()!.querySelector('.wg-fnote')).toBeNull();
            fireEvent.pointerEnter(pic());
            fireEvent.pointerMove(pic(), { pointerId: 1, clientX: 60, clientY: 120 });
            fireEvent.pointerMove(pic(), { pointerId: 1, clientX: 140, clientY: 180 });
            expect(lit()).toEqual(['2']);
        });

        // The output inside a subgraph is reached through its instance: the picture points at the instance, then,
        // one level down, at the node itself. The window keeps its place across the levels.
        it('points at the subgraph holding the output, then at the output inside it, keeping its place', () => {
            const box = withCanvas(1024, 768);
            try {
                renderFloat(savedInside);
                dragBy(bar(), 200, 100);
                const before = place();
                fireEvent.pointerEnter(pic());
                expect(lit()).toEqual(['3']);
                fireEvent.pointerLeave(pic());
                fireEvent.click(screen.getByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' }));
                expect(place()).toEqual(before);
                fireEvent.pointerEnter(pic());
                expect(lit()).toEqual(['u1']);
                fireEvent.click(pic());
                expect(panel()).toBe('Node Inner');
            } finally {
                box.mockRestore();
            }
        });

        it('lights nothing, and says why, where the output is on no path from this level', () => {
            renderFloat(report(root, { subgraphs, selectedOutputPaths: [] }));
            expect(pic().getAttribute('aria-disabled')).toBe('true');
            // Said on the window, not in a native tooltip over the picture.
            const note = win()!.querySelector('.wg-fnote')!;
            expect(note.textContent).toContain('not on this level');
            expect(pic().getAttribute('aria-describedby')).toBe(note.id);
            fireEvent.pointerEnter(pic());
            fireEvent.click(pic());
            expect(lit()).toEqual([]);
            expect(panel()).toBeUndefined();
        });

        it('keeps a press or drag on the window from closing the panel or panning, in near view', () => {
            renderFloat();
            fireEvent.click(pic());
            expect(panel()).toBe('Node Decode');
            const caption = win()!.querySelector('.wg-fcap')!;
            fireEvent.pointerDown(caption, { button: 0, pointerId: 3, clientX: 50, clientY: 200 });
            fireEvent.pointerUp(caption, { pointerId: 3, clientX: 50, clientY: 200 });
            expect(panel()).toBe('Node Decode');
            fireEvent.pointerDown(bar(), { button: 0, pointerId: 4, clientX: 50, clientY: 70 });
            fireEvent.pointerMove(bar(), { pointerId: 4, clientX: 150, clientY: 170 });
            expect(document.querySelector('.wg-canvas')?.classList.contains('panning')).toBe(false);
            fireEvent.pointerUp(bar(), { pointerId: 4, clientX: 150, clientY: 170 });
            expect(panel()).toBe('Node Decode');
        });

        it('keeps a press on the window from picking or clearing a node, in far view', () => {
            const canvases = fakeCanvases();
            const box = withCanvas(1024, 768);
            try {
                renderFloat();
                fireEvent.click(pic());
                const world = screen.getByTestId('workflow-graph-world');
                for (let i = 0; i < 20 && !world.classList.contains('far'); i++) fireEvent.keyDown(document.body, { key: '-' });
                expect(world.classList.contains('far')).toBe(true);
                const caption = win()!.querySelector('.wg-fcap')!;
                fireEvent.pointerDown(caption, { button: 0, pointerId: 5, clientX: 60, clientY: 240 });
                fireEvent.pointerUp(caption, { pointerId: 5, clientX: 60, clientY: 240 });
                expect(panel()).toBe('Node Decode');
            } finally {
                box.mockRestore();
                canvases.restore();
            }
        });

        it('leaves Escape as it was: up a level, then out, with the window still shown', () => {
            const { onClose } = renderFloat(savedInside);
            fireEvent.click(screen.getByRole('button', { name: 'Open subgraph Upscale stage, 1 node inside' }));
            fireEvent.keyDown(document.body, { key: 'Escape' });
            expect(screen.getByRole('navigation', { name: 'Workflow levels' }).querySelector('[aria-current]')?.textContent).toBe(
                'render.png'
            );
            expect(win()).not.toBeNull();
            expect(onClose).not.toHaveBeenCalled();
            fireEvent.keyDown(document.body, { key: 'Escape' });
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('leaves I to the search box while it is being typed in', () => {
            renderFloat();
            fireEvent.keyDown(document.body, { key: '/' });
            fireEvent.keyDown(screen.getByRole('combobox', { name: 'Find a node or value' }), { key: 'i' });
            expect(win()).not.toBeNull();
        });

        // Focus left on a window that goes away drops to the page, and the graph's own keys (Tab trap, arrows, Esc) stop.
        describe('hands focus back to the graph when it closes with focus inside', () => {
            const dialog = () => screen.getByRole('dialog', { name: 'Workflow graph' });
            const focusKept = () => {
                const active = document.activeElement;
                expect(dialog().contains(active)).toBe(true);
                expect(active?.closest('.wg-float')).toBeNull();
            };

            it('from its ×, at once and while it fades out', () => {
                renderFloat();
                const close = screen.getByRole('button', { name: 'Close the image' });
                close.focus();
                fireEvent.click(close);
                expect(win()).toBeNull();
                focusKept();

                const motion = fakeAnimate();
                try {
                    fireEvent.click(imageButton());
                    pic().focus();
                    fireEvent.click(pic());
                    screen.getByRole('button', { name: 'Close the image' }).focus();
                    fireEvent.click(screen.getByRole('button', { name: 'Close the image' }));
                    // Still fading, so still mounted, but no longer holding focus.
                    expect(win()).not.toBeNull();
                    focusKept();
                    motion.finish(motion.calls.at(-1)!.animation);
                    focusKept();
                } finally {
                    motion.restore();
                }
            });

            it('from I pressed on the picture', () => {
                renderFloat();
                pic().focus();
                fireEvent.keyDown(pic(), { key: 'i' });
                expect(win()).toBeNull();
                focusKept();
            });
        });

        it('moves out from under the side panel while it is open', () => {
            const box = withCanvas(1024, 768);
            try {
                renderFloat();
                dragBy(bar(), 5000, 0);
                expect(place().left).toBe(`${1024 - 200 - 6}px`);
                fireEvent.click(pic());
                expect(panel()).toBe('Node Decode');
                expect(place().left).toBe(`${1024 - 340 - 200 - 6}px`);
                // While the panel is open, a drag stops at its edge too.
                dragBy(bar(), 5000, 0, 8);
                expect(place().left).toBe(`${1024 - 340 - 200 - 6}px`);
            } finally {
                box.mockRestore();
            }
        });

        // A canvas no wider than the panel would leave no room at all, and an empty room clamps nothing.
        it('stays on a canvas no wider than the side panel while the panel is open', () => {
            // So narrow a canvas fits the graph in far view, which draws on a canvas.
            const canvases = fakeCanvases();
            const box = withCanvas(340, 600);
            try {
                renderFloat();
                fireEvent.click(pic());
                expect(panel()).toBe('Node Decode');
                // Half the canvas is kept: 170 px, so the window shrinks to its smallest width at the left margin.
                expect(place()).toMatchObject({ left: '6px', width: '160px' });
                dragBy(bar(), 5000, 5000);
                expect(place()).toMatchObject({ left: '6px', top: `${600 - 32 - 6}px`, width: '160px' });
            } finally {
                box.mockRestore();
                canvases.restore();
            }
        });

        it('closes the panel a picture click opened on Escape, and leaves the window open', () => {
            const { onClose } = renderFloat();
            fireEvent.click(pic());
            expect(panel()).toBe('Node Decode');
            fireEvent.keyDown(document.body, { key: 'Escape' });
            expect(panel()).toBeUndefined();
            expect(win()).not.toBeNull();
            expect(onClose).not.toHaveBeenCalled();
        });

        describe('with the saving node in a group', () => {
            const grouped = report(
                level(
                    [
                        canvasNode('1', { title: 'Load', pos: { x: 20, y: 80 }, outputs: [port(0, 'LATENT')] }),
                        canvasNode('2', { title: 'Decode', pos: { x: 400, y: 80 }, inputs: [port(0, 'LATENT')] }),
                    ],
                    [canvasLink('1', 0, '2', 0)],
                    [canvasGroup('Sampling', 380, 40, 300, 200)]
                ),
                { selectedOutputPaths: [['2']] }
            );
            const groupBoxEl = () => document.querySelector<HTMLElement>('.wg-world .wg-group')!;

            // A folded group's members are not drawn, so the group itself is what lights.
            it('lights the folded group while the picture is pointed at', () => {
                vi.useFakeTimers();
                try {
                    renderFloat(grouped);
                    fireEvent.pointerEnter(pic());
                    expect(lit()).toEqual(['2']);
                    expect(groupBoxEl().classList.contains('hit')).toBe(false);
                    fireEvent.pointerLeave(pic());
                    fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
                    act(() => {
                        vi.advanceTimersByTime(FOLD_MS);
                    });
                    expect(document.querySelector('.wg-world [data-node-id="2"]')).toBeNull();
                    fireEvent.pointerEnter(pic());
                    expect(groupBoxEl().classList.contains('hit')).toBe(true);
                    fireEvent.pointerLeave(pic());
                    expect(groupBoxEl().classList.contains('hit')).toBe(false);
                } finally {
                    vi.useRealTimers();
                }
            });

            // The window stops pointer moves reaching the canvas, so a pill hovered just before is cleared on the way in.
            it('clears a far pill’s hover when the pointer moves straight onto the window', () => {
                const canvases = fakeCanvases();
                const box = withCanvas(1024, 768);
                const original = window.matchMedia;
                window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
                try {
                    renderFloat(grouped);
                    const world = screen.getByTestId('workflow-graph-world');
                    const canvas = document.querySelector<HTMLElement>('.wg-canvas')!;
                    for (let i = 0; i < 20 && !world.classList.contains('far'); i++) fireEvent.keyDown(document.body, { key: '-' });
                    expect(world.classList.contains('far')).toBe(true);
                    const [x, y, s] = /translate\(([\d.e-]+)px, ([\d.e-]+)px\) scale\(([\d.e-]+)\)/
                        .exec(world.style.transform)!
                        .slice(1)
                        .map(Number);
                    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: x + 380 * s + 12, clientY: y + 40 * s + 12 });
                    expect(canvas.classList.contains('on-pill')).toBe(true);
                    fireEvent.pointerEnter(win()!);
                    expect(canvas.classList.contains('on-pill')).toBe(false);
                } finally {
                    window.matchMedia = original;
                    box.mockRestore();
                    canvases.restore();
                }
            });
        });

        it('under reduced motion, folds and closes with no animation', () => {
            const motion = fakeAnimate();
            const original = window.matchMedia;
            window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
            try {
                renderFloat();
                fireEvent.click(screen.getByRole('button', { name: 'Fold the image' }));
                fireEvent.click(screen.getByRole('button', { name: 'Close the image' }));
                expect(win()).toBeNull();
                fireEvent.click(imageButton());
                expect(win()).not.toBeNull();
                expect(motion.calls).toHaveLength(0);
            } finally {
                window.matchMedia = original;
                motion.restore();
            }
        });
    });

    // The owner's polish round: a click on a node box far out flies in to it, a click in the Detailed level only
    // picks, and a click from the side (search, panel, picture) lands the node in the centre where it can be read.
    describe('the camera on a click', () => {
        const withReducedMotion = (run: () => void) => {
            const original = window.matchMedia;
            window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
            try {
                run();
            } finally {
                window.matchMedia = original;
            }
        };
        const world = () => screen.getByTestId('workflow-graph-world');
        const view = () => {
            const [x, y, s] = /translate\(([\d.e-]+)px, ([\d.e-]+)px\) scale\(([\d.e-]+)\)/
                .exec(world().style.transform)!
                .slice(1)
                .map(Number);
            return { x, y, s };
        };
        const decode = savedPositions(buildGraphModel(graph.root)).get('2')!;
        const decodeNode = buildGraphModel(graph.root).byId.get('2')!;
        const canvas = () => document.querySelector<HTMLElement>('.wg-canvas')!;
        /** Wheel turns, flushed a frame at a time, until the zoom is `target`. */
        const zoomTo = (frames: FrameRequestCallback[], target: number) => {
            const deltaY = -Math.log(target / view().s) / 0.0016;
            fireEvent.wheel(canvas(), { deltaY, clientX: 512, clientY: 384 });
            act(() => frames.splice(0).forEach((frame) => frame(performance.now())));
            expect(view().s).toBeCloseTo(target, 6);
        };
        const pick = (text: string) => {
            const box = screen.getByRole('combobox', { name: 'Find a node or value' });
            fireEvent.change(box, { target: { value: text } });
            fireEvent.keyDown(box, { key: 'Enter' });
        };
        const centredY = (s: number) => 768 / 2 - (decode.y + nodeHeight(decodeNode, false) / 2) * s;

        it('flies in to a node box clicked in far view, at 100 %, and opens it; a pan that starts on it does not', () => {
            const { restore } = fakeCanvases();
            const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
            try {
                withReducedMotion(() => {
                    renderGraph();
                    for (let i = 0; i < 14 && !world().classList.contains('far'); i++) fireEvent.keyDown(document.body, { key: '-' });
                    const far = view();
                    const onDecode = { clientX: far.x + (decode.x + 100) * far.s, clientY: far.y + (decode.y + 30) * far.s };
                    // A drag that starts on the box pans and stays far.
                    fireEvent.pointerDown(canvas(), { button: 0, pointerId: 1, ...onDecode });
                    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: onDecode.clientX + 40, clientY: onDecode.clientY });
                    fireEvent.pointerUp(canvas(), { pointerId: 1, clientX: onDecode.clientX + 40, clientY: onDecode.clientY });
                    expect(view().s).toBe(far.s);
                    expect(document.querySelector('.wg-panel')).toBeNull();
                    const panned = view();
                    const onDecodeNow = { clientX: panned.x + (decode.x + 100) * panned.s, clientY: panned.y + (decode.y + 30) * panned.s };
                    fireEvent.pointerDown(canvas(), { button: 0, pointerId: 2, ...onDecodeNow });
                    fireEvent.pointerUp(canvas(), { pointerId: 2, ...onDecodeNow });
                    expect(document.querySelector('.wg-panel')?.getAttribute('aria-label')).toBe('Node Decode');
                    expect(view().s).toBe(1);
                    expect(view().y).toBeCloseTo(centredY(1), 6);
                    expect(world().classList.contains('far')).toBe(false);
                });
            } finally {
                box.mockRestore();
                restore();
            }
        });

        // The owner's look on smoke-423: a node clicked in the Detailed level comes to the centre, at the zoom they
        // chose, even where its text is still faded; its own fold button folds it where it is.
        it('centres a node clicked in the Detailed level and keeps the zoom; its fold button does not move the view', () => {
            const frames: FrameRequestCallback[] = [];
            const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
            const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
            try {
                withReducedMotion(() => {
                    renderGraph();
                    const clickNode = (target: Element) => {
                        fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
                        fireEvent.pointerUp(target, { pointerId: 1, clientX: 10, clientY: 10 });
                    };
                    const node = () => document.querySelector<HTMLElement>('.wg-world [data-node-id="2"]')!;
                    for (const zoom of [DETAIL_FADE_SCALE - 0.05, 1.4]) {
                        zoomTo(frames, zoom);
                        const before = view();
                        const fold = node().querySelector('.wg-cb')!;
                        clickNode(fold);
                        expect(view()).toEqual(before);
                        clickNode(node());
                        expect(document.querySelector('.wg-panel')?.getAttribute('aria-label')).toBe('Node Decode');
                        expect(view().s).toBeCloseTo(zoom, 6);
                        expect(view().y).toBeCloseTo(centredY(zoom), 6);
                        fireEvent.keyDown(document.body, { key: 'Escape' });
                    }
                });
            } finally {
                box.mockRestore();
                raf.mockRestore();
            }
        });

        // Below the zoom where body text shows in full, a node reached from the side is not readable yet.
        it('centres a node picked from the side, zooming to 100 % where its text would still be faded', () => {
            const frames: FrameRequestCallback[] = [];
            const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
            const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
            try {
                withReducedMotion(() => {
                    renderGraph();
                    for (const [from, landed] of [
                        [DETAIL_FADE_SCALE - 0.05, 1],
                        [0.8, 0.8],
                        [1.4, 1.4],
                    ]) {
                        zoomTo(frames, from);
                        pick('Decode');
                        expect(view().s).toBeCloseTo(landed, 6);
                        expect(view().y).toBeCloseTo(centredY(landed), 6);
                        fireEvent.keyDown(document.body, { key: 'Escape' });
                    }
                });
            } finally {
                box.mockRestore();
                raf.mockRestore();
            }
        });

        // #641: the switch from the far canvas to the Detailed nodes popped while a flight raced through it. A
        // flight now fades the nodes in over the rest of its way; a wheel zoom keeps the short fade.
        it('fades the Detailed level in over the rest of a flight into it, and quickly on a wheel zoom', () => {
            const { restore } = fakeCanvases();
            const frames: FrameRequestCallback[] = [];
            const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
            const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
            let clock = 1000;
            const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
            const flush = () => act(() => frames.splice(0).forEach((frame) => frame(clock)));
            try {
                renderGraph();
                flush();
                for (let i = 0; i < 14 && !world().classList.contains('far'); i++) fireEvent.keyDown(document.body, { key: '-' });
                expect(world().classList.contains('far')).toBe(true);
                pick('Decode');
                const started = clock;
                let crossed: string | null = null;
                while (clock < started + 600 && frames.length > 0) {
                    clock += 16;
                    flush();
                    if (crossed === null && !world().classList.contains('far')) crossed = world().style.transitionDuration;
                }
                expect(view().s).toBe(1);
                const fade = Number.parseFloat(crossed ?? '');
                expect(fade).toBeGreaterThan(160);
                expect(fade).toBeLessThan(560);
                expect(document.querySelector<HTMLElement>('.wg-farcanvas')!.style.transitionDelay).toBe(`0s, ${fade}ms`);

                for (let i = 0; i < 14 && !world().classList.contains('far'); i++) fireEvent.keyDown(document.body, { key: '-' });
                expect(world().style.transitionDuration).toBe('');
                zoomTo(frames, 0.9);
                expect(world().classList.contains('far')).toBe(false);
                expect(world().style.transitionDuration).toBe('');
            } finally {
                now.mockRestore();
                box.mockRestore();
                raf.mockRestore();
                restore();
            }
        });
    });

    // UX-L267's entrance, which the owner liked: the nodes fade and rise in from left to right and the wires draw in.
    describe('the entrance', () => {
        type Played = { element: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: () => void };
        const played: Played[] = [];
        const stubAnimate = () => {
            played.length = 0;
            const original = Element.prototype.animate as typeof Element.prototype.animate | undefined;
            Element.prototype.animate = function (this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
                const cancel = vi.fn();
                played.push({ element: this, keyframes, options, cancel });
                return { cancel, finished: Promise.resolve() } as unknown as Animation;
            } as typeof Element.prototype.animate;
            return () => {
                if (original) Element.prototype.animate = original;
                else delete (Element.prototype as Partial<Element>).animate;
            };
        };
        const forNode = (id: string) => played.filter((entry) => (entry.element as HTMLElement).dataset?.nodeId === id);
        const wire = () => document.querySelector<SVGPathElement>('.wg-wire')!;

        it('brings the nodes in from left to right, fades the groups in and draws each wire from its source', () => {
            vi.useFakeTimers();
            const restore = stubAnimate();
            try {
                renderGraph();
                const [left] = forNode('1');
                const [right] = forNode('2');
                expect(left.options.delay).toBe(0);
                expect(right.options.delay!).toBeGreaterThan(0);
                expect(left.keyframes[0]).toMatchObject({ opacity: 0, translate: '0 8px' });
                expect(played.some((entry) => (entry.element as HTMLElement).classList.contains('wg-group'))).toBe(true);
                const drawn = played.find((entry) => entry.element === wire())!;
                expect(drawn.keyframes[0]).toMatchObject({ strokeDashoffset: 1 });
                expect(drawn.options.delay!).toBeGreaterThan(0);
                expect(wire().getAttribute('pathLength')).toBe('1');
                // When it ends, nothing it set stays on the elements.
                act(() => vi.advanceTimersByTime(2000));
                expect(wire().hasAttribute('pathLength')).toBe(false);
                expect(played.every((entry) => vi.mocked(entry.cancel).mock.calls.length > 0)).toBe(true);
            } finally {
                restore();
                vi.useRealTimers();
            }
        });

        // The owner's look on smoke-423: a graph that opened in Detailed showed its nodes whole, faded them out and
        // brought them back, because a lone keyframe is where an animation ends. Every entrance animation starts from
        // its hidden frame, so the first painted frame is already the entrance's start.
        it('starts every animation hidden, so the first frame is the start of the entrance', () => {
            const restore = stubAnimate();
            try {
                renderGraph();
                expect(played.length).toBeGreaterThan(0);
                for (const { keyframes } of played) expect(keyframes[0]).toMatchObject({ opacity: 0, offset: 0 });
            } finally {
                restore();
            }
        });

        // A dashed wire would lose its dashes to the drawing dash, and drawing hundreds of wires costs too much:
        // those fade in, with nothing measured on them.
        const fadedOnly = (path: SVGPathElement) => {
            const entry = played.find((candidate) => candidate.element === path)!;
            expect(entry.keyframes).toEqual([{ opacity: 0, offset: 0 }]);
            expect(path.hasAttribute('pathLength')).toBe(false);
        };

        it('fades a bypassed wire in rather than drawing it', () => {
            const restore = stubAnimate();
            try {
                const bypassed = report(
                    level(
                        [
                            canvasNode('a', { pos: { x: 0, y: 30 }, outputs: [port(0, 'LATENT')] }),
                            canvasNode('b', { pos: { x: 400, y: 30 }, inputs: [port(0, 'LATENT')], mode: 'bypassed' }),
                        ],
                        [canvasLink('a', 0, 'b', 0)]
                    )
                );
                render(<WorkflowGraphView report={bypassed} fileName="bypass.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
                fadedOnly(wire());
            } finally {
                restore();
            }
        });

        it(`fades every wire in on a level with more than ${WIRE_DRAW_LIMIT} wires`, () => {
            const restore = stubAnimate();
            // A tall view, so the two tall nodes open near enough to draw in the HTML.
            const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1200, 8000));
            try {
                const count = WIRE_DRAW_LIMIT + 1;
                const slots = Array.from({ length: count }, (_, slot) => port(slot, 'LATENT'));
                const many = report(
                    level(
                        [
                            canvasNode('a', { pos: { x: 0, y: 30 }, outputs: slots }),
                            canvasNode('b', { pos: { x: 400, y: 30 }, inputs: slots }),
                        ],
                        slots.map((_, slot) => canvasLink('a', slot, 'b', slot))
                    )
                );
                render(<WorkflowGraphView report={many} fileName="many.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
                const paths = document.querySelectorAll<SVGPathElement>('.wg-wire');
                expect(paths).toHaveLength(count);
                expect(screen.getByTestId('workflow-graph-world').classList.contains('far')).toBe(false);
                paths.forEach(fadedOnly);
            } finally {
                box.mockRestore();
                restore();
            }
        });

        it('plays nothing under reduced motion', () => {
            const restore = stubAnimate();
            const original = window.matchMedia;
            window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
            try {
                renderGraph();
                expect(played).toEqual([]);
                expect(wire().hasAttribute('pathLength')).toBe(false);
            } finally {
                window.matchMedia = original;
                restore();
            }
        });

        // Tidy and As saved glide the nodes to their new places; the entrance is for a level that opens.
        it('ends when the layout changes, without playing again, and plays again on a subgraph level', async () => {
            const restore = stubAnimate();
            try {
                const withSubgraph = report(
                    level([
                        canvasNode('1', { title: 'Load', pos: { x: 20, y: 80 } }),
                        canvasNode('s', { title: 'Stage', kind: 'subgraph', subgraphId: 'def', pos: { x: 400, y: 80 } }),
                    ]),
                    {
                        subgraphs: [
                            { id: 'def', name: 'Stage', level: level([canvasNode('u1', { title: 'Inner', pos: { x: 0, y: 30 } })]) },
                        ],
                    }
                );
                render(<WorkflowGraphView report={withSubgraph} fileName="enter.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
                expect(forNode('1')).toHaveLength(1);
                fireEvent.click(screen.getByRole('button', { name: 'Tidy' }));
                await waitFor(() => expect(vi.mocked(forNode('1')[0].cancel).mock.calls.length).toBeGreaterThan(0));
                expect(forNode('1')).toHaveLength(1);
                fireEvent.click(screen.getByRole('button', { name: 'Open subgraph Stage, 1 node inside' }));
                expect(forNode('u1')).toHaveLength(1);
            } finally {
                restore();
            }
        });

        // A big graph opens far out, on the canvas: it draws the entrance a frame at a time, then stops drawing.
        it('draws the far canvas in until the entrance ends, and then asks for no more frames', () => {
            const { restore } = fakeCanvases();
            const frames: FrameRequestCallback[] = [];
            const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
            const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
            let clock = 1000;
            const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
            try {
                const wide = report(level([canvasNode('a', { pos: { x: 0, y: 30 } }), canvasNode('b', { pos: { x: 40_000, y: 30 } })]));
                render(<WorkflowGraphView report={wide} fileName="wide.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
                expect(screen.getByTestId('workflow-graph-world').classList.contains('far')).toBe(true);
                expect(frames.length).toBeGreaterThan(0);
                clock += 300;
                act(() => frames.splice(0).forEach((frame) => frame(clock)));
                expect(frames.length).toBeGreaterThan(0);
                clock += 2000;
                act(() => frames.splice(0).forEach((frame) => frame(clock)));
                expect(frames).toHaveLength(0);
            } finally {
                now.mockRestore();
                box.mockRestore();
                raf.mockRestore();
                restore();
            }
        });

        // The owner's look on smoke-423: a graph that opened far showed its nodes whole while the zoom cross-fade
        // hid them, then arrived again on the canvas. The first level switches with no cross-fade, so the first
        // painted frame is already the entrance's start; later zooms keep the fade.
        it('opens far without the cross-fade, so the nodes never show before the entrance', () => {
            const { restore } = fakeCanvases();
            const box = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
            // The transitions in force at the moment the level switches.
            const atSwitch: string[] = [];
            const realToggle = DOMTokenList.prototype.toggle;
            DOMTokenList.prototype.toggle = function (this: DOMTokenList, token: string, force?: boolean) {
                if (token === 'far') {
                    const world = document.querySelector<HTMLElement>('[data-testid="workflow-graph-world"]')!;
                    const farCanvas = document.querySelector<HTMLElement>('.wg-farcanvas')!;
                    atSwitch.push(world.style.transition, farCanvas.style.transition);
                }
                return realToggle.call(this, token, force);
            };
            try {
                const wide = report(level([canvasNode('a', { pos: { x: 0, y: 30 } }), canvasNode('b', { pos: { x: 40_000, y: 30 } })]));
                render(<WorkflowGraphView report={wide} fileName="wide.png" onClose={vi.fn()} makeLayoutWorker={fakeWorker} />);
                const world = screen.getByTestId('workflow-graph-world');
                expect(world.classList.contains('far')).toBe(true);
                expect(atSwitch).toEqual(['none', 'none']);
                // The fade is back for the owner's own zooms.
                expect(world.style.transition).toBe('');
                expect(document.querySelector<HTMLElement>('.wg-farcanvas')!.style.transition).toBe('');
            } finally {
                DOMTokenList.prototype.toggle = realToggle;
                box.mockRestore();
                restore();
            }
        });
    });
});
