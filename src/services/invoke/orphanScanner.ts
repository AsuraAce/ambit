import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc } from '@tauri-apps/api/core';
import { commands } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import { getDb } from '../db/connection';
import { insertImagesBatch } from '../db/imageRepo';
import { AIImage, GeneratorTool, ImageMetadata } from '../../types';
import { getFilename, normalizePath } from '../../utils/pathUtils';

const normalizeRelativePath = (path: string): string =>
    normalizePath(path).replace(/^\/+/, '');

const buildPathMatchKeys = (path: string): string[] => {
    const normalized = normalizeRelativePath(path);
    const withoutOutputPrefix = normalized.replace(/^outputs\/images\//i, '');

    return Array.from(new Set([
        normalized,
        withoutOutputPrefix
    ].filter(Boolean)));
};

const buildInvokeRowPath = (imageName: string, imageSubfolder?: string | null): string => {
    const normalizedName = normalizeRelativePath(imageName);
    const normalizedSubfolder = normalizeRelativePath(imageSubfolder || '');
    if (!normalizedSubfolder) return normalizedName;

    const filename = getFilename(normalizedName) || normalizedName;
    const subfolder = normalizedSubfolder.replace(/^outputs\/images\//i, '');
    return `outputs/images/${subfolder}/${filename}`;
};

const buildIntermediateMatchKeys = (imageName: string, imageSubfolder?: string | null): string[] => {
    const normalizedName = normalizeRelativePath(imageName);
    const normalizedSubfolder = normalizeRelativePath(imageSubfolder || '');
    const hasPathTruth = !!normalizedSubfolder || /[\\/]/.test(normalizedName);

    if (hasPathTruth) {
        return buildPathMatchKeys(buildInvokeRowPath(imageName, imageSubfolder));
    }

    const filename = getFilename(normalizedName);
    return filename ? [filename] : [];
};

export const scanForOrphans = async (
    rootPath: string,
    syncedIds: Set<string>,
    onProgress: (phase: string, current: number, total: number) => void,
    options: { importIntermediates?: boolean } = { importIntermediates: false }
): Promise<number> => {
    let imagesRoot = rootPath.replace(/[\\/]$/, '');
    const isFile = rootPath.endsWith('.db');
    if (isFile) {
        imagesRoot = imagesRoot.replace(/[\\/](databases)?[\\/]?invokeai\.db$/i, '');
    } else if (imagesRoot.endsWith('databases')) {
        imagesRoot = imagesRoot.replace(/[\\/]databases$/i, '');
    }

    onProgress('Scanning disk for untracked files...', 0, 0);

    const ambitDb = await getDb();
    const existingRows = await ambitDb.select('SELECT id FROM images') as { id: string }[];
    const ambitExistingIds = new Set(existingRows.map(r => r.id));

    let knownIntermediates = new Set<string>();
    if (!options.importIntermediates) {
        try {
            const dbPath = isFile ? rootPath : `${imagesRoot}/databases/invokeai.db`;
            const invokeDb = await Database.load(`sqlite:${dbPath.replace(/\\/g, '/')}`);
            const tableInfo = await invokeDb.select<Array<{ name: string }>>('PRAGMA table_info(images)');
            const hasImageSubfolder = tableInfo.some(column => column.name === 'image_subfolder');
            const interRows = await invokeDb.select<Array<{ image_name: string, image_subfolder?: string | null }>>(
                `SELECT image_name ${hasImageSubfolder ? ', image_subfolder' : ''} FROM images WHERE is_intermediate = 1`
            );
            knownIntermediates = new Set(interRows.flatMap((r) =>
                buildIntermediateMatchKeys(r.image_name, r.image_subfolder)
            ));
        } catch (e) {
            console.error("[Hybrid Sync] ERROR loading intermediates:", e);
        }
    }

    let allFiles: string[] = [];
    try {
        allFiles = await unwrap(commands.listInvokeaiImages(imagesRoot));
    } catch (e) {
        console.error('[OrphanScan] Failed to list images on disk:', e);
        return 0;
    }

    if (!allFiles || allFiles.length === 0) {
        return 0;
    }

    const orphans = allFiles.filter(f => {
        const pathMatchKeys = buildPathMatchKeys(f);
        const filename = getFilename(f);
        if (!options.importIntermediates && (
            pathMatchKeys.some(key => knownIntermediates.has(key)) ||
            (filename && knownIntermediates.has(filename))
        )) return false;
        if (pathMatchKeys.some(key => syncedIds.has(key))) return false;

        // f is relative to root (e.g. "outputs/images/uuid.png")
        // So we just join it with root.
        const absPath = `${imagesRoot}/${f}`.replace(/\\/g, '/').replace(/\/+/g, '/');
        return !ambitExistingIds.has(absPath);
    });

    if (orphans.length === 0) return 0;

    let processed = 0;
    const total = orphans.length;
    onProgress('Importing untracked files...', 0, total);

    const CHUNK_SIZE = 100;
    for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = orphans.slice(i, i + CHUNK_SIZE);
        const chunkAbsPaths = chunk.map(rel => {
            return `${imagesRoot}/${rel}`.replace(/\\/g, '/').replace(/\/+/g, '/');
        });

        try {
            const scanResults = await unwrap(commands.scanImagesBulk(chunkAbsPaths, null, true, false, null, null));

            const batchToInsert: AIImage[] = [];
            for (let j = 0; j < chunk.length; j++) {
                const meta = scanResults[j];
                const absPath = chunkAbsPaths[j];
                const relName = chunk[j];

                // In new pipeline, errors return a zeroed ScanResult with no metadata
                if (!meta || (meta.width === 0 && !meta.metadata)) continue;
                if (!options.importIntermediates && meta.metadata?.isIntermediate) continue;
                if (ambitExistingIds.has(absPath)) continue;

                const finalMeta: ImageMetadata = {
                    tool: GeneratorTool.INVOKEAI,
                    model: meta.metadata?.model || 'Unknown',
                    seed: meta.metadata?.seed ?? undefined,
                    steps: meta.metadata?.steps || 0,
                    cfg: meta.metadata?.cfg || 0,
                    positivePrompt: meta.metadata?.positivePrompt || '',
                    negativePrompt: meta.metadata?.negativePrompt || '',
                    sampler: meta.metadata?.sampler || '',
                    loras: meta.metadata?.loras || [],
                    controlNets: meta.metadata?.controlNets || [],
                    workflowJson: meta.metadata?.workflowJson ?? undefined,
                    rawParameters: meta.metadata?.rawParameters ?? undefined,
                    isIntermediate: !!meta.metadata?.isIntermediate || !meta.metadata
                };

                const newImg: AIImage = {
                    id: absPath,
                    url: convertFileSrc(absPath),
                    thumbnailUrl: meta.thumbnail || absPath,
                    filename: relName.split('/').pop() ?? relName,
                    fileSize: meta.size,
                    timestamp: meta.modified || Date.now(),
                    width: meta.width,
                    height: meta.height,
                    isFavorite: false,
                    isPinned: false,
                    isDeleted: false,
                    isMissing: false,
                    metadata: finalMeta
                };

                batchToInsert.push(newImg);
                processed++;
            }

            if (batchToInsert.length > 0) {
                await insertImagesBatch(batchToInsert);
            }
        } catch (e) { }
        onProgress('Importing untracked files...', processed, total);
    }

    return processed;
};
