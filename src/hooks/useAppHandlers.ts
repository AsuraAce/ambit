import { AIImage, GeneratorTool } from '../types';
import { useToast } from './useToast';

interface UseAppHandlersProps {
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
}

export const useAppHandlers = ({ setImages }: UseAppHandlersProps) => {
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

    return {
        handleUpdatePrompt,
        handleUpdateModel,
        handleUpdateTool,
        handleGroupImages
    };
};
