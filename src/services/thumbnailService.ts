import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { scanImageNative, scanImagesBulk } from './metadataParser';
import { AIImage } from '../types';

let cachedThumbnailDir: string | null = null;

export const getThumbnailDir = async (): Promise<string | undefined> => {
    if (cachedThumbnailDir) return cachedThumbnailDir;
    try {
        const appData = await appLocalDataDir();
        const thumbPath = await join(appData, '.thumbnails');
        cachedThumbnailDir = thumbPath;
        return thumbPath;
    } catch (e) {
        console.error("Failed to resolve thumbnail dir", e);
        return undefined;
    }
};

export const regenerateThumbnailsForImages = async (
    candidates: AIImage[],
    onProgress?: (current: number, total: number) => void
): Promise<AIImage[]> => {
    const thumbDir = await getThumbnailDir();
    if (!thumbDir || candidates.length === 0) return [];

    let processed = 0;
    const total = candidates.length;
    const updates: AIImage[] = [];
    const BATCH_SIZE = 20;

    // Process in batches
    for (let i = 0; i < total; i += BATCH_SIZE) {
        const batch = candidates.slice(i, i + BATCH_SIZE);
        const paths = batch.map(img => img.id);

        try {
            // fast-scan with extractWorkflow: false
            const results = await scanImagesBulk(paths, thumbDir, false, false);

            // Match results back to images
            results.forEach((res, idx) => {
                if (res.thumbnail) {
                    updates.push({ ...batch[idx], thumbnailUrl: res.thumbnail });
                }
            });

        } catch (e) {
            console.error(`Failed to bulk gen thumbs for batch starting at ${i}`, e);
        }

        processed += batch.length;
        if (onProgress) onProgress(Math.min(processed, total), total);
    }

    return updates;
};
