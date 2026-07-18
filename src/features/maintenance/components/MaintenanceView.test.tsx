import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceTab } from '../../../hooks/useMaintenanceData';
import { useLibraryStore } from '../../../stores/libraryStore';
import { type AIImage, GeneratorTool } from '../../../types';
import { MaintenanceView } from './MaintenanceView';

const maintenanceDataMock = vi.hoisted(() => ({
    isLoading: false,
    initializedTabs: new Set<string>(['missing']),
    localDeletedImages: [] as AIImage[],
    localUntaggedImages: [] as AIImage[],
    localUnoptimizedImages: [] as AIImage[],
    localDuplicateCandidates: [] as AIImage[],
    localMissingImages: [] as AIImage[],
    localIntermediateImages: [] as AIImage[],
    unoptimizedTotalCount: 0,
    hasActiveLoadError: false,
    hasLoadedActiveTab: true,
    refreshData: vi.fn().mockResolvedValue(undefined),
    retryActiveTab: vi.fn().mockResolvedValue(undefined),
    setLocalMissingImages: vi.fn(),
    setLocalDuplicateCandidates: vi.fn(),
}));

const imageRepoMock = vi.hoisted(() => ({
    getImagesByIds: vi.fn().mockResolvedValue([]),
    toggleImageIntermediate: vi.fn().mockResolvedValue(undefined)
}));

const thumbnailServiceMock = vi.hoisted(() => ({
    regenerateAllUnoptimized: vi.fn().mockResolvedValue(0)
}));

const libraryContextMock = vi.hoisted(() => ({
    activeSqlWhere: 'WHERE model_name = ?',
    activeSqlParams: ['model-a'] as unknown[]
}));

const createImage = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'image-1',
    url: 'file:///image-1.png',
    thumbnailUrl: 'file:///thumb-1.png',
    filename: 'image-1.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: '',
        seed: 0,
        steps: 0,
        cfg: 0,
        sampler: '',
        positivePrompt: '',
        negativePrompt: ''
    },
    ...overrides
});

vi.mock('../../../hooks/useMaintenanceData', () => ({
    useMaintenanceData: () => ({
        isLoading: maintenanceDataMock.isLoading,
        initializedTabs: maintenanceDataMock.initializedTabs,
        localDeletedImages: maintenanceDataMock.localDeletedImages,
        localUntaggedImages: maintenanceDataMock.localUntaggedImages,
        localUnoptimizedImages: maintenanceDataMock.localUnoptimizedImages,
        localDuplicateCandidates: maintenanceDataMock.localDuplicateCandidates,
        localMissingImages: maintenanceDataMock.localMissingImages,
        localIntermediateImages: maintenanceDataMock.localIntermediateImages,
        unoptimizedTotalCount: maintenanceDataMock.unoptimizedTotalCount,
        hasActiveLoadError: maintenanceDataMock.hasActiveLoadError,
        hasLoadedActiveTab: maintenanceDataMock.hasLoadedActiveTab,
        refreshData: maintenanceDataMock.refreshData,
        retryActiveTab: maintenanceDataMock.retryActiveTab,
        setLocalMissingImages: maintenanceDataMock.setLocalMissingImages,
        setLocalDuplicateCandidates: maintenanceDataMock.setLocalDuplicateCandidates,
    })
}));

vi.mock('../../../contexts/LibraryContext', () => ({
    useLibraryContext: () => libraryContextMock
}));

vi.mock('./MaintenanceTabs', () => ({
    MAINTENANCE_TABS: [
        { id: 'missing', label: 'Missing' },
        { id: 'thumbnails', label: 'Thumbnails' },
        { id: 'duplicates', label: 'Duplicates' },
        { id: 'untagged', label: 'Untagged' },
        { id: 'intermediates', label: 'Intermediates' },
        { id: 'trash', label: 'Removed' },
    ],
    MaintenanceTabs: ({ activeTab, onTabChange }: {
        activeTab: MaintenanceTab;
        onTabChange: (tab: MaintenanceTab) => void;
    }) => (
        <div data-testid="maintenance-tabs" data-active-tab={activeTab}>
            {(['missing', 'trash', 'untagged', 'thumbnails', 'duplicates', 'intermediates'] as MaintenanceTab[]).map(tab => (
                <button key={tab} onClick={() => onTabChange(tab)}>Tab {tab}</button>
            ))}
        </div>
    )
}));

vi.mock('./LibraryHealth', () => ({
    LibraryHealth: ({ onScanComplete }: { onScanComplete: (ids: string[]) => void }) => (
        <div data-testid="library-health">
            <button onClick={() => onScanComplete(['missing-scan'])}>Scan Missing</button>
            <button onClick={() => onScanComplete([])}>Clear Missing Scan</button>
        </div>
    )
}));

vi.mock('./MissingTab', () => ({
    MissingTab: ({ images, onItemClick, onSelectAll, onDeleteSelected, onPurgeMissing, onViewImage, onRangeSelection, onBackgroundClick }: {
        images: AIImage[];
        onItemClick: (id: string, index: number, event: React.MouseEvent) => void;
        onSelectAll: () => void;
        onDeleteSelected: () => void;
        onPurgeMissing: () => void;
        onViewImage: (id: string) => void;
        onRangeSelection: (indexes: number[], additive: boolean) => void;
        onBackgroundClick: () => void;
    }) => (
        <div>
            <div data-testid="missing-count">{images.length}</div>
            {images[0] && <button onClick={() => onViewImage(images[0].id)}>Open Missing Viewer</button>}
            {images[0] && <button onClick={event => onItemClick(images[0].id, 0, event)}>Select Missing Item</button>}
            <button onClick={onSelectAll}>Select All Missing</button>
            <button onClick={onDeleteSelected}>Delete Missing</button>
            <button onClick={onPurgeMissing}>Purge Missing</button>
            <button onClick={() => onRangeSelection([0], true)}>Range Missing</button>
            <button onClick={onBackgroundClick}>Clear Missing Selection</button>
        </div>
    )
}));

vi.mock('./TrashTab', () => ({
    TrashTab: ({ images, onSelectAll, onRestoreSelected, onDeleteSelected, onItemClick, busyAction }: {
        images: AIImage[];
        onSelectAll: () => void;
        onRestoreSelected: () => void;
        onDeleteSelected: () => void;
        onItemClick: (id: string, index: number, event: React.MouseEvent) => void;
        busyAction: string | null;
    }) => (
        <div data-testid="trash-tab" data-busy={busyAction ?? ''}>
            <button onClick={onSelectAll}>Select All Trash</button>
            <button onClick={onRestoreSelected}>Restore Trash</button>
            <button onClick={onDeleteSelected}>Delete Trash</button>
            {images[0] && <button onClick={event => onItemClick(images[0].id, 0, event)}>Open Trash Viewer</button>}
        </div>
    )
}));

vi.mock('./UntaggedTab', () => ({
    UntaggedTab: ({ images, onSelectAll, onRemoveFromLibrary, onScopeChange, onViewImage }: {
        images: AIImage[];
        onSelectAll: () => void;
        onRemoveFromLibrary: () => void;
        onScopeChange: (scope: 'global' | 'filtered') => void;
        onViewImage: (id: string) => void;
    }) => (
        <div data-testid="untagged-tab">
            <button onClick={onSelectAll}>Select All Untagged</button>
            <button onClick={onRemoveFromLibrary}>Remove Untagged</button>
            <button onClick={() => onScopeChange('filtered')}>Filter Untagged</button>
            {images[0] && <button onClick={() => onViewImage(images[0].id)}>Open Untagged Viewer</button>}
        </div>
    )
}));

vi.mock('./ThumbnailsTab', () => ({
    ThumbnailsTab: ({ images, selectedIds, onItemClick, onSelectAll, onRegenerate, onScopeChange, onIncludeUpgradeableChange, onRepairComplete }: {
        images: AIImage[];
        selectedIds: Set<string>;
        onItemClick: (id: string, index: number, event: React.MouseEvent) => void;
        onSelectAll: () => void;
        onRegenerate: (ids?: string[]) => void;
        onScopeChange: (scope: 'global' | 'filtered') => void;
        onIncludeUpgradeableChange: (include: boolean) => void;
        onRepairComplete: () => void;
    }) => (
        <div data-testid="thumbnails-tab">
            {images[0] && <button onClick={event => onItemClick(images[0].id, 0, event)}>Open Thumbnail Viewer</button>}
            <button onClick={onSelectAll}>Select All Thumbnails</button>
            <button onClick={() => onRegenerate(Array.from(selectedIds))}>Regenerate Selected</button>
            <button onClick={() => onRegenerate()}>Regenerate All</button>
            <button onClick={() => onScopeChange('filtered')}>Filter Thumbnails</button>
            <button onClick={() => onIncludeUpgradeableChange(true)}>Include Upgradeable</button>
            <button onClick={onRepairComplete}>Repair Complete</button>
        </div>
    )
}));

vi.mock('./IntermediatesTab', () => ({
    IntermediatesTab: ({ images, onSelectAll, onDeleteSelected, onUnmarkSelected, onScopeChange, onViewImage }: {
        images: AIImage[];
        onSelectAll: () => void;
        onDeleteSelected: () => void;
        onUnmarkSelected: () => void;
        onScopeChange: (scope: 'global' | 'filtered') => void;
        onViewImage: (id: string) => void;
    }) => (
        <div data-testid="intermediates-tab">
            <button onClick={onSelectAll}>Select All Intermediates</button>
            <button onClick={onDeleteSelected}>Delete Intermediates</button>
            <button onClick={onUnmarkSelected}>Unmark Intermediates</button>
            <button onClick={() => onScopeChange('filtered')}>Filter Intermediates</button>
            {images[0] && <button onClick={() => onViewImage(images[0].id)}>Open Intermediate Viewer</button>}
        </div>
    )
}));

vi.mock('./DuplicateFinder', () => ({
    DuplicateFinder: ({ images, onResolve, onRefresh, onViewImage, onCompareImages }: {
        images: AIImage[];
        onResolve: (resolutions: Array<{ keepId: string; removeIds: string[] }>) => void;
        onRefresh: () => void;
        onViewImage: (id: string) => void;
        onCompareImages: (first: AIImage, second: AIImage) => void;
    }) => (
        <div data-testid="duplicate-finder">
            {images[0] && <button onClick={() => onViewImage(images[0].id)}>Open Duplicate Viewer</button>}
            {images.length > 1 && <button onClick={() => onCompareImages(images[0], images[1])}>Compare Duplicates</button>}
            {images.length > 1 && <button onClick={() => onResolve([{ keepId: images[0].id, removeIds: [images[1].id] }])}>Resolve Duplicates</button>}
            <button onClick={onRefresh}>Refresh Duplicates</button>
        </div>
    )
}));

vi.mock('./ScanPlaceholder', () => ({
    ScanPlaceholder: ({ tab, onStartScan }: {
        tab: MaintenanceTab;
        onStartScan: (tab: MaintenanceTab, scope: 'global' | 'filtered') => void;
    }) => <button onClick={() => onStartScan(tab, 'filtered')}>Start {tab} Scan</button>
}));

vi.mock('../../../features/viewer/components/ImageViewer', () => ({
    ImageViewer: ({ image, onDelete, onNext, onPrev, onClose, onToggleFavorite, onTogglePin, onSetCollectionMembership, onSearch, onOpenSettings, isShortcutBlocked }: {
        image: AIImage;
        onDelete?: () => void;
        onNext: () => void;
        onPrev: () => void;
        onClose: () => void;
        onToggleFavorite: (id: string) => void;
        onTogglePin?: (id: string, pinned: boolean) => void;
        onSetCollectionMembership: (imageId: string, collectionId: string, shouldBelong: boolean) => Promise<boolean>;
        onSearch: () => void;
        onOpenSettings: () => void;
        isShortcutBlocked?: boolean;
    }) => (
        <div data-testid="maintenance-viewer" data-image-id={image.id} data-shortcuts-blocked={String(isShortcutBlocked)}>
            {onDelete && <button onClick={onDelete}>Viewer Cleanup</button>}
            <button onClick={onNext}>Viewer Next</button>
            <button onClick={onPrev}>Viewer Previous</button>
            <button onClick={onClose}>Close Viewer</button>
            <button onClick={() => onToggleFavorite(image.id)}>Favorite Viewer</button>
            {onTogglePin && <button onClick={() => onTogglePin(image.id, true)}>Pin Viewer</button>}
            <button onClick={() => void onSetCollectionMembership(image.id, 'collection', true)}>Add Viewer Collection</button>
            <button onClick={() => void onSetCollectionMembership(image.id, 'collection', false)}>Remove Viewer Collection</button>
            <button onClick={onSearch}>Viewer Search</button>
            <button onClick={onOpenSettings}>Viewer Settings</button>
        </div>
    )
}));

vi.mock('../../../features/viewer/components/CompareModal', () => ({
    CompareModal: ({ imageA, imageB, onClose, onToggleFavorite, onTogglePin }: {
        imageA: AIImage;
        imageB: AIImage;
        onClose: () => void;
        onToggleFavorite: (id: string) => void;
        onTogglePin?: (id: string, pinned: boolean) => void;
    }) => (
        <div data-testid="compare-modal">
            <button onClick={onClose}>Close Compare</button>
            <button onClick={() => onToggleFavorite(imageA.id)}>Favorite Compare</button>
            {onTogglePin && <button onClick={() => onTogglePin(imageA.id, true)}>Pin Compare</button>}
            {onTogglePin && <button onClick={() => onTogglePin(imageB.id, true)}>Pin Compare B</button>}
        </div>
    )
}));

vi.mock('../../../services/db/imageRepo', () => ({
    getImagesByIds: imageRepoMock.getImagesByIds,
    toggleImageIntermediate: imageRepoMock.toggleImageIntermediate
}));

vi.mock('../../../services/thumbnailService', () => ({
    regenerateAllUnoptimized: thumbnailServiceMock.regenerateAllUnoptimized
}));

const createProps = (): React.ComponentProps<typeof MaintenanceView> => ({
    images: [],
    onResolveDuplicate: vi.fn().mockResolvedValue(undefined),
    onRestoreImages: vi.fn().mockResolvedValue(undefined),
    onRemoveFromLibrary: vi.fn().mockResolvedValue(undefined),
    onDeleteFile: vi.fn().mockResolvedValue(undefined),
    onEmptyTrash: vi.fn().mockResolvedValue(undefined),
    onViewImage: vi.fn(),
    onRegenerateThumbnails: vi.fn().mockResolvedValue(undefined),
    maskedKeywords: [],
    onToggleFavorite: vi.fn(),
    onTogglePin: vi.fn(),
    onViewerOpenChange: vi.fn(),
    isShortcutBlocked: false,
    onSetCollectionMembership: vi.fn().mockResolvedValue(true)
});

const renderView = (overrides: Partial<React.ComponentProps<typeof MaintenanceView>> = {}) => {
    const props = { ...createProps(), ...overrides };
    return { props, ...render(<MaintenanceView {...props} />) };
};

describe('MaintenanceView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        maintenanceDataMock.isLoading = false;
        maintenanceDataMock.initializedTabs = new Set(['missing']);
        maintenanceDataMock.localDeletedImages = [];
        maintenanceDataMock.localUntaggedImages = [];
        maintenanceDataMock.localUnoptimizedImages = [];
        maintenanceDataMock.localDuplicateCandidates = [];
        maintenanceDataMock.localMissingImages = [];
        maintenanceDataMock.localIntermediateImages = [];
        maintenanceDataMock.unoptimizedTotalCount = 0;
        maintenanceDataMock.hasActiveLoadError = false;
        maintenanceDataMock.hasLoadedActiveTab = true;
        maintenanceDataMock.refreshData.mockResolvedValue(undefined);
        maintenanceDataMock.retryActiveTab.mockResolvedValue(undefined);
        maintenanceDataMock.setLocalMissingImages.mockImplementation(update => {
            maintenanceDataMock.localMissingImages = typeof update === 'function'
                ? update(maintenanceDataMock.localMissingImages)
                : update;
        });
        imageRepoMock.getImagesByIds.mockResolvedValue([]);
        imageRepoMock.toggleImageIntermediate.mockResolvedValue(undefined);
        thumbnailServiceMock.regenerateAllUnoptimized.mockResolvedValue(0);
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not derive Missing tab results from gallery search images', () => {
        const galleryMissingImage = createImage({ id: 'gallery-missing', isMissing: true });

        renderView({ images: [galleryMissingImage] });

        expect(screen.getByTestId('missing-count').textContent).toBe('0');
    });

    it('uses remove-from-library cleanup from the Maintenance viewer', async () => {
        maintenanceDataMock.localMissingImages = [createImage({ id: 'missing-1', isMissing: true })];
        const onRemoveFromLibrary = vi.fn().mockResolvedValue(undefined);
        const onDeleteFile = vi.fn();

        renderView({ onRemoveFromLibrary, onDeleteFile });
        fireEvent.click(screen.getByText('Open Missing Viewer'));
        fireEvent.click(screen.getByText('Viewer Cleanup'));

        await waitFor(() => expect(onRemoveFromLibrary).toHaveBeenCalledWith(['missing-1']));
        expect(onDeleteFile).not.toHaveBeenCalled();
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('missing', false, {
            scope: 'global',
            includeUpgradeable: undefined,
            runHashBackfill: false
        });
    });

    it('fetches missing audit results from both the store and LibraryHealth', async () => {
        const storeImage = createImage({ id: 'missing-store', isMissing: true });
        const scanImage = createImage({ id: 'missing-scan', isMissing: true });
        imageRepoMock.getImagesByIds
            .mockResolvedValueOnce([storeImage])
            .mockResolvedValueOnce([scanImage]);

        renderView();
        act(() => {
            useLibraryStore.getState().setLastMissingScanResult({
                scanned: 10,
                total: 10,
                missingIds: ['missing-store'],
                sampleMissingPaths: ['missing-store.png'],
                wasCancelled: false
            });
        });

        await waitFor(() => expect(imageRepoMock.getImagesByIds).toHaveBeenCalledWith(['missing-store']));
        fireEvent.click(await screen.findByText('Scan Missing'));
        await waitFor(() => expect(imageRepoMock.getImagesByIds).toHaveBeenCalledWith(['missing-scan']));
        await waitFor(() => expect(screen.getByTestId('missing-count').textContent).toBe('1'));
        expect(imageRepoMock.getImagesByIds).toHaveBeenCalledTimes(2);

        fireEvent.click(screen.getByText('Clear Missing Scan'));
        await waitFor(() => expect(screen.getByTestId('missing-count').textContent).toBe('0'));
    });

    it('logs failed missing-result hydration without breaking the tab', async () => {
        const failure = new Error('missing lookup failed');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        imageRepoMock.getImagesByIds.mockRejectedValueOnce(failure);

        renderView();
        fireEvent.click(await screen.findByText('Scan Missing'));

        await waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to fetch missing images', failure));
        expect(screen.getByTestId('missing-count').textContent).toBe('0');
    });

    it('cleans hydrated missing results through selected and viewer removal paths', async () => {
        const hydrated = createImage({ id: 'missing-scan', isMissing: true });
        imageRepoMock.getImagesByIds.mockResolvedValue([hydrated]);
        const onRemoveFromLibrary = vi.fn().mockResolvedValue(undefined);
        renderView({ onRemoveFromLibrary });

        fireEvent.click(await screen.findByText('Scan Missing'));
        await waitFor(() => expect(screen.getByTestId('missing-count').textContent).toBe('1'));
        fireEvent.click(screen.getByText('Select All Missing'));
        fireEvent.click(screen.getByText('Delete Missing'));
        await waitFor(() => expect(screen.getByTestId('missing-count').textContent).toBe('0'));

        fireEvent.click(screen.getByText('Scan Missing'));
        await waitFor(() => expect(screen.getByTestId('missing-count').textContent).toBe('1'));
        fireEvent.click(screen.getByText('Open Missing Viewer'));
        fireEvent.click(screen.getByText('Viewer Cleanup'));

        await waitFor(() => expect(screen.getByTestId('missing-count').textContent).toBe('0'));
        expect(onRemoveFromLibrary).toHaveBeenCalledTimes(2);
        expect(onRemoveFromLibrary).toHaveBeenNthCalledWith(1, ['missing-scan']);
        expect(onRemoveFromLibrary).toHaveBeenNthCalledWith(2, ['missing-scan']);
    });

    it('removes selected missing rows and can purge the complete missing result', async () => {
        maintenanceDataMock.localMissingImages = [
            createImage({ id: 'missing-a', isMissing: true }),
            createImage({ id: 'missing-b', isMissing: true })
        ];
        const onRemoveFromLibrary = vi.fn().mockResolvedValue(undefined);
        renderView({ onRemoveFromLibrary });

        fireEvent.click(screen.getByText('Purge Missing'));
        await waitFor(() => expect(onRemoveFromLibrary).toHaveBeenLastCalledWith(['missing-a', 'missing-b']));
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('missing', false);

        fireEvent.click(screen.getByText('Select All Missing'));
        fireEvent.click(screen.getByText('Delete Missing'));

        await waitFor(() => expect(onRemoveFromLibrary).toHaveBeenLastCalledWith(['missing-a', 'missing-b']));
        expect(maintenanceDataMock.setLocalMissingImages).toHaveBeenCalledWith(expect.any(Function));
    });

    it('restores and permanently deletes selected trash rows', async () => {
        maintenanceDataMock.localDeletedImages = [createImage({ id: 'trash-a', isDeleted: true })];
        const onRestoreImages = vi.fn().mockResolvedValue(undefined);
        const onDeleteFile = vi.fn().mockResolvedValue(undefined);
        renderView({ onRestoreImages, onDeleteFile });

        fireEvent.click(screen.getByText('Tab trash'));
        fireEvent.click(await screen.findByText('Restore Trash'));
        fireEvent.click(screen.getByText('Delete Trash'));
        expect(onRestoreImages).not.toHaveBeenCalled();
        expect(onDeleteFile).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByText('Select All Trash'));
        fireEvent.click(screen.getByText('Restore Trash'));
        await waitFor(() => expect(onRestoreImages).toHaveBeenCalledWith(['trash-a']));

        fireEvent.click(screen.getByText('Select All Trash'));
        fireEvent.click(screen.getByText('Delete Trash'));
        await waitFor(() => expect(onDeleteFile).toHaveBeenCalledWith(['trash-a']));
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('trash', false, { scope: 'global' });
    });

    it('routes untagged and intermediate actions through their filtered scopes', async () => {
        maintenanceDataMock.initializedTabs = new Set(['missing', 'untagged', 'intermediates']);
        maintenanceDataMock.localUntaggedImages = [createImage({ id: 'untagged-a' })];
        maintenanceDataMock.localIntermediateImages = [createImage({ id: 'intermediate-a', isIntermediate: true })];
        const onRemoveFromLibrary = vi.fn().mockResolvedValue(undefined);
        const onDeleteFile = vi.fn().mockResolvedValue(undefined);
        renderView({ onRemoveFromLibrary, onDeleteFile });

        fireEvent.click(screen.getByText('Tab untagged'));
        fireEvent.click(await screen.findByText('Filter Untagged'));
        fireEvent.click(screen.getByText('Select All Untagged'));
        fireEvent.click(screen.getByText('Remove Untagged'));
        await waitFor(() => expect(onRemoveFromLibrary).toHaveBeenCalledWith(['untagged-a']));
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('untagged', false, { scope: 'filtered' });

        fireEvent.click(screen.getByText('Tab intermediates'));
        fireEvent.click(await screen.findByText('Filter Intermediates'));
        fireEvent.click(screen.getByText('Unmark Intermediates'));
        expect(imageRepoMock.toggleImageIntermediate).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Select All Intermediates'));
        fireEvent.click(screen.getByText('Unmark Intermediates'));
        await waitFor(() => expect(imageRepoMock.toggleImageIntermediate).toHaveBeenCalledWith('intermediate-a', false));
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('intermediates', false, { scope: 'filtered' });

        fireEvent.click(screen.getByText('Select All Intermediates'));
        fireEvent.click(screen.getByText('Delete Intermediates'));
        await waitFor(() => expect(onDeleteFile).toHaveBeenCalledWith(['intermediate-a']));
    });

    it('regenerates selected and filtered thumbnail work while restoring store progress state', async () => {
        maintenanceDataMock.initializedTabs = new Set(['missing', 'thumbnails']);
        maintenanceDataMock.localUnoptimizedImages = [createImage({ id: 'thumb-a' }), createImage({ id: 'thumb-b' })];
        maintenanceDataMock.unoptimizedTotalCount = 2;
        thumbnailServiceMock.regenerateAllUnoptimized.mockImplementationOnce(async onProgress => {
            onProgress(2, 2);
            return 2;
        });
        const onRegenerateThumbnails = vi.fn().mockResolvedValue(undefined);
        renderView({ onRegenerateThumbnails });

        fireEvent.click(screen.getByText('Tab thumbnails'));
        fireEvent.click(await screen.findByText('Filter Thumbnails'));
        fireEvent.click(screen.getByText('Include Upgradeable'));
        fireEvent.click(screen.getByText('Select All Thumbnails'));
        fireEvent.click(screen.getByText('Regenerate Selected'));
        await waitFor(() => expect(onRegenerateThumbnails).toHaveBeenCalledWith(['thumb-a', 'thumb-b']));

        fireEvent.click(screen.getByText('Regenerate All'));
        await waitFor(() => expect(thumbnailServiceMock.regenerateAllUnoptimized).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(AbortSignal),
            'WHERE model_name = ?',
            ['model-a'],
            true
        ));
        expect(useLibraryStore.getState().isRegeneratingThumbnails).toBe(false);
        expect(useLibraryStore.getState().thumbnailProgress).toBeNull();
        expect(useLibraryStore.getState().thumbnailAbortController).toBeNull();

        fireEvent.click(screen.getByText('Repair Complete'));
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('thumbnails', false, {
            scope: 'filtered',
            includeUpgradeable: true
        });
    });

    it('starts deferred scans and handles duplicate resolution and comparison callbacks', async () => {
        const duplicateA = createImage({ id: 'duplicate-a' });
        const duplicateB = createImage({ id: 'duplicate-b' });
        const onResolveDuplicate = vi.fn().mockResolvedValue(undefined);
        const onToggleFavorite = vi.fn();
        const onTogglePin = vi.fn();
        const onViewerOpenChange = vi.fn();
        const view = renderView({ onResolveDuplicate, onToggleFavorite, onTogglePin, onViewerOpenChange });

        fireEvent.click(screen.getByText('Tab duplicates'));
        fireEvent.click(await screen.findByText('Start duplicates Scan'));
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('duplicates', true, {
            scope: 'global',
            includeUpgradeable: undefined,
            runHashBackfill: true
        });

        maintenanceDataMock.initializedTabs = new Set(['missing', 'duplicates']);
        maintenanceDataMock.localDuplicateCandidates = [duplicateA, duplicateB];
        act(() => {
            useLibraryStore.setState({
                lastDuplicateScanResult: {
                    scanned: 2,
                    updated: 2,
                    missing: 0,
                    errors: 0,
                    remaining: 0,
                    wasCancelled: false
                }
            });
        });
        view.rerender(<MaintenanceView {...view.props} />);

        expect(await screen.findByTestId('duplicate-finder')).toBeTruthy();
        fireEvent.click(screen.getByText('Resolve Duplicates'));
        await waitFor(() => expect(onResolveDuplicate).toHaveBeenCalledWith([{
            keepId: 'duplicate-a',
            removeIds: ['duplicate-b'],
        }]));
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('duplicates', false, {
            runHashBackfill: false
        });
        fireEvent.click(screen.getByText('Refresh Duplicates'));
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('duplicates', true, {
            runHashBackfill: true
        });

        fireEvent.click(screen.getByText('Compare Duplicates'));
        expect(onViewerOpenChange).toHaveBeenLastCalledWith(true);
        fireEvent.click(screen.getByText('Favorite Compare'));
        fireEvent.click(screen.getByText('Pin Compare'));
        fireEvent.click(screen.getByText('Pin Compare B'));
        expect(onToggleFavorite).toHaveBeenCalledWith('duplicate-a');
        expect(onTogglePin).toHaveBeenCalledWith('duplicate-a', true);
        expect(onTogglePin).toHaveBeenCalledWith('duplicate-b', true);
        fireEvent.click(screen.getByText('Close Compare'));
        expect(screen.queryByTestId('compare-modal')).toBeNull();
        expect(onViewerOpenChange).toHaveBeenLastCalledWith(false);
    });

    it('navigates the active maintenance list and forwards viewer actions', () => {
        maintenanceDataMock.localMissingImages = [createImage({ id: 'missing-a' }), createImage({ id: 'missing-b' })];
        const onToggleFavorite = vi.fn();
        const onTogglePin = vi.fn();
        const onViewerOpenChange = vi.fn();
        const onSetCollectionMembership = vi.fn().mockResolvedValue(true);
        renderView({ onToggleFavorite, onTogglePin, onViewerOpenChange, onSetCollectionMembership, isShortcutBlocked: true });

        fireEvent.click(screen.getByText('Select Missing Item'));
        expect(onViewerOpenChange).toHaveBeenLastCalledWith(true);
        expect(screen.getByTestId('maintenance-viewer').getAttribute('data-image-id')).toBe('missing-a');
        expect(screen.getByTestId('maintenance-viewer').getAttribute('data-shortcuts-blocked')).toBe('true');
        fireEvent.click(screen.getByText('Viewer Next'));
        expect(screen.getByTestId('maintenance-viewer').getAttribute('data-image-id')).toBe('missing-b');
        fireEvent.click(screen.getByText('Viewer Next'));
        fireEvent.click(screen.getByText('Viewer Previous'));
        fireEvent.click(screen.getByText('Viewer Previous'));
        fireEvent.click(screen.getByText('Favorite Viewer'));
        fireEvent.click(screen.getByText('Pin Viewer'));
        expect(onToggleFavorite).toHaveBeenCalledWith('missing-a');
        expect(onTogglePin).toHaveBeenCalledWith('missing-a', true);
        fireEvent.click(screen.getByText('Add Viewer Collection'));
        fireEvent.click(screen.getByText('Remove Viewer Collection'));
        expect(onSetCollectionMembership).toHaveBeenNthCalledWith(1, 'missing-a', 'collection', true);
        expect(onSetCollectionMembership).toHaveBeenNthCalledWith(2, 'missing-a', 'collection', false);
        fireEvent.click(screen.getByText('Viewer Search'));
        fireEvent.click(screen.getByText('Viewer Settings'));
        fireEvent.click(screen.getByText('Close Viewer'));
        expect(screen.queryByTestId('maintenance-viewer')).toBeNull();
        expect(onViewerOpenChange).toHaveBeenLastCalledWith(false);

        fireEvent.click(screen.getByText('Range Missing'));
        fireEvent.click(screen.getByText('Clear Missing Selection'));
    });

    it('covers global thumbnail work, non-duplicate scans, and viewer cleanup variants', async () => {
        maintenanceDataMock.initializedTabs = new Set(['missing', 'thumbnails', 'duplicates', 'trash']);
        maintenanceDataMock.localUnoptimizedImages = [createImage({ id: 'thumb-a' })];
        maintenanceDataMock.localDuplicateCandidates = [
            createImage({ id: 'duplicate-a' }),
            createImage({ id: 'duplicate-b' }),
        ];
        maintenanceDataMock.localDeletedImages = [createImage({ id: 'trash-a', isDeleted: true })];
        const onRemoveFromLibrary = vi.fn().mockResolvedValue(undefined);
        const view = renderView({ onRemoveFromLibrary, onTogglePin: undefined });

        fireEvent.click(screen.getByText('Tab thumbnails'));
        fireEvent.click(await screen.findByText('Regenerate All'));
        await waitFor(() => expect(thumbnailServiceMock.regenerateAllUnoptimized).toHaveBeenCalledWith(
            expect.any(Function), expect.any(AbortSignal), '', [], false
        ));
        fireEvent.click(screen.getByText('Open Thumbnail Viewer'));
        fireEvent.click(screen.getByText('Viewer Cleanup'));
        await waitFor(() => expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith(
            'thumbnails', false, expect.objectContaining({ scope: 'global', includeUpgradeable: false })
        ));

        maintenanceDataMock.initializedTabs = new Set();
        view.rerender(<MaintenanceView {...view.props} />);
        fireEvent.click(screen.getByText('Tab thumbnails'));
        fireEvent.click(await screen.findByText('Start thumbnails Scan'));
        expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith('thumbnails', true, {
            scope: 'filtered',
            includeUpgradeable: false,
            runHashBackfill: false,
        });

        maintenanceDataMock.initializedTabs = new Set(['missing', 'duplicates']);
        view.rerender(<MaintenanceView {...view.props} />);
        fireEvent.click(screen.getByText('Tab duplicates'));
        fireEvent.click(await screen.findByText('Compare Duplicates'));
        expect(screen.queryByText('Pin Compare')).toBeNull();

        fireEvent.click(screen.getByText('Tab trash'));
        fireEvent.click(await screen.findByText('Open Trash Viewer'));
        expect(screen.queryByText('Viewer Cleanup')).toBeNull();
    });

    it('refreshes every scoped viewer cleanup and drops stale viewer ids', async () => {
        maintenanceDataMock.initializedTabs = new Set(['missing', 'untagged', 'duplicates', 'intermediates']);
        maintenanceDataMock.localUntaggedImages = [createImage({ id: 'untagged-a' })];
        maintenanceDataMock.localDuplicateCandidates = [createImage({ id: 'duplicate-a' })];
        maintenanceDataMock.localIntermediateImages = [createImage({ id: 'intermediate-a' })];
        const view = renderView();

        for (const [tab, openLabel] of [
            ['untagged', 'Open Untagged Viewer'],
            ['duplicates', 'Open Duplicate Viewer'],
            ['intermediates', 'Open Intermediate Viewer'],
        ] as const) {
            fireEvent.click(screen.getByText(`Tab ${tab}`));
            fireEvent.click(await screen.findByText(openLabel));
            fireEvent.click(screen.getByText('Viewer Cleanup'));
            await waitFor(() => expect(maintenanceDataMock.refreshData).toHaveBeenCalledWith(
                tab,
                false,
                expect.objectContaining({ scope: 'global' })
            ));
        }

        fireEvent.click(screen.getByText('Tab duplicates'));
        fireEvent.click(await screen.findByText('Open Duplicate Viewer'));
        maintenanceDataMock.localDuplicateCandidates = [];
        view.rerender(<MaintenanceView {...view.props} />);
        expect(screen.queryByTestId('maintenance-viewer')).toBeNull();
    });

    it('ignores thumbnail regeneration when no callback was supplied', async () => {
        maintenanceDataMock.initializedTabs = new Set(['missing', 'thumbnails']);
        maintenanceDataMock.localUnoptimizedImages = [createImage({ id: 'thumb-a' })];
        renderView({ onRegenerateThumbnails: undefined });

        fireEvent.click(screen.getByText('Tab thumbnails'));
        fireEvent.click(await screen.findByText('Regenerate All'));

        expect(thumbnailServiceMock.regenerateAllUnoptimized).not.toHaveBeenCalled();
        expect(maintenanceDataMock.refreshData).not.toHaveBeenCalledWith('thumbnails', false, expect.anything());
    });

    it('shows the loading overlay while maintenance data is refreshing', () => {
        maintenanceDataMock.isLoading = true;
        renderView();

        expect(screen.getByText('Loading Missing data...')).toBeTruthy();
    });

    it('shows an inline retry when the initial tab load fails', () => {
        maintenanceDataMock.hasActiveLoadError = true;
        maintenanceDataMock.hasLoadedActiveTab = false;
        renderView();

        expect(screen.getByRole('alert').textContent).toContain("Couldn't load Missing data");
        expect(screen.queryByTestId('library-health')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
        expect(maintenanceDataMock.retryActiveTab).toHaveBeenCalledTimes(1);
    });

    it('keeps last successful content visible when a refresh fails', () => {
        maintenanceDataMock.hasActiveLoadError = true;
        maintenanceDataMock.hasLoadedActiveTab = true;
        renderView();

        expect(screen.getByRole('alert').textContent).toContain('Showing the last loaded missing data');
        expect(screen.getByTestId('library-health')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
        expect(maintenanceDataMock.retryActiveTab).toHaveBeenCalledTimes(1);
    });

    it('keeps an active-tab click inert and resets scroll on a real tab change', async () => {
        const scrollTo = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
            configurable: true,
            value: scrollTo
        });
        renderView();

        fireEvent.click(screen.getByText('Tab missing'));
        expect(scrollTo).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('Tab trash'));
        await waitFor(() => expect(screen.getByTestId('maintenance-tabs').getAttribute('data-active-tab')).toBe('trash'));
        expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    });

    it('connects the active tab to a busy-aware tab panel', () => {
        maintenanceDataMock.isLoading = true;
        renderView();

        const panel = screen.getByRole('tabpanel');
        expect(panel.id).toBe('maintenance-panel-missing');
        expect(panel.getAttribute('aria-labelledby')).toBe('maintenance-tab-missing');
        expect(panel.getAttribute('aria-busy')).toBe('true');
    });
});
