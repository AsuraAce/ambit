import * as React from 'react';
import { fireEvent, render, screen } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../types';
import { GlobalModals } from '../GlobalModals';

const contextMocks = vi.hoisted(() => ({
    setSettings: vi.fn(),
    toggleFavorite: vi.fn(),
    togglePin: vi.fn(),
    navigate: vi.fn()
}));

vi.mock('../../../contexts/SettingsContext', () => ({
    useSettings: () => ({ settings: { theme: 'dark' }, setSettings: contextMocks.setSettings })
}));
vi.mock('../../../contexts/CollectionContext', () => ({
    useCollections: () => ({
        collections: [{ id: 'collection-1', name: 'Portraits' }],
        smartCollections: [{ id: 'smart-1', name: 'Smart' }]
    })
}));
vi.mock('../../../contexts/SearchContext', () => ({
    useSearch: () => ({ images: [image('a'), image('b')], toggleFavorite: contextMocks.toggleFavorite, togglePin: contextMocks.togglePin })
}));
vi.mock('../../../hooks/useLibraryContext', () => ({ useLibraryContext: vi.fn() }));

vi.mock('../../../features/settings/components/SettingsModal', () => ({
    SettingsModal: (props: { onClose: () => void; onSave: (value: { theme: string }) => void; onNavigateToMaintenance: () => void; onCheckForUpdates: () => Promise<void>; onOpenUpdatePrompt: () => void }) => (
        <><button onClick={props.onClose}>close-settings</button><button onClick={() => props.onSave({ theme: 'light' })}>save-settings</button><button onClick={props.onNavigateToMaintenance}>maintenance</button><button onClick={() => void props.onCheckForUpdates()}>check-updates</button><button onClick={props.onOpenUpdatePrompt}>open-update</button></>
    )
}));
vi.mock('../ConfirmDialog', () => ({
    ConfirmDialog: (props: { title: string; message: string; onConfirm: () => void; onCancel: () => void }) => (
        <div><span>{props.title}</span><span>{props.message}</span><button onClick={props.onConfirm}>confirm-{props.title}</button><button onClick={props.onCancel}>cancel-{props.title}</button></div>
    )
}));
vi.mock('../../../features/viewer/components/CompareModal', () => ({
    CompareModal: (props: { onClose: () => void; onToggleFavorite: (id: string) => void; onTogglePin: (id: string, pinned: boolean) => void }) => (
        <><button onClick={props.onClose}>close-compare</button><button onClick={() => props.onToggleFavorite('a')}>favorite</button><button onClick={() => props.onTogglePin('b', true)}>pin</button></>
    )
}));
vi.mock('../ShortcutsModal', () => ({ ShortcutsModal: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>close-shortcuts</button> }));
vi.mock('../../../features/library/components/MetadataRecoveryModal', () => ({ MetadataRecoveryModal: ({ onClose, onConfirm }: { onClose: () => void; onConfirm: (style: 'sidecar') => void }) => <><button onClick={onClose}>close-recovery</button><button onClick={() => onConfirm('sidecar')}>recover</button></> }));
vi.mock('../../../features/viewer/components/SlideshowModal', () => ({ SlideshowModal: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>close-slideshow</button> }));
vi.mock('../DonationModal', () => ({ DonationModal: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>close-donation</button> }));
vi.mock('../../../features/library/components/ExportModal', () => ({ ExportModal: ({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: (name: string, folder: string) => void }) => <><span>export-count:{count}</span><button onClick={onClose}>close-export</button><button onClick={() => onConfirm('archive.zip', 'C:/exports')}>export</button></> }));
vi.mock('../CommandPalette', () => ({ CommandPalette: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>close-command</button> }));
vi.mock('../../../features/collections/components/AddToCollectionModal', () => ({ AddToCollectionModal: ({ selectedIds, sourceCollectionId, onClose, onConfirm }: { selectedIds: string[]; sourceCollectionId?: string; onClose: () => void; onConfirm: (ids: string[], id: string, mode: 'add', source?: string) => void }) => <><span>selected:{selectedIds.join(',')}:{sourceCollectionId ?? 'none'}</span><button onClick={onClose}>close-add</button><button onClick={() => onConfirm(selectedIds, 'collection-1', 'add', sourceCollectionId)}>add</button></> }));

function image(id: string): AIImage {
    return {
        id,
        url: `${id}.png`,
        thumbnailUrl: `${id}-thumb.png`,
        filename: `${id}.png`,
        timestamp: 1,
        width: 10,
        height: 10,
        isFavorite: false,
        isPinned: false,
        metadata: {
            tool: GeneratorTool.COMFYUI,
            model: 'model',
            seed: 1,
            steps: 20,
            cfg: 7,
            sampler: 'Euler',
            positivePrompt: '',
            negativePrompt: ''
        }
    };
}

const allOpen = {
    settings: true, addToCollection: true, deleteConfirm: true, deleteCollection: true,
    compare: true, shortcuts: true, recovery: true, slideshow: true, donation: true,
    export: true, commandPalette: true
};

const setup = (overrides: Partial<React.ComponentProps<typeof GlobalModals>> = {}) => {
    const setModals = vi.fn((update: React.SetStateAction<typeof allOpen>) => {
        if (typeof update === 'function') update(allOpen);
    });
    const props: React.ComponentProps<typeof GlobalModals> = {
        modals: allOpen,
        setModals,
        selectedIds: new Set(['a', 'b']),
        filteredImages: [image('a'), image('b')],
        onExportConfirm: vi.fn(),
        onDeleteConfirm: vi.fn(),
        onDeleteCollectionConfirm: vi.fn(),
        onRecoverMetadata: vi.fn(),
        onCollectionAction: vi.fn(),
        pendingViewerDeleteId: null,
        collectionToDeleteId: 'collection-1',
        addToCollectionMode: 'add',
        sourceCollectionId: 'source-1',
        isRecoveringMetadata: false,
        isExporting: false,
        slideshowShuffle: false,
        initialSettingsTab: 'general',
        shortcutsModalTab: 'shortcuts',
        commandPaletteProps: { onNavigate: contextMocks.navigate, onToggleTheme: vi.fn(), onOpenSettings: vi.fn(), onImport: vi.fn(), onCreateCollection: vi.fn(), onToggleAI: vi.fn() },
        ...overrides
    };
    render(<GlobalModals {...props} />);
    return props;
};

describe('GlobalModals', () => {
    beforeEach(() => vi.clearAllMocks());

    it('routes close and confirmation callbacks for every global modal', () => {
        const onCloseExport = vi.fn();
        const props = setup({ onCloseExport });

        for (const label of ['close-settings', 'cancel-Remove from Library?', 'cancel-Delete "Portraits"?', 'close-compare', 'close-shortcuts', 'close-recovery', 'close-slideshow', 'close-donation', 'close-export', 'close-command', 'close-add']) {
            fireEvent.click(screen.getByText(label));
        }
        expect(props.setModals).toHaveBeenCalledTimes(11);
        expect(onCloseExport).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('confirm-Remove from Library?'));
        fireEvent.click(screen.getByText('confirm-Delete "Portraits"?'));
        fireEvent.click(screen.getByText('recover'));
        fireEvent.click(screen.getByText('export'));
        fireEvent.click(screen.getByText('add'));
        expect(props.onDeleteConfirm).toHaveBeenCalledTimes(1);
        expect(props.onDeleteCollectionConfirm).toHaveBeenCalledTimes(1);
        expect(props.onRecoverMetadata).toHaveBeenCalledWith('sidecar');
        expect(props.onExportConfirm).toHaveBeenCalledWith('archive.zip', 'C:/exports');
        expect(props.onCollectionAction).toHaveBeenCalledWith(['a', 'b'], 'collection-1', 'add', 'source-1');
        expect(props.setModals).toHaveBeenCalledTimes(12);
    });

    it('uses context defaults, compare actions, and fallback maintenance navigation', () => {
        setup();
        fireEvent.click(screen.getByText('save-settings'));
        fireEvent.click(screen.getByText('maintenance'));
        fireEvent.click(screen.getByText('favorite'));
        fireEvent.click(screen.getByText('pin'));
        fireEvent.click(screen.getByText('check-updates'));
        fireEvent.click(screen.getByText('open-update'));

        expect(contextMocks.setSettings).toHaveBeenCalledWith({ theme: 'light' });
        expect(contextMocks.navigate).toHaveBeenCalledWith('maintenance');
        expect(contextMocks.toggleFavorite).toHaveBeenCalledWith('a');
        expect(contextMocks.togglePin).toHaveBeenCalledWith('b', true);
        expect(screen.getByText(/This will remove 2 image/)).toBeTruthy();
        expect(screen.getByText('export-count:2')).toBeTruthy();
    });

    it('honors explicit callbacks and suppresses compare and slideshow when unavailable', () => {
        const onSettingsSave = vi.fn();
        const onNavigateToMaintenance = vi.fn();
        setup({
            modals: { ...allOpen, compare: false, slideshow: false },
            selectedIds: new Set(['a']),
            exportIds: new Set(['a', 'b', 'c']),
            pendingViewerDeleteId: 'a',
            collectionToDeleteId: 'missing',
            sourceCollectionId: null,
            onSettingsSave,
            onNavigateToMaintenance
        });

        fireEvent.click(screen.getByText('save-settings'));
        fireEvent.click(screen.getByText('maintenance'));
        expect(onSettingsSave).toHaveBeenCalledWith({ theme: 'light' });
        expect(onNavigateToMaintenance).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('close-compare')).toBeNull();
        expect(screen.queryByText('close-slideshow')).toBeNull();
        expect(screen.getByText('Delete "Collection"?')).toBeTruthy();
        expect(screen.getByText(/This will remove 1 image/)).toBeTruthy();
        expect(screen.getByText('export-count:3')).toBeTruthy();
        expect(screen.getByText('selected:a:none')).toBeTruthy();
    });
});
