import * as React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '../../../constants/defaultSettings';
import type { useAppActions } from '../../../hooks/useAppActions';
import type { useCollectionOperations } from '../../../hooks/useCollectionOperations';
import type { useModalManager } from '../../../hooks/useModalManager';
import {
    AIImage,
    AppSettings,
    Collection,
    ContextMenuState,
    FilterState,
    GeneratorTool,
    ImageMetadata,
} from '../../../types';
import { AppContextMenu } from '../AppContextMenu';

interface ModelThumbnail {
    name: string;
    hash: string;
    type: string;
}

interface CapturedMenuProps extends Record<string, unknown> {
    x: number;
    y: number;
    isPinned?: boolean;
    isFavorite?: boolean;
    isMasked?: boolean;
    userMasked?: boolean;
    isIntermediate?: boolean;
    enableAI?: boolean;
    activeCollectionName?: string;
    onClose: () => void;
    onCopyPrompt: () => void;
    onCopySeed?: () => void;
    onCopyGenerationInfo: () => void;
    onCopyImage: () => Promise<void>;
    onCopyFilePath: () => void;
    onAddToCollection: () => void;
    onMoveToCollection: () => void;
    onRemoveFromCollection: () => void;
    onToggleFavorite: () => void;
    onTogglePin: () => void;
    onToggleMask: (value?: boolean | null) => void;
    onToggleIntermediate: () => Promise<void>;
    onDelete: () => void;
    onShowInFolder: () => Promise<void>;
    onOpenInDefaultApp: () => Promise<void>;
    onSetThumbnail?: () => Promise<void>;
    onUnsetThumbnail?: () => Promise<void>;
    modelsForThumbnail: ModelThumbnail[];
    onSetModelThumbnail: (model: ModelThumbnail) => Promise<void>;
}

const menuCapture = vi.hoisted(() => ({ props: null as CapturedMenuProps | null }));
const toastMocks = vi.hoisted(() => ({ addToast: vi.fn() }));
const settingsMock = vi.hoisted(() => ({
    state: null as unknown as { settings: AppSettings; privacyEnabled: boolean },
}));
const collectionMock = vi.hoisted(() => ({
    state: { collections: [] as Collection[] },
}));
const maskingMocks = vi.hoisted(() => ({ isImageMasked: vi.fn() }));
const runtimeMocks = vi.hoisted(() => ({ browserMockMode: false }));
const osMocks = vi.hoisted(() => ({
    showPathInFolder: vi.fn(),
    openFileInDefaultApp: vi.fn(),
    isOsOpenUnavailable: vi.fn(),
}));
const imageRepoMocks = vi.hoisted(() => ({ toggleImageIntermediate: vi.fn() }));
const tauriMocks = vi.hoisted(() => ({ invoke: vi.fn() }));
const queryMocks = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));

vi.mock('../ContextMenu', () => ({
    ContextMenu: (props: CapturedMenuProps) => {
        menuCapture.props = props;
        return <div data-testid="context-menu" />;
    },
}));

vi.mock('../../../hooks/useToast', () => ({
    useToast: () => toastMocks,
}));

vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: typeof settingsMock.state) => unknown) => selector(settingsMock.state),
}));

vi.mock('../../../stores/collectionStore', () => ({
    useCollectionStore: (selector: (state: typeof collectionMock.state) => unknown) => selector(collectionMock.state),
}));

vi.mock('../../../utils/maskingUtils', () => maskingMocks);

vi.mock('../../../services/runtime', () => ({
    isBrowserMockMode: () => runtimeMocks.browserMockMode,
}));

vi.mock('../../../services/osOpen', () => osMocks);

vi.mock('../../../services/db/imageRepo', () => imageRepoMocks);

vi.mock('@tauri-apps/api/core', () => tauriMocks);

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => queryMocks,
}));

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

const baseMetadata = (): ImageMetadata => ({
    tool: GeneratorTool.COMFYUI,
    model: 'dream-model.safetensors',
    modelHash: 'model-hash',
    seed: 42,
    steps: 28,
    cfg: 7,
    sampler: 'Euler',
    positivePrompt: 'a secret castle',
    negativePrompt: 'blurry',
    rawParameters: 'raw generation data',
    loras: ['lora:Detail (abc):0.8', '   '],
    embeddings: ['Embedding:1'],
    hypernetworks: ['HyperNet'],
    controlNets: ['Control (hash)'],
    ipAdapters: ['IP Adapter'],
    isIntermediate: false,
});

const createImage = (
    imageOverrides: Partial<Omit<AIImage, 'metadata'>> = {},
    metadataOverrides: Partial<ImageMetadata> = {},
): AIImage => ({
    id: 'C:/library/image.png',
    url: 'asset://image.png',
    thumbnailUrl: 'asset://thumb.png',
    filename: 'image.png',
    timestamp: 1,
    width: 1024,
    height: 768,
    isFavorite: true,
    isPinned: true,
    userMasked: true,
    ...imageOverrides,
    metadata: { ...baseMetadata(), ...metadataOverrides },
});

const createCollection = (overrides: Partial<Collection> = {}): Collection => ({
    id: 'collection-1',
    name: 'Favorites',
    imageIds: [],
    createdAt: 1,
    ...overrides,
});

const createFilters = (collectionId: string | null = 'collection-1'): FilterState => ({
    searchQuery: '',
    models: [],
    tools: [],
    loras: [],
    embeddings: [],
    hypernetworks: [],
    samplers: [],
    generationTypes: [],
    controlNets: [],
    ipAdapters: [],
    dateRange: 'all',
    favoritesOnly: false,
    collectionId,
});

const actionMocks = {
    toggleFavorite: vi.fn(),
    handlePinImage: vi.fn(),
    handleBulkMask: vi.fn(),
    requestDeleteForId: vi.fn(),
};

const collectionOperationMocks = {
    removeImagesFromCollection: vi.fn(),
    setCollectionThumbnail: vi.fn(),
    resetCollectionThumbnail: vi.fn(),
};

const modalMocks = {
    setAddToCollectionMode: vi.fn(),
    setSourceCollectionId: vi.fn(),
    openModal: vi.fn(),
};

const onClose = vi.fn();
const onMoveToCollection = vi.fn();
const clipboardWriteText = vi.fn();
const clipboardWrite = vi.fn();

const requireMenu = (): CapturedMenuProps => {
    if (!menuCapture.props) throw new Error('ContextMenu was not rendered');
    return menuCapture.props;
};

const renderMenu = ({
    contextMenu = { x: 12, y: 34, imageId: 'C:/library/image.png' },
    images = [createImage()],
    filters = createFilters(),
}: {
    contextMenu?: ContextMenuState | null;
    images?: AIImage[];
    filters?: FilterState;
} = {}) => render(
    <AppContextMenu
        contextMenu={contextMenu}
        onClose={onClose}
        images={images}
        actions={actionMocks as unknown as ReturnType<typeof useAppActions>}
        fileOps={{}}
        colOps={collectionOperationMocks as unknown as ReturnType<typeof useCollectionOperations>}
        onMoveToCollection={onMoveToCollection}
        modals={modalMocks as unknown as ReturnType<typeof useModalManager>}
        filters={filters}
    />,
);

describe('AppContextMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        menuCapture.props = null;
        runtimeMocks.browserMockMode = false;
        settingsMock.state = {
            settings: { ...createDefaultAppSettings(), enableAI: true, maskedKeywords: ['secret'] },
            privacyEnabled: true,
        };
        collectionMock.state.collections = [
            createCollection({ customThumbnail: 'custom.png' }),
            createCollection({ id: 'smart-1', name: 'Smart', filters: createFilters(null) }),
        ];
        maskingMocks.isImageMasked.mockReturnValue(true);
        osMocks.showPathInFolder.mockResolvedValue({ status: 'ok' });
        osMocks.openFileInDefaultApp.mockResolvedValue({ status: 'ok' });
        osMocks.isOsOpenUnavailable.mockImplementation((error: string) => error.includes('unavailable'));
        imageRepoMocks.toggleImageIntermediate.mockResolvedValue(undefined);
        collectionOperationMocks.setCollectionThumbnail.mockResolvedValue(undefined);
        collectionOperationMocks.resetCollectionThumbnail.mockResolvedValue(undefined);
        queryMocks.invalidateQueries.mockResolvedValue(undefined);
        tauriMocks.invoke.mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: clipboardWriteText, write: clipboardWrite },
        });
        vi.stubGlobal('ClipboardItem', class ClipboardItem {
            constructor(public readonly items: Record<string, Blob>) { }
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    afterAll(() => {
        if (clipboardDescriptor) {
            Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
        } else {
            Reflect.deleteProperty(navigator, 'clipboard');
        }
    });

    it('renders nothing when no menu was requested', () => {
        const { container } = renderMenu({ contextMenu: null });

        expect(container.innerHTML).toBe('');
        expect(menuCapture.props).toBeNull();
    });

    it('derives active collection, privacy, and model thumbnail resources', () => {
        renderMenu();

        const menu = requireMenu();
        expect(menu).toMatchObject({
            x: 12,
            y: 34,
            isPinned: true,
            isFavorite: true,
            isMasked: true,
            userMasked: true,
            isIntermediate: false,
            enableAI: true,
            activeCollectionName: 'Favorites',
        });
        expect(maskingMocks.isImageMasked).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'C:/library/image.png' }),
            true,
            ['secret'],
        );
        expect(menu.modelsForThumbnail).toEqual([
            { name: 'dream-model.safetensors', hash: 'model-hash', type: 'checkpoint' },
            { name: 'Detail', hash: 'lora_Detail', type: 'loras' },
            { name: 'Embedding', hash: 'emb_Embedding', type: 'embeddings' },
            { name: 'HyperNet', hash: 'hyper_HyperNet', type: 'hypernetworks' },
            { name: 'Control', hash: 'cnet_Control', type: 'control_nets' },
            { name: 'IP Adapter', hash: 'ipad_IP Adapter', type: 'ip_adapters' },
        ]);
    });

    it('supports object model names and smart collection labels', () => {
        const image = createImage({}, {
            model: { name: 'Object Model' } as unknown as string,
            modelHash: undefined,
            loras: undefined,
            embeddings: undefined,
            hypernetworks: undefined,
            controlNets: undefined,
            ipAdapters: undefined,
        });

        renderMenu({ images: [image], filters: createFilters('smart-1') });

        expect(requireMenu().activeCollectionName).toBe('Smart');
        expect(requireMenu().modelsForThumbnail).toEqual([
            { name: 'Object Model', hash: 'name:Object Model', type: 'checkpoint' },
        ]);
    });

    it('copies prompts, seeds, generation details, file paths, and image blobs', async () => {
        const blob = new Blob(['image'], { type: 'image/png' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ blob: vi.fn().mockResolvedValue(blob) }));
        renderMenu();
        const menu = requireMenu();

        menu.onCopyPrompt();
        menu.onCopySeed?.();
        menu.onCopyGenerationInfo();
        menu.onCopyFilePath();
        await menu.onCopyImage();

        expect(clipboardWriteText).toHaveBeenNthCalledWith(1, 'a secret castle');
        expect(clipboardWriteText).toHaveBeenNthCalledWith(2, '42');
        expect(clipboardWriteText).toHaveBeenNthCalledWith(3, expect.stringContaining('Negative Prompt: blurry'));
        expect(clipboardWriteText).toHaveBeenNthCalledWith(3, expect.stringContaining('Raw Parameters:\nraw generation data'));
        expect(clipboardWriteText).toHaveBeenNthCalledWith(4, 'C:/library/image.png');
        expect(clipboardWrite).toHaveBeenCalledOnce();
        expect(toastMocks.addToast).toHaveBeenCalledWith('Image copied to clipboard', 'success');
        expect(onClose).toHaveBeenCalledTimes(5);
    });

    it('falls back to the image URL when clipboard blob copying fails', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('blocked')));
        renderMenu();

        await requireMenu().onCopyImage();

        expect(clipboardWriteText).toHaveBeenCalledWith('asset://image.png');
        expect(toastMocks.addToast).toHaveBeenCalledWith('Image path copied (fallback)', 'info');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('routes collection and image mutations to their owning hooks', async () => {
        renderMenu();
        const menu = requireMenu();

        menu.onAddToCollection();
        menu.onMoveToCollection();
        menu.onRemoveFromCollection();
        menu.onToggleFavorite();
        menu.onTogglePin();
        menu.onToggleMask(false);
        await menu.onToggleIntermediate();
        menu.onDelete();

        expect(modalMocks.setAddToCollectionMode).toHaveBeenCalledWith('add');
        expect(modalMocks.setSourceCollectionId).toHaveBeenCalledWith(null);
        expect(modalMocks.openModal).toHaveBeenCalledWith('addToCollection');
        expect(onMoveToCollection).toHaveBeenCalledOnce();
        expect(collectionOperationMocks.removeImagesFromCollection).toHaveBeenCalledWith(
            ['C:/library/image.png'],
            'collection-1',
        );
        expect(actionMocks.toggleFavorite).toHaveBeenCalledWith('C:/library/image.png');
        expect(actionMocks.handlePinImage).toHaveBeenCalledWith('C:/library/image.png', false);
        expect(actionMocks.handleBulkMask).toHaveBeenCalledWith('C:/library/image.png', false);
        expect(imageRepoMocks.toggleImageIntermediate).toHaveBeenCalledWith('C:/library/image.png', true);
        expect(toastMocks.addToast).toHaveBeenCalledWith('Marked as intermediate', 'info');
        expect(actionMocks.requestDeleteForId).toHaveBeenCalledWith('C:/library/image.png');
    });

    it('reports filesystem open outcomes with the appropriate severity', async () => {
        renderMenu();
        const menu = requireMenu();

        await menu.onShowInFolder();
        osMocks.showPathInFolder.mockResolvedValueOnce({ status: 'error', error: 'shell unavailable' });
        await menu.onShowInFolder();
        osMocks.showPathInFolder.mockResolvedValueOnce({ status: 'error', error: 'permission denied' });
        await menu.onShowInFolder();
        osMocks.openFileInDefaultApp.mockResolvedValueOnce({ status: 'error', error: 'app unavailable' });
        await menu.onOpenInDefaultApp();
        osMocks.openFileInDefaultApp.mockResolvedValueOnce({ status: 'error', error: 'launch failed' });
        await menu.onOpenInDefaultApp();

        expect(osMocks.showPathInFolder).toHaveBeenCalledWith('C:/library/image.png');
        expect(osMocks.openFileInDefaultApp).toHaveBeenCalledWith('C:/library/image.png');
        expect(toastMocks.addToast).toHaveBeenCalledWith('Opening folder...', 'info');
        expect(toastMocks.addToast).toHaveBeenCalledWith('shell unavailable', 'info');
        expect(toastMocks.addToast).toHaveBeenCalledWith('permission denied', 'error');
        expect(toastMocks.addToast).toHaveBeenCalledWith('app unavailable', 'info');
        expect(toastMocks.addToast).toHaveBeenCalledWith('launch failed', 'error');
        expect(onClose).toHaveBeenCalledTimes(5);
    });

    it('sets and resets collection thumbnails and closes after failures', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        renderMenu();
        const menu = requireMenu();

        await menu.onSetThumbnail?.();
        await menu.onUnsetThumbnail?.();
        collectionOperationMocks.setCollectionThumbnail.mockRejectedValueOnce(new Error('set failed'));
        collectionOperationMocks.resetCollectionThumbnail.mockRejectedValueOnce(new Error('reset failed'));
        await menu.onSetThumbnail?.();
        await menu.onUnsetThumbnail?.();

        expect(collectionOperationMocks.setCollectionThumbnail).toHaveBeenCalledWith(
            'collection-1',
            expect.objectContaining({ id: 'C:/library/image.png' }),
        );
        expect(collectionOperationMocks.resetCollectionThumbnail).toHaveBeenCalledWith('collection-1');
        expect(toastMocks.addToast).toHaveBeenCalledWith('Failed to update thumbnail', 'error');
        expect(toastMocks.addToast).toHaveBeenCalledWith('Failed to reset thumbnail', 'error');
        expect(onClose).toHaveBeenCalledTimes(4);
        consoleError.mockRestore();
    });

    it('blocks model thumbnail writes in browser mode and invalidates stats after native writes', async () => {
        runtimeMocks.browserMockMode = true;
        const { rerender } = renderMenu();
        const model = { name: 'Detail', hash: 'lora_Detail', type: 'loras' };

        await requireMenu().onSetModelThumbnail(model);
        expect(tauriMocks.invoke).not.toHaveBeenCalled();
        expect(toastMocks.addToast).toHaveBeenCalledWith('Unavailable in browser mock mode.', 'info');

        runtimeMocks.browserMockMode = false;
        rerender(
            <AppContextMenu
                contextMenu={{ x: 12, y: 34, imageId: 'C:/library/image.png' }}
                onClose={onClose}
                images={[createImage()]}
                actions={actionMocks as unknown as ReturnType<typeof useAppActions>}
                fileOps={{}}
                colOps={collectionOperationMocks as unknown as ReturnType<typeof useCollectionOperations>}
                onMoveToCollection={onMoveToCollection}
                modals={modalMocks as unknown as ReturnType<typeof useModalManager>}
                filters={createFilters()}
            />,
        );
        await act(async () => requireMenu().onSetModelThumbnail(model));

        expect(tauriMocks.invoke).toHaveBeenCalledWith('set_model_thumbnail', {
            modelHash: 'lora_Detail',
            modelName: 'Detail',
            imagePath: 'C:/library/image.png',
            resourceType: 'loras',
        });
        expect(queryMocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['libraryStats'] });
        expect(toastMocks.addToast).toHaveBeenCalledWith('Thumbnail set for Detail', 'success');
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    });

    it('keeps optional actions safe when the selected image no longer exists', async () => {
        renderMenu({ images: [], filters: createFilters(null) });
        const menu = requireMenu();

        menu.onCopyPrompt();
        menu.onCopyGenerationInfo();
        await menu.onCopyImage();
        menu.onCopyFilePath();
        menu.onTogglePin();
        await menu.onToggleIntermediate();
        menu.onDelete();
        await menu.onShowInFolder();
        await menu.onOpenInDefaultApp();
        await menu.onSetModelThumbnail({ name: 'Missing', hash: 'none', type: 'checkpoint' });

        expect(menu.onCopySeed).toBeUndefined();
        expect(menu.onSetThumbnail).toBeUndefined();
        expect(menu.onUnsetThumbnail).toBeUndefined();
        expect(menu.modelsForThumbnail).toEqual([]);
        expect(actionMocks.handlePinImage).not.toHaveBeenCalled();
        expect(imageRepoMocks.toggleImageIntermediate).toHaveBeenCalledWith('C:/library/image.png', true);
        expect(tauriMocks.invoke).not.toHaveBeenCalled();
    });

    it('formats sparse generation metadata with placeholders and unmarks intermediates', async () => {
        const image = createImage({}, {
            tool: '' as GeneratorTool,
            model: '',
            modelHash: undefined,
            seed: undefined,
            steps: 0,
            cfg: 0,
            sampler: '',
            positivePrompt: '',
            negativePrompt: '',
            rawParameters: undefined,
            isIntermediate: true,
            loras: undefined,
            embeddings: undefined,
            hypernetworks: undefined,
            controlNets: undefined,
            ipAdapters: undefined,
        });
        renderMenu({ images: [image] });
        const menu = requireMenu();

        menu.onCopyGenerationInfo();
        await menu.onToggleIntermediate();

        expect(clipboardWriteText).toHaveBeenCalledWith(
            'Steps: ?, Sampler: ?, CFG scale: ?, Seed: ?, Size: 1024x768, Model: ?',
        );
        expect(imageRepoMocks.toggleImageIntermediate).toHaveBeenCalledWith('C:/library/image.png', false);
        expect(toastMocks.addToast).toHaveBeenCalledWith('Unmarked as intermediate', 'info');
        expect(menu.modelsForThumbnail).toEqual([]);
    });

    it('does not dispatch id-dependent actions for a blank menu image id', async () => {
        renderMenu({
            contextMenu: { x: 1, y: 2, imageId: '' },
            images: [],
            filters: createFilters(),
        });
        const menu = requireMenu();

        menu.onRemoveFromCollection();
        menu.onToggleFavorite();
        await menu.onToggleIntermediate();
        menu.onDelete();
        await menu.onShowInFolder();
        await menu.onOpenInDefaultApp();
        await menu.onSetModelThumbnail({ name: 'Missing', hash: 'none', type: 'checkpoint' });

        expect(collectionOperationMocks.removeImagesFromCollection).not.toHaveBeenCalled();
        expect(actionMocks.toggleFavorite).not.toHaveBeenCalled();
        expect(imageRepoMocks.toggleImageIntermediate).not.toHaveBeenCalled();
        expect(actionMocks.requestDeleteForId).not.toHaveBeenCalled();
        expect(osMocks.showPathInFolder).not.toHaveBeenCalled();
        expect(osMocks.openFileInDefaultApp).not.toHaveBeenCalled();
        expect(tauriMocks.invoke).not.toHaveBeenCalled();
    });

    it('uses checkpoint fallback names only when a model hash is available', () => {
        const namelessObject = createImage({}, {
            model: { name: undefined } as unknown as string,
            modelHash: undefined,
            loras: undefined,
            embeddings: undefined,
            hypernetworks: undefined,
            controlNets: undefined,
            ipAdapters: undefined,
        });
        renderMenu({ images: [namelessObject] });
        expect(requireMenu().modelsForThumbnail).toEqual([]);

        const hashOnly = createImage({}, {
            model: null as unknown as string,
            modelHash: 'hash-only',
            loras: undefined,
            embeddings: undefined,
            hypernetworks: undefined,
            controlNets: undefined,
            ipAdapters: undefined,
        });
        renderMenu({ images: [hashOnly] });

        expect(requireMenu().modelsForThumbnail).toEqual([
            { name: 'Checkpoint', hash: 'hash-only', type: 'checkpoint' },
        ]);
    });
});
