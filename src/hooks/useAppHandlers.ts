import { AIImage, GeneratorTool } from '../types';
import { useToast } from './useToast';
import { updateImageMetadataFields, updateImageNotesCol } from '../services/db/imageRepo';
import { urlToPath } from '../utils/pathUtils';

interface UseAppHandlersProps {
    images: AIImage[];
    setImages: (update: AIImage[] | ((prev: AIImage[]) => AIImage[])) => void;
    refreshMaintenanceCounts: () => void;
}

export const useAppHandlers = ({ images, setImages, refreshMaintenanceCounts }: UseAppHandlersProps) => {
    const { addToast } = useToast();

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
        const { markAsDeleted } = await import('../services/db/imageRepo');
        await markAsDeleted(deleteIds, true);
        setImages(p => p.map(i => deleteIds.includes(i.id) ? { ...i, isDeleted: true } : i));
        addToast(`Moved ${deleteIds.length} duplicates to trash`, 'success');
        refreshMaintenanceCounts();
    };

    const handleRestoreImages = async (ids: string[]) => {
        const { markAsDeleted } = await import('../services/db/imageRepo');
        await markAsDeleted(ids, false);
        setImages(p => p.map(i => ids.includes(i.id) ? { ...i, isDeleted: false } : i));
        addToast(`Restored ${ids.length} images`, 'success');
        refreshMaintenanceCounts();
    };

    const handleMoveToTrash = async (ids: string[]) => {
        const { markAsDeleted } = await import('../services/db/imageRepo');
        await markAsDeleted(ids, true);
        setImages(p => p.map(i => ids.includes(i.id) ? { ...i, isDeleted: true } : i));
        addToast(`Moved ${ids.length} images to trash`, 'success');
        refreshMaintenanceCounts();
    };

    const handleDeleteForever = async (ids: string[]) => {
        const { deleteImageFromDisk } = await import('../services/db/imageRepo');

        // Fetch paths first to ensure we can trash them
        const { getImagesByIds } = await import('../services/db/imageRepo');
        const imagesToDelete = await getImagesByIds(ids);

        for (const img of imagesToDelete) {
            const path = img.id; // ID is the normalized path in this app
            const thumbnailPath = img.thumbnailUrl ? urlToPath(img.thumbnailUrl) : null;
            await deleteImageFromDisk(img.id, path, thumbnailPath);
        }

        setImages(p => p.filter(i => !ids.includes(i.id)));
        addToast(`Permanently deleted ${ids.length} images`, 'success');
        refreshMaintenanceCounts();
    };

    const handleEmptyTrash = async () => {
        const { getDeletedImages } = await import('../services/db/maintenanceRepo');
        const { deleteImage } = await import('../services/db/imageRepo');
        const deleted = await getDeletedImages();
        const ids = deleted.map(i => i.id);
        for (const id of ids) await deleteImage(id);
        setImages(p => p.filter(i => !i.isDeleted));
        addToast('Trash emptied', 'success');
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
        if (!img || !img.originalMetadata) return;

        const updatedImg = {
            ...img,
            metadata: img.originalMetadata,
            originalMetadata: undefined
        };
        setImages(prev => prev.map(i => i.id === id ? updatedImg : i));
        // For revert, we actually want to overwrite the metadata_json with originalMetadata
        // But since we don't have a specific individual 'save' that handles metadata_json blob overwrite safely 
        // without risking other columns in this specific context, we'll use updateImageMetadataFields with the full object
        await updateImageMetadataFields(id, img.originalMetadata);
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
        handleMoveToTrash,
        handleDeleteForever,
        handleEmptyTrash
    };
};
