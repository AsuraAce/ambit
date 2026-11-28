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
    // Reading a large canvas costs hundreds of milliseconds: it happens on open, not for every item browsed.
    it('reads the canvas from the file chunks only when the graph is opened', async () => {
        render(<WorkflowInspector image={makeImage()} />);
        await act(async () => {
            await Promise.resolve();
        });
        expect(mockInspectWorkflowCanvas).not.toHaveBeenCalled();
        expect(graphButton().getAttribute('aria-disabled')).toBeNull();
        fireEvent.click(graphButton());
        expect(mockInspectWorkflowCanvas).toHaveBeenCalledWith({ workflow: workflowJson });
        // The first test loads the graph's lazy chunk.
        const dialog = await screen.findByRole('dialog', { name: 'Workflow graph' }, { timeout: 5000 });
        // Portalled to the body, so no ancestor's overflow or stacking clips it.
        expect(dialog.parentElement).toBe(document.body);
        // Set in an effect, which a cold first load of the chunk can flush a tick after the dialog shows.
        await waitFor(() => expect(useWorkflowGraphStore.getState().open).toBe(true));
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

    // The floating image is the picture the viewer already shows, never a new read of the file: the image itself, or a
    // video's poster. No command beyond the canvas read runs (the mock above has no other).
    it.each([
        ['an image', makeImage(), 'comfy.png'],
        [
            'a video, by its poster',
            makeImage({ mediaType: 'video', url: 'asset://clip.mp4', thumbnailUrl: 'asset://poster.webp' } as Partial<AIImage>),
            'poster.webp',
        ],
    ])('floats the viewer’s picture for %s', async (_, image, shown) => {
        render(<WorkflowInspector image={image} />);
        await waitFor(() => expect(graphButton().getAttribute('aria-disabled')).toBeNull());
        fireEvent.click(graphButton());
        const picture = await screen.findByTestId('graph-float');
        expect(picture.querySelector('img')?.getAttribute('src')).toContain(shown);
        expect(document.body.innerHTML).not.toContain('clip.mp4');
        expect(mockInspectWorkflowCanvas).toHaveBeenCalledTimes(1);
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
        fireEvent.click(graphButton());
        await waitFor(() => expect(graphReason()).toContain('no ComfyUI graph that Ambit can draw'));
        expect(graphButton().getAttribute('aria-disabled')).toBe('true');
        expect(graphDialog()).toBeNull();
        expect(useWorkflowGraphStore.getState().open).toBe(false);
    });
});
