import * as React from 'react';
import { useCallback } from 'react';
import { AIImage } from '../types';
import { useToast } from './useToast';
import { useLibraryStore } from '../stores/libraryStore';
import { isBrowserMockMode } from '../services/runtime';

interface UseThumbnailOpsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollectionThumbnails: () => Promise<void>;
}

export const useThumbnailOps = ({
    images,
    setImages,
    refreshCollectionThumbnails
}: UseThumbnailOpsProps) => {
    const { addToast } = useToast();
    const {
        setIsRegeneratingThumbnails,
        setThumbnailProgress,
        setThumbnailAbortController
    } = useLibraryStore();

    const regenerateThumbnails = useCallback(async (arg?: string[] | ((current: number, total: number) => void)) => {
        if (isBrowserMockMode()) {
            addToast('Unavailable in browser mock mode.', 'info');
            return;
        }

        const targetIds = Array.isArray(arg) ? arg : undefined;
        const onProgress = typeof arg === 'function' ? arg : undefined;

        let candidates: AIImage[];

        if (targetIds && targetIds.length > 0) {
            try {
                const { getImagesByIds } = await import('../services/db/imageRepo');
                candidates = await getImagesByIds(targetIds);
            } catch (e) {
                console.error("Failed to fetch images for regeneration", e);
                candidates = [];
            }
        } else {
            candidates = images.filter(img => img.url === img.thumbnailUrl && !img.url.startsWith('blob:') && !img.url.startsWith('data:'));
        }

        if (candidates.length === 0) {
            if (!targetIds) addToast("No unoptimized images found correctly.", "success");
            return;
        }

        const abortCtrl = new AbortController();
        setThumbnailAbortController(abortCtrl);
        setIsRegeneratingThumbnails(true);
        setThumbnailProgress({ current: 0, total: candidates.length });

        try {
            const { regenerateThumbnailsForImages } = await import('../services/thumbnailService');
            const updates = await regenerateThumbnailsForImages(candidates, (curr, tot) => {
                setThumbnailProgress({ current: curr, total: tot });
                if (onProgress) onProgress(curr, tot);
            }, abortCtrl.signal);

            if (updates.length > 0) {
                setImages(prev => {
                    const updateMap = new Map(updates.map(u => [u.id, u]));
                    return prev.map(p => updateMap.get(p.id) || p);
                });
                const msg = abortCtrl.signal.aborted
                    ? `Cancelled after optimizing ${updates.length} thumbnails.`
                    : `Successfully optimized ${updates.length} of ${candidates.length} thumbnails.`;
                addToast(msg, "success");
                await refreshCollectionThumbnails();
            }
        } catch (e) {
            console.error("Regeneration error", e);
            addToast("Thumbnail optimization failed partway through", "error");
        } finally {
            setIsRegeneratingThumbnails(false);
            setThumbnailProgress(null);
            setThumbnailAbortController(null);
        }
    }, [images, setImages, addToast, refreshCollectionThumbnails, setIsRegeneratingThumbnails, setThumbnailProgress, setThumbnailAbortController]);

    return {
        regenerateThumbnails
    };
};
