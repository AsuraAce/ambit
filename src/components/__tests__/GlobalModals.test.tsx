import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type Collection } from '../../types';
import { createDefaultAppSettings } from '../../constants/defaultSettings';
import { createDefaultFilters } from '../../utils/filterState';
import { GlobalModals } from '../GlobalModals';

const captures = vi.hoisted(() => ({
    props: {} as Record<string, Record<string, unknown>>,
    confirms: [] as Record<string, unknown>[]
}));

const modalButton = (name: string, props: Record<string, unknown>) => {
    captures.props[name] = props;
    return <button onClick={() => (props.onClose as () => void)()}>{`close-${name}`}</button>;
};

vi.mock('../ui/ConfirmDialog', () => ({
    ConfirmDialog: (props: Record<string, unknown>) => {
        captures.confirms.push(props);
        return <div>{String(props.title)}: {String(props.message)}</div>;
    }
}));
vi.mock('../../features/settings/components/SettingsModal', () => ({ SettingsModal: (props: Record<string, unknown>) => modalButton('settings', props) }));
vi.mock('../../features/library/components/ExportModal', () => ({ ExportModal: (props: Record<string, unknown>) => modalButton('export', props) }));
vi.mock('../../features/viewer/components/SlideshowModal', () => ({ SlideshowModal: (props: Record<string, unknown>) => modalButton('slideshow', props) }));
vi.mock('../../features/library/components/MetadataRecoveryModal', () => ({ MetadataRecoveryModal: (props: Record<string, unknown>) => modalButton('recovery', props) }));
vi.mock('../../features/collections/components/AddToCollectionModal', () => ({ AddToCollectionModal: (props: Record<string, unknown>) => modalButton('addToCollection', props) }));
vi.mock('../ui/CommandPalette', () => ({ CommandPalette: (props: Record<string, unknown>) => modalButton('commandPalette', props) }));
vi.mock('../ui/ShortcutsModal', () => ({ ShortcutsModal: (props: Record<string, unknown>) => modalButton('shortcuts', props) }));
vi.mock('../../features/viewer/components/CompareModal', () => ({ CompareModal: (props: Record<string, unknown>) => modalButton('compare', props) }));
vi.mock('../ui/DonationModal', () => ({ DonationModal: (props: Record<string, unknown>) => modalButton('donation', props) }));
vi.mock('../../features/collections/components/CollectionEditorModal', () => ({ CollectionEditorModal: (props: Record<string, unknown>) => modalButton('collectionEditor', props) }));

const image = (id: string): AIImage => ({
    id,
    url: `${id}.png`,
    thumbnailUrl: `${id}-thumb.png`,
    filename: `${id}.png`,
    width: 10,
    height: 10,
    timestamp: 1,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.COMFYUI,
        model: 'model',
        steps: 1,
        cfg: 1,
        sampler: 'euler',
        positivePrompt: '',
        negativePrompt: ''
    }
});

const collection = (id: string, filters?: ReturnType<typeof createDefaultFilters>): Collection => ({
    id,
    name: id,
    imageIds: [],
    createdAt: 1,
    filters
});

const allOpen: Record<string, boolean> = {
    settings: true,
    export: true,
    deleteConfirm: true,
    deleteCollection: true,
    slideshow: true,
    recovery: true,
    addToCollection: true,
    commandPalette: true,
    shortcuts: true,
    compare: true,
    donation: true,
    collectionEditor: true
};

const setup = (overrides: Partial<React.ComponentProps<typeof GlobalModals>> = {}) => {
    const settings = createDefaultAppSettings();
    const props: React.ComponentProps<typeof GlobalModals> = {
        modals: allOpen,
        setModals: vi.fn(),
        selectedIds: new Set(['a', 'b']),
        filteredImages: [image('a'), image('b')],
        canCheckForUpdates: true,
        onSettingsSave: vi.fn(),
        onExportConfirm: vi.fn(),
        onDeleteConfirm: vi.fn(),
        onDeleteCollectionConfirm: vi.fn(),
        onRecoverMetadata: vi.fn(),
        onCollectionAction: vi.fn(),
        onCloseExport: vi.fn(),
        exportIds: new Set(),
        pendingViewerDeleteId: null,
        collectionToDeleteId: 'regular',
        addToCollectionMode: 'move',
        sourceCollectionId: 'source',
        isRecoveringMetadata: true,
        isExporting: true,
        slideshowShuffle: true,
        initialSettingsTab: 'resources',
        shortcutsModalTab: 'search',
        commandPaletteProps: {
            onNavigate: vi.fn(),
            onToggleTheme: vi.fn(),
            onOpenSettings: vi.fn(),
            onImport: vi.fn(),
            onCreateCollection: vi.fn(),
            onToggleAI: vi.fn(),
            settings
        },
        collections: [collection('regular')],
        smartCollections: [collection('smart', createDefaultFilters())],
        toggleFavorite: vi.fn(),
        togglePin: vi.fn(),
        settings,
        filters: createDefaultFilters(),
        collectionToEditId: 'smart',
        onSaveCollectionFilters: vi.fn(),
        onScanFolder: vi.fn(),
        onInvokeSync: vi.fn(),
        hasPendingUpdate: true,
        pendingUpdateVersion: '2.0.0',
        updateErrorMessage: 'error',
        updateStatus: 'available',
        onCheckForUpdates: vi.fn(),
        onOpenUpdatePrompt: vi.fn(),
        onNavigateToMaintenance: vi.fn(),
        ...overrides
    };
    render(<GlobalModals {...props} />);
    return props;
};

describe('GlobalModals', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        captures.props = {};
        captures.confirms = [];
    });

    it('renders every modal with its public data contract and routes all close actions', async () => {
        const props = setup();
        await screen.findByText('close-settings');
        expect(Object.keys(captures.props)).toHaveLength(10);

        expect(captures.props.settings).toMatchObject({ initialTab: 'resources', hasPendingUpdate: true, pendingUpdateVersion: '2.0.0' });
        expect(captures.props.export).toMatchObject({ count: 2, isExporting: true });
        expect(captures.props.slideshow).toMatchObject({ initialIndex: 0, isShuffleDefault: true });
        expect(captures.props.recovery).toMatchObject({ isProcessing: true });
        expect(captures.props.addToCollection).toMatchObject({ selectedIds: ['a', 'b'], mode: 'move', sourceCollectionId: 'source' });
        expect(captures.props.shortcuts).toMatchObject({ initialTab: 'search' });
        expect(captures.props.collectionEditor.collection).toMatchObject({ id: 'smart' });

        for (const name of Object.keys(captures.props)) {
            fireEvent.click(screen.getByText(`close-${name}`));
        }
        expect(props.setModals).toHaveBeenCalledTimes(10);
        expect(props.onCloseExport).toHaveBeenCalledOnce();

        const updates = vi.mocked(props.setModals).mock.calls.map(([update]) =>
            (update as (value: Record<string, boolean>) => Record<string, boolean>)(allOpen)
        );
        expect(updates).toEqual(expect.arrayContaining([
            expect.objectContaining({ settings: false }),
            expect.objectContaining({ collectionEditor: false })
        ]));
    });

    it('routes confirmation actions and uses selected-count delete copy', () => {
        const props = setup();
        expect(captures.confirms).toHaveLength(2);
        expect(captures.confirms[0].message).toContain('Remove 2 image(s)');
        (captures.confirms[0].onConfirm as () => void)();
        (captures.confirms[0].onCancel as () => void)();
        (captures.confirms[1].onConfirm as () => void)();
        (captures.confirms[1].onCancel as () => void)();
        expect(props.onDeleteConfirm).toHaveBeenCalledOnce();
        expect(props.onDeleteCollectionConfirm).toHaveBeenCalledOnce();
        expect(props.setModals).toHaveBeenCalledTimes(2);
    });

    it('uses export and compare fallbacks and viewer-delete singular copy', async () => {
        const images = [image('fallback-a'), image('fallback-b')];
        setup({
            selectedIds: new Set(['missing-a', 'missing-b']),
            filteredImages: images,
            exportIds: new Set(['x', 'y', 'z']),
            pendingViewerDeleteId: 'viewer',
            sourceCollectionId: null
        });
        await waitFor(() => expect(captures.props.compare).toBeTruthy());
        expect(captures.props.export.count).toBe(3);
        expect(captures.props.compare.imageA).toBe(images[0]);
        expect(captures.props.compare.imageB).toBe(images[1]);
        expect(captures.props.addToCollection.sourceCollectionId).toBeUndefined();
        expect(captures.confirms[0].message).toContain('Remove 1 image(s)');
    });

    it('suppresses conditional modals and supplies collection-editor defaults', async () => {
        const onSave = vi.fn();
        setup({
            modals: { ...allOpen, settings: false, export: false, slideshow: false, recovery: false, addToCollection: false, commandPalette: false, shortcuts: false, donation: false, compare: true },
            selectedIds: new Set(['a']),
            filteredImages: [image('a')],
            smartCollections: undefined,
            filters: undefined,
            collectionToEditId: 'missing',
            onSaveCollectionFilters: undefined
        });
        await waitFor(() => expect(captures.props.collectionEditor).toBeTruthy());
        expect(captures.props.compare).toBeUndefined();
        expect(captures.props.collectionEditor.collection).toBeNull();
        expect(captures.props.collectionEditor.filters).toEqual(createDefaultFilters());
        (captures.props.collectionEditor.onSave as (id: string, filters: unknown) => void)('id', undefined);
        expect(onSave).not.toHaveBeenCalled();
    });
});
