import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AIImage, AppSettings, FilterState, Collection } from '../types';
import { useToast } from './useToast';
import { useSearchStore } from '../stores/searchStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useCollectionStore } from '../stores/collectionStore';
import { useModalManager } from './useModalManager';

interface UseAppActionsProps {
    viewingImageId: string | null;
    selectedImageIndex: number | null;
    setSelectedImageIndex: React.Dispatch<React.SetStateAction<number | null>>;
    fileOps: any;
    selectedIds: Set<string>;
    setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    lastSelectedId: string | null;
    modalManager: any; // Renamed from modals
}

export const useAppActions = ({
    viewingImageId,
    selectedImageIndex,
    setSelectedImageIndex,
    fileOps,
    selectedIds,
    setSelectedIds,
    lastSelectedId,
    modalManager: modals // Destructure with alias for minimum logic change
}: UseAppActionsProps) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();

    // Store access
    const images = useSearchStore(s => s.images);
    const setImages = useSearchStore(s => s.setImages);
    const filters = useSearchStore(s => s.filters);
    const toggleFavorite = useSearchStore(s => s.toggleFavorite);

    const settings = useSettingsStore(s => s.settings);
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    const setPrivacyEnabled = useSettingsStore(s => s.setPrivacyEnabled);

    const refreshCollections = useCollectionStore(s => s.refreshCollections);

    const { openModal, closeModal, pendingViewerDeleteId, setPendingViewerDeleteId } = modals;

    const persistPinChanges = React.useCallback(async (
        ids: string[],
        isPinned: boolean,
        previousImages: typeof images,
        errorMessage: string
    ) => {
        try {
            const { toggleImagePin } = await import('../services/db/imageRepo');
            await Promise.all(ids.map(id => toggleImagePin(id, isPinned)));
            void refreshCollections(true);
        } catch (error) {
            console.error('[Pin] Failed to persist pin state', error);
            setImages(previousImages);
            addToast(errorMessage, 'error');
        }
    }, [refreshCollections, setImages, addToast, images]);

    const executeDeleteByIds = React.useCallback((ids: string[], targetDeleteId: string | null = null) => {
        fileOps.deleteImages(ids);

        if (targetDeleteId) {
            const idx = images.findIndex(img => img.id === targetDeleteId);
            if (idx !== -1) {
                let nextIndex: number | null = idx;
                if (images.length === 1) nextIndex = null;
                else if (idx === images.length - 1) nextIndex = idx - 1;
                setSelectedImageIndex(nextIndex);
            }
        } else {
            setSelectedIds(new Set());
        }
        closeModal('deleteConfirm');
        setPendingViewerDeleteId(null);
    }, [fileOps, images, setSelectedImageIndex, setSelectedIds, closeModal, setPendingViewerDeleteId]);

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
        setImages(prev => prev.map(img => selectedIds.has(img.id) ? { ...img, isFavorite: anyUnfavorite } : img));

        selectedIds.forEach(id => {
            import('../services/db/imageRepo').then(db => db.toggleImageFavorite(id, anyUnfavorite));
        });

        addToast(`${anyUnfavorite ? 'Favorited' : 'Unfavorited'} ${selectedIds.size} images`, 'success');
    };

    const handleBulkPin = () => {
        const anyUnpinned = images.some(img => selectedIds.has(img.id) && !img.isPinned);
        const previousImages = images;

        setImages(prev => {
            const updated = prev.map(img => selectedIds.has(img.id) ? { ...img, isPinned: anyUnpinned } : img);

            // Only sort if we are in a collection (where pinned items are forced to top)
            // In "All Photos", we want to keep chronological order
            if (filters.collectionId) {
                return [...updated].sort((a, b) => {
                    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                    return (b.timestamp || 0) - (a.timestamp || 0);
                });
            }
            return updated;
        });

        const ids = Array.from(selectedIds);
        addToast(`${anyUnpinned ? 'Pinned' : 'Unpinned'} ${selectedIds.size} images`, 'info');
        void persistPinChanges(ids, anyUnpinned, previousImages, 'Failed to update pinned images');
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

        const { toggleImageMask, rebuildThumbnailFacetCache } = await import('../services/db/imageRepo');
        const { useLibraryStore } = await import('../stores/libraryStore');
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

    const executeMetadataRecovery = async (style: any) => {
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

        fileOps.recoverMetadata(targetId, style, () => closeModal('recovery'));
    };

    const handlePinImage = (id: string, newPinned: boolean) => {
        const previousImages = images;

        setImages(prev => {
            const updated = prev.map(i => i.id === id ? { ...i, isPinned: newPinned } : i);

            if (filters.collectionId) {
                return [...updated].sort((a, b) => {
                    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
                    return (b.timestamp || 0) - (a.timestamp || 0);
                });
            }
            return updated;
        });

        addToast(newPinned ? "Pinned to top" : "Unpinned", "info");
        void persistPinChanges([id], newPinned, previousImages, 'Failed to update pinned state');
        // await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
    };

    const handleShortcutFavorite = () => {
        if (selectedImageIndex !== null && images[selectedImageIndex]) {
            toggleFavorite(images[selectedImageIndex].id);
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
        const { backfillParameterColumns } = await import('../services/db/maintenanceRepo');
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
        handlePinImage,
        handleShortcutFavorite,
        handleShortcutPin,
        toggleFavorite,
        runBackfill
    };
};
