import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';

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

    const { insertImagesBatch, getDb } = await import('../db');

    const ambitDb = await getDb();
    const existingRows = await ambitDb.select('SELECT id FROM images') as { id: string }[];
    const ambitExistingIds = new Set(existingRows.map(r => r.id));

    let knownIntermediates = new Set<string>();
    if (!options.importIntermediates) {
        try {
            const dbPath = isFile ? rootPath : `${imagesRoot}/databases/invokeai.db`;
            const invokeDb = await Database.load(`sqlite:${dbPath.replace(/\\/g, '/')}`);
            const interRows = await (invokeDb as any).select("SELECT image_name FROM images WHERE is_intermediate = 1");
            knownIntermediates = new Set(interRows.map((r: any) => r.image_name));
        } catch (e) {
            console.error("[Hybrid Sync] ERROR loading intermediates:", e);
        }
    }

    let allFiles: string[] = [];
    try {
        allFiles = await invoke('list_invokeai_images', { path: imagesRoot });
    } catch (e) {
        return 0;
    }

    if (!allFiles || allFiles.length === 0) return 0;

    const orphans = allFiles.filter(f => {
        if (!options.importIntermediates && knownIntermediates.has(f)) return false;
        const absPath = `${imagesRoot}/outputs/images/${f}`.replace(/\\/g, '/').replace(/\/+/g, '/');
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
            return `${imagesRoot}/outputs/images/${rel}`.replace(/\\/g, '/').replace(/\/+/g, '/');
        });

        try {
            const scanResults: any[] = await invoke('scan_images_bulk', {
                paths: chunkAbsPaths,
                thumbnailDir: null,
                skipThumbnail: true,
                extractWorkflow: false
            });

            const batchToInsert: any[] = [];
            for (let j = 0; j < chunk.length; j++) {
                const meta = scanResults[j];
                const absPath = chunkAbsPaths[j];
                const relName = chunk[j];

                if (!meta || meta.failed || meta.error) continue;
                if (!options.importIntermediates && meta.isIntermediate) continue;
                if (ambitExistingIds.has(absPath)) continue;

                const finalMeta: any = {
                    tool: 'InvokeAI',
                    source: 'orphan_scan',
                    tags: ['ambit_orphan'],
                    model: meta.metadata?.model || 'Unknown',
                    seed: meta.metadata?.seed || 0,
                    steps: meta.metadata?.steps || 0,
                    cfg: meta.metadata?.cfg || 0,
                    positivePrompt: meta.metadata?.positivePrompt || '',
                    negativePrompt: meta.metadata?.negativePrompt || '',
                    sampler: meta.metadata?.sampler || '',
                    loras: meta.metadata?.loras || [],
                    controlNets: meta.metadata?.controlNets || [],
                    workflowJson: meta.metadata?.workflowJson,
                    rawParameters: meta.metadata?.rawParameters,
                    isIntermediate: !!meta.isIntermediate || !meta.metadata
                };

                const newImg: any = {
                    id: absPath,
                    url: convertFileSrc(absPath),
                    thumbnailUrl: meta.thumbnail || absPath,
                    filename: relName.split('/').pop(),
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
