import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowGraphStore } from '../../../../stores/workflowGraphStore';
import { GeneratorTool, type AIImage, type ImageMetadata } from '../../../../types';
import { canvasNode, level, report } from '../../workflowGraph/__tests__/canvasFixtures';
import { WorkflowInspector } from '../WorkflowInspector';

const mockInspectWorkflowCanvas = vi.hoisted(() => vi.fn());

vi.mock('../../../../bindings', () => ({
    commands: {
        inspectComfyuiMetadataChunks: () => Promise.resolve({ status: 'error', error: 'not under test here' }),
        inspectComfyuiWorkflowGraph: () => Promise.resolve({ status: 'error', error: 'not under test here' }),
        inspectWorkflowCanvas: (...args: unknown[]) => mockInspectWorkflowCanvas(...args),
    },
}));

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: { settings: { devMode: boolean } }) => unknown) => selector({ settings: { devMode: false } }),
}));
vi.mock('../../../../services/metadataParser', () => ({ scanImageWorkflow: vi.fn() }));
vi.mock('../../../../services/db/imageRepo', () => ({ updateImageWorkflow: vi.fn(), updateImageWorkflowHint: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn() }));

const workflowJson = JSON.stringify({ nodes: [{ id: 1, type: 'KSampler' }] });

const metadataFor = (tool: GeneratorTool, extra: Partial<ImageMetadata> = {}): ImageMetadata => ({
    tool,
    model: 'model',
    seed: 1,
    steps: 20,
    cfg: 7,
    sampler: 'euler',
    positivePrompt: '',
    negativePrompt: '',
    ...extra,
});

const makeImage = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'C:/library/comfy.png',
    url: 'asset://comfy.png',
    thumbnailUrl: 'asset://thumb.webp',
    filename: 'comfy.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: metadataFor(GeneratorTool.COMFYUI, { workflowJson, hasWorkflowHint: true }),
    originalChunks: { workflow: workflowJson },
    ...overrides,
});

const drawable = report(level([canvasNode('1', { title: 'Sampler node' })]));
const graphButton = () => screen.getByRole('button', { name: 'Open the workflow graph' });
/** The reason the button gives, in the tooltip it shows on focus. */
const graphReason = () => {
    fireEvent.focus(graphButton());
    return screen.getByRole('tooltip').textContent ?? '';
};
const graphDialog = () => screen.queryByRole('dialog', { name: 'Workflow graph' });

beforeEach(() => {
    mockInspectWorkflowCanvas.mockReset().mockResolvedValue({ status: 'ok', data: drawable });
});
afterEach(() => useWorkflowGraphStore.setState({ open: false }));

describe('WorkflowInspector graph button', () => {
    it('reads the canvas from the file chunks and opens the graph over the page', async () => {
        render(<WorkflowInspector image={makeImage()} />);
        expect(mockInspectWorkflowCanvas).toHaveBeenCalledWith({ workflow: workflowJson });
        await waitFor(() => expect(graphButton().getAttribute('aria-disabled')).toBeNull());
        fireEvent.click(graphButton());
        const dialog = await screen.findByRole('dialog', { name: 'Workflow graph' });
        // Portalled to the body, so no ancestor's overflow or stacking clips it.
        expect(dialog.parentElement).toBe(document.body);
        expect(useWorkflowGraphStore.getState().open).toBe(true);
    });

    it('returns focus to the Graph button when the graph closes', async () => {
        render(<WorkflowInspector image={makeImage()} />);
        await waitFor(() => expect(graphButton().getAttribute('aria-disabled')).toBeNull());
        fireEvent.click(graphButton());
        fireEvent.click(await screen.findByRole('button', { name: /back to image/i }));
        expect(graphDialog()).toBeNull();
        expect(document.activeElement).toBe(graphButton());
        expect(useWorkflowGraphStore.getState().open).toBe(false);
    });

    // The viewer's privacy gate unmounts the sidebar for a masked item: the graph must go with it.
    it('removes the graph and frees the keyboard when the inspector unmounts', async () => {
        const { unmount } = render(<WorkflowInspector image={makeImage()} />);
        await waitFor(() => expect(graphButton().getAttribute('aria-disabled')).toBeNull());
        fireEvent.click(graphButton());
        await screen.findByRole('dialog', { name: 'Workflow graph' });
        unmount();
        expect(graphDialog()).toBeNull();
        expect(useWorkflowGraphStore.getState().open).toBe(false);
    });

    it.each([
        ['an image from another tool', makeImage({ metadata: metadataFor(GeneratorTool.AUTOMATIC1111) }), 'draws ComfyUI workflows only'],
        ['a ComfyUI file with no workflow', makeImage({ metadata: metadataFor(GeneratorTool.COMFYUI), originalChunks: {} }), 'No workflow'],
    ])('stays shut for %s and says why', async (_, image, reason) => {
        render(<WorkflowInspector image={image} />);
        await act(async () => {
            await Promise.resolve();
        });
        expect(graphButton().getAttribute('aria-disabled')).toBe('true');
        expect(mockInspectWorkflowCanvas).not.toHaveBeenCalled();
        fireEvent.click(graphButton());
        expect(graphDialog()).toBeNull();
        expect(graphReason()).toContain(reason);
    });

    it('stays shut when the backend finds nothing it can draw', async () => {
        mockInspectWorkflowCanvas.mockResolvedValue({ status: 'ok', data: report(level([]), { source: 'none' }) });
        render(<WorkflowInspector image={makeImage()} />);
        await waitFor(() => expect(graphReason()).toContain('no ComfyUI graph that Ambit can draw'));
        fireEvent.click(graphButton());
        expect(graphDialog()).toBeNull();
    });
});
