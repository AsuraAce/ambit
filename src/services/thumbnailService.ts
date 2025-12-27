import { appLocalDataDir, join } from '@tauri-apps/api/path';
import { scanImageNative } from './metadataParser';
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

    for (const img of candidates) {
        try {
            // Note: img.id is the absolute path
            const { thumbnail } = await scanImageNative(img.id, thumbDir);

            if (thumbnail) {
                updates.push({ ...img, thumbnailUrl: thumbnail });
            }
        } catch (e) {
            console.error(`Failed to gen thumb for ${img.id}`, e);
        }

        processed++;
        if (onProgress) onProgress(processed, total);
    }

    return updates;
};
