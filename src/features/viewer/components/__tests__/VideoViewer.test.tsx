import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '../../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type VideoAsset } from '../../../../types';
import { VideoViewer } from '../VideoViewer';

const mocks = vi.hoisted(() => ({
    updateVideoPlaybackStatus: vi.fn().mockResolvedValue(undefined),
    openFileInDefaultApp: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    prepareVideoPlayback: vi.fn().mockResolvedValue({ status: 'ok', data: 'C:/videos/clip.mp4' }),
    exportAssetOriginal: vi.fn(),
    open: vi.fn(),
    convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
    getCollectionsForImage: vi.fn().mockResolvedValue([]),
    getImageWithFullMetadata: vi.fn(),
    addToast: vi.fn()
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    getImageWithFullMetadata: mocks.getImageWithFullMetadata,
    updateVideoPlaybackStatus: mocks.updateVideoPlaybackStatus
}));
vi.mock('../../../../services/db/collectionRepo', () => ({
    getCollectionsForImage: mocks.getCollectionsForImage
}));
vi.mock('../../../../services/osOpen', () => ({
    openFileInDefaultApp: mocks.openFileInDefaultApp
}));
vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({ addToast: mocks.addToast })
}));
vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: mocks.convertFileSrc
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: mocks.open
}));
vi.mock('../../../../stores/collectionStore', () => ({
    useCollectionStore: (selector: (state: { collections: Array<{ id: string; name: string }> }) => unknown) =>
        selector({ collections: [{ id: 'collection-1', name: 'Favorites set' }] })
}));
vi.mock('../../../../bindings', () => ({
    commands: {
        exportAssetOriginal: mocks.exportAssetOriginal,
        prepareVideoPlayback: mocks.prepareVideoPlayback
    }
}));

const video: VideoAsset = {
    id: 'C:/videos/clip.mp4',
    url: 'asset://localhost/C:/videos/clip.mp4',
    thumbnailUrl: 'poster.webp',
    thumbnailSource: 'ambit-video-v1',
    filename: 'clip.mp4',
    timestamp: 1,
    width: 1920,
    height: 1080,
    isFavorite: false,
    isPinned: false,
    mediaType: 'video',
    mediaContainer: 'MPEG-4',
    durationMs: 2_500,
    videoCodec: 'AVC',
    audioPresent: true,
    audioCodec: 'AAC',
    rotationDegrees: 0,
    probeStatus: 'ready',
    playbackStatus: 'unknown',
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: '',
        generationMode: 'text_to_video',
        fieldSources: {
            generationMode: 'trusted_sidecar',
            model: 'trusted_sidecar',
            positivePrompt: 'trusted_sidecar',
            negativePrompt: 'trusted_sidecar'
        }
    }
};

const setup = (isMasked = false, videoOverrides: Partial<VideoAsset> = {}, initiallyRevealed = false) => {
    const props: React.ComponentProps<typeof VideoViewer> = {
        video: { ...video, ...videoOverrides },
        isMasked,
        initiallyRevealed,
        onClose: vi.fn(),
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onToggleFavorite: vi.fn(),
        onTogglePin: vi.fn(),
        onDelete: vi.fn(),
        onUpdateNotes: vi.fn(),
        onUpdatePrompt: vi.fn(),
        onUpdateNegativePrompt: vi.fn(),
        onUpdateModel: vi.fn(),
        onUpdateTool: vi.fn(),
        onUpdateGenerationMode: vi.fn(),
        onRevertMetadata: vi.fn(),
        onSearch: vi.fn(),
        onSetCollectionMembership: vi.fn().mockResolvedValue(true)
    };
    return { ...render(<VideoViewer {...props} />), props };
};

describe('VideoViewer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCollectionsForImage.mockResolvedValue([]);
        mocks.getImageWithFullMetadata.mockResolvedValue(video);
        mocks.prepareVideoPlayback.mockResolvedValue({ status: 'ok', data: 'C:/videos/clip.mp4' });
    });

    it('opens new video viewers on Metadata', async () => {
        const view = setup();

        expect(screen.getByRole('tab', { name: 'Metadata' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByLabelText('Positive prompt')).toBeTruthy();
        expect(screen.queryByRole('heading', { name: 'Video' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        await waitFor(() => expect((screen.getByRole('button', { name: 'Favorites set' }) as HTMLButtonElement).disabled).toBe(false));
        view.rerender(<VideoViewer {...view.props} video={{ ...view.props.video, id: 'C:/videos/next.mp4' }} />);
        await waitFor(() => expect(mocks.getImageWithFullMetadata).toHaveBeenCalledWith('C:/videos/next.mp4'));
        expect(screen.getByRole('tab', { name: 'Details' }).getAttribute('aria-selected')).toBe('true');
    });

    it('does not create or scope a player before a masked video is revealed', async () => {
        setup(true);

        const dialog = screen.getByRole('dialog', { name: 'Hidden video' });
        expect(screen.queryByText(video.filename)).toBeNull();
        expect(screen.queryByLabelText(new RegExp(video.filename))).toBeNull();
        expect(screen.queryByRole('application')).toBeNull();
        expect(document.querySelector('video')).toBeNull();
        expect(mocks.prepareVideoPlayback).not.toHaveBeenCalled();
        expect(mocks.convertFileSrc).not.toHaveBeenCalled();
        expect(mocks.getImageWithFullMetadata).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Reveal video' }));
        expect(document.querySelector('video')).toBeNull();
        await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('clip.mp4'));
        expect(screen.getByRole('dialog', { name: `Video viewer: ${video.filename}` })).toBe(dialog);
        expect(screen.getByText(video.filename)).toBeTruthy();
        expect(mocks.prepareVideoPlayback).toHaveBeenCalledWith(video.id);
        expect(mocks.convertFileSrc).toHaveBeenCalledWith('C:/videos/clip.mp4');
        expect(mocks.getImageWithFullMetadata).toHaveBeenCalledWith(video.id);
    });

    it('keeps a locally revealed masked video visible across metadata updates', async () => {
        const view = setup(true);
        fireEvent.click(screen.getByRole('button', { name: 'Reveal video' }));
        await waitFor(() => expect(document.querySelector('video')).not.toBeNull());

        view.rerender(<VideoViewer
            {...view.props}
            video={{
                ...view.props.video,
                metadata: { ...view.props.video.metadata, generationMode: 'guided_video' },
            }}
        />);

        expect(screen.queryByRole('button', { name: 'Reveal video' })).toBeNull();
        expect(document.querySelector('video')).not.toBeNull();
    });

    it('loads full video evidence on demand for lightweight gallery rows', async () => {
        const lightVideo: VideoAsset = {
            ...video,
            metadata: {
                ...video.metadata,
                generationMode: undefined,
                fieldSources: undefined,
                loras: [],
            },
        };
        mocks.getImageWithFullMetadata.mockResolvedValueOnce({
            ...video,
            metadata: { ...video.metadata, loras: ['full-evidence-lora'] },
        });
        setup(false, lightVideo);

        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));

        await waitFor(() => expect((screen.getByLabelText('Generation mode') as HTMLSelectElement).value).toBe('text_to_video'));
        expect(screen.getAllByRole('button', { name: 'Source: trusted sidecar' }).length).toBeGreaterThan(0);
        expect(screen.getByText('full-evidence-lora')).toBeTruthy();
    });

    it('hides empty resource sections instead of rendering empty-state cards', () => {
        setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));

        expect(screen.queryByText('LoRAs')).toBeNull();
        expect(screen.queryByText('ControlNets')).toBeNull();
        expect(screen.queryByText('IP adapters')).toBeNull();
        expect(screen.queryByText('Resources')).toBeNull();
        expect(screen.queryByText('None detected')).toBeNull();
    });

    it('keeps disclosure choices while navigating within one viewer session', () => {
        const view = setup();
        const disclosure = screen.getByRole('button', { name: 'Generation parameters' });
        fireEvent.click(disclosure);
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');

        view.rerender(<VideoViewer
            {...view.props}
            video={{ ...view.props.video, id: 'C:/videos/next.mp4', filename: 'next.mp4' }}
        />);

        expect(screen.getByRole('button', { name: 'Generation parameters' }).getAttribute('aria-expanded')).toBe('false');
    });

    it('does not reuse workflow inspector state while navigating between videos', () => {
        const firstWorkflow = JSON.stringify({ nodes: [{ id: 'first', type: 'FirstVideoNode', inputs: {} }] });
        const secondWorkflow = JSON.stringify({ nodes: [{ id: 'second', type: 'SecondVideoNode', inputs: {} }] });
        const view = setup(false, { metadata: { ...video.metadata, workflowJson: firstWorkflow } });
        fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }));
        expect(screen.getAllByText('FirstVideoNode')).toHaveLength(2);

        view.rerender(<VideoViewer
            {...view.props}
            video={{
                ...view.props.video,
                id: 'C:/videos/next.mp4',
                metadata: { ...view.props.video.metadata, workflowJson: secondWorkflow },
            }}
        />);

        expect(screen.queryAllByText('FirstVideoNode')).toHaveLength(0);
        expect(screen.getAllByText('SecondVideoNode')).toHaveLength(2);
    });

    it('does not reuse playback or editable drafts while navigating to another video', async () => {
        const view = setup(false, {
            notes: 'first notes',
            metadata: { ...video.metadata, positivePrompt: 'first prompt' },
        });
        await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('clip.mp4'));

        let resolveNextPlayback: ((value: { status: 'ok'; data: string }) => void) | undefined;
        mocks.prepareVideoPlayback.mockImplementationOnce(() => new Promise(resolve => {
            resolveNextPlayback = resolve;
        }));
        const nextVideo: VideoAsset = {
            ...view.props.video,
            id: 'C:/videos/next.mp4',
            filename: 'next.mp4',
            notes: 'next notes',
            metadata: { ...view.props.video.metadata, positivePrompt: 'next prompt' },
        };
        view.rerender(<VideoViewer {...view.props} video={nextVideo} />);

        expect(document.querySelector('video')).toBeNull();
        expect(screen.getByRole('status').textContent).toContain('Preparing secure playback');
        expect((screen.getByLabelText('Positive prompt') as HTMLTextAreaElement).value).toBe('next prompt');
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('next notes');

        resolveNextPlayback?.({ status: 'ok', data: 'C:/videos/next.mp4' });
        await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('next.mp4'));
    });

    it.each([
        ['loras', 'motion-detail.safetensors (0.75)', 'motion-detail', 'lora:motion-detail'],
        ['controlNets', 'canny-video.safetensors', 'canny-video', 'cn:canny-video'],
        ['ipAdapters', 'reference-face.pt', 'reference-face', 'ip:reference-face'],
    ] as const)('filters the gallery from populated %s chips', (field, value, chipName, expectedSearch) => {
        const { props } = setup(false, {
            metadata: {
                ...video.metadata,
                [field]: [value],
            },
        });
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
        fireEvent.click(screen.getByRole('button', { name: new RegExp(chipName) }));

        expect(props.onSearch).toHaveBeenCalledWith(expectedSearch);
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('renders resource chips as inert when gallery search is unavailable', () => {
        setup(false, {
            metadata: { ...video.metadata, loras: ['motion-detail'] },
        }).rerender(<VideoViewer
            video={{ ...video, metadata: { ...video.metadata, loras: ['motion-detail'] } }}
            isMasked={false}
            onClose={vi.fn()}
            onNext={vi.fn()}
            onPrev={vi.fn()}
            onToggleFavorite={vi.fn()}
            onSetCollectionMembership={vi.fn().mockResolvedValue(true)}
        />);
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));

        expect(screen.getByText('motion-detail')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'motion-detail' })).toBeNull();
    });

    it('uses a card reveal grant without showing a second viewer gate', async () => {
        setup(true, {}, true);

        expect(screen.queryByRole('button', { name: 'Reveal video' })).toBeNull();
        await waitFor(() => expect(document.querySelector('video')?.getAttribute('src')).toContain('clip.mp4'));
        expect(mocks.prepareVideoPlayback).toHaveBeenCalledOnce();
    });

    it('records decode success and renders an external fallback after a playback error', async () => {
        setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });

        fireEvent.canPlay(player);
        expect(mocks.updateVideoPlaybackStatus).toHaveBeenCalledWith(video.id, 'playable');

        fireEvent.error(player);
        expect(await screen.findByText('Playback unavailable here')).toBeTruthy();
        expect(mocks.updateVideoPlaybackStatus).toHaveBeenCalledWith(video.id, 'external_required');
    });

    it('uses the shared subdued toolbar controls and text-only viewer tabs', () => {
        setup(false, { isFavorite: true, isPinned: true });

        const favorite = screen.getByRole('button', { name: 'Remove from Favorites' });
        expect(favorite.getAttribute('aria-pressed')).toBe('true');
        expect(favorite.className).toContain('text-white/50');

        const pin = screen.getByRole('button', { name: 'Unpin' });
        expect(pin.getAttribute('aria-pressed')).toBe('true');
        expect(pin.className).toContain('text-sage-400');

        const open = screen.getByRole('button', { name: 'Open in Default App' });
        fireEvent.focus(open);
        expect(screen.getByRole('tooltip').textContent).toBe('Open in Default App');

        expect(screen.getByRole('tablist', { name: 'Video viewer sections' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Workflow' }).querySelector('svg')).toBeNull();
    });

    it('explains a missing source without preparing playback or offering file actions', () => {
        setup(false, { isMissing: true, playbackStatus: 'playable' });

        expect(screen.getByText('Source file missing')).toBeTruthy();
        expect(screen.getByText(/Restore the file at its original location/)).toBeTruthy();
        expect(mocks.prepareVideoPlayback).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Open in Default App' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Export Original' })).toBeNull();
        expect(screen.queryByText('Open externally')).toBeNull();
    });

    it('exports the original and hides the Windows verbatim prefix in the toast', async () => {
        mocks.open.mockResolvedValueOnce('C:/exports');
        mocks.exportAssetOriginal.mockResolvedValueOnce({
            status: 'ok',
            data: {
                assetId: video.id,
                outputPath: '//?/C:/exports/clip.mp4',
                bytesCopied: 2_500
            }
        });
        setup();

        fireEvent.click(screen.getByRole('button', { name: 'Export Original' }));

        await waitFor(() => expect(mocks.exportAssetOriginal).toHaveBeenCalledWith(video.id, 'C:/exports'));
        expect(mocks.addToast).toHaveBeenCalledWith('Exported C:/exports/clip.mp4', 'success');
    });

    it('persists notes and collection membership through generic asset actions', async () => {
        const { props } = setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const notes = screen.getByLabelText('Notes');
        fireEvent.change(notes, { target: { value: 'Useful motion reference' } });
        fireEvent.blur(notes);
        expect(props.onUpdateNotes).toHaveBeenCalledWith(video.id, 'Useful motion reference');

        const membership = screen.getByRole('button', { name: 'Favorites set' }) as HTMLButtonElement;
        await waitFor(() => expect(membership.disabled).toBe(false));
        fireEvent.click(membership);
        await waitFor(() => expect(props.onSetCollectionMembership).toHaveBeenCalledWith(
            video.id,
            'collection-1',
            true
        ));
    });

    it('does not persist unchanged blur values as user edits', () => {
        const { props } = setup();

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        fireEvent.blur(screen.getByLabelText('Notes'));
        expect(props.onUpdateNotes).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
        fireEvent.blur(screen.getByLabelText('Positive prompt'));
        fireEvent.blur(screen.getByLabelText('Negative prompt'));

        expect(props.onUpdateModel).not.toHaveBeenCalled();
        expect(props.onUpdatePrompt).not.toHaveBeenCalled();
        expect(props.onUpdateNegativePrompt).not.toHaveBeenCalled();
    });

    it('presents an unresolved model hash without saving it as an override', async () => {
        const view = setup(false, {
            metadata: { ...video.metadata, model: 'Unknown', modelHash: 'f8bb2922e1' },
        });

        await waitFor(() => expect(screen.getByText('f8bb2922e1')).toBeTruthy());
        expect(screen.getByText('Unresolved hash')).toBeTruthy();
        expect(screen.queryByText('Model Hash')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        expect((screen.getByRole('combobox', { name: 'Search models' }) as HTMLInputElement).value).toBe('');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(view.props.onUpdateModel).not.toHaveBeenCalled();

        view.rerender(<VideoViewer
            {...view.props}
            video={{
                ...view.props.video,
                metadata: { ...view.props.video.metadata, model: 'Resolved model', modelHash: 'f8bb2922e1' },
            }}
        />);
        await waitFor(() => expect(screen.getByText('Resolved model')).toBeTruthy());
        expect(screen.queryByText('Unresolved hash')).toBeNull();
        expect(screen.getByText('Model Hash').parentElement?.textContent).toContain('f8bb2922e1');
    });

    it('discards metadata editor drafts when navigating between videos with equal values', async () => {
        const view = setup(false, {
            metadata: { ...video.metadata, tool: GeneratorTool.COMFYUI, model: 'Shared Model' },
        });

        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Generation Tool' })).toBeTruthy());
        fireEvent.click(screen.getByRole('button', { name: 'Edit Generation Tool' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Generator software' }), { target: { value: GeneratorTool.INVOKEAI } });
        view.rerender(<VideoViewer
            {...view.props}
            video={{ ...view.props.video, id: 'C:/videos/next.mp4' }}
        />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Generation Tool' })).toBeTruthy());
        expect(screen.queryByRole('button', { name: /save/i })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.click(screen.getByRole('option', { name: /Custom model/i }));
        fireEvent.change(screen.getByLabelText('Custom model name'), { target: { value: 'Unsaved Model' } });
        view.rerender(<VideoViewer
            {...view.props}
            video={{ ...view.props.video, id: 'C:/videos/third.mp4' }}
        />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Model' })).toBeTruthy());
        expect(screen.queryByLabelText('Custom model name')).toBeNull();
        expect(view.props.onUpdateTool).not.toHaveBeenCalled();
        expect(view.props.onUpdateModel).not.toHaveBeenCalled();
    });

    it('shows video evidence and exposes explicit metadata overrides', async () => {
        const { props } = setup(false, {
            metadata: {
                ...video.metadata,
                model: 'ltx-video.safetensors',
                seed: 42,
                steps: 24,
                cfg: 5,
                sampler: 'euler',
                loras: ['motion-detail'],
                controlNets: ['canny-video'],
                ipAdapters: ['reference-face'],
                positivePrompt: 'A moving test pattern',
                negativePrompt: 'static',
                fieldSources: {
                    ...video.metadata.fieldSources,
                    model: 'user_override',
                    overrideModel: 'user_override',
                    seed: 'trusted_sidecar',
                    steps: 'trusted_sidecar',
                    cfg: 'trusted_sidecar',
                    sampler: 'trusted_sidecar',
                },
                diagnostics: [{ code: 'sidecar_media_mismatch', message: 'Ignored mismatched sidecar' }]
            }
        });
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));

        expect(screen.getAllByRole('button', { name: 'Source: trusted sidecar' }).length).toBeGreaterThan(0);
        expect(screen.getByText('Ignored mismatched sidecar')).toBeTruthy();
        expect(screen.getByText('motion-detail')).toBeTruthy();
        expect(screen.getByText('canny-video')).toBeTruthy();
        expect(screen.getByText('reference-face')).toBeTruthy();
        const mode = screen.getByLabelText('Generation mode');
        const model = screen.getByRole('heading', { name: 'Model' });
        const prompt = screen.getByLabelText('Positive prompt');
        const parameters = screen.getByText('Seed').closest('dl');
        const seedRow = screen.getByText('Seed').parentElement;
        const negativePrompt = screen.getByLabelText('Negative prompt');
        expect(prompt.compareDocumentPosition(negativePrompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(negativePrompt.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(mode.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(model.compareDocumentPosition(parameters as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(seedRow?.children[1]?.textContent).toBe('42');
        expect(seedRow?.lastElementChild?.querySelector('button')?.getAttribute('aria-label')).toBe('Source: trusted sidecar');
        fireEvent.change(screen.getByLabelText('Generation mode'), { target: { value: 'guided_video' } });
        expect(props.onUpdateGenerationMode).toHaveBeenCalledWith(video.id, 'guided_video');

        fireEvent.change(prompt, { target: { value: 'Updated motion prompt' } });
        fireEvent.blur(prompt);
        expect(props.onUpdatePrompt).toHaveBeenCalledWith(video.id, 'Updated motion prompt');

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.click(screen.getByRole('option', { name: /Custom model/i }));
        fireEvent.change(screen.getByLabelText('Custom model name'), { target: { value: 'override.safetensors' } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(props.onUpdateModel).toHaveBeenCalledWith(video.id, 'override.safetensors');
        fireEvent.click(screen.getByRole('button', { name: 'Revert user overrides' }));
        expect(props.onRevertMetadata).toHaveBeenCalledWith(video.id);
    });

    it('shows the revert action only while user overrides exist', () => {
        const { rerender, props } = setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Metadata' }));
        expect(screen.queryByRole('button', { name: 'Revert user overrides' })).toBeNull();

        rerender(<VideoViewer
            {...props}
            video={{
                ...video,
                metadata: {
                    ...video.metadata,
                    fieldSources: { ...video.metadata.fieldSources, positivePrompt: 'user_override' },
                },
            }}
        />);
        expect(screen.getByRole('button', { name: 'Revert user overrides' })).toBeTruthy();
    });

    it('loads persisted collection membership when the viewer opens', async () => {
        mocks.getCollectionsForImage.mockResolvedValueOnce(['collection-1']);
        setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));

        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Favorites set' }).getAttribute('aria-pressed'),
            ).toBe('true'),
        );
        expect(mocks.getCollectionsForImage).toHaveBeenCalledWith(video.id);
    });

    it('shows a retryable error when collection membership cannot be loaded', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.getCollectionsForImage
            .mockRejectedValueOnce(new Error('sqlite busy'))
            .mockResolvedValueOnce(['collection-1']);
        setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));

        expect((await screen.findByRole('alert')).textContent).toContain('Could not load collection membership.');
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() =>
            expect(
                screen.getByRole('button', { name: 'Favorites set' }).getAttribute('aria-pressed'),
            ).toBe('true'),
        );
        expect(mocks.getCollectionsForImage).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalled();
    });

    it('seeks with visible controls and clamps at video boundaries', async () => {
        setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        Object.defineProperty(player, 'duration', { configurable: true, value: 30 });
        player.currentTime = 5;

        fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
        expect(player.currentTime).toBe(0);

        player.currentTime = 25;
        fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
        expect(player.currentTime).toBe(30);
    });

    it('uses J and L for seeking while preserving arrow gallery navigation', async () => {
        const { props } = setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
        player.currentTime = 30;

        fireEvent.keyDown(window, { key: 'j' });
        expect(player.currentTime).toBe(20);
        fireEvent.keyDown(window, { key: 'L' });
        expect(player.currentTime).toBe(30);

        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(props.onPrev).toHaveBeenCalledOnce();
        expect(props.onNext).toHaveBeenCalledOnce();
    });

    it('uses Space for playback and keeps close on Escape', async () => {
        const { props } = setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        const play = vi.spyOn(player, 'play').mockResolvedValue(undefined);
        const pause = vi.spyOn(player, 'pause').mockImplementation(() => undefined);

        Object.defineProperty(player, 'paused', { configurable: true, value: true });
        const playEvent = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
        window.dispatchEvent(playEvent);
        expect(playEvent.defaultPrevented).toBe(true);
        expect(play).toHaveBeenCalledOnce();

        Object.defineProperty(player, 'paused', { configurable: true, value: false });
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', cancelable: true }));
        expect(pause).toHaveBeenCalledOnce();

        const closeButton = screen.getByRole('button', { name: 'Close Viewer (Esc)' });
        closeButton.focus();
        fireEvent.keyDown(closeButton, { key: ' ' });
        expect(play).toHaveBeenCalledOnce();
        expect(pause).toHaveBeenCalledOnce();

        fireEvent.keyDown(closeButton, { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('closes from bare playback background but not from the player', async () => {
        const { props } = setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });

        fireEvent.click(player);
        expect(props.onClose).not.toHaveBeenCalled();

        fireEvent.click(player.parentElement as HTMLElement);
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('does not seek from editable controls or without finite media duration', async () => {
        setup();
        const player = await waitFor(() => {
            const element = document.querySelector('video') as HTMLVideoElement | null;
            expect(element).not.toBeNull();
            return element as HTMLVideoElement;
        });
        Object.defineProperty(player, 'duration', { configurable: true, value: Number.NaN });
        player.currentTime = 4;
        fireEvent.keyDown(window, { key: 'l' });
        expect(player.currentTime).toBe(4);

        Object.defineProperty(player, 'duration', { configurable: true, value: 60 });
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const notes = screen.getByLabelText('Notes');
        fireEvent.keyDown(notes, { key: 'l' });
        expect(player.currentTime).toBe(4);

        const speed = screen.getByRole('combobox');
        fireEvent.keyDown(speed, { key: 'j' });
        expect(player.currentTime).toBe(4);
    });

    it('uses source-neutral wording when no trusted workflow is available', () => {
        setup();
        fireEvent.click(screen.getByRole('tab', { name: 'Workflow' }));

        expect(screen.getByText('No trusted workflow evidence was found for this video.')).toBeTruthy();
        expect(screen.queryByText(/ComfyUI workflow evidence/)).toBeNull();
    });
});
