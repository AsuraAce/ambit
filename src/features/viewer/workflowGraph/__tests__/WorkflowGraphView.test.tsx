import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowGraphStore } from '../../../../stores/workflowGraphStore';
import { FAR_EXIT_SCALE, FAR_SCALE, FOLD_MS, LOWEST_SCALE, MIN_SCALE } from '../geometry';
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
            expect(screen.getByTestId('workflow-graph-world').classList.contains('folding')).toBe(true);
            act(() => {
                vi.advanceTimersByTime(FOLD_MS - 1);
            });
            expect(shown(UNSAFE_TITLE)).toBe(true);
            act(() => {
                vi.advanceTimersByTime(1);
            });
            expect(shown(UNSAFE_TITLE)).toBe(false);
            expect(screen.getByTestId('workflow-graph-world').classList.contains('folding')).toBe(false);
            // Unfolding brings them back at once, fading in.
            fireEvent.click(screen.getByRole('button', { name: 'Unfold group Sampling' }));
            expect(screen.getByText(UNSAFE_TITLE).closest('.wg-node')?.classList.contains('arriving')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('folds at once, with no motion, under reduced motion', () => {
        const original = window.matchMedia;
        window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query })) as typeof window.matchMedia;
        try {
            renderGraph();
            fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
            expect(shown(UNSAFE_TITLE)).toBe(false);
            expect(screen.getByTestId('workflow-graph-world').classList.contains('folding')).toBe(false);
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

    // The owner's pick: tabs under the nodes, and a chip over them only where a node would cover the tab.
    it('draws a group title as a tab under the nodes, or as a chip over them when a node covers the tab', () => {
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
        const tab = container.querySelector('.wg-gtab');
        const chip = container.querySelector('.wg-gchip');
        const node = container.querySelector('[data-node-id="top"]');
        expect(tab?.textContent).toContain('Upper');
        expect(chip?.textContent).toContain('Lower');
        expect(order.indexOf(tab!)).toBeLessThan(order.indexOf(node!));
        expect(order.indexOf(chip!)).toBeGreaterThan(order.indexOf(node!));
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
});
