import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AIImage, AppSettings, FilterState, Collection, RecoveryStyle } from '../types';
import { useToast } from './useToast';
import { useSearchStore } from '../stores/searchStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useCollectionStore } from '../stores/collectionStore';
import {
    rebuildThumbnailFacetCache,
    toggleImageFavorite,
    toggleImageMask,
    toggleImagePin,
} from '../services/db/imageRepo';
import { backfillParameterColumns } from '../services/db/maintenanceRepo';
import { useLibraryStore } from '../stores/libraryStore';
import { patchImageFlagsInQueryCaches, restoreImagesInQueryCaches } from '../utils/imageQueryCache';
import { applyOptimisticPinOrder } from '../utils/imageOptimisticUpdates';
import type { ImagesQueryKey } from './useImagesQuery';
import type { ActiveImageStateAdapter } from './activeImageState';

interface AppActionFileOps {
    deleteImages: (ids: string[]) => void | Promise<void>;
    exportImages: (filename: string, ids: Set<string> | string[], destinationFolder: string, onComplete?: () => void) => Promise<void>;
    recoverMetadata?: (targetId: string, style: RecoveryStyle, onComplete: () => void) => Promise<void>;
}

interface AppActionModalManager {
    openModal: (key: 'settings' | 'deleteConfirm' | 'recovery' | 'export') => void;
    closeModal: (key: 'deleteConfirm' | 'recovery' | 'export') => void;
    pendingViewerDeleteId: string | null;
    setPendingViewerDeleteId: React.Dispatch<React.SetStateAction<string | null>>;
    setInitialSettingsTab?: (tab: 'intelligence') => void;
}

interface UseAppActionsProps {
    viewingImageId: string | null;
    selectedImageIndex: number | null;
    setSelectedImageIndex: React.Dispatch<React.SetStateAction<number | null>>;
    viewerImages: AIImage[];
    setViewerSessionImages: React.Dispatch<React.SetStateAction<AIImage[] | null>>;
    fileOps: AppActionFileOps;
    selectedIds: Set<string>;
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    lastSelectedId: string | null;
    imagesQueryKey: ImagesQueryKey;
    modalManager: AppActionModalManager; // Renamed from modals
    activeImageState?: ActiveImageStateAdapter;
}

interface SingleImageActionOptions {
    showToast?: boolean;
}

export const useAppActions = ({
    viewingImageId,
    selectedImageIndex,
    setSelectedImageIndex,
    viewerImages,
    setViewerSessionImages,
    fileOps,
    selectedIds,
    setSelectedIds,
    lastSelectedId,
    imagesQueryKey,
    modalManager: modals, // Destructure with alias for minimum logic change
    activeImageState
}: UseAppActionsProps) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();

    // Store access
    const images = useSearchStore(s => s.images);
    const setImages = useSearchStore(s => s.setImages);
    const filters = useSearchStore(s => s.filters);

    const settings = useSettingsStore(s => s.settings);
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    const setPrivacyEnabled = useSettingsStore(s => s.setPrivacyEnabled);

    const refreshCollections = useCollectionStore(s => s.refreshCollections);
    const refreshSmartCounts = useCollectionStore(s => s.refreshSmartCounts);

    const { openModal, closeModal, pendingViewerDeleteId, setPendingViewerDeleteId } = modals;
    const getImage = (id: string) => activeImageState?.getImage(id) ?? images.find(image => image.id === id);
    const updateImage = (id: string, updater: (image: AIImage) => AIImage) => {
        if (activeImageState) {
            activeImageState.updateImage(id, updater);
            return;
        }
        setImages(prev => prev.map(image => image.id === id ? updater(image) : image));
    };

    const refreshCollectionsAfterImageFlagChange = React.useCallback(() => {
        void refreshCollections(true);

        if (!filters.collectionId) return;

        void refreshSmartCounts({
            collectionIds: [filters.collectionId],
            includeArchived: true,
            includePromptSearch: true,
            markPending: true
        });
    }, [filters.collectionId, refreshCollections, refreshSmartCounts]);

    const persistPinChanges = React.useCallback(async (
        ids: string[],
        isPinned: boolean,
        previousImages: typeof images,
        optimisticImages: typeof images,
        errorMessage: string,
        previousActiveImage?: AIImage,
        restoreGallery = true
    ) => {
        try {
            await Promise.all(ids.map(id => toggleImagePin(id, isPinned)));
            if (!restoreGallery) {
                void queryClient.invalidateQueries({ queryKey: ['images'] });
            }
            refreshCollectionsAfterImageFlagChange();
        } catch (error) {
            console.error('[Pin] Failed to persist pin state', error);
            if (restoreGallery) {
                setImages(previousImages);
                restoreImagesInQueryCaches(queryClient, previousImages, {
                    previousOrder: optimisticImages,
                    nextOrder: previousImages,
                    reorderQueryKey: imagesQueryKey
                });
            } else if (previousActiveImage) {
                patchImageFlagsInQueryCaches(queryClient, [previousActiveImage.id], {
                    isPinned: previousActiveImage.isPinned,
                });
            }
            if (previousActiveImage && activeImageState) {
                activeImageState.updateImage(previousActiveImage.id, () => previousActiveImage);
            }
            addToast(errorMessage, 'error');
        }
    }, [refreshCollectionsAfterImageFlagChange, setImages, addToast, queryClient, imagesQueryKey, activeImageState]);

    const persistFavoriteChanges = React.useCallback(async (
        ids: string[],
        isFavorite: boolean,
        previousImages: typeof images,
        previousActiveImage?: AIImage,
        restoreGallery = true
    ) => {
        try {
            await Promise.all(ids.map(id => toggleImageFavorite(id, isFavorite)));
            refreshCollectionsAfterImageFlagChange();
        } catch (error) {
            console.error('[Favorite] Failed to persist favorite state', error);
            if (restoreGallery) {
                setImages(previousImages);
                restoreImagesInQueryCaches(queryClient, previousImages);
            } else if (previousActiveImage) {
                patchImageFlagsInQueryCaches(queryClient, [previousActiveImage.id], {
                    isFavorite: previousActiveImage.isFavorite,
                });
            }
            if (previousActiveImage && activeImageState) {
                activeImageState.updateImage(previousActiveImage.id, () => previousActiveImage);
            }
            addToast('Failed to update favorite state', 'error');
        }
    }, [addToast, queryClient, refreshCollectionsAfterImageFlagChange, setImages, activeImageState]);

    const executeDeleteByIds = React.useCallback((ids: string[], targetDeleteId: string | null) => {
        fileOps.deleteImages(ids);

        if (targetDeleteId) {
            const idx = viewerImages.findIndex(img => img.id === targetDeleteId);
            if (idx !== -1) {
                const remainingViewerImages = viewerImages.filter(img => !ids.includes(img.id));
                let nextIndex: number | null = idx;
                if (remainingViewerImages.length === 0) nextIndex = null;
                else if (idx >= remainingViewerImages.length) nextIndex = remainingViewerImages.length - 1;
                setViewerSessionImages(remainingViewerImages.length > 0 ? remainingViewerImages : null);
                setSelectedImageIndex(nextIndex);
            } else {
                activeImageState?.removeImage(targetDeleteId);
            }
        } else {
            setSelectedIds(new Set());
        }
        closeModal('deleteConfirm');
        setPendingViewerDeleteId(null);
    }, [fileOps, viewerImages, setViewerSessionImages, setSelectedImageIndex, setSelectedIds, closeModal, setPendingViewerDeleteId, activeImageState]);

    const executeDelete = React.useCallback(() => {
        const ids = pendingViewerDeleteId ? [pendingViewerDeleteId] : Array.from(selectedIds);
        executeDeleteByIds(ids, pendingViewerDeleteId);
    }, [pendingViewerDeleteId, selectedIds, executeDeleteByIds]);

    const requestDeleteForId = React.useCallback((id: string) => {
        setPendingViewerDeleteId(id);
        if (settings.confirmDelete) {
            openModal('deleteConfirm');
            return;
        }

        executeDeleteByIds([id], id);
    }, [settings.confirmDelete, openModal, setPendingViewerDeleteId, executeDeleteByIds]);

    const handleDeleteViewerImage = (id: string) => {
        requestDeleteForId(id);
    };

    const handleExportConfirm = async (filename: string, folder: string, ids?: Set<string>) => {
        const targetIds = ids || selectedIds;
        await fileOps.exportImages(filename, targetIds, folder, () => {
            if (!ids) setSelectedIds(new Set());
            closeModal('export');
        });
    };

    const handleBulkFavorite = () => {
        const anyUnfavorite = images.some(img => selectedIds.has(img.id) && !img.isFavorite);
        const previousImages = images;
        const ids = Array.from(selectedIds);

        setImages(prev => prev.map(img => selectedIds.has(img.id) ? { ...img, isFavorite: anyUnfavorite } : img));
        patchImageFlagsInQueryCaches(queryClient, ids, { isFavorite: anyUnfavorite });

        void persistFavoriteChanges(ids, anyUnfavorite, previousImages);

        addToast(`${anyUnfavorite ? 'Favorited' : 'Unfavorited'} ${selectedIds.size} images`, 'success');
    };

    const handleFavoriteImage = (id: string, options: SingleImageActionOptions = {}) => {
        const img = getImage(id);
        if (!img) return;

        const newFavorite = !img.isFavorite;
        const previousImages = images;
        const isInCurrentQuery = images.some(image => image.id === id);

        updateImage(id, item => ({ ...item, isFavorite: newFavorite }));
        patchImageFlagsInQueryCaches(queryClient, [id], { isFavorite: newFavorite });
        void persistFavoriteChanges([id], newFavorite, previousImages, img, isInCurrentQuery);

        if (options.showToast) {
            addToast(newFavorite ? "Liked" : "Unliked", newFavorite ? "success" : "info");
        }
    };

    const handleBulkPin = () => {
        const anyUnpinned = images.some(img => selectedIds.has(img.id) && !img.isPinned);
        const previousImages = images;
        const ids = Array.from(selectedIds);
        const nextImages = applyOptimisticPinOrder(
            previousImages,
            ids,
            anyUnpinned,
            !!filters.collectionId
        );

        setImages(nextImages);
        patchImageFlagsInQueryCaches(queryClient, ids, { isPinned: anyUnpinned }, {
            previousOrder: previousImages,
            nextOrder: nextImages,
            reorderQueryKey: imagesQueryKey
        });

        addToast(`${anyUnpinned ? 'Pinned' : 'Unpinned'} ${selectedIds.size} images`, 'info');
        void persistPinChanges(ids, anyUnpinned, previousImages, nextImages, 'Failed to update pinned images');
        // await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
    };

    const handleBulkMask = async (targetId?: string, overrideValue?: boolean | null) => {
        let idsToToggle = new Set<string>();

        if (targetId) {
            idsToToggle = new Set([targetId]);
        } else {
            if (selectedIds.size > 0) idsToToggle = new Set(selectedIds);
            else if (lastSelectedId) idsToToggle.add(lastSelectedId);
        }

        if (idsToToggle.size === 0) return;

        setImages(prev => prev.map(img => {
            if (idsToToggle.has(img.id)) {
                let newValue = overrideValue;
                if (newValue === undefined) {
                    newValue = !img.userMasked;
                }
                return { ...img, userMasked: newValue !== null ? newValue : undefined };
            }
            return img;
        }));

        const promises: Promise<void>[] = [];

        idsToToggle.forEach(id => {
            if (overrideValue !== undefined) {
                promises.push(toggleImageMask(id, overrideValue));
            } else {
                const img = images.find(i => i.id === id);
                if (img) {
                    promises.push(toggleImageMask(id, !img.userMasked));
                }
            }
        });

        await Promise.all(promises);
        await rebuildThumbnailFacetCache();
        useLibraryStore.getState().incrementFacetCacheVersion();
        void refreshCollections(true);
        await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });

        if (privacyEnabled && settings.maskingMode === 'hide') {
            await queryClient.invalidateQueries({ queryKey: ['images'] });
            await queryClient.invalidateQueries({ queryKey: ['parameterRanges'] });
        }

        let message = '';
        const count = idsToToggle.size;
        const s = count === 1 ? '' : 's';

        if (overrideValue === true) message = `${count} image${s} Manually Masked`;
        else if (overrideValue === false) message = `${count} image${s} Unmasked`;
        else if (overrideValue === null) message = `${count} image${s} Reset to Auto Mask`;
        else message = `${count} image${s} Mask Toggled`;

        addToast(message, 'info');
    };

    const handleTogglePrivacy = () => {
        const next = !privacyEnabled;
        setPrivacyEnabled(next);
        addToast(next ? "Privacy Mode Enabled" : "Privacy Mode Disabled (Hidden/Blurred items revealed)", "info");
    };

    const executeMetadataRecovery = async (style: RecoveryStyle) => {
        const targetId = viewingImageId || (selectedImageIndex !== null ? images[selectedImageIndex]?.id : null) || (selectedIds.size > 0 ? Array.from(selectedIds)[0] : null);
        if (!targetId) return;

        const { geminiApiKey } = useSettingsStore.getState();
        if (!settings.enableAI || !geminiApiKey) {
            closeModal('recovery');
            modals.setInitialSettingsTab?.('intelligence');
            openModal('settings');
            addToast('Enable AI features and configure a Gemini API key in Settings to use Prompt Recovery.', 'info');
            return;
        }

        if (!fileOps.recoverMetadata) {
            addToast('Prompt Recovery is unavailable in this runtime.', 'error');
            return;
        }

        fileOps.recoverMetadata(targetId, style, () => closeModal('recovery'));
    };

    const handlePinImage = (id: string, newPinned: boolean, options: SingleImageActionOptions = { showToast: true }) => {
        const previousActiveImage = getImage(id);
        const previousImages = images;
        const isInCurrentQuery = images.some(image => image.id === id);
        const nextImages = isInCurrentQuery
            ? applyOptimisticPinOrder(previousImages, [id], newPinned, !!filters.collectionId)
            : previousImages;

        if (isInCurrentQuery) {
            setImages(nextImages);
            patchImageFlagsInQueryCaches(queryClient, [id], { isPinned: newPinned }, {
                previousOrder: previousImages,
                nextOrder: nextImages,
                reorderQueryKey: imagesQueryKey
            });
        } else if (activeImageState) {
            activeImageState.updateImage(id, image => ({ ...image, isPinned: newPinned }));
            patchImageFlagsInQueryCaches(queryClient, [id], { isPinned: newPinned });
        }

        if (options.showToast !== false) {
            addToast(newPinned ? "Pinned to top" : "Unpinned", "info");
        }
        void persistPinChanges(
            [id],
            newPinned,
            previousImages,
            nextImages,
            'Failed to update pinned state',
            previousActiveImage,
            isInCurrentQuery
        );
        // await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
    };

    const handleShortcutFavorite = () => {
        if (selectedImageIndex !== null && images[selectedImageIndex]) {
            handleFavoriteImage(images[selectedImageIndex].id);
        } else {
            handleBulkFavorite();
        }
    };

    const handleShortcutPin = async () => {
        if (selectedImageIndex !== null && images[selectedImageIndex]) {
            await handlePinImage(images[selectedImageIndex].id, !images[selectedImageIndex].isPinned);
        } else {
            handleBulkPin();
        }
    };

    const runBackfill = async () => {
        addToast("Starting background backfill...", "info");
        const count = await backfillParameterColumns();
        if (count > 0) {
            addToast(`Backfill complete: ${count} images updated`, "success");
            await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
            await queryClient.invalidateQueries({ queryKey: ['parameterRanges'] });
        } else {
            addToast("Backfill complete: No images needed updating", "success");
        }
    };

    return {
        executeDelete,
        requestDeleteForId,
        handleDeleteViewerImage,
        handleExportConfirm,
        handleBulkFavorite,
        handleBulkPin,
        handleBulkMask,
        handleTogglePrivacy,
        executeMetadataRecovery,
        handleFavoriteImage,
        handlePinImage,
        handleShortcutFavorite,
        handleShortcutPin,
        toggleFavorite: handleFavoriteImage,
        runBackfill
    };
};
