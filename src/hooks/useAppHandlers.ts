import { useQueryClient } from '@tanstack/react-query';
import { AIImage, GeneratorTool } from '../types';
import { useToast } from './useToast';
import {
    deleteRemovedImagesFromDisk,
    getImagesByIds,
    rebuildFacetCache,
    rebuildFacetCacheIncremental,
    refreshFacetCacheForResourcesStrict,
    removeImagesFromLibrary,
    restoreRemovedImages,
    revertImageMetadata,
    updateImageMetadataFields,
    updateImageNotesCol,
} from '../services/db/imageRepo';
import { useLibraryStore } from '../stores/libraryStore';
import { removeImagesFromQueryCaches, updateImagesQueryCaches } from '../utils/imageQueryCache';
import type { ActiveImageStateAdapter } from './activeImageState';
import { invalidateInvokeReferenceQueries } from '../services/db/invokeReferenceRepo';
import type { DeleteRemovedImagesResult, ExactDuplicateResolution, ExactDuplicateResolutionResult } from '../bindings';

interface UseAppHandlersProps {
    images: AIImage[];
    setImages: (update: AIImage[] | ((prev: AIImage[]) => AIImage[])) => void;
    refreshMaintenanceCounts: () => void;
    refreshHiddenAvailability: () => Promise<void>;
    activeImageState?: ActiveImageStateAdapter;
}

export const useAppHandlers = ({ images, setImages, refreshMaintenanceCounts, refreshHiddenAvailability, activeImageState }: UseAppHandlersProps) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const incrementFacetCacheVersion = useLibraryStore(state => state.incrementFacetCacheVersion);

    const refreshFacets = () => {
        void rebuildFacetCache()
            .then(() => incrementFacetCacheVersion())
            .catch(error => console.error('Failed to refresh facet cache', error));
    };
    const getImage = (id: string) => activeImageState?.getImage(id) ?? images.find(image => image.id === id);
    const updateImage = (id: string, updater: (image: AIImage) => AIImage) => {
        if (activeImageState) {
            activeImageState.updateImage(id, updater);
            return;
        }
        setImages(prev => prev.map(image => image.id === id ? updater(image) : image));
    };

    const handleUpdatePrompt = async (id: string, prompt: string) => {
        const img = getImage(id);
        if (!img) return;

        const originalMetadata = img.originalMetadata || { ...img.metadata };
        const updatedImg = {
            ...img,
            originalMetadata,
            metadata: { ...img.metadata, positivePrompt: prompt }
        };

        updateImage(id, () => updatedImg);
        await updateImageMetadataFields(id, { positivePrompt: prompt });
        addToast('Updated', 'success');
    };

    const handleUpdateNegativePrompt = async (id: string, negativePrompt: string) => {
        const img = getImage(id);
        if (!img) return;

        const originalMetadata = img.originalMetadata || { ...img.metadata };
        const updatedImg = {
            ...img,
            originalMetadata,
            metadata: { ...img.metadata, negativePrompt }
        };

        updateImage(id, () => updatedImg);
        await updateImageMetadataFields(id, { negativePrompt });
        addToast('Updated', 'success');
    };

    const handleUpdateModel = async (id: string, model: string) => {
        const img = getImage(id);
        if (!img) return;

        const originalMetadata = img.originalMetadata || { ...img.metadata };
        const updatedImg = {
            ...img,
            originalMetadata,
            metadata: { ...img.metadata, overrideModel: model }
        };

        updateImage(id, () => updatedImg);
        await updateImageMetadataFields(id, { overrideModel: model });

        // Ensure filter panel is updated
        rebuildFacetCacheIncremental('checkpoints').then(() => incrementFacetCacheVersion());

        addToast('Updated', 'success');
    };

    const handleUpdateTool = async (id: string, tool: GeneratorTool) => {
        const img = getImage(id);
        if (!img) return;

        const originalMetadata = img.originalMetadata || { ...img.metadata };
        const updatedImg = {
            ...img,
            originalMetadata,
            metadata: { ...img.metadata, tool }
        };

        updateImage(id, () => updatedImg);
        await updateImageMetadataFields(id, { tool });

        // Ensure filter panel is updated
        rebuildFacetCacheIncremental('tools').then(() => incrementFacetCacheVersion());

        addToast('Updated', 'success');
    };

    const handleGroupImages = (ids: string[]) => {
        const groupId = `stack_${Date.now()}`;
        setImages(prev => prev.map(img =>
            ids.includes(img.id) ? { ...img, groupId } : img
        ));
        addToast(`Grouped ${ids.length} images into a stack`, 'success');
    };

    const handleResolveDuplicate = async (resolutions: ExactDuplicateResolution[]) => {
        let result: ExactDuplicateResolutionResult;
        try {
            const { resolveExactDuplicateGroups } = await import('../services/db/exactDuplicateRepo');
            result = await resolveExactDuplicateGroups(resolutions);
        } catch (error) {
            console.error('Failed to resolve exact duplicates', error);
            addToast('Could not resolve duplicates. Run the scan again and retry.', 'error');
            throw error;
        }

        const removedIds = new Set(result.removedIds);
        const keeperStates = new Map(result.keepers.map(keeper => [keeper.id, keeper]));
        const applyKeeperState = (image: AIImage): AIImage => {
            const keeper = keeperStates.get(image.id);
            return keeper ? {
                ...image,
                isFavorite: keeper.isFavorite,
                isPinned: keeper.isPinned,
                userMasked: keeper.userMasked ?? undefined,
            } : image;
        };
        setImages(previous => previous
            .filter(image => !removedIds.has(image.id))
            .map(applyKeeperState));
        removeImagesFromQueryCaches(queryClient, removedIds);
        updateImagesQueryCaches(queryClient, applyKeeperState);
        try {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['images'] }),
                invalidateInvokeReferenceQueries(queryClient),
            ]);
        } catch (error) {
            console.error('Failed to refresh image queries after resolving duplicates', error);
        }
        addToast(`Moved ${result.removedIds.length} duplicate${result.removedIds.length === 1 ? '' : 's'} to Removed`, 'success');
        refreshMaintenanceCounts();
        refreshFacets();
    };

    const handleRestoreImages = async (ids: string[]) => {
        const result = await restoreRemovedImages(ids).catch(error => {
            console.error('[Restore] Failed to restore removed images', error);
            addToast('Could not restore the selected items. Their Removed entries were kept.', 'error');
            throw error;
        });
        let refreshFailed = false;
        try {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['images'] }),
                invalidateInvokeReferenceQueries(queryClient),
                refreshHiddenAvailability(),
            ]);
        } catch (error) {
            refreshFailed = true;
            console.error('[Restore] Restored images, but failed to refresh dependent views', error);
        }
        addToast(`Restored ${result.affectedIds.length} item${result.affectedIds.length === 1 ? '' : 's'} to the library`, 'success');
        if (refreshFailed) {
            addToast('Items were restored, but some views may need a refresh.', 'warning');
        }
        if (result.membershipWarningIds.length > 0) {
            addToast(`${result.membershipWarningIds.length} restored ${result.membershipWarningIds.length === 1 ? 'item has' : 'items have'} legacy collection data that could not be recovered.`, 'warning');
        }
        refreshMaintenanceCounts();
        void refreshFacetCacheForResourcesStrict(result.touchedResources)
            .then(() => incrementFacetCacheVersion())
            .catch(error => console.error('Failed to refresh restored facet resources', error));
    };

    const handleRemoveFromLibrary = async (ids: string[]) => {
        const result = await removeImagesFromLibrary(ids).catch(error => {
            console.error('[Removed] Failed to remove images from the library', error);
            addToast('Could not remove the selected items. The library was left unchanged.', 'error');
            throw error;
        });

        const affectedIds = new Set(result.affectedIds);
        setImages(p => p.filter(i => !affectedIds.has(i.id)));
        removeImagesFromQueryCaches(queryClient, affectedIds);
        addToast(`Removed ${result.affectedIds.length} item${result.affectedIds.length === 1 ? '' : 's'} from the library`, 'success');
        refreshMaintenanceCounts();
        try {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['images'] }),
                invalidateInvokeReferenceQueries(queryClient),
            ]);
        } catch (error) {
            console.error('[Removed] Images were removed, but dependent views failed to refresh', error);
            addToast('Items were removed, but some views may need a refresh.', 'warning');
        }
        void refreshFacetCacheForResourcesStrict(result.touchedResources)
            .then(() => incrementFacetCacheVersion())
            .catch(error => console.error('Failed to refresh affected facet resources', error));
    };

    const handleDeleteFile = async (ids: string[]): Promise<DeleteRemovedImagesResult> => {
        try {
            const result = await deleteRemovedImagesFromDisk(ids);
            const unresolvedCount = result.failedIds.length + result.cleanupPendingIds.length;
            let dependentRefreshFailed = false;

            if (result.clearedIds.length > 0) {
                const clearedIds = new Set(result.clearedIds);
                setImages(previous => previous.filter(image => !clearedIds.has(image.id)));
                removeImagesFromQueryCaches(queryClient, clearedIds);
                refreshMaintenanceCounts();
                try {
                    await Promise.all([
                        queryClient.invalidateQueries({ queryKey: ['images'] }),
                        invalidateInvokeReferenceQueries(queryClient),
                    ]);
                } catch (error) {
                    dependentRefreshFailed = true;
                    console.error('[Removed] Files were deleted, but dependent views failed to refresh', error);
                }
            }

            if (unresolvedCount === 0 && result.thumbnailWarningIds.length === 0 && result.notFoundIds.length === 0) {
                const recoveredCount = result.alreadyMissingIds.length;
                const message = recoveredCount > 0
                    ? `Removed ${result.clearedIds.length} ${result.clearedIds.length === 1 ? 'entry' : 'entries'} from Ambit; ${recoveredCount} source ${recoveredCount === 1 ? 'file was' : 'files were'} already missing.`
                    : `Moved ${result.trashedIds.length} file${result.trashedIds.length === 1 ? '' : 's'} to OS trash and removed ${result.clearedIds.length === 1 ? 'it' : 'them'} from Ambit`;
                addToast(message, 'success');
            } else if (result.clearedIds.length > 0 || result.cleanupPendingIds.length > 0 || result.notFoundIds.length > 0) {
                const details = [
                    unresolvedCount > 0 ? `${unresolvedCount} still need attention` : null,
                    result.thumbnailWarningIds.length > 0
                        ? `${result.thumbnailWarningIds.length} had thumbnail cleanup warnings`
                        : null,
                    result.notFoundIds.length > 0
                        ? `${result.notFoundIds.length} selected ${result.notFoundIds.length === 1 ? 'entry was' : 'entries were'} already unavailable`
                        : null,
                ].filter((detail): detail is string => detail !== null);
                addToast(
                    `Removed ${result.clearedIds.length} ${result.clearedIds.length === 1 ? 'entry' : 'entries'} from Ambit; ${details.join(' and ')}.`,
                    'warning'
                );
            } else {
                addToast('Failed to move selected files to OS trash. The Removed entries were kept.', 'error');
            }
            if (dependentRefreshFailed) {
                addToast('Files were deleted, but some views may need a refresh.', 'warning');
            }

            return result;
        } catch (error) {
            console.error('[Removed] Failed to delete selected files', error);
            addToast('Could not finish deleting the selected files. The Removed entries were kept.', 'error');
            throw error;
        }
    };

    const handleEmptyTrash = async () => {
        addToast('Removed items are now handled through the Removed tab actions.', 'info');
        refreshMaintenanceCounts();
    };

    const handleUpdateNotes = async (id: string, notes: string) => {
        const img = getImage(id);
        if (!img) return;

        const updatedImg = { ...img, notes };
        updateImage(id, () => updatedImg);
        try {
            await updateImageNotesCol(id, notes);
            addToast('Saved', 'success');
        } catch (error) {
            console.error('[Notes] Failed to persist notes', error);
            updateImage(id, () => img);
            addToast('Failed to save notes', 'error');
        }
    };

    const handleRevertMetadata = async (id: string) => {
        await revertImageMetadata(id);
        const [revertedImage] = await getImagesByIds([id]);
        if (!revertedImage) {
            addToast('Metadata reverted, but the image could not be refreshed.', 'warning');
            return;
        }

        const applyRevertedImage = (current: AIImage): AIImage => (
            current.id === id
                ? { ...revertedImage, stack: current.stack }
                : current
        );
        if (activeImageState) {
            activeImageState.updateImage(id, applyRevertedImage);
        } else {
            setImages(prev => prev.map(applyRevertedImage));
        }
        updateImagesQueryCaches(queryClient, applyRevertedImage);

        // Revert can change tools and models, so we rebuild both incrementally
        Promise.all([
            rebuildFacetCacheIncremental('tools'),
            rebuildFacetCacheIncremental('checkpoints')
        ]).then(() => incrementFacetCacheVersion());

        addToast('Reverted to original', 'success');
    };

    return {
        handleUpdatePrompt,
        handleUpdateNegativePrompt,
        handleUpdateModel,
        handleUpdateTool,
        handleUpdateNotes,
        handleRevertMetadata,
        handleGroupImages,
        handleResolveDuplicate,
        handleRestoreImages,
        handleRemoveFromLibrary,
        handleDeleteFile,
        handleEmptyTrash
    };
};
