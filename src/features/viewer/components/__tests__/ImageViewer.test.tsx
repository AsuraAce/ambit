import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { ImageViewer } from '../ImageViewer';

const mockGetImageWithFullMetadata = vi.fn();
const mockMetadataSidebar = vi.fn();
const captures = vi.hoisted(() => ({
    toolbar: null as Record<string, unknown> | null,
    canvas: null as Record<string, unknown> | null,
    sidebar: null as Record<string, unknown> | null,
    versions: null as Record<string, unknown> | null,
    aiModal: null as Record<string, unknown> | null,
    aiConfig: null as Record<string, unknown> | null,
}));
const zoomMocks = vi.hoisted(() => ({ resetZoom: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());
const openFileMock = vi.hoisted(() => vi.fn());
const assetAccessMock = vi.hoisted(() => vi.fn());
const aiState = vi.hoisted(() => ({
    value: {
        modalOpen: false,
        modalType: 'analysis',
        result: null as string | null,
        isAnalyzing: false,
        closeModal: vi.fn(),
        openModal: vi.fn(),
        analyzePrompt: vi.fn(),
        generateVariations: vi.fn(),
    }
}));

vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
            <div {...props}>{children}</div>
        ),
    },
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    getImageWithFullMetadata: (...args: unknown[]) => mockGetImageWithFullMetadata(...args),
}));

vi.mock('../MetadataSidebar', () => ({
    MetadataSidebar: (props: { image: AIImage } & Record<string, unknown>) => {
        mockMetadataSidebar(props);
        captures.sidebar = props;
        return <div data-testid="metadata-sidebar" />;
    },
}));

vi.mock('../ImageCanvas', () => ({
    ImageCanvas: (props: Record<string, unknown>) => {
        captures.canvas = props;
        return <div data-testid="image-canvas" />;
    },
}));

vi.mock('../ViewerToolbar', () => ({
    ViewerToolbar: (props: Record<string, unknown>) => {
        captures.toolbar = props;
        return <div data-testid="viewer-toolbar" />;
    },
}));

vi.mock('../VersionSelector', () => ({
    VersionSelector: (props: Record<string, unknown>) => {
        captures.versions = props;
        return <div data-testid="version-selector" />;
    },
}));

vi.mock('../AIResultModal', () => ({
    AIResultModal: (props: Record<string, unknown>) => {
        captures.aiModal = props;
        return <div data-testid="ai-result-modal" />;
    },
}));

vi.mock('../../../../hooks/useZoomPan', () => ({
    useZoomPan: () => ({
        scale: 1,
        position: { x: 0, y: 0 },
        isDragging: false,
        resetZoom: zoomMocks.resetZoom,
        zoomIn: zoomMocks.zoomIn,
        zoomOut: zoomMocks.zoomOut,
        handlers: {},
    }),
}));

vi.mock('../../../../hooks/usePalette', () => ({
    usePalette: () => ({ palette: [], isLoading: false }),
}));

vi.mock('../../../../hooks/useImageAI', () => ({
    useImageAI: (config: Record<string, unknown>) => {
        captures.aiConfig = config;
        return aiState.value;
    },
}));

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: { settings: Record<string, unknown> }) => unknown) => (
        selector({
            settings: {
                enableAI: true,
                aiModel: 'gemini-3.1-flash-lite',
                aiThinkingMode: 'default',
            },
        })
    ),
}));

vi.mock('../../../../stores/collectionStore', () => ({
    useCollectionStore: (selector: (state: { collections: never[] }) => unknown) => (
        selector({ collections: [] })
    ),
}));

vi.mock('../../../../services/assetScope', () => ({
    ensureAssetPathAccessible: (...args: unknown[]) => assetAccessMock(...args),
}));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({ addToast: toastMock }),
}));

vi.mock('../../../../services/osOpen', () => ({
    openFileInDefaultApp: (...args: unknown[]) => openFileMock(...args),
    isOsOpenUnavailable: (message: string) => message.includes('unavailable'),
}));

const metadata = (positivePrompt: string) => ({
    tool: GeneratorTool.UNKNOWN,
    model: 'Unknown',
    seed: 0,
    steps: 0,
    cfg: 0,
    sampler: 'Unknown',
    positivePrompt,
    negativePrompt: '',
});

const lightImage: AIImage = {
    id: 'C:/library/image.png',
    url: 'asset://image.png',
    thumbnailUrl: 'asset://thumb.webp',
    filename: 'image.png',
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata: metadata('Recovered prompt'),
};

const renderViewer = (overrides: Partial<React.ComponentProps<typeof ImageViewer>> = {}) => {
    const props: React.ComponentProps<typeof ImageViewer> = {
        image: lightImage,
        onSetCollectionMembership: vi.fn().mockResolvedValue(true),
        onClose: vi.fn(),
        onNext: vi.fn(),
        onPrev: vi.fn(),
        onSearch: vi.fn(),
        onToggleFavorite: vi.fn(),
        onOpenSettings: vi.fn(),
        isOpen: true,
        ...overrides,
    };
    return { ...render(<ImageViewer {...props} />), props };
};

describe('ImageViewer full metadata loading', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.keys(captures).forEach(key => {
            captures[key as keyof typeof captures] = null;
        });
        aiState.value.modalOpen = false;
        aiState.value.modalType = 'analysis';
        aiState.value.result = null;
        aiState.value.isAnalyzing = false;
        assetAccessMock.mockResolvedValue(undefined);
        mockGetImageWithFullMetadata.mockResolvedValue(lightImage);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('keeps persisted original metadata when a lightweight image omits it after restart', async () => {
        const originalMetadata = {
            ...metadata('Original prompt'),
            seed: 42,
            steps: 30,
            cfg: 8,
            sampler: 'DPM++',
        };
        const originalChunks = { parameters: 'raw metadata' };
        const originalState = { isFavorite: false };
        mockGetImageWithFullMetadata.mockResolvedValue({
            ...lightImage,
            metadata: {
                ...originalMetadata,
                positivePrompt: 'Recovered prompt',
            },
            originalMetadata,
            originalChunks,
            originalState,
        });

        render(<ImageViewer
            image={lightImage}
            onSetCollectionMembership={vi.fn().mockResolvedValue(true)}
            onClose={vi.fn()}
            onNext={vi.fn()}
            onPrev={vi.fn()}
            onSearch={vi.fn()}
            onToggleFavorite={vi.fn()}
            onOpenSettings={vi.fn()}
            isOpen
        />);

        await waitFor(() => {
            const latestProps = mockMetadataSidebar.mock.calls.at(-1)?.[0] as { image: AIImage };
            expect(latestProps.image.originalMetadata).toEqual(originalMetadata);
            expect(latestProps.image.originalChunks).toEqual(originalChunks);
            expect(latestProps.image.originalState).toEqual(originalState);
            expect(latestProps.image.metadata.positivePrompt).toBe('Recovered prompt');
            expect(latestProps.image.metadata).toMatchObject({
                seed: 42,
                steps: 30,
                cfg: 8,
                sampler: 'DPM++',
            });
        });
    });

    it('renders nothing while closed and ignores viewer shortcuts', () => {
        const onNext = vi.fn();
        const { container } = renderViewer({ isOpen: false, onNext });
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(container.firstChild).toBeNull();
        expect(onNext).not.toHaveBeenCalled();
    });

    it('handles navigation, actions, theater mode, and input shortcut guards', async () => {
        const onNext = vi.fn();
        const onPrev = vi.fn();
        const onClose = vi.fn();
        const onToggleFavorite = vi.fn();
        const onTogglePin = vi.fn();
        const onToggleSidebar = vi.fn();
        const onDelete = vi.fn();
        const { container } = renderViewer({
            onNext, onPrev, onClose, onToggleFavorite, onTogglePin, onToggleSidebar, onDelete
        });
        await waitFor(() => expect(mockMetadataSidebar).toHaveBeenCalled());

        for (const key of ['ArrowRight', 'ArrowLeft', 'f', 'p', 'i']) {
            act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })));
        }
        expect(onNext).toHaveBeenCalled();
        expect(onPrev).toHaveBeenCalled();
        expect(onToggleFavorite).toHaveBeenCalledWith(lightImage.id);
        expect(onTogglePin).toHaveBeenCalledWith(lightImage.id, true);
        expect(onToggleSidebar).toHaveBeenCalled();

        const spaceEvent = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
        act(() => window.dispatchEvent(spaceEvent));
        expect(spaceEvent.defaultPrevented).toBe(true);
        expect(onClose).toHaveBeenCalledOnce();

        const deleteEvent = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });
        act(() => window.dispatchEvent(deleteEvent));
        expect(deleteEvent.defaultPrevented).toBe(true);
        expect(onDelete).toHaveBeenCalledWith(lightImage.id);

        const backspaceEvent = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
        act(() => window.dispatchEvent(backspaceEvent));
        expect(backspaceEvent.defaultPrevented).toBe(true);
        expect(onDelete).toHaveBeenCalledTimes(2);

        act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' })));
        expect(container.firstElementChild?.className).toContain('bg-black');
        act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
        expect(container.firstElementChild?.className).not.toContain('bg-black');
        act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
        expect(onClose).toHaveBeenCalled();

        const input = document.createElement('input');
        document.body.appendChild(input);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
        expect(onNext).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(2);
        expect(onClose).toHaveBeenCalledTimes(2);
        input.remove();
    });

    it('lets the AI modal own shortcuts and closes it before the viewer on Escape', () => {
        aiState.value.modalOpen = true;
        const onClose = vi.fn();
        const onDelete = vi.fn();
        const onNext = vi.fn();
        const onToggleFavorite = vi.fn();
        renderViewer({ onClose, onDelete, onNext, onToggleFavorite });

        for (const key of [' ', 'Delete', 'Backspace', 'ArrowRight', 'f', 'z']) {
            act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })));
        }

        expect(onClose).not.toHaveBeenCalled();
        expect(onDelete).not.toHaveBeenCalled();
        expect(onNext).not.toHaveBeenCalled();
        expect(onToggleFavorite).not.toHaveBeenCalled();

        act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));

        expect(aiState.value.closeModal).toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('leaves all viewer shortcuts to an external modal while blocked', () => {
        const onClose = vi.fn();
        const onDelete = vi.fn();
        const onNext = vi.fn();
        const onToggleFavorite = vi.fn();
        renderViewer({ isShortcutBlocked: true, onClose, onDelete, onNext, onToggleFavorite });

        for (const key of [' ', 'Delete', 'Backspace', 'ArrowRight', 'f', 'z', 'Escape']) {
            act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key })));
        }

        expect(onClose).not.toHaveBeenCalled();
        expect(onDelete).not.toHaveBeenCalled();
        expect(onNext).not.toHaveBeenCalled();
        expect(onToggleFavorite).not.toHaveBeenCalled();
    });

    it('forwards sidebar edits, searches, collections, and AI commands', async () => {
        aiState.value.result = 'analysis result';
        const callbacks = {
            onUpdateNotes: vi.fn(), onUpdatePrompt: vi.fn(), onUpdateNegativePrompt: vi.fn(),
            onUpdateModel: vi.fn(), onUpdateTool: vi.fn(), onSetCollectionMembership: vi.fn().mockResolvedValue(true),
            onSearch: vi.fn(), onRecoverMetadata: vi.fn(), onRevertMetadata: vi.fn(), onOpenSettings: vi.fn()
        };
        renderViewer(callbacks);
        await waitFor(() => expect(captures.sidebar).toBeTruthy());
        const sidebar = captures.sidebar as {
            setActiveTab: (tab: 'edit') => void;
            setNotes: (value: string) => void; setPromptValue: (value: string) => void;
            setNegativePromptValue: (value: string) => void;
            onUpdateNotes: (id: string, value: string) => void;
            onUpdatePrompt: (id: string, value: string) => void;
            onUpdateNegativePrompt: (id: string, value: string) => void;
            onUpdateModel: (id: string, value: string) => void;
            onUpdateTool: (id: string, value: GeneratorTool) => void;
            onSetCollectionMembership: (id: string, collection: string, shouldBelong: boolean) => Promise<boolean>;
            onSearch: (term: string) => void;
            onRecoverMetadata: () => void; onRevertMetadata: (id: string) => void;
            onAIAnalysis: () => void; onGenerateVariations: () => void; onOpenAIResult: () => void;
        };
        act(() => {
            sidebar.setActiveTab('edit');
            sidebar.setNotes('note');
            sidebar.setPromptValue('prompt');
            sidebar.setNegativePromptValue('negative');
        });
        sidebar.onUpdateNotes('id', 'note');
        sidebar.onUpdatePrompt('id', 'prompt');
        sidebar.onUpdateNegativePrompt('id', 'negative');
        sidebar.onUpdateModel('id', 'Flux');
        sidebar.onUpdateTool('id', GeneratorTool.COMFYUI);
        await sidebar.onSetCollectionMembership('id', 'collection', true);
        sidebar.onSearch('term');
        sidebar.onRecoverMetadata();
        sidebar.onRevertMetadata('id');
        sidebar.onAIAnalysis();
        sidebar.onGenerateVariations();
        sidebar.onOpenAIResult();
        expect(callbacks.onUpdateNotes).toHaveBeenCalledWith('id', 'note');
        expect(callbacks.onUpdatePrompt).toHaveBeenCalledWith('id', 'prompt');
        expect(callbacks.onUpdateNegativePrompt).toHaveBeenCalledWith('id', 'negative');
        expect(callbacks.onUpdateModel).toHaveBeenCalledWith('id', 'Flux');
        expect(callbacks.onUpdateTool).toHaveBeenCalledWith('id', GeneratorTool.COMFYUI);
        expect(callbacks.onSetCollectionMembership).toHaveBeenCalledWith('id', 'collection', true);
        expect(aiState.value.analyzePrompt).toHaveBeenCalledWith('Recovered prompt', callbacks.onOpenSettings);
        expect(aiState.value.generateVariations).toHaveBeenCalledWith('Recovered prompt', callbacks.onOpenSettings);
        expect(aiState.value.openModal).toHaveBeenCalled();
    });

    it('sorts stacked versions and loads the selected version metadata', async () => {
        const small = { ...lightImage, id: 'small', width: 64, height: 64 };
        const large = { ...lightImage, id: 'large', width: 512, height: 512 };
        const stacked = { ...lightImage, stack: [large, small] };
        mockGetImageWithFullMetadata.mockImplementation(async (id: string) => ({
            ...(id === 'large' ? large : lightImage),
            metadata: metadata(id)
        }));
        renderViewer({ image: stacked });
        await waitFor(() => expect(captures.versions).toBeTruthy());
        const versions = captures.versions as {
            versions: AIImage[]; onVersionSelect: (id: string) => void; activeVersionId: string;
        };
        expect(versions.versions.map(image => image.id)).toEqual(['small', 'large']);

        act(() => versions.onVersionSelect('large'));
        await waitFor(() => expect(mockGetImageWithFullMetadata).toHaveBeenCalledWith('large'));
        await waitFor(() => {
            const sidebar = captures.sidebar as { image: AIImage };
            expect(sidebar.image.id).toBe('large');
        });
    });

    it('runs toolbar clipboard, external-open, share, toggle, favorite, pin, and delete actions', async () => {
        const clipboardWrite = vi.fn().mockResolvedValue(undefined);
        const clipboardWriteText = vi.fn().mockResolvedValue(undefined);
        const share = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true, value: { write: clipboardWrite, writeText: clipboardWriteText }
        });
        Object.defineProperty(navigator, 'share', { configurable: true, value: share });
        vi.stubGlobal('ClipboardItem', class ClipboardItem {
            constructor(public value: Record<string, Blob>) {}
        });
        const blob = new Blob(['image'], { type: 'image/png' });
        const fetchMock = vi.fn().mockResolvedValue({ blob: vi.fn().mockResolvedValue(blob) });
        vi.stubGlobal('fetch', fetchMock);
        openFileMock
            .mockResolvedValueOnce({ status: 'error', error: 'open unavailable' })
            .mockResolvedValueOnce({ status: 'error', error: 'permission denied' })
            .mockResolvedValueOnce({ status: 'ok' });
        const onToggleFavorite = vi.fn();
        const onTogglePin = vi.fn();
        const onDelete = vi.fn();
        const { container } = renderViewer({ onToggleFavorite, onTogglePin, onDelete });
        await waitFor(() => expect(captures.toolbar).toBeTruthy());
        const toolbar = captures.toolbar as {
            onCopy: () => Promise<void>; onOpenExternal: () => Promise<void>; onShare: () => void;
            onToggleTheater: () => void; onToggleFavorite: () => void; onTogglePin: () => void;
            onDelete: () => void;
        };

        await toolbar.onCopy();
        expect(clipboardWrite).toHaveBeenCalled();
        fetchMock.mockRejectedValueOnce(new Error('copy failed'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        await toolbar.onCopy();
        expect(errorSpy).toHaveBeenCalledWith('Copy failed', expect.any(Error));
        errorSpy.mockRestore();

        await toolbar.onOpenExternal();
        await toolbar.onOpenExternal();
        await toolbar.onOpenExternal();
        expect(toastMock).toHaveBeenNthCalledWith(1, 'open unavailable', 'info');
        expect(toastMock).toHaveBeenNthCalledWith(2, 'permission denied', 'error');
        toolbar.onShare();
        expect(share).toHaveBeenCalledWith({ title: lightImage.filename, url: lightImage.url });
        act(() => {
            toolbar.onToggleFavorite();
            toolbar.onTogglePin();
        });
        toolbar.onDelete();
        expect(onToggleFavorite).toHaveBeenCalledWith(lightImage.id);
        expect(onTogglePin).toHaveBeenCalledWith(lightImage.id, true);
        expect(onDelete).toHaveBeenCalledWith(lightImage.id);
        act(() => toolbar.onToggleTheater());
        expect(container.firstElementChild?.className).toContain('bg-black');
        const canvas = captures.canvas as { onToggleTheater: () => void };
        act(() => canvas.onToggleTheater());
        expect(container.firstElementChild?.className).not.toContain('bg-black');

        const modal = captures.aiModal as { onCopy: (text: string) => Promise<void> };
        await modal.onCopy('AI text');
        expect(clipboardWriteText).toHaveBeenCalledWith('AI text');
        vi.unstubAllGlobals();
    });

    it('omits sharing, pinning, and deletion when browser or callbacks are unavailable', () => {
        Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        renderViewer();
        const toolbar = captures.toolbar as {
            onShare: () => void; onTogglePin?: () => void; onDelete?: () => void;
        };
        toolbar.onShare();
        expect(toolbar.onTogglePin).toBeUndefined();
        expect(toolbar.onDelete).toBeUndefined();
    });

    it('hides controls and status HUD on timers and reveals them on movement and actions', async () => {
        vi.useFakeTimers();
        const onToggleFavorite = vi.fn();
        const { container } = renderViewer({ isSidebarOpen: false, onToggleFavorite });
        await act(async () => Promise.resolve());
        const leftArea = container.querySelector('[data-testid="viewer-toolbar"]')?.parentElement as HTMLElement;

        act(() => vi.advanceTimersByTime(3000));
        expect((captures.toolbar as { showControls: boolean }).showControls).toBe(false);
        fireEvent.mouseMove(leftArea);
        act(() => vi.advanceTimersByTime(2999));
        expect((captures.toolbar as { showControls: boolean }).showControls).toBe(true);
        act(() => vi.advanceTimersByTime(1));
        expect((captures.toolbar as { showControls: boolean }).showControls).toBe(false);

        const toolbar = captures.toolbar as { onToggleFavorite: () => void };
        act(() => toolbar.onToggleFavorite());
        expect(onToggleFavorite).toHaveBeenCalled();
        act(() => vi.advanceTimersByTime(2000));
        expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it('handles metadata and asset loading failures and forwards AI errors to toast', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mockGetImageWithFullMetadata.mockRejectedValue(new Error('metadata failed'));
        assetAccessMock.mockRejectedValue(new Error('scope failed'));
        renderViewer();

        await waitFor(() => expect(assetAccessMock).toHaveBeenCalled());
        await waitFor(() => expect(warnSpy).toHaveBeenCalledWith(
            '[ImageViewer] Failed to register image path for viewer', expect.any(Error)
        ));
        const config = captures.aiConfig as { onError: (message: string) => void };
        config.onError('AI failed');
        expect(toastMock).toHaveBeenCalledWith('AI failed', 'error');
        warnSpy.mockRestore();
    });

    it('handles active HUD styling, empty buffers, override models, null metadata, and missing versions', async () => {
        vi.useFakeTimers();
        const version = { ...lightImage, id: 'version', width: 10, height: 10 };
        const image: AIImage = {
            ...lightImage,
            isFavorite: false,
            isPinned: true,
            notes: undefined,
            metadata: { ...metadata(''), negativePrompt: '', overrideModel: 'Override Model' },
            stack: [version]
        };
        mockGetImageWithFullMetadata.mockResolvedValue(null);
        const { container } = renderViewer({ image });
        await act(async () => Promise.resolve());
        expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('not liked, pinned');
        const sidebar = captures.sidebar as {
            notes: string; promptValue: string; negativePromptValue: string; image: AIImage;
        };
        expect(sidebar).toMatchObject({ notes: '', promptValue: '', negativePromptValue: '' });
        expect(sidebar.image.metadata.overrideModel).toBe('Override Model');

        const selector = captures.versions as { onVersionSelect: (id: string) => void };
        act(() => selector.onVersionSelect('missing-version'));
        await act(async () => Promise.resolve());
        expect((captures.sidebar as { image: AIImage }).image.id).toBe(lightImage.id);

        act(() => vi.advanceTimersByTime(1600));
        const status = container.querySelector('[role="status"]');
        expect(status).toBeTruthy();
        expect(status?.querySelector('.opacity-0')).toBeTruthy();
    });

    it('starts a mouse-hide timer when controls have no existing timer', () => {
        vi.useFakeTimers();
        const { container } = renderViewer({ isSidebarOpen: true });
        const leftArea = container.querySelector('[data-testid="viewer-toolbar"]')?.parentElement as HTMLElement;
        fireEvent.mouseMove(leftArea);
        act(() => vi.advanceTimersByTime(3000));
        expect((captures.toolbar as { showControls: boolean }).showControls).toBe(false);
    });

    it('preserves a reactive override model while merging matching full metadata', async () => {
        const image: AIImage = {
            ...lightImage,
            metadata: { ...lightImage.metadata, overrideModel: 'Reactive Override' }
        };
        mockGetImageWithFullMetadata.mockResolvedValue({
            ...lightImage,
            metadata: { ...lightImage.metadata, model: 'Persisted Model' }
        });
        renderViewer({ image });

        await waitFor(() => {
            const sidebar = captures.sidebar as { image: AIImage };
            expect(sidebar.image.metadata).toMatchObject({
                model: 'Persisted Model',
                overrideModel: 'Reactive Override'
            });
        });
    });

    it('announces and styles a favorite-only image', () => {
        const { container } = renderViewer({
            image: { ...lightImage, isFavorite: true, isPinned: false }
        });
        const status = container.querySelector('[role="status"]');
        expect(status?.getAttribute('aria-label')).toBe('liked, not pinned');
        expect(status?.querySelector('.fill-current')).toBeTruthy();
    });
});
