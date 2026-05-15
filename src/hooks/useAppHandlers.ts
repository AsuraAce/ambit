import { AIImage, GeneratorTool } from '../types';
import { useToast } from './useToast';
import {
    deleteRemovedImagesFromDisk,
    getImagesByIds,
    rebuildFacetCache,
    rebuildFacetCacheIncremental,
    removeImagesFromLibrary,
    restoreRemovedImages,
    revertImageMetadata,
    updateImageMetadataFields,
    updateImageNotesCol,
} from '../services/db/imageRepo';
import { useLibraryStore } from '../stores/libraryStore';

interface UseAppHandlersProps {
    images: AIImage[];
    setImages: (update: AIImage[] | ((prev: AIImage[]) => AIImage[])) => void;
    refreshMaintenanceCounts: () => void;
}

export const useAppHandlers = ({ images, setImages, refreshMaintenanceCounts }: UseAppHandlersProps) => {
    const { addToast } = useToast();
    const incrementFacetCacheVersion = useLibraryStore(state => state.incrementFacetCacheVersion);

    const refreshFacets = () => {
        rebuildFacetCache().then(() => incrementFacetCacheVersion());
    };

    const handleUpdatePrompt = async (id: string, prompt: string) => {
        const img = images.find(i => i.id === id);
        if (!img) return;

        const originalMetadata = img.originalMetadata || { ...img.metadata };
        const updatedImg = {
            ...img,
            originalMetadata,
            metadata: { ...img.metadata, positivePrompt: prompt }
        };

        setImages(prev => prev.map(i => i.id === id ? updatedImg : i));
        await updateImageMetadataFields(id, { positivePrompt: prompt });
        addToast('Updated', 'success');
    };

    const handleUpdateNegativePrompt = async (id: string, negativePrompt: string) => {
        const img = images.find(i => i.id === id);
        if (!img) return;

        const originalMetadata = img.originalMetadata || { ...img.metadata };
        const updatedImg = {
            ...img,
            originalMetadata,
            metadata: { ...img.metadata, negativePrompt }
        };

        setImages(prev => prev.map(i => i.id === id ? updatedImg : i));
        await updateImageMetadataFields(id, { negativePrompt });
        addToast('Updated', 'success');
    };

    const handleUpdateModel = async (id: string, model: string) => {
        const img = images.find(i => i.id === id);
        if (!img) return;

        const originalMetadata = img.originalMetadata || { ...img.metadata };
        const updatedImg = {
            ...img,
            originalMetadata,
            metadata: { ...img.metadata, overrideModel: model }
        };

        setImages(prev => prev.map(i => i.id === id ? updatedImg : i));
        await updateImageMetadataFields(id, { overrideModel: model });

        // Ensure filter panel is updated
        rebuildFacetCacheIncremental('checkpoints').then(() => incrementFacetCacheVersion());

        addToast('Updated', 'success');
    };

    const handleUpdateTool = async (id: string, tool: GeneratorTool) => {
        const img = images.find(i => i.id === id);
        if (!img) return;

        const originalMetadata = img.originalMetadata || { ...img.metadata };
        const updatedImg = {
            ...img,
            originalMetadata,
            metadata: { ...img.metadata, tool }
        };

        setImages(prev => prev.map(i => i.id === id ? updatedImg : i));
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

    const handleResolveDuplicate = async (_keepId: string, deleteIds: string[]) => {
        await removeImagesFromLibrary(deleteIds);
        setImages(p => p.filter(i => !deleteIds.includes(i.id)));
        addToast(`Removed ${deleteIds.length} duplicate${deleteIds.length === 1 ? '' : 's'} from the library`, 'success');
        refreshMaintenanceCounts();
        refreshFacets();
    };

    const handleRestoreImages = async (ids: string[]) => {
        await restoreRemovedImages(ids);
        const restoredImages = await getImagesByIds(ids);
        setImages(p => {
            const existingIds = new Set(p.map(image => image.id));
            const uniqueRestored = restoredImages.filter(image => !existingIds.has(image.id));
            return uniqueRestored.length > 0 ? [...uniqueRestored, ...p] : p;
        });
        addToast(`Restored ${ids.length} image${ids.length === 1 ? '' : 's'} to the library`, 'success');
        refreshMaintenanceCounts();
        refreshFacets();
    };

    const handleRemoveFromLibrary = async (ids: string[]) => {
        await removeImagesFromLibrary(ids);
        setImages(p => p.filter(i => !ids.includes(i.id)));
        addToast(`Removed ${ids.length} image${ids.length === 1 ? '' : 's'} from the library`, 'success');
        refreshMaintenanceCounts();
        refreshFacets();
    };

    const handleDeleteFile = async (ids: string[]) => {
        const result = await deleteRemovedImagesFromDisk(ids);

        if (result.deletedIds.length > 0) {
            if (result.failedIds.length === 0 && result.thumbnailWarningIds.length === 0) {
                addToast(`Moved ${result.deletedIds.length} file${result.deletedIds.length === 1 ? '' : 's'} to OS trash and removed ${result.deletedIds.length === 1 ? 'it' : 'them'} from Ambit`, 'success');
            } else {
                addToast(
                    `Deleted ${result.deletedIds.length} file${result.deletedIds.length === 1 ? '' : 's'} from Ambit, but ${result.failedIds.length} failed and ${result.thumbnailWarningIds.length} had thumbnail cleanup warnings.`,
                    'warning'
                );
            }
            refreshMaintenanceCounts();
            refreshFacets();
            return;
        }

        addToast('Failed to move selected files to OS trash.', 'error');
    };

    const handleEmptyTrash = async () => {
        addToast('Removed items are now handled through the Removed tab actions.', 'info');
        refreshMaintenanceCounts();
    };

    const handleUpdateNotes = async (id: string, notes: string) => {
        const img = images.find(i => i.id === id);
        if (!img) return;

        const updatedImg = { ...img, notes };
        setImages(prev => prev.map(i => i.id === id ? updatedImg : i));
        await updateImageNotesCol(id, notes);
        addToast('Saved', 'success');
    };

    const handleRevertMetadata = async (id: string) => {
        const img = images.find(i => i.id === id);
        if (!img) return;

        // Optimistic UI update
        const updatedImg = {
            ...img,
            metadata: img.originalMetadata || { ...img.metadata },
            originalMetadata: img.originalMetadata
        };
        setImages(prev => prev.map(i => i.id === id ? updatedImg : i));

        await revertImageMetadata(id);

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
