import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowGraphStore } from '../../../../stores/workflowGraphStore';
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

/** A node title is drawn twice: in its header and as the far-zoom label. */
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

    it('closes on Escape', () => {
        const { onClose } = renderGraph();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('hides the members of a folded group and shows them again on unfold', () => {
        renderGraph();
        expect(shown('Decode')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Fold group Sampling' }));
        expect(shown(UNSAFE_TITLE)).toBe(false);
        expect(shown('Decode')).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Unfold group Sampling' }));
        expect(shown(UNSAFE_TITLE)).toBe(true);
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

    // Wheel events come faster than frames: the view is drawn once per frame, and the far-mode scales are
    // written below the world, so a zoom step never restyles every node.
    it('draws wheel zoom once per frame and keeps far-mode scales off the world', () => {
        const frames: FrameRequestCallback[] = [];
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
        try {
            const { container } = renderGraph();
            const world = screen.getByTestId('workflow-graph-world');
            for (let i = 0; i < 12; i++) fireEvent.keyDown(document.body, { key: '-' });
            expect(world.classList.contains('far')).toBe(true);
            const before = world.style.transform;
            const canvas = container.ownerDocument.querySelector('.wg-canvas') as HTMLElement;
            for (let i = 0; i < 10; i++) fireEvent.wheel(canvas, { deltaY: -20, clientX: 100, clientY: 100 });
            expect(world.style.transform).toBe(before);
            const pending = frames.splice(0);
            expect(pending).toHaveLength(1);
            act(() => pending[0](performance.now()));
            expect(world.style.transform).not.toBe(before);
            expect(world.style.getPropertyValue('--wg-group-k')).toBe('');
            expect(world.style.getPropertyValue('--wg-wire-k')).toBe('');
            const groups = container.ownerDocument.querySelector('.wg-groups') as HTMLElement;
            expect(Number(groups.style.getPropertyValue('--wg-group-k'))).toBeGreaterThan(2);
        } finally {
            raf.mockRestore();
        }
    });
});
