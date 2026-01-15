export type ThumbnailSource = 'ambit' | 'invokeai' | 'external' | 'none';

export function detectThumbnailSource(thumbnailUrl: string | undefined): ThumbnailSource {
    if (!thumbnailUrl) return 'none';

    const lowerUrl = thumbnailUrl.toLowerCase();

    // Ambit-generated: in .thumbnails folder with WebP extension
    // We specifically look for our standard pattern
    if (lowerUrl.includes('.thumbnails') && lowerUrl.endsWith('.webp')) {
        return 'ambit';
    }

    // InvokeAI thumbnails often contain 'invokeai' in path or are in 'thumbnails' folder but not webp (or different structure)
    // Actually, InvokeAI might use .webp too, but usually not in our specific .thumbnails root folder if it's an import.
    // Basic heuristic: if it has a thumbnail BUT it's not our standard Ambit one, it's external/upgradeable.

    if (lowerUrl.includes('invokeai')) {
        return 'invokeai';
    }

    return 'external';
}

export function isUpgradeableThumb(thumbnailUrl: string | undefined): boolean {
    const source = detectThumbnailSource(thumbnailUrl);
    // Upgrade if it's external, invokeai, or none (though 'none' usually counts as unoptimized already)
    // We typically separate "unoptimized" (no thumb) from "upgradeable" (bad thumb)
    // So here we only return true if it HAS a thumbnail but it's not Ambit's high-quality one.
    return source === 'invokeai' || source === 'external';
}
