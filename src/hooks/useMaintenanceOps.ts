import * as React from 'react';
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AIImage, AppSettings, RecoveryStyle } from '../types';
import { useToast } from './useToast';
import { imageToBase64 } from '../services/imageService';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
    getImagesByIds,
    refreshFacetCacheForResourcesStrict,
    removeImagesFromLibrary,
    updateImageMetadataFields,
} from '../services/db/imageRepo';
import { removeImagesFromQueryCaches, updateImagesQueryCaches } from '../utils/imageQueryCache';
import {
    getEffectiveAiModel,
    getEffectiveAiThinkingMode,
    getEffectiveSystemPrompts
} from '../utils/settingsUtils';
import type { ActiveImageStateAdapter } from './activeImageState';
import { invalidateInvokeReferenceQueries } from '../services/db/invokeReferenceRepo';

interface UseMaintenanceOpsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollections: () => Promise<void>;
    settings: AppSettings;
    activeImageState?: ActiveImageStateAdapter;
}

export const useMaintenanceOps = ({
    images,
    setImages,
    refreshCollections,
    settings,
    activeImageState
}: UseMaintenanceOpsProps) => {
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const [isRecoveringMetadata, setIsRecoveringMetadata] = useState(false);
    const incrementFacetCacheVersion = useLibraryStore(state => state.incrementFacetCacheVersion);
    const effectiveAiModel = getEffectiveAiModel(settings);
    const effectiveAiThinkingMode = getEffectiveAiThinkingMode(settings);
    const effectiveSystemPrompts = getEffectiveSystemPrompts(settings);

    const deleteImages = useCallback(async (ids: string[]): Promise<boolean> => {
        const logPrefix = '[MaintenanceOps] removeFromLibrary';
        let rebuildSucceeded = false;

        try {
            console.info(`${logPrefix}: tombstoning images`, { count: ids.length });
            const result = await removeImagesFromLibrary(ids);
            const affectedIds = new Set(result.affectedIds);
            setImages(prev => prev.filter(img => !affectedIds.has(img.id)));
            removeImagesFromQueryCaches(queryClient, affectedIds);
            addToast(`Removed ${affectedIds.size} image${affectedIds.size === 1 ? '' : 's'} from the library`, 'success');

            try {
                console.info(`${logPrefix}: refreshing collections`);
                await refreshCollections();
            } catch (collectionRefreshError) {
                console.error(`${logPrefix}: collection refresh failed`, collectionRefreshError);
                addToast('Removed from library, but collections may need a refresh.', 'warning');
            }

            try {
                await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['images'] }),
                    invalidateInvokeReferenceQueries(queryClient),
                ]);
            } catch (queryRefreshError) {
                console.error(`${logPrefix}: dependent view refresh failed`, queryRefreshError);
                addToast('Removed from library, but some views may need a refresh.', 'warning');
            }

            try {
                console.info(`${logPrefix}: refreshing affected facet resources`);
                await refreshFacetCacheForResourcesStrict(result.touchedResources);
                rebuildSucceeded = true;
            } catch (facetError) {
                console.error(`${logPrefix}: facet refresh failed`, facetError);
            }

            if (rebuildSucceeded) {
                incrementFacetCacheVersion();
            } else {
                addToast('Library update succeeded, but filters may take a moment to refresh.', 'info');
            }
            return true;
        } catch (e) {
            console.error(`${logPrefix}: mutation failed`, e);
            addToast("Failed to update library state", "error");
            return false;
        }
    }, [setImages, addToast, refreshCollections, incrementFacetCacheVersion, queryClient]);

    const recoverMetadata = useCallback(async (targetId: string, style: RecoveryStyle): Promise<AIImage | null> => {
        setIsRecoveringMetadata(true);
        try {
            const img = activeImageState?.getImage(targetId)
                ?? images.find(i => i.id === targetId)
                ?? (await getImagesByIds([targetId]))[0];
            if (!img) {
                addToast("Prompt Recovery could not find this image in the library.", "error");
                return null;
            }

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
            if (activeImageState) {
                activeImageState.updateImage(img.id, () => updatedImg);
            } else {
                setImages(prev => prev.map(pImg => pImg.id === img.id ? updatedImg : pImg));
            }
            updateImagesQueryCaches(queryClient, cachedImage => (
                cachedImage.id === img.id ? updatedImg : cachedImage
            ));

            addToast("Metadata recovered successfully!", "success");
            return updatedImg;
        } catch (e) {
            console.error(e);
            addToast("AI Prompt Recovery failed. Please try again.", "error");
            return null;
        } finally {
            setIsRecoveringMetadata(false);
        }
    }, [images, effectiveAiModel, effectiveAiThinkingMode, effectiveSystemPrompts, setImages, addToast, queryClient, activeImageState]);

    return {
        isRecoveringMetadata,
        deleteImages,
        recoverMetadata
    };
};
