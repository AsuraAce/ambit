import { AIImage, GeneratorTool } from '../types';
import { useToast } from './useToast';

interface UseAppHandlersProps {
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshMaintenanceCounts: () => void;
}

export const useAppHandlers = ({ setImages, refreshMaintenanceCounts }: UseAppHandlersProps) => {
    const { addToast } = useToast();

    const handleUpdatePrompt = (id: string, prompt: string) => {
        setImages(prev => prev.map(i => {
            if (i.id !== id) return i;
            const originalMetadata = i.originalMetadata || { ...i.metadata };
            return {
                ...i,
                originalMetadata,
                metadata: { ...i.metadata, positivePrompt: prompt }
            };
        }));
        addToast('Updated', 'success');
    };

    const handleUpdateModel = (id: string, model: string) => {
        setImages(prev => prev.map(i => {
            if (i.id !== id) return i;
            const originalMetadata = i.originalMetadata || { ...i.metadata };
            return {
                ...i,
                originalMetadata,
                metadata: { ...i.metadata, overrideModel: model }
            };
        }));
        addToast('Updated', 'success');
    };

    const handleUpdateTool = (id: string, tool: GeneratorTool) => {
        setImages(prev => prev.map(i => {
            if (i.id !== id) return i;
            const originalMetadata = i.originalMetadata || { ...i.metadata };
            return {
                ...i,
                originalMetadata,
                metadata: { ...i.metadata, tool }
            };
        }));
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
        const { deleteImage } = await import('../services/db/imageRepo');
        for (const id of ids) await deleteImage(id);
        setImages(p => p.filter(i => !ids.includes(i.id)));
        addToast(`Removed ${ids.length} records from library`, 'success');
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

    return {
        handleUpdatePrompt,
        handleUpdateModel,
        handleUpdateTool,
        handleGroupImages,
        handleResolveDuplicate,
        handleRestoreImages,
        handleMoveToTrash,
        handleDeleteForever,
        handleEmptyTrash
    };
};
