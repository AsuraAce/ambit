import * as React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { act, fireEvent, render, waitFor } from './test/testUtils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from './constants/defaultSettings';
import { createDefaultFilters } from './utils/filterState';
import { GeneratorTool, type AIImage, type AppSettings, type Collection, type FilterState, type LayoutMode, type SmartCollection, type ViewMode } from './types';
import App from './App';
import { settingsPersistenceCoordinator } from './utils/settingsPersistenceCoordinator';

type AppLayoutProbe = {
    changeViewMode: (mode: ViewMode) => void;
    setLayoutMode: (mode: LayoutMode) => void;
    handleLayoutChange: (columns: number, rowHeight: number) => void;
    onOpenImportModal: () => void;
    handleRemoveFromCollection: () => Promise<void>;
    handleOpenCollectionModal: (mode?: 'add' | 'move') => void;
    onEditCollection: (id: string) => void;
    setExportIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    setViewingImageId: React.Dispatch<React.SetStateAction<string | null>>;
    setSelectedImageIndex: React.Dispatch<React.SetStateAction<number | null>>;
    searchProps: {
        onFocus: () => void;
        onBlur: () => void;
    };
    scopeName: string;
    scopeTotal: number;
    loadMoreImages: () => void;
    handlers: {
        setContextMenu: React.Dispatch<React.SetStateAction<unknown>>;
    };
};

type GlobalModalsProbe = {
    filteredImages: AIImage[];
    onExportConfirm: (name: string, folder: string) => void;
    onDeleteCollectionConfirm: () => void;
    onCollectionAction: (ids: string[], targetId: string, mode: 'add' | 'move', sourceId?: string) => Promise<void>;
    onCloseExport: () => void;
    onSettingsSave: React.Dispatch<React.SetStateAction<AppSettings>>;
    onCheckForUpdates: () => Promise<void>;
    onOpenUpdatePrompt: () => void;
    onNavigateToMaintenance: () => void;
    commandPaletteProps: {
        onNavigate: (mode: ViewMode) => void;
        onToggleTheme: () => void;
        onOpenSettings: () => void;
        onImport: () => void;
        onCreateCollection: () => void;
        onToggleAI: () => void;
    };
};

type OnboardingProbe = {
    isOpen: boolean;
    onComplete: (settings: Partial<AppSettings>) => void | Promise<void>;
    onOpenSettings: (tab: string) => void;
};

type ImportModalProbe = {
    isOpen: boolean;
    onClose: () => void;
    onOpenSettings: (tab: string) => void;
    onImportFiles: () => void;
};

type ViewerProbe = {
    image: AIImage;
    onClose: () => void;
    onNext: () => void;
    onPrev: () => void;
    onUpdatePrompt: (id: string, prompt: string) => void;
    onUpdateNegativePrompt: (id: string, prompt: string) => void;
    onUpdateModel: (id: string, model: string) => void;
    onUpdateTool: (id: string, tool: AIImage['metadata']['tool']) => void;
    onToggleFavorite: (id: string) => void;
    onTogglePin: (id: string, pinned: boolean) => void;
    onDelete: (id: string) => void;
    onOpenSettings: () => void;
    onUpdateNotes: (id: string, notes: string) => void;
    onSearch: (term: string) => void;
    onRevertMetadata: (id: string) => void;
    onRecoverMetadata: () => void;
    onAddToCollection: (id: string) => void;
    onToggleSidebar: () => void;
};

type ContextMenuProbe = {
    onClose: () => void;
    onMoveToCollection: () => void;
};

type ShortcutProbe = {
    handleBulkDelete: () => void;
    togglePrivacyMode: () => void;
    toggleMasking: () => void;
    toggleFavorite: () => void;
    togglePin: () => void;
    openCollection: () => void;
    closeAllModals: () => void;
    toggleShortcuts: () => void;
    toggleCommandPalette: () => void;
    onCloseViewer: () => void;
    handleRemoveFromCollection: () => Promise<void>;
};

const captured = vi.hoisted(() => ({
    appLayout: null as AppLayoutProbe | null,
    globalModals: null as GlobalModalsProbe | null,
    onboarding: null as OnboardingProbe | null,
    importModal: null as ImportModalProbe | null,
    viewer: null as ViewerProbe | null,
    contextMenu: null as ContextMenuProbe | null,
    updateDialog: null as Record<string, unknown> | null
}));

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    settings: null as unknown as AppSettings,
    settingsLoaded: true,
    geminiApiKey: null as string | null,
    setSettings: vi.fn(),
    rollbackSettings: vi.fn(),
    flushSettings: vi.fn().mockResolvedValue(undefined),
    collectionsLoaded: true,
    collections: [] as Collection[],
    setCollections: vi.fn(),
    refreshCollections: vi.fn().mockResolvedValue(undefined),
    refreshCollectionThumbnails: vi.fn().mockResolvedValue(undefined),
    images: [] as AIImage[],
    filters: null as unknown as FilterState,
    setImages: vi.fn(),
    setFilters: vi.fn(),
    setSortOption: vi.fn(),
    toggleFavorite: vi.fn(),
    clearAllFilters: vi.fn(),
    setRecentSearches: vi.fn(),
    refreshMetadata: vi.fn(),
    selectedIds: new Set<string>(),
    setSelectedIds: vi.fn(),
    setLastSelectedId: vi.fn(),
    handleImageClick: vi.fn(),
    handleSelectionToggle: vi.fn(),
    handleRangeSelection: vi.fn(),
    clearSelection: vi.fn(),
    toggleTheme: vi.fn(),
    refreshMaintenanceCounts: vi.fn(),
    toggleAiSearch: vi.fn(),
    submitSearch: vi.fn(),
    aiSearchOptions: null as null | { onOpenSettings: () => void },
    dragDropOptions: null as null | { onImportFiles: (files: FileList) => void; onImportPaths: (paths: string[]) => void },
    fileInputRef: { current: null as HTMLInputElement | null },
    handleImportFiles: vi.fn().mockResolvedValue(undefined),
    handleImportPaths: vi.fn().mockResolvedValue(undefined),
    handleImportFolders: vi.fn().mockResolvedValue(undefined),
    importImages: vi.fn(),
    handleInvokeSync: vi.fn(),
    removeImagesFromCollection: vi.fn().mockResolvedValue(undefined),
    moveImagesBetweenCollections: vi.fn().mockResolvedValue(undefined),
    addImagesToCollection: vi.fn().mockResolvedValue(undefined),
    deleteCollection: vi.fn().mockResolvedValue(undefined),
    updateCollectionFilters: vi.fn().mockResolvedValue(undefined),
    handleExportConfirm: vi.fn(),
    executeDelete: vi.fn(),
    executeMetadataRecovery: vi.fn(),
    handlePinImage: vi.fn(),
    handleFavoriteImage: vi.fn(),
    handleDeleteViewerImage: vi.fn(),
    handleTogglePrivacy: vi.fn(),
    handleBulkMask: vi.fn(),
    handleShortcutFavorite: vi.fn(),
    handleShortcutPin: vi.fn(),
    handlers: {
        handleUpdatePrompt: vi.fn(),
        handleUpdateNegativePrompt: vi.fn(),
        handleUpdateModel: vi.fn(),
        handleUpdateTool: vi.fn(),
        handleUpdateNotes: vi.fn(),
        handleRevertMetadata: vi.fn()
    },
    startInvokeSync: vi.fn(),
    folderMonitor: vi.fn(),
    shortcuts: vi.fn(),
    thumbnailQueue: vi.fn(),
    metadataRefresh: vi.fn(),
    updater: {
        update: null as null | { version: string; body?: string; date?: string },
        canCheckForUpdates: true,
        isDialogOpen: false,
        errorMessage: null as string | null,
        status: 'idle',
        checkForUpdates: vi.fn().mockResolvedValue(undefined),
        openUpdateDialog: vi.fn(),
        dismissUpdateDialog: vi.fn(),
        installUpdate: vi.fn()
    },
    modals: {
        modals: {} as Record<string, boolean>,
        setModals: vi.fn(),
        openModal: vi.fn(),
        closeModal: vi.fn(),
        closeAllModals: vi.fn(),
        isAnyModalOpen: false,
        setInitialSettingsTab: vi.fn(),
        setAddToCollectionMode: vi.fn(),
        setSourceCollectionId: vi.fn(),
        setCollectionToEditId: vi.fn(),
        setCollectionToDelete: vi.fn(),
        setShortcutsModalTab: vi.fn(),
        collectionToDelete: null as string | null,
        collectionToEditId: null as string | null,
        pendingViewerDeleteId: null as string | null,
        addToCollectionMode: 'add' as 'add' | 'move',
        sourceCollectionId: null as string | null,
        slideshowShuffle: false,
        initialSettingsTab: 'general',
        shortcutsModalTab: 'shortcuts'
    }
}));

const image = (id: string): AIImage => ({
    id,
    url: `file:///${id}.png`,
    thumbnailUrl: `file:///${id}-thumb.png`,
    filename: `${id}.png`,
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Model',
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: 'sunset, detailed sky',
        negativePrompt: ''
    }
});

const createDeferred = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
};

vi.mock('./hooks/useToast', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('./hooks/useModalManager', () => ({ useModalManager: () => mocks.modals }));
vi.mock('./hooks/useAppVersion', () => ({ useAppVersion: () => '1.0.0' }));
vi.mock('./stores/settingsStore', () => {
    const storeState = () => ({
        isLoaded: mocks.settingsLoaded,
        settings: mocks.settings,
        geminiApiKey: mocks.geminiApiKey,
        setSettings: mocks.setSettings,
        rollbackSettings: mocks.rollbackSettings,
        flushSettings: mocks.flushSettings,
    });
    const useSettingsStore = (selector: (state: ReturnType<typeof storeState>) => unknown) => selector({
        isLoaded: mocks.settingsLoaded,
        settings: mocks.settings,
        geminiApiKey: mocks.geminiApiKey,
        setSettings: mocks.setSettings,
        rollbackSettings: mocks.rollbackSettings,
        flushSettings: mocks.flushSettings
    });
    useSettingsStore.getState = storeState;
    return { useSettingsStore };
});
vi.mock('./stores/collectionStore', () => ({
    useCollectionStore: (selector: (state: {
        isLoaded: boolean;
        collections: Collection[];
        setCollections: typeof mocks.setCollections;
        refreshCollections: typeof mocks.refreshCollections;
        refreshCollectionThumbnails: typeof mocks.refreshCollectionThumbnails;
    }) => unknown) => selector({
        isLoaded: mocks.collectionsLoaded,
        collections: mocks.collections,
        setCollections: mocks.setCollections,
        refreshCollections: mocks.refreshCollections,
        refreshCollectionThumbnails: mocks.refreshCollectionThumbnails
    })
}));
vi.mock('./contexts/SearchContext', () => ({
    useSearch: () => ({
        images: mocks.images,
        setImages: mocks.setImages,
        imagesQueryKey: ['images'],
        filters: mocks.filters,
        setFilters: mocks.setFilters,
        sortOption: 'date_desc',
        setSortOption: mocks.setSortOption,
        totalImages: mocks.images.length,
        globalTotal: mocks.images.length + 5,
        isFiltering: false,
        toggleFavorite: mocks.toggleFavorite,
        clearAllFilters: mocks.clearAllFilters,
        recentSearches: ['old'],
        setRecentSearches: mocks.setRecentSearches,
        refreshMetadata: mocks.refreshMetadata
    })
}));
vi.mock('./hooks/useAppUpdater', () => ({ useAppUpdater: () => mocks.updater }));
vi.mock('./hooks/useThumbnailQueue', () => ({ useThumbnailQueue: mocks.thumbnailQueue }));
vi.mock('./hooks/useMetadataRefresh', () => ({ useMetadataRefresh: mocks.metadataRefresh }));
vi.mock('./hooks/useTheme', () => ({ useTheme: () => ({ toggleTheme: mocks.toggleTheme }) }));
vi.mock('./hooks/useSelection', () => ({
    useSelection: () => ({
        selectedIds: mocks.selectedIds,
        setSelectedIds: mocks.setSelectedIds,
        lastSelectedId: null,
        setLastSelectedId: mocks.setLastSelectedId,
        handleImageClick: mocks.handleImageClick,
        handleSelectionToggle: mocks.handleSelectionToggle,
        handleRangeSelection: mocks.handleRangeSelection,
        clearSelection: mocks.clearSelection
    })
}));
vi.mock('./contexts/WatcherContext', () => ({ useWatchers: () => ({ refreshMaintenanceCounts: mocks.refreshMaintenanceCounts }) }));
vi.mock('./hooks/useAppHandlers', () => ({ useAppHandlers: () => mocks.handlers }));
vi.mock('./hooks/useAiSearchLogic', () => ({
    useAiSearchLogic: (options: { onOpenSettings: () => void }) => {
        mocks.aiSearchOptions = options;
        return {
        toggleAiSearch: mocks.toggleAiSearch,
        submitSearch: mocks.submitSearch,
        inputRef: { current: null },
        isAiSearchEnabled: true,
        isSearchingAi: false
        };
    }
}));
vi.mock('./hooks/useFileOperations', () => ({
    useFileOperations: () => ({
        handleImportFiles: mocks.handleImportFiles,
        handleImportPaths: mocks.handleImportPaths,
        handleImportFolders: mocks.handleImportFolders,
        importImages: mocks.importImages,
        handleInvokeSync: mocks.handleInvokeSync,
        fileInputRef: mocks.fileInputRef,
        isRecoveringMetadata: false,
        isExporting: false
    })
}));
vi.mock('./hooks/useCollectionOperations', () => ({
    useCollectionOperations: () => ({
        removeImagesFromCollection: mocks.removeImagesFromCollection,
        moveImagesBetweenCollections: mocks.moveImagesBetweenCollections,
        addImagesToCollection: mocks.addImagesToCollection,
        deleteCollection: mocks.deleteCollection,
        updateCollectionFilters: mocks.updateCollectionFilters
    })
}));
vi.mock('./hooks/useAppActions', () => ({
    useAppActions: () => ({
        handleExportConfirm: mocks.handleExportConfirm,
        executeDelete: mocks.executeDelete,
        executeMetadataRecovery: mocks.executeMetadataRecovery,
        handlePinImage: mocks.handlePinImage,
        handleFavoriteImage: mocks.handleFavoriteImage,
        handleDeleteViewerImage: mocks.handleDeleteViewerImage,
        handleTogglePrivacy: mocks.handleTogglePrivacy,
        handleBulkMask: mocks.handleBulkMask,
        handleShortcutFavorite: mocks.handleShortcutFavorite,
        handleShortcutPin: mocks.handleShortcutPin
    })
}));
vi.mock('./hooks/useDragDrop', () => ({
    useDragDrop: (options: { onImportFiles: (files: FileList) => void; onImportPaths: (paths: string[]) => void }) => {
        mocks.dragDropOptions = options;
        return { isDraggingExternal: true };
    }
}));
vi.mock('./contexts/SyncContext', () => ({ useSync: () => ({ startInvokeSync: mocks.startInvokeSync }) }));
vi.mock('./hooks/useFolderMonitor', () => ({ useFolderMonitor: mocks.folderMonitor }));
vi.mock('./hooks/useGlobalShortcuts', () => ({ useGlobalShortcuts: mocks.shortcuts }));
vi.mock('./features/viewer/utils/searchHighlights', () => ({ derivePromptHighlightSpec: vi.fn(() => ({ terms: ['sunset'] })) }));

vi.mock('./components/AppLayout', () => ({
    AppLayout: (props: AppLayoutProbe) => {
        captured.appLayout = props;
        return <div data-testid="app-layout" />;
    }
}));
vi.mock('./components/GlobalModals', () => ({
    GlobalModals: (props: GlobalModalsProbe) => {
        captured.globalModals = props;
        return <div data-testid="global-modals" />;
    }
}));
vi.mock('./components/ui/OnboardingWizard', () => ({
    OnboardingWizard: (props: OnboardingProbe) => {
        captured.onboarding = props;
        return <div data-testid="onboarding" />;
    }
}));
vi.mock('./components/ui/ImportModal', () => ({
    ImportModal: (props: ImportModalProbe) => {
        captured.importModal = props;
        return <div data-testid="import-modal" />;
    }
}));
vi.mock('./components/ui/UpdateDialog', () => ({
    UpdateDialog: (props: Record<string, unknown>) => {
        captured.updateDialog = props;
        return <div data-testid="update-dialog" />;
    }
}));
vi.mock('./components/ui/AppContextMenu', () => ({
    AppContextMenu: (props: ContextMenuProbe) => {
        captured.contextMenu = props;
        return <div data-testid="context-menu" />;
    }
}));
vi.mock('./components/ui/TitleBar', () => ({ TitleBar: () => <div data-testid="title-bar" /> }));
vi.mock('./components/ui/DragOverlay', () => ({ DragOverlay: ({ isVisible }: { isVisible: boolean }) => <div data-visible={isVisible} /> }));
vi.mock('./features/viewer/components/ImageViewer', () => ({
    ImageViewer: (props: ViewerProbe) => {
        captured.viewer = props;
        return <div data-testid="image-viewer" />;
    }
}));

const requireProbe = <T,>(value: T | null, name: string): T => {
    if (!value) throw new Error(`${name} was not rendered`);
    return value;
};

describe('App orchestration', () => {
    beforeEach(() => {
        settingsPersistenceCoordinator.reopenAdmission();
        vi.clearAllMocks();
        captured.appLayout = null;
        captured.globalModals = null;
        captured.onboarding = null;
        captured.importModal = null;
        captured.viewer = null;
        captured.contextMenu = null;
        captured.updateDialog = null;
        mocks.settings = createDefaultAppSettings({
            hasCompletedOnboarding: true,
            autoCheckForUpdates: true,
            enableAI: false,
            defaultTheaterMode: false
        });
        mocks.settingsLoaded = true;
        mocks.geminiApiKey = null;
        mocks.collectionsLoaded = true;
        mocks.collections = [];
        mocks.images = [image('one'), image('two')];
        mocks.filters = createDefaultFilters();
        mocks.selectedIds = new Set();
        mocks.aiSearchOptions = null;
        mocks.dragDropOptions = null;
        mocks.fileInputRef.current = null;
        mocks.updater.update = null;
        mocks.updater.isDialogOpen = false;
        mocks.updater.status = 'idle';
        mocks.updater.errorMessage = null;
        mocks.modals.collectionToDelete = null;
        mocks.modals.collectionToEditId = null;
        mocks.modals.isAnyModalOpen = false;
        mocks.setSettings.mockImplementation((update: React.SetStateAction<AppSettings>) => {
            mocks.settings = {
                ...mocks.settings,
                ...(typeof update === 'function' ? update(mocks.settings) : update),
            };
        });
        mocks.rollbackSettings.mockImplementation((_permit, update: React.SetStateAction<AppSettings>) => {
            mocks.settings = {
                ...mocks.settings,
                ...(typeof update === 'function' ? update(mocks.settings) : update),
            };
            return mocks.settings;
        });
        mocks.flushSettings.mockResolvedValue(undefined);
        mocks.setRecentSearches.mockImplementation((update: React.SetStateAction<string[]>) => {
            if (typeof update === 'function') update(['old']);
        });
        vi.mocked(open).mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
        document.getElementById('static-loading')?.remove();
    });

    it('waits for settings and collections before rendering the application shell', () => {
        mocks.settingsLoaded = false;
        const { container } = render(<App />);

        expect(container.textContent).toBe('');
        expect(captured.appLayout).toBeNull();
        expect(mocks.thumbnailQueue).toHaveBeenCalledWith(mocks.addToast);
        expect(mocks.metadataRefresh).toHaveBeenCalled();
    });

    it('wires loaded stores, background hooks, tags, and the static loader lifecycle', async () => {
        vi.useFakeTimers();
        const staticLoader = document.createElement('div');
        staticLoader.id = 'static-loading';
        document.body.appendChild(staticLoader);

        render(<App />);
        expect(requireProbe(captured.appLayout, 'AppLayout').scopeName).toBe('Library');
        expect(requireProbe(captured.appLayout, 'AppLayout').scopeTotal).toBe(7);
        expect(staticLoader.style.opacity).toBe('0');
        expect(mocks.folderMonitor).toHaveBeenCalledWith(expect.objectContaining({
            isLoaded: true,
            monitoredFolders: mocks.settings.monitoredFolders,
            addToast: mocks.addToast,
            refreshMetadata: mocks.refreshMetadata
        }));
        expect(mocks.shortcuts).toHaveBeenCalledWith(expect.objectContaining({ viewMode: 'grid' }));

        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4000);
        });
        expect(document.getElementById('static-loading')).toBeNull();
    });

    it('handles view, layout, search focus, collection, and export commands', async () => {
        vi.useFakeTimers();
        const active: Collection = {
            id: 'collection-a',
            name: 'Collection A',
            imageIds: ['one'],
            count: 1,
            createdAt: 1,
            source: 'ambit'
        };
        const smart: SmartCollection = {
            id: 'smart-a',
            name: 'Smart A',
            imageIds: [],
            count: 2,
            createdAt: 2,
            source: 'ambit',
            filters: createDefaultFilters({ searchQuery: 'portrait' })
        };
        mocks.collections = [active, smart];
        mocks.filters = createDefaultFilters({ collectionId: 'collection-a' });
        mocks.selectedIds = new Set(['one']);
        mocks.modals.collectionToDelete = 'collection-a';
        render(<App />);
        const layout = requireProbe(captured.appLayout, 'AppLayout');

        const initialClearCount = mocks.clearSelection.mock.calls.length;
        act(() => layout.changeViewMode('grid'));
        expect(mocks.clearSelection).toHaveBeenCalledTimes(initialClearCount);
        act(() => layout.changeViewMode('maintenance'));
        expect(mocks.clearSelection).toHaveBeenCalledTimes(initialClearCount + 1);
        act(() => layout.setLayoutMode('justified'));
        expect(mocks.settings.libraryLayoutMode).toBe('justified');
        act(() => layout.handleLayoutChange(1, 200));
        act(() => layout.handleLayoutChange(4, 240));
        layout.loadMoreImages();
        act(() => layout.searchProps.onFocus());
        act(() => layout.searchProps.onBlur());
        await act(async () => vi.advanceTimersByTimeAsync(200));

        act(() => layout.handleOpenCollectionModal('move'));
        expect(mocks.modals.setAddToCollectionMode).toHaveBeenCalledWith('move');
        act(() => layout.handleOpenCollectionModal('add'));
        expect(mocks.modals.setSourceCollectionId).toHaveBeenCalledWith(null);
        act(() => layout.onEditCollection('collection-a'));
        expect(mocks.modals.setCollectionToEditId).toHaveBeenCalledWith('collection-a');
        await act(async () => layout.handleRemoveFromCollection());
        expect(mocks.removeImagesFromCollection).toHaveBeenCalledWith(['one'], 'collection-a');
        expect(mocks.addToast).toHaveBeenCalledWith('Removed 1 images from collection', 'info');

        act(() => layout.setExportIds(new Set(['one'])));
        requireProbe(captured.globalModals, 'GlobalModals').onExportConfirm('export', 'C:/out');
        expect(mocks.handleExportConfirm).toHaveBeenCalledWith('export', 'C:/out', new Set(['one']));
        requireProbe(captured.globalModals, 'GlobalModals').onDeleteCollectionConfirm();
        expect(mocks.deleteCollection).toHaveBeenCalledWith('collection-a');
        requireProbe(captured.globalModals, 'GlobalModals').onCloseExport();
        act(() => layout.handlers.setContextMenu({ x: 1, y: 2, imageId: 'one' }));
        requireProbe(captured.contextMenu, 'AppContextMenu').onMoveToCollection();
        expect(mocks.modals.setSourceCollectionId).toHaveBeenCalledWith('collection-a');
        requireProbe(captured.contextMenu, 'AppContextMenu').onClose();
    });

    it('completes onboarding and handles browser and native import paths', async () => {
        mocks.settings.hasCompletedOnboarding = false;
        render(<App />);
        const onboarding = requireProbe(captured.onboarding, 'OnboardingWizard');
        expect(onboarding.isOpen).toBe(true);
        await act(async () => onboarding.onComplete({ theme: 'light' }));
        expect(mocks.settings.theme).toBe('light');
        expect(mocks.flushSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'light' }));
        expect(mocks.addToast).toHaveBeenCalledWith('Setup complete!', 'success');
        act(() => onboarding.onOpenSettings('privacy'));
        expect(mocks.modals.setInitialSettingsTab).toHaveBeenCalledWith('privacy');

        const input = mocks.fileInputRef.current;
        if (!input) throw new Error('File input was not attached');
        const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => undefined);
        act(() => requireProbe(captured.appLayout, 'AppLayout').onOpenImportModal());
        expect(requireProbe(captured.importModal, 'ImportModal').isOpen).toBe(true);
        act(() => requireProbe(captured.importModal, 'ImportModal').onImportFiles());
        expect(clickSpy).toHaveBeenCalled();
        act(() => requireProbe(captured.importModal, 'ImportModal').onOpenSettings('folders'));
        expect(mocks.modals.setInitialSettingsTab).toHaveBeenCalledWith('folders');
        act(() => requireProbe(captured.importModal, 'ImportModal').onClose());
        expect(requireProbe(captured.importModal, 'ImportModal').isOpen).toBe(false);

        (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
        vi.mocked(open).mockResolvedValue(['C:/a.png', 'C:/b.webp']);
        await act(async () => requireProbe(captured.importModal, 'ImportModal').onImportFiles());
        expect(mocks.handleImportPaths).toHaveBeenCalledWith(['C:/a.png', 'C:/b.webp']);
    });

    it('keeps onboarding open and restores only its fields when the durable flush rejects', async () => {
        const flush = createDeferred<void>();
        const rollbackFlush = createDeferred<void>();
        mocks.settings = createDefaultAppSettings({
            hasCompletedOnboarding: false,
            enableAI: false,
            maskedKeywords: ['existing-private'],
            maskingMode: 'hide',
            thumbnailSize: 200,
        });
        let durableSettings = mocks.settings;
        mocks.flushSettings
            .mockImplementationOnce(async (nextSettings: AppSettings) => {
                // Model a repository that wrote its pending/main snapshots before
                // a later backup step rejected the onboarding flush.
                durableSettings = nextSettings;
                await flush.promise;
            })
            .mockImplementationOnce(async (restoredSettings: AppSettings) => {
                durableSettings = restoredSettings;
                await rollbackFlush.promise;
            });
        render(<App />);

        const onboarding = requireProbe(captured.onboarding, 'OnboardingWizard');
        const completion = onboarding.onComplete({
            hasCompletedOnboarding: true,
            enableAI: true,
            maskedKeywords: ['new-private'],
            maskingMode: 'blur',
        });
        await waitFor(() => expect(mocks.flushSettings).toHaveBeenCalledOnce());
        let drainSettled = false;
        const drain = settingsPersistenceCoordinator.closeAdmissionAndDrain().finally(() => {
            drainSettled = true;
        });
        void drain.catch(() => undefined);
        mocks.settings = { ...mocks.settings, thumbnailSize: 320 };
        flush.reject(new Error('disk full'));

        await waitFor(() => expect(mocks.flushSettings).toHaveBeenCalledTimes(2));
        expect(drainSettled).toBe(false);
        rollbackFlush.resolve();
        await act(async () => expect(completion).rejects.toThrow('disk full'));
        await expect(drain).rejects.toBeInstanceOf(AggregateError);
        expect(mocks.settings).toEqual(expect.objectContaining({
            hasCompletedOnboarding: false,
            enableAI: false,
            maskedKeywords: ['existing-private'],
            maskingMode: 'hide',
            thumbnailSize: 320,
        }));
        expect(mocks.flushSettings).toHaveBeenCalledTimes(2);
        expect(mocks.flushSettings).toHaveBeenLastCalledWith(expect.objectContaining({
            hasCompletedOnboarding: false,
            enableAI: false,
            maskedKeywords: ['existing-private'],
            maskingMode: 'hide',
            thumbnailSize: 320,
        }));
        expect(durableSettings).toEqual(expect.objectContaining({
            hasCompletedOnboarding: false,
            maskedKeywords: ['existing-private'],
            thumbnailSize: 320,
        }));
        expect(requireProbe(captured.importModal, 'ImportModal').isOpen).toBe(false);
        expect(mocks.addToast).not.toHaveBeenCalledWith('Setup complete!', 'success');
        expect(mocks.addToast).toHaveBeenCalledWith('Setup could not be saved. Please try again.', 'error');
    });

    it('routes global modal collection, update, and command-palette actions', async () => {
        const createButton = document.createElement('button');
        createButton.id = 'create-col-btn';
        const createClick = vi.spyOn(createButton, 'click').mockImplementation(() => undefined);
        document.body.appendChild(createButton);
        vi.useFakeTimers();
        render(<App />);
        const global = requireProbe(captured.globalModals, 'GlobalModals');

        await act(async () => global.onCollectionAction(['one'], 'target', 'add'));
        expect(mocks.addImagesToCollection).toHaveBeenCalledWith(['one'], 'target');
        await act(async () => global.onCollectionAction(['two'], 'target', 'move', 'source'));
        expect(mocks.moveImagesBetweenCollections).toHaveBeenCalledWith(['two'], 'source', 'target');
        await global.onCheckForUpdates();
        expect(mocks.updater.checkForUpdates).toHaveBeenCalledWith({ manual: true });
        global.onOpenUpdatePrompt();
        expect(mocks.updater.openUpdateDialog).toHaveBeenCalled();
        global.onNavigateToMaintenance();
        global.commandPaletteProps.onToggleTheme();
        global.commandPaletteProps.onOpenSettings();
        global.commandPaletteProps.onToggleAI();
        global.commandPaletteProps.onImport();
        global.commandPaletteProps.onCreateCollection();
        await act(async () => vi.advanceTimersByTimeAsync(100));

        expect(mocks.toggleTheme).toHaveBeenCalled();
        expect(mocks.toggleAiSearch).toHaveBeenCalled();
        expect(mocks.modals.setInitialSettingsTab).toHaveBeenCalledWith('general');
        expect(createClick).toHaveBeenCalled();
        createButton.remove();
    });

    it('renders updater state and forwards viewer navigation and metadata actions', async () => {
        mocks.updater.update = { version: '2.0.0', body: 'Notes', date: '2026-07-10' };
        mocks.updater.isDialogOpen = true;
        render(<App />);
        await waitFor(() => {
            expect(captured.updateDialog).toEqual(expect.objectContaining({
                isOpen: true,
                currentVersion: '1.0.0',
                availableVersion: '2.0.0'
            }));
        });

        act(() => requireProbe(captured.appLayout, 'AppLayout').setSelectedImageIndex(0));
        await waitFor(() => expect(captured.viewer?.image.id).toBe('one'));
        let viewer = requireProbe(captured.viewer, 'ImageViewer');
        act(() => viewer.onNext());
        await waitFor(() => expect(captured.viewer?.image.id).toBe('two'));
        viewer = requireProbe(captured.viewer, 'ImageViewer');
        act(() => viewer.onPrev());
        await waitFor(() => expect(captured.viewer?.image.id).toBe('one'));
        viewer = requireProbe(captured.viewer, 'ImageViewer');

        viewer.onUpdatePrompt('one', 'prompt');
        viewer.onUpdateNegativePrompt('one', 'negative');
        viewer.onUpdateModel('one', 'model');
        viewer.onUpdateTool('one', GeneratorTool.COMFYUI);
        viewer.onUpdateNotes('one', 'notes');
        viewer.onToggleFavorite('one');
        viewer.onTogglePin('one', true);
        viewer.onDelete('one');
        viewer.onRevertMetadata('one');
        viewer.onOpenSettings();
        viewer.onAddToCollection('one');
        viewer.onToggleSidebar();
        viewer.onClose();

        expect(mocks.handlers.handleUpdatePrompt).toHaveBeenCalledWith('one', 'prompt');
        expect(mocks.handlers.handleUpdateNegativePrompt).toHaveBeenCalledWith('one', 'negative');
        expect(mocks.handleFavoriteImage).toHaveBeenCalledWith('one', { showToast: false });
        expect(mocks.handlePinImage).toHaveBeenCalledWith('one', true, { showToast: false });
        expect(mocks.handleDeleteViewerImage).toHaveBeenCalledWith('one');
        expect(mocks.settings.defaultTheaterMode).toBe(true);
    });

    it('removes viewer and compare/slideshow image exposure when SearchContext fails closed', async () => {
        mocks.selectedIds = new Set(['one', 'two']);
        mocks.modals.modals = { ...mocks.modals.modals, compare: true, slideshow: true };
        const view = render(<App />);

        act(() => requireProbe(captured.appLayout, 'AppLayout').setViewingImageId('one'));
        await waitFor(() => expect(view.container.querySelector('[data-testid="image-viewer"]')).not.toBeNull());

        mocks.images = [];
        captured.viewer = null;
        view.rerender(<App />);

        await waitFor(() => expect(view.container.querySelector('[data-testid="image-viewer"]')).toBeNull());
        expect(requireProbe(captured.globalModals, 'GlobalModals').filteredImages).toEqual([]);
        expect(captured.viewer).toBeNull();
    });

    it('handles orchestration defaults, picker variants, and viewer boundaries', async () => {
        mocks.settings.libraryLayoutMode = undefined;
        mocks.images = [
            image('one'),
            {
                ...image('two'),
                metadata: { ...image('two').metadata, positivePrompt: 42 as unknown as string },
            },
            {
                ...image('three'),
                metadata: { ...image('three').metadata, positivePrompt: 'a, this prompt token is deliberately much longer than forty characters' },
            },
        ];
        render(<App />);
        const layout = requireProbe(captured.appLayout, 'AppLayout');

        act(() => layout.handleOpenCollectionModal());
        expect(mocks.modals.setAddToCollectionMode).toHaveBeenCalledWith('add');

        act(() => layout.setExportIds(new Set()));
        requireProbe(captured.globalModals, 'GlobalModals').onExportConfirm('all', 'C:/out');
        expect(mocks.handleExportConfirm).toHaveBeenCalledWith('all', 'C:/out', undefined);
        requireProbe(captured.globalModals, 'GlobalModals').onDeleteCollectionConfirm();
        expect(mocks.deleteCollection).not.toHaveBeenCalled();

        act(() => layout.handlers.setContextMenu({ x: 1, y: 2, imageId: 'one' }));
        requireProbe(captured.contextMenu, 'AppContextMenu').onMoveToCollection();
        expect(mocks.modals.setSourceCollectionId).not.toHaveBeenCalledWith(expect.any(String));

        (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
        vi.mocked(open).mockResolvedValueOnce('C:/single.png');
        await act(async () => requireProbe(captured.importModal, 'ImportModal').onImportFiles());
        expect(mocks.handleImportPaths).toHaveBeenCalledWith(['C:/single.png']);
        vi.mocked(open).mockResolvedValueOnce(null);
        await act(async () => requireProbe(captured.importModal, 'ImportModal').onImportFiles());

        act(() => layout.setSelectedImageIndex(0));
        await waitFor(() => expect(captured.viewer?.image.id).toBe('one'));
        act(() => requireProbe(captured.viewer, 'ImageViewer').onPrev());
        expect(captured.viewer?.image.id).toBe('one');

        act(() => layout.setSelectedImageIndex(mocks.images.length - 1));
        await waitFor(() => expect(captured.viewer?.image.id).toBe('three'));
        act(() => requireProbe(captured.viewer, 'ImageViewer').onNext());
        expect(captured.viewer?.image.id).toBe('three');
    });

    it('derives fallback collection totals, onboarding visibility, and guarded prompt tags', async () => {
        vi.useFakeTimers();
        mocks.settings.hasCompletedOnboarding = false;
        mocks.collections = [{
            id: 'collection-a',
            name: 'Collection A',
            imageIds: ['one', 'two'],
            createdAt: 1,
            source: 'ambit',
        }];
        mocks.filters = createDefaultFilters({ collectionId: 'collection-a' });
        mocks.images = [
            { ...image('one'), metadata: { ...image('one').metadata, positivePrompt: 42 as unknown as string } },
            { ...image('two'), metadata: { ...image('two').metadata, positivePrompt: 'a, this prompt token is deliberately much longer than forty characters' } },
        ];

        render(<App />);

        expect(requireProbe(captured.appLayout, 'AppLayout').scopeTotal).toBe(2);
        expect(requireProbe(captured.onboarding, 'OnboardingWizard').isOpen).toBe(true);
        await act(async () => vi.advanceTimersByTimeAsync(1000));
    });

    it('forwards AI, drag-drop, folder-monitor, and shortcut adapters', async () => {
        render(<App />);
        requireProbe(mocks.aiSearchOptions, 'AI search options').onOpenSettings();
        expect(mocks.modals.setInitialSettingsTab).toHaveBeenCalledWith('experiments');

        const dragOptions = requireProbe(mocks.dragDropOptions, 'Drag-drop options');
        const file = new File(['image'], 'drop.png', { type: 'image/png' });
        const files = {
            0: file,
            length: 1,
            item: (index: number) => index === 0 ? file : null
        } as unknown as FileList;
        dragOptions.onImportFiles(files);
        expect(mocks.handleImportFiles).toHaveBeenCalledWith([file]);
        dragOptions.onImportPaths(['C:/drop.png']);
        expect(mocks.handleImportPaths).toHaveBeenCalledWith(['C:/drop.png']);

        const monitorOptions = mocks.folderMonitor.mock.calls[0][0] as {
            onScan: (folders: AppSettings['monitoredFolders'], options: { forceRescan: boolean }) => void;
        };
        monitorOptions.onScan(mocks.settings.monitoredFolders, { forceRescan: true });
        expect(mocks.handleImportFolders).toHaveBeenCalledWith(mocks.settings.monitoredFolders, { forceRescan: true });

        const shortcuts = mocks.shortcuts.mock.calls[0][0] as ShortcutProbe;
        shortcuts.handleBulkDelete();
        expect(mocks.modals.openModal).toHaveBeenCalledWith('deleteConfirm');
        mocks.settings.confirmDelete = false;
        shortcuts.handleBulkDelete();
        shortcuts.togglePrivacyMode();
        shortcuts.toggleMasking();
        shortcuts.toggleFavorite();
        shortcuts.togglePin();
        shortcuts.openCollection();
        shortcuts.closeAllModals();
        shortcuts.toggleShortcuts();
        shortcuts.toggleCommandPalette();
        shortcuts.onCloseViewer();
        await shortcuts.handleRemoveFromCollection();

        expect(mocks.executeDelete).toHaveBeenCalled();
        expect(mocks.handleTogglePrivacy).toHaveBeenCalled();
        expect(mocks.handleBulkMask).toHaveBeenCalled();
        expect(mocks.handleShortcutFavorite).toHaveBeenCalled();
        expect(mocks.handleShortcutPin).toHaveBeenCalled();
        expect(mocks.modals.closeAllModals).toHaveBeenCalled();
        expect(mocks.modals.setShortcutsModalTab).toHaveBeenCalledWith('shortcuts');
        expect(mocks.modals.openModal).toHaveBeenCalledWith('commandPalette');
    });

    it('falls back to the browser file input when the native picker fails', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
        vi.mocked(open).mockRejectedValueOnce(new Error('picker unavailable'));
        render(<App />);
        const input = mocks.fileInputRef.current;
        if (!input) throw new Error('File input was not attached');
        const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => undefined);

        await act(async () => requireProbe(captured.importModal, 'ImportModal').onImportFiles());

        expect(errorSpy).toHaveBeenCalledWith(
            '[App] Native file picker import failed, falling back to file input.',
            expect.any(Error)
        );
        expect(clickSpy).toHaveBeenCalled();
    });

    it('derives smart collection scope labels and counts', () => {
        const smart: SmartCollection = {
            id: 'smart-a',
            name: 'Smart A',
            imageIds: [],
            count: 12,
            createdAt: 1,
            source: 'ambit',
            filters: createDefaultFilters({ searchQuery: 'portrait' })
        };
        mocks.collections = [smart];
        mocks.filters = createDefaultFilters({ collectionId: 'smart-a' });

        render(<App />);

        expect(requireProbe(captured.appLayout, 'AppLayout').scopeName).toBe('Smart A');
        expect(requireProbe(captured.appLayout, 'AppLayout').scopeTotal).toBe(2);
    });

    it('updates searches and gates recovery on AI configuration', async () => {
        render(<App />);
        act(() => requireProbe(captured.appLayout, 'AppLayout').setViewingImageId('one'));
        await waitFor(() => expect(captured.viewer?.image.id).toBe('one'));
        const viewer = requireProbe(captured.viewer, 'ImageViewer');

        viewer.onSearch('new term');
        await waitFor(() => expect(mocks.setFilters).toHaveBeenCalled());
        expect(mocks.setRecentSearches).toHaveBeenCalledWith(expect.any(Function));
        viewer.onRecoverMetadata();
        expect(mocks.modals.setInitialSettingsTab).toHaveBeenCalledWith('intelligence');
        expect(mocks.addToast).toHaveBeenCalledWith(
            'Enable AI features and configure a Gemini API key in Settings to use Prompt Recovery.',
            'info'
        );

        mocks.settings.enableAI = true;
        mocks.geminiApiKey = 'key';
        const { rerender } = render(<App />);
        rerender(<App />);
        act(() => requireProbe(captured.appLayout, 'AppLayout').setViewingImageId('one'));
        await waitFor(() => expect(captured.viewer).not.toBeNull());
        requireProbe(captured.viewer, 'ImageViewer').onRecoverMetadata();
        expect(mocks.modals.openModal).toHaveBeenCalledWith('recovery');
    });

    it('imports selected browser files through the hidden input', () => {
        render(<App />);
        const input = mocks.fileInputRef.current;
        if (!input) throw new Error('File input was not attached');
        const files = [new File(['a'], 'a.png', { type: 'image/png' })];
        fireEvent.change(input, { target: { files } });
        expect(mocks.importImages).toHaveBeenCalled();
    });
});
