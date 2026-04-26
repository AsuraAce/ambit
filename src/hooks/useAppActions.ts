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

    const refreshCollectionThumbnails = useCollectionStore(s => s.refreshCollections); // Placeholder or mapping

    const { openModal, closeModal, pendingViewerDeleteId, setPendingViewerDeleteId } = modals;

    const executeDelete = () => {
        const ids = pendingViewerDeleteId ? [pendingViewerDeleteId] : Array.from(selectedIds);
        fileOps.deleteImages(ids);

        if (pendingViewerDeleteId) {
            const idx = images.findIndex(img => img.id === pendingViewerDeleteId);
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
    };

    const handleDeleteViewerImage = (id: string) => {
        if (settings.confirmDelete) {
            setPendingViewerDeleteId(id);
            openModal('deleteConfirm');
        } else {
            setPendingViewerDeleteId(id);
            // Non-ideal to use setTimeout but matches original logic for now
            setTimeout(() => executeDelete(), 0);
        }
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

    const handleBulkPin = async () => {
        const anyUnpinned = images.some(img => selectedIds.has(img.id) && !img.isPinned);
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
        const { toggleImagePin } = await import('../services/db/imageRepo');
        await Promise.all(ids.map(id => toggleImagePin(id, anyUnpinned)));

        await refreshCollectionThumbnails();
        // await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
        addToast(`${anyUnpinned ? 'Pinned' : 'Unpinned'} ${selectedIds.size} images`, 'info');
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

        const { toggleImageMask } = await import('../services/db/imageRepo');
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

        if (privacyEnabled && settings.maskingMode === 'hide') {
            await queryClient.invalidateQueries({ queryKey: ['images'] });
            await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
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
        fileOps.recoverMetadata(targetId, style, () => closeModal('recovery'));
    };

    const handlePinImage = async (id: string, newPinned: boolean) => {
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

        await import('../services/db/imageRepo').then(db => db.toggleImagePin(id, newPinned));
        await refreshCollectionThumbnails();
        // await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });
        addToast(newPinned ? "Pinned to top" : "Unpinned", "info");
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
