import { readDir, readFile } from '@tauri-apps/plugin-fs';
import { A1111Config, A1111FolderType, DiscoveryCandidate, WebUIVariant } from './types';
import { normalizePath } from '../../utils/pathUtils';

const MAX_DEPTH = 4;

/**
 * Attempts to detect the specific WebUI variant (A1111, Forge, SD.Next, Anapnoe)
 * based on file structure signatures.
 */
export const detectWebUIVariation = async (rootPath: string): Promise<WebUIVariant> => {
    try {
        const entries = await readDir(rootPath);
        const fileNames = new Set(entries.map(e => e.name.toLowerCase()));

        // 1. Forge Detection (Robust)
        // Newer Forge has 'modules_forge' folder
        if (fileNames.has('modules_forge')) {
            return WebUIVariant.FORGE;
        }

        // 2. Read README.md for definitive identification
        // This is safe and reliable for identifying forks
        if (fileNames.has('readme.md')) {
            try {
                // Find potential readme file with correct casing
                const readmeName = entries.find(e => e.name.toLowerCase() === 'readme.md')?.name;
                if (readmeName) {
                    const bytes = await readFile(`${rootPath}/${readmeName}`);
                    const content = new TextDecoder('utf-8').decode(bytes);
                    const lowerContent = content.slice(0, 1000).toLowerCase(); // Scan first 1000 chars

                    if (lowerContent.includes('sd.next') || lowerContent.includes('vladmandic')) {
                        return WebUIVariant.SDNEXT;
                    }
                    if (lowerContent.includes('forge') && lowerContent.includes('webui')) {
                        return WebUIVariant.FORGE;
                    }
                    if (lowerContent.includes('anapnoe')) {
                        return WebUIVariant.ANAPNOE;
                    }
                }
            } catch (e) {
                // Ignore read errors, fall back to file structure
            }
        }

        // 3. Fallback File Structure Checks
        // Scan modules folder if it exists
        let modulesFiles = new Set<string>();
        if (fileNames.has('modules')) {
            try {
                const modEntries = await readDir(`${rootPath}/modules`);
                modEntries.forEach(e => modulesFiles.add(e.name.toLowerCase()));
            } catch (e) { }
        }

        // Forge Fallback
        if (modulesFiles.has('forge_legacy.py') || fileNames.has('entry_with_update.py')) {
            return WebUIVariant.FORGE;
        }

        // SD.Next Fallback
        if (modulesFiles.has('installer.py') || modulesFiles.has('sd_next_impl.py')) {
            return WebUIVariant.SDNEXT;
        }

        // 4. Final Fallback to A1111 if webui.py exists
        if (fileNames.has('webui.py') || fileNames.has('webui.sh') || fileNames.has('webui.bat')) {
            return WebUIVariant.A1111;
        }

        return WebUIVariant.UNKNOWN;

    } catch (e) {
        console.error("Failed to detect WebUI variant", e);
        return WebUIVariant.UNKNOWN;
    }
};

/**
 * Perform a dynamic discovery of potential A1111/SD folders.
 * Scans depth 4 subfolders for images and applies heuristics.
 */
export const discoverA1111Candidates = async (
    rootPath: string,
    existingPaths: Set<string>
): Promise<{ candidates: DiscoveryCandidate[], logs: string[] }> => {
    const candidates: DiscoveryCandidate[] = [];
    const logs: string[] = [];
    const log = (msg: string) => logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    const normalizedRoot = normalizePath(rootPath);

    log(`Starting scan of ${normalizedRoot}`);

    // Detect Variant First
    const detectedVariant = await detectWebUIVariation(rootPath);
    log(`Detected Installation Type: ${detectedVariant}`);

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
        if (folderName === 'thumbnails') return;

        log(`Processing: ${path} (Depth ${depth})`);

        try {
            const entries = await readDir(path);
            let directImageCount = 0;
            const subdirs: { name: string, fullPath: string }[] = [];

            for (const entry of entries) {
                if (entry.isDirectory) {
                    const lowerName = entry.name?.toLowerCase() || '';
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

            log(`  Found ${entries.length} entries. Subdirs: ${subdirs.map(s => s.name).join(', ')}. Direct Images: ${directImageCount}`);

            const normalizedPath = normalizePath(path);
            const type = inferTypeFromPath(normalizedPath);
            const isPriority = type !== A1111FolderType.UNKNOWN;

            if (isPriority) {
                const totalImageCount = await countImagesRecursive(path);
                if (totalImageCount > 0) {
                    candidates.push({
                        path: normalizedPath,
                        name: path.split(/[\\/]/).pop() || path,
                        imageCount: totalImageCount,
                        inferredType: type,
                        isAlreadyLinked: existingPaths.has(normalizedPath.toLowerCase()),
                        isPriority: true,
                        variant: detectedVariant
                    });
                    log(`  -> Added Priority: ${path} (Images: ${totalImageCount})`);
                } else {
                    log(`  -> Skipped Priority (Empty): ${path}`);
                }
                return;
            }

            // Check if any subdirectory is a priority folder or contains one
            let hasPriorityDeep = false;
            for (const subdir of subdirs) {
                const subType = inferTypeFromPath(normalizePath(subdir.fullPath));
                if (subType !== A1111FolderType.UNKNOWN) {
                    hasPriorityDeep = true;
                    log(`  -> Has Priority Deep: ${subdir.name} is ${subType}`);
                    break;
                }
            }

            if (!hasPriorityDeep && depth > 0) {
                // If this is NOT the root and has NO priority folders deep inside, 
                // check if it has images anywhere inside. If so, consolidate.
                const totalImageCount = await countImagesRecursive(path);
                if (totalImageCount > 0) {
                    candidates.push({
                        path: normalizedPath,
                        name: path.split(/[\\/]/).pop() || path,
                        imageCount: totalImageCount,
                        inferredType: A1111FolderType.UNKNOWN,
                        isAlreadyLinked: existingPaths.has(normalizedPath.toLowerCase()),
                        isPriority: false,
                        variant: detectedVariant
                    });
                    log(`  -> Added Consolidated: ${path} (Images: ${totalImageCount})`);
                    // Consolidate here, don't recurse deeper if we found images and it's a "clean" custom folder
                    return;
                } else {
                    log(`  -> Skipped Consolidated (No Images): ${path}`);
                }
            } else if (hasPriorityDeep) {
                log(`  -> Recursing (Has Priority Deep)`);
            } else if (depth === 0) {
                log(`  -> Recursing (Root)`);
            }

            // Otherwise, recurse deeper
            for (const subdir of subdirs) {
                await processFolder(subdir.fullPath, depth + 1);
            }
        } catch (e) {
            log(`Error processing ${path}: ${e}`);
        }
    };

    await processFolder(normalizedRoot, 0);
    return { candidates, logs };
};

const inferTypeFromPath = (path: string): A1111FolderType => {
    const lower = path.toLowerCase();
    // Prioritize grids
    if (lower.includes('txt2img-grids') || lower.includes('img2img-grids')) return A1111FolderType.GRID;

    // Check specific folder names (not just containing the word)
    const parts = lower.split(/[\\/]/);
    if (parts.some(p => p === 'txt2img-images' || p === 'txt2img' || p === 'text')) return A1111FolderType.TXT2IMG;
    if (parts.some(p => p === 'img2img-images' || p === 'img2img' || p === 'image')) return A1111FolderType.IMG2IMG;
    if (parts.some(p => p === 'extras-images' || p === 'extras' || p === 'upscale')) return A1111FolderType.EXTRAS;
    if (parts.some(p => p === 'grids' || p === 'grids-images')) return A1111FolderType.GRID;
    if (parts.some(p => p === 'save' || p === 'saved')) return A1111FolderType.SAVED;

    return A1111FolderType.UNKNOWN;
};

