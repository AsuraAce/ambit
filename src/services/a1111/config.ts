import { readDir } from '@tauri-apps/plugin-fs';
import { A1111Config, A1111FolderType, DiscoveryCandidate } from './types';
import { normalizePath } from '../../utils/pathUtils';

const MAX_DEPTH = 4;

/**
 * Perform a dynamic discovery of potential A1111/SD folders.
 * Scans depth 4 subfolders for images and applies heuristics.
 */
export const discoverA1111Candidates = async (
    rootPath: string,
    existingPaths: Set<string>
): Promise<DiscoveryCandidate[]> => {
    const candidates: DiscoveryCandidate[] = [];
    const normalizedRoot = normalizePath(rootPath);

    // Helper to recursively count images in a folder
    const countImagesRecursive = async (path: string): Promise<number> => {
        let count = 0;
        try {
            const entries = await readDir(path);
            for (const entry of entries) {
                if (entry.isDirectory) {
                    const lowerName = entry.name?.toLowerCase() || '';
                    if (lowerName === 'thumbnails') continue;
                    count += await countImagesRecursive(`${path}/${entry.name}`);
                } else {
                    const ext = entry.name?.split('.').pop()?.toLowerCase();
                    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) count++;
                }
            }
        } catch (e) { }
        return count;
    };

    // Helper to check if a folder is a candidate
    const processFolder = async (path: string, depth: number) => {
        if (depth > MAX_DEPTH) return;

        const folderName = path.split(/[\\/]/).pop()?.toLowerCase() || '';
        if (folderName === 'thumbnails') return; // Skip thumbnail folders entirely

        try {
            const entries = await readDir(path);
            let directImageCount = 0;
            const subdirs: { name: string, fullPath: string }[] = [];

            for (const entry of entries) {
                if (entry.isDirectory) {
                    const lowerName = entry.name?.toLowerCase() || '';
                    // Skip technical folders
                    if (!['venv', 'scripts', 'extensions', 'models', 'embeddings', 'tmp', 'cache', '.git', 'thumbnails'].includes(lowerName)) {
                        subdirs.push({ name: entry.name, fullPath: `${path}/${entry.name}` });
                    }
                } else if (entry.isFile) {
                    const ext = entry.name?.split('.').pop()?.toLowerCase();
                    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) {
                        directImageCount++;
                    }
                }
            }

            const normalizedPath = normalizePath(path);
            const type = inferTypeFromPath(normalizedPath);
            const isPriority = type !== A1111FolderType.UNKNOWN;

            if (isPriority) {
                // If it's a priority folder (e.g. txt2img-images), 
                // we treat it as a single unit and count all images inside it (including date subfolders).
                const totalImageCount = await countImagesRecursive(path);
                if (totalImageCount > 0) {
                    candidates.push({
                        path: normalizedPath,
                        name: path.split(/[\\/]/).pop() || path,
                        imageCount: totalImageCount,
                        inferredType: type,
                        isAlreadyLinked: existingPaths.has(normalizedPath.toLowerCase()),
                        isPriority: true
                    });
                }
                // Stop recursing further into a priority folder as its children are consolidated
                return;
            } else if (directImageCount > 0) {
                // Non-priority folders show up if they have images directly inside
                candidates.push({
                    path: normalizedPath,
                    name: path.split(/[\\/]/).pop() || path,
                    imageCount: directImageCount,
                    inferredType: A1111FolderType.UNKNOWN,
                    isAlreadyLinked: existingPaths.has(normalizedPath.toLowerCase()),
                    isPriority: false
                });
            }

            // Recurse into subdirectories if not a priority folder
            for (const subdir of subdirs) {
                await processFolder(subdir.fullPath, depth + 1);
            }
        } catch (e) {
            // Probably access denied or not a dir
        }
    };

    await processFolder(normalizedRoot, 0);
    return candidates;
};

const inferTypeFromPath = (path: string): A1111FolderType => {
    const lower = path.toLowerCase();
    // Prioritize grids
    if (lower.includes('txt2img-grids') || lower.includes('img2img-grids')) return A1111FolderType.GRID;

    // Check specific folder names (not just containing the word)
    const parts = lower.split(/[\\/]/);
    if (parts.some(p => p === 'txt2img-images' || p === 'txt2img')) return A1111FolderType.TXT2IMG;
    if (parts.some(p => p === 'img2img-images' || p === 'img2img')) return A1111FolderType.IMG2IMG;
    if (parts.some(p => p === 'extras-images' || p === 'extras' || p === 'upscale')) return A1111FolderType.EXTRAS;
    if (parts.some(p => p === 'grids' || p === 'grids-images')) return A1111FolderType.GRID;

    return A1111FolderType.UNKNOWN;
};
