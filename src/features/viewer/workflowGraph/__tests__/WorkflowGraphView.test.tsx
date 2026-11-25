import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowGraphStore } from '../../../../stores/workflowGraphStore';
import { handleLayoutRequest, type LayoutRequest, type LayoutResponse } from '../tidyLayout';
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
});
