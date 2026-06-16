import * as React from 'react';
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AIImage, AppSettings, RecoveryStyle } from '../types';
import { useToast } from './useToast';
import { imageToBase64 } from '../services/imageService';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { urlToPath } from '../utils/pathUtils';
import {
    deleteImageFromDisk,
    getImagesByIds,
    rebuildFacetCache,
    removeImagesFromLibrary,
    updateImageMetadataFields,
} from '../services/db/imageRepo';
import { updateImagesQueryCaches } from '../utils/imageQueryCache';
import {
    getEffectiveAiModel,
    getEffectiveAiThinkingMode,
    getEffectiveSystemPrompts
} from '../utils/settingsUtils';

interface UseMaintenanceOpsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollections: () => Promise<void>;
    settings: AppSettings;
}

export const useMaintenanceOps = ({
    images,
    setImages,
    refreshCollections,
    settings
}: UseMaintenanceOpsProps) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const [isRecoveringMetadata, setIsRecoveringMetadata] = useState(false);
    const incrementFacetCacheVersion = useLibraryStore(state => state.incrementFacetCacheVersion);
    const effectiveAiModel = getEffectiveAiModel(settings);
    const effectiveAiThinkingMode = getEffectiveAiThinkingMode(settings);
    const effectiveSystemPrompts = getEffectiveSystemPrompts(settings);

    const deleteImages = useCallback(async (ids: string[], permanent = false) => {
        const logPrefix = permanent ? '[MaintenanceOps] deleteFiles' : '[MaintenanceOps] removeFromLibrary';
        let rebuildSucceeded = false;

        try {
            if (permanent) {
                console.info(`${logPrefix}: fetching images`, { count: ids.length });
                const imagesToDelete = await getImagesByIds(ids);
                for (const img of imagesToDelete) {
                    const path = img.id;
                    const thumbnailPath = img.thumbnailUrl ? urlToPath(img.thumbnailUrl) : null;
                    console.info(`${logPrefix}: deleting file`, { id: img.id });
                    await deleteImageFromDisk(img.id, path, thumbnailPath);
                }
                setImages(prev => prev.filter(img => !ids.includes(img.id)));
                addToast(`Moved ${ids.length} file${ids.length === 1 ? '' : 's'} to OS trash`, 'success');
            } else {
                console.info(`${logPrefix}: tombstoning images`, { count: ids.length });
                await removeImagesFromLibrary(ids);
                setImages(prev => prev.filter(img => !ids.includes(img.id)));
                addToast(`Removed ${ids.length} image${ids.length === 1 ? '' : 's'} from the library`, 'success');
            }

            if (!permanent) {
                try {
                    console.info(`${logPrefix}: refreshing collections`);
                    await refreshCollections();
                } catch (collectionRefreshError) {
                    console.error(`${logPrefix}: collection refresh failed`, collectionRefreshError);
                    addToast('Removed from library, but collections may need a refresh.', 'warning');
                }
            }

            try {
                console.info(`${logPrefix}: rebuilding facet cache`);
                await rebuildFacetCache();
                rebuildSucceeded = true;
            } catch (facetError) {
                console.error(`${logPrefix}: facet rebuild failed`, facetError);
            }

            if (rebuildSucceeded) {
                incrementFacetCacheVersion();
            } else {
                addToast('Library update succeeded, but filters may take a moment to refresh.', 'info');
            }
        } catch (e) {
            console.error(`${logPrefix}: mutation failed`, e);
            addToast("Failed to update library state", "error");
        }
    }, [setImages, addToast, refreshCollections, incrementFacetCacheVersion]);

    const recoverMetadata = useCallback(async (targetId: string, style: RecoveryStyle, onComplete: () => void) => {
        const img = images.find(i => i.id === targetId);
        if (!img) return;

        setIsRecoveringMetadata(true);
        try {
            const base64 = await imageToBase64(img.id);
            const apiKey = useSettingsStore.getState().geminiApiKey;
            if (!apiKey) throw new Error("No API Key");

            const { recoverImageMetadata } = await import('../services/geminiService');
            const recoveredMeta = await recoverImageMetadata(
                base64,
                style,
                apiKey,
                effectiveAiModel,
                effectiveSystemPrompts,
                effectiveAiThinkingMode
            );
            const recoveredPrompt = recoveredMeta.positivePrompt ?? '';

            const updatedImg = {
                ...img,
                metadata: {
                    ...img.metadata,
                    positivePrompt: recoveredPrompt
                },
                originalMetadata: img.originalMetadata
            };

            await updateImageMetadataFields(img.id, { positivePrompt: recoveredPrompt });
            setImages(prev => prev.map(pImg => pImg.id === img.id ? updatedImg : pImg));
            updateImagesQueryCaches(queryClient, cachedImage => (
                cachedImage.id === img.id ? updatedImg : cachedImage
            ));

            addToast("Metadata recovered successfully!", "success");
            onComplete();
        } catch (e) {
            console.error(e);
            addToast("AI Analysis Failed", "error");
        } finally {
            setIsRecoveringMetadata(false);
        }
    }, [images, effectiveAiModel, effectiveAiThinkingMode, effectiveSystemPrompts, setImages, addToast, queryClient]);

    return {
        isRecoveringMetadata,
        deleteImages,
        recoverMetadata
    };
};
