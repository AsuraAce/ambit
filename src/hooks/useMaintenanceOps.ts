import * as React from 'react';
import { useState, useCallback } from 'react';
import { AIImage, AppSettings, RecoveryStyle } from '../types';
import { useToast } from './useToast';
import { imageToBase64 } from '../services/imageService';
import { recoverImageMetadata } from '../services/geminiService';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { urlToPath } from '../utils/pathUtils';

interface UseMaintenanceOpsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollectionThumbnails: () => Promise<void>;
    settings: AppSettings;
}

export const useMaintenanceOps = ({
    images,
    setImages,
    refreshCollectionThumbnails,
    settings
}: UseMaintenanceOpsProps) => {
    const { addToast } = useToast();
    const [isRecoveringMetadata, setIsRecoveringMetadata] = useState(false);
    const incrementFacetCacheVersion = useLibraryStore(state => state.incrementFacetCacheVersion);

    const deleteImages = useCallback(async (ids: string[], permanent = false) => {
        try {
            const { removeImagesFromLibrary, deleteImageFromDisk, getImagesByIds, rebuildFacetCache } = await import('../services/db/imageRepo');
            if (permanent) {
                const imagesToDelete = await getImagesByIds(ids);
                for (const img of imagesToDelete) {
                    const path = img.id;
                    const thumbnailPath = img.thumbnailUrl ? urlToPath(img.thumbnailUrl) : null;
                    await deleteImageFromDisk(img.id, path, thumbnailPath);
                }
                setImages(prev => prev.filter(img => !ids.includes(img.id)));
                addToast(`Moved ${ids.length} file${ids.length === 1 ? '' : 's'} to OS trash`, 'success');
            } else {
                await removeImagesFromLibrary(ids);
                setImages(prev => prev.filter(img => !ids.includes(img.id)));
                addToast(`Removed ${ids.length} image${ids.length === 1 ? '' : 's'} from the library`, 'success');
                await refreshCollectionThumbnails();
            }
            await rebuildFacetCache();
            incrementFacetCacheVersion();
        } catch (e) {
            console.error("Failed to delete images", e);
            addToast("Failed to update library state", "error");
        }
    }, [setImages, addToast, refreshCollectionThumbnails, incrementFacetCacheVersion]);

    const recoverMetadata = useCallback(async (targetId: string, style: RecoveryStyle, onComplete: () => void) => {
        const img = images.find(i => i.id === targetId);
        if (!img) return;

        setIsRecoveringMetadata(true);
        try {
            const base64 = await imageToBase64(img.url);
            const apiKey = useSettingsStore.getState().geminiApiKey;
            if (!apiKey) throw new Error("No API Key");

            const recoveredMeta = await recoverImageMetadata(base64, style, apiKey, settings.aiModel, settings.systemPrompts);
            const recoveredPrompt = recoveredMeta.positivePrompt;

            const updatedImg = {
                ...img,
                metadata: {
                    ...img.metadata,
                    positivePrompt: recoveredPrompt
                },
                originalMetadata: img.originalMetadata || img.metadata
            };

            setImages(prev => prev.map(pImg => pImg.id === img.id ? updatedImg : pImg));

            const { insertImage } = await import('../services/db/imageRepo');
            await insertImage(updatedImg);

            addToast("Metadata recovered successfully!", "success");
            onComplete();
        } catch (e) {
            console.error(e);
            addToast("AI Analysis Failed", "error");
        } finally {
            setIsRecoveringMetadata(false);
        }
    }, [images, settings.systemPrompts, settings.aiModel, setImages, addToast]);

    return {
        isRecoveringMetadata,
        deleteImages,
        recoverMetadata
    };
};
