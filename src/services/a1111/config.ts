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

    // Helper to check if a folder is a candidate
    const processFolder = async (path: string, depth: number) => {
        if (depth > MAX_DEPTH) return;

        try {
            const entries = await readDir(path);
            let imageCount = 0;
            const subdirs: { name: string, fullPath: string }[] = [];

            for (const entry of entries) {
                if (entry.isDirectory) {
                    const lowerName = entry.name?.toLowerCase() || '';
                    // Skip technical folders to keep scan fast
                    if (!['venv', 'scripts', 'extensions', 'models', 'embeddings', 'tmp', 'cache', '.git'].includes(lowerName)) {
                        subdirs.push({ name: entry.name, fullPath: `${path}/${entry.name}` });
                    }
                } else if (entry.isFile) {
                    const ext = entry.name?.split('.').pop()?.toLowerCase();
                    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext || '')) {
                        imageCount++;
                    }
                }
            }

            if (imageCount > 0) {
                const normalizedPath = normalizePath(path);
                const pathParts = normalizedPath.toLowerCase().split('/');
                const isInsideOutputs = pathParts.includes('outputs');
                const type = inferTypeFromPath(normalizedPath);

                // Priority if:
                // 1. Inside an 'outputs' folder (standard SD structure)
                // 2. Or the path hierarchy contains key terms
                const isPriority = isInsideOutputs || (type !== A1111FolderType.UNKNOWN);

                candidates.push({
                    path: normalizedPath,
                    name: path.split('/').pop() || path,
                    imageCount,
                    inferredType: type,
                    isAlreadyLinked: existingPaths.has(normalizedPath.toLowerCase().replace(/\\/g, '/')),
                    isPriority
                });
            }

            // Recurse
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
    // Look for keywords in the entire path, prioritizing the most specific ones
    if (lower.includes('txt2img-grids') || lower.includes('img2img-grids')) return A1111FolderType.GRID;
    if (lower.includes('txt2img')) return A1111FolderType.TXT2IMG;
    if (lower.includes('img2img')) return A1111FolderType.IMG2IMG;
    if (lower.includes('extra') || lower.includes('upscale')) return A1111FolderType.EXTRAS;
    if (lower.includes('grid')) return A1111FolderType.GRID;
    return A1111FolderType.UNKNOWN;
};
