import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc } from '@tauri-apps/api/core';

// --- Helper to map InvokeAI metadata to Ambit's format ---
function mapInvokeMetadata(row: any, metaCol: string): any {
    const rawVal = row[metaCol];
    if (!rawVal) return {};

    let meta: any = {};
    try {
        meta = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
    } catch (e) { return {}; }

    const mapped: any = {
        tool: 'InvokeAI',
        model: 'Unknown',
        seed: 0,
        steps: 20,
        cfg: 7,
        sampler: 'k_lms',
        positivePrompt: '',
        negativePrompt: '',
    };

    const root = meta.image || meta.generation || meta;

    if (root.positive_prompt) mapped.positivePrompt = root.positive_prompt;
    if (root.negative_prompt) mapped.negativePrompt = root.negative_prompt;
    if (root.steps) mapped.steps = root.steps;
    if (root.cfg_scale) mapped.cfg = root.cfg_scale;
    if (root.seed) mapped.seed = root.seed;
    if (root.scheduler) mapped.sampler = root.scheduler;

    if (!mapped.positivePrompt && root.prompt && Array.isArray(root.prompt)) {
        mapped.positivePrompt = root.prompt.map((p: any) => p.prompt).join(' ');
    }

    if (root.model) {
        // Debug Log for first few images to identify structure
        if (Math.random() < 0.001) console.log('[Invoke Metadata Debug]', 'Raw Model:', root.model);

        if (typeof root.model === 'string') mapped.model = root.model;
        else if (root.model.model_name) mapped.model = root.model.model_name;
        else if (root.model.name) mapped.model = root.model.name;
        else if (root.model.default) mapped.model = root.model.default; // Some store as default?
    }

    // Extract LoRAs
    if (root.loras && Array.isArray(root.loras)) {
        mapped.loras = root.loras.map((l: any) => {
            if (typeof l === 'string') return l;
            // Handle { model: { name: "..." } } structure (InvokeAI 4+)
            if (l.model && typeof l.model === 'object') {
                return l.model.model_name || l.model.name || 'Unknown LoRA';
            }
            // Handle older or alternative structures
            if (l.lora && typeof l.lora === 'object') return l.lora.model_name || l.lora.name;
            return l.model_name || l.name || 'Unknown LoRA';
        }).filter(Boolean);

        if (mapped.loras.length > 0) {
            console.log('[Invoke LoRA Sync] Extracted LoRAs:', mapped.loras);
        }
    }

    return mapped;
}

// --- Helper to fetch Boards Mapping ---
async function fetchBoardMappings(db: Database): Promise<Map<string, string>> {
    const mapping = new Map<string, string>();
    try {
        const boards = await (db as any).select("SELECT board_id, board_name FROM boards");
        const boardMap = new Map(boards.map(b => [b.board_id, b.board_name]));

        const images = await (db as any).select("SELECT image_name, board_id FROM board_images");

        for (const img of images as any[]) {
            const name = boardMap.get(img.board_id) as string | undefined;
            if (name) mapping.set(String(img.image_name), name);
        }
    } catch (e) {
        console.warn('Failed to fetch boards/collections mapping:', e);
    }
    return mapping;
}

export const testConnection = async (rootPath: string): Promise<{ success: boolean, count: number, message: string }> => {
    if (!rootPath) return { success: false, count: 0, message: "No path provided." };

    const isFile = rootPath.endsWith('.db');
    const candidates = isFile ? [rootPath] : [
        `${rootPath}/databases/invokeai.db`,
        `${rootPath}\\databases\\invokeai.db`,
        `${rootPath}/invokeai.db`
    ];

    for (const path of candidates) {
        try {
            const cleanPath = path.replace(/\\/g, '/');
            const connectionString = `sqlite:${cleanPath}`;

            console.log(`[InvokeAI] Testing connection to ${connectionString}`);
            const db = await Database.load(connectionString);
            const result = await (db as any).select('SELECT count(*) as count FROM images');
            const count = result[0]?.count || 0;

            return {
                success: true,
                count: count,
                message: `Connected! Found ${count} images.`
            };
        } catch (e: any) {
            console.warn(`[InvokeAI] Failed to connect to ${path}:`, e);
        }
    }

    return {
        success: false,
        count: 0,
        message: "Could not find valid 'invokeai.db' at this path."
    };
};

export const diagnoseInvokeAI = async (rootPath: string): Promise<any> => {
    if (!rootPath) return { error: "No path provided." };

    let imagesRoot = rootPath.replace(/[\\/]$/, '');
    const isFile = rootPath.endsWith('.db');
    if (isFile) {
        imagesRoot = imagesRoot.replace(/[\\/](databases)?[\\/]?invokeai\.db$/i, '');
    } else if (imagesRoot.endsWith('databases')) {
        imagesRoot = imagesRoot.replace(/[\\/]databases$/i, '');
    }

    let dbPath = isFile ? rootPath : `${imagesRoot}/databases/invokeai.db`;
    const connectionString = `sqlite:${dbPath.replace(/\\/g, '/')}`;

    try {
        const db = await Database.load(connectionString);

        // 1. Get Column Info
        const tableInfo = await (db as any).select('PRAGMA table_info(images)');
        const columns = tableInfo.map((c: any) => c.name);

        // 2. Counts
        const totalImages = (await (db as any).select('SELECT count(*) as count FROM images'))[0].count;

        const categories = columns.includes('image_category')
            ? await (db as any).select('SELECT image_category, count(*) as count FROM images GROUP BY image_category')
            : [];

        const origins = columns.includes('image_origin')
            ? await (db as any).select('SELECT image_origin, count(*) as count FROM images GROUP BY image_origin')
            : [];

        const intermediateStatus = columns.includes('is_intermediate')
            ? await (db as any).select('SELECT is_intermediate, count(*) as count FROM images GROUP BY is_intermediate')
            : [];

        // 3. All Tables
        const tablesList = await (db as any).select("SELECT name FROM sqlite_master WHERE type='table'");
        const tableCounts = [];
        for (const t of tablesList) {
            try {
                const res = await (db as any).select(`SELECT count(*) as count FROM ${t.name}`);
                tableCounts.push({ name: t.name, count: res[0].count });
            } catch (e) {
                tableCounts.push({ name: t.name, count: 'Error' });
            }
        }

        return {
            totalInDb: totalImages,
            columns,
            categories,
            origins,
            intermediateStatus,
            dbPath,
            imagesRoot,
            tables: tableCounts
        };
    } catch (e: any) {
        return { error: e.message || String(e) };
    }
};

export const syncImages = async (
    rootPath: string,
    onProgress: (current: number, total: number) => void,
    signal?: AbortSignal,
    options: { syncFavorites?: boolean, syncBoards?: boolean, afterTimestamp?: any, importIntermediates?: boolean } = { syncFavorites: true, syncBoards: true, importIntermediates: false }
): Promise<{ imported: number, updated: number, maxTimestamp: any, syncedIds: Set<string> }> => {
    if (!rootPath) return { imported: 0, updated: 0, maxTimestamp: '', syncedIds: new Set() };

    let imagesRoot = rootPath.replace(/[\\/]$/, '');
    const isFile = rootPath.endsWith('.db');
    if (isFile) {
        imagesRoot = imagesRoot.replace(/[\\/](databases)?[\\/]?invokeai\.db$/i, '');
    } else if (imagesRoot.endsWith('databases')) {
        imagesRoot = imagesRoot.replace(/[\\/]databases$/i, '');
    }

    let dbPath = isFile ? rootPath : `${imagesRoot}/databases/invokeai.db`;
    const connectionString = `sqlite:${dbPath.replace(/\\/g, '/')}`;

    let invokeDb;
    try {
        invokeDb = await Database.load(connectionString);
    } catch (e) {
        throw new Error(`Could not connect to InvokeAI DB at ${dbPath}`);
    }

    // 2. Inspect Schema
    const tableInfo = await (invokeDb as any).select('PRAGMA table_info(images)');
    const columns = tableInfo.map(c => c.name);

    const hasMetadataJson = columns.includes('metadata_json');
    const hasMetadata = columns.includes('metadata');
    const hasIsIntermediate = columns.includes('is_intermediate');
    const hasStarred = columns.includes('starred');
    const hasIsStarred = columns.includes('is_starred');
    const hasThumbnailName = columns.includes('thumbnail_name');

    const metaCol = hasMetadataJson ? 'metadata_json' : (hasMetadata ? 'metadata' : null);

    if (!metaCol) {
        throw new Error("Could not find metadata column (checked 'metadata_json' and 'metadata')");
    }

    // Check for Boards
    let hasBoardsTable = false;
    try {
        const boardsTable = await (invokeDb as any).select("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'");
        hasBoardsTable = boardsTable.length > 0;
    } catch (e) { }

    // Pre-fetch Boards if requested
    let boardMapping = new Map<string, string>();
    if (options.syncBoards && hasBoardsTable) {
        boardMapping = await fetchBoardMappings(invokeDb);
    }

    console.log('[InvokeAI Schema]', { columns, hasBoardsTable, hasStarred, hasIsStarred, hasThumbnailName });

    console.log('[InvokeAI Sync] Using root:', imagesRoot);

    // 4. Count Total & Prepare Filter
    const conditions: string[] = [];

    // Intermediate Filter
    if (!options.importIntermediates && hasIsIntermediate) {
        conditions.push('is_intermediate = 0');
    }

    // Incremental Sync Logic
    if (options.afterTimestamp && options.afterTimestamp > 0) {
        // Use a 1-minute buffer (shrunk from 5) to catch drift but minimize duplicates
        // IMPORTANT: InvokeAI stores created_at in UTC.
        const bufferedTimestamp = options.afterTimestamp - (60 * 1000);
        const isoDate = new Date(bufferedTimestamp).toISOString().replace('T', ' ').replace('Z', '');
        conditions.push(`created_at > '${isoDate}'`);
        console.log('[InvokeAI Sync] Incremental Scan since (buffered):', isoDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await (invokeDb as any).select(`SELECT count(*) as count FROM images ${whereClause}`);
    const totalToImport = countRes[0]?.count || 0;

    const { getDb, insertImagesBatch } = await import('./db');

    // Get all existing IDs from Ambit DB once to avoid individual SELECTs
    const ambitDb = await getDb();
    const existingRows = await ambitDb.select('SELECT id FROM images') as { id: string }[];
    const ambitExistingIds = new Set(existingRows.map(r => r.id));

    const syncedIds = new Set<string>();

    if (totalToImport === 0) {
        if (options.syncBoards && boardMapping.size > 0) {
            console.log('[InvokeAI Sync] Refreshing board associations natively...');
            const { invoke } = await import('@tauri-apps/api/core');
            try {
                // Convert Map to plain object for Rust HashMap compatibility
                const mappingObj: Record<string, string> = {};
                boardMapping.forEach((val, key) => { mappingObj[key] = val; });

                const updatedCount = await invoke<number>('refresh_boards_native', { boardMapping: mappingObj });
                console.log(`[InvokeAI Sync] Native board mapping complete. Updated ${updatedCount} images.`);
            } catch (e) {
                console.error('[InvokeAI Sync] Native board refresh failed', e);
            }
        }
        return { imported: 0, updated: 0, maxTimestamp: options.afterTimestamp || 0, syncedIds };
    }

    // 5. Batch Process
    let processed = 0;
    let newImportedCount = 0;
    let totalUpdated = 0;
    const BATCH_SIZE = 500;
    let offset = 0;
    let maxTimestampNum = options.afterTimestamp || 0;

    const favCol = hasStarred ? ', starred' : (hasIsStarred ? ', is_starred' : '');
    const thumbCol = hasThumbnailName ? ', thumbnail_name' : '';

    while (true) {
        if (signal?.aborted) throw new Error('Aborted');

        const query = `
            SELECT image_name, ${metaCol}, created_at, width, height ${favCol} ${thumbCol}
            FROM images 
            ${whereClause} 
            ORDER BY created_at ASC
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `;

        const rows = await (invokeDb as any).select(query);
        if (rows.length === 0) break;

        const currentBatch: any[] = [];

        for (const row of rows) {
            if (signal?.aborted) throw new Error('Aborted');

            // Force UTC parsing as InvokeAI SQLite uses UTC
            const timeRaw = row.created_at.includes('Z') ? row.created_at : row.created_at + ' Z';
            const timestamp = new Date(timeRaw).getTime();

            if (processed === 0) console.log('[InvokeAI Sync] First image found timestamp:', row.created_at, '->', timestamp);
            if (timestamp > maxTimestampNum) {
                maxTimestampNum = timestamp;
            }

            const rawPath = `${imagesRoot}/outputs/images/${row.image_name}`;
            const fullPath = rawPath.replace(/\\/g, '/').replace(/\/+/g, '/');

            try {
                const metadata = mapInvokeMetadata(row, metaCol);

                // Tag as intermediate if applicable
                if (hasIsIntermediate) {
                    metadata.isIntermediate = !!row.is_intermediate;
                }

                let isFavorite = false;
                if (options.syncFavorites) {
                    if (hasStarred && row.starred) isFavorite = true;
                    else if (hasIsStarred && row.is_starred) isFavorite = true;
                }

                let boardId: string | undefined = undefined;
                if (options.syncBoards) {
                    boardId = boardMapping.get(row.image_name);
                }

                let thumbnailUrl = convertFileSrc(fullPath);
                if (hasThumbnailName && row.thumbnail_name) {
                    thumbnailUrl = convertFileSrc(`${imagesRoot}/outputs/images/thumbnails/${row.thumbnail_name}`);
                } else {
                    const inferredThumbName = row.image_name.replace(/\.[^/.]+$/, "") + ".webp";
                    thumbnailUrl = convertFileSrc(`${imagesRoot}/outputs/images/thumbnails/${inferredThumbName}`);
                }

                const newImg: any = {
                    id: fullPath,
                    url: convertFileSrc(fullPath),
                    thumbnailUrl: thumbnailUrl,
                    filename: row.image_name,
                    fileSize: 0,
                    timestamp: timestamp || Date.now(),
                    width: row.width || 0,
                    height: row.height || 0,
                    isFavorite: isFavorite,
                    isDeleted: false,
                    isMissing: false,
                    groupId: undefined,
                    boardId: boardId,
                    metadata: metadata
                };

                const isNew = !ambitExistingIds.has(fullPath);
                if (isNew) {
                    newImportedCount++;
                    ambitExistingIds.add(fullPath); // Mark as seen for this run
                } else {
                    totalUpdated++;
                }

                currentBatch.push(newImg);
                syncedIds.add(row.image_name);
                processed++;
            } catch (e) {
                console.error('Failed to import image:', fullPath, e);
            }
        }

        if (currentBatch.length > 0) {
            await insertImagesBatch(currentBatch);
        }

        offset += rows.length;
        onProgress(Math.min(processed, totalToImport), totalToImport);
        await new Promise(r => setTimeout(r, 0));
    }

    return { imported: newImportedCount, updated: totalUpdated, maxTimestamp: maxTimestampNum, syncedIds };
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

    const { invoke } = await import('@tauri-apps/api/core');
    const { insertImage, getDb } = await import('./db');

    // 1. Get ALL existing absolute paths already in Ambit (Phase 1.5)
    // AND get known intermediates if we are skipping them
    const ambitDb = await getDb();
    const existingRows = await ambitDb.select('SELECT id FROM images') as { id: string }[];
    const ambitExistingIds = new Set(existingRows.map(r => r.id));
    console.log(`[Hybrid Sync] Ambit already knows about ${ambitExistingIds.size} images.`);

    let knownIntermediates = new Set<string>();
    if (!options.importIntermediates) {
        try {
            // Re-connect to Invoke DB just to get the intermediates list
            // We use a simplified connection here since we assume checkConnection passed
            const dbPath = isFile ? rootPath : `${imagesRoot}/databases/invokeai.db`;
            const invokeDb = await Database.load(`sqlite:${dbPath.replace(/\\/g, '/')}`);
            const interRows = await (invokeDb as any).select("SELECT image_name FROM images WHERE is_intermediate = 1");
            knownIntermediates = new Set(interRows.map((r: any) => r.image_name));
            console.log(`[Hybrid Sync] Loaded ${knownIntermediates.size} known intermediates to ignore.`);
            // Close not strictly necessary as plugin manages valid pool, but good practice if API supported it
        } catch (e) {
            console.warn("[Hybrid Sync] Failed to load intermediates list from Invoke DB, falling back to metadata check.", e);
        }
    }

    // 2. Get all files list (Phase 2)
    let allFiles: string[] = [];
    try {
        allFiles = await invoke('list_invokeai_images', { path: imagesRoot });
    } catch (e) {
        console.error("Failed to list invokeai images:", e);
        return 0;
    }

    if (!allFiles || allFiles.length === 0) return 0;

    // 3. Identify REAL Orphans (Phase 3)
    // We only care about files that are NOT in Ambit's database already.
    let skippedIntermediates = 0;
    let skippedExisting = 0;

    console.log(`[Hybrid Sync Debug] Starting orphan filter. Total disk files: ${allFiles.length}`);
    console.log(`[Hybrid Sync Debug] Ambit Known IDs: ${ambitExistingIds.size}`);
    console.log(`[Hybrid Sync Debug] Invoke Known Intermediates: ${knownIntermediates.size}`);

    const orphans = allFiles.filter((f, index) => {
        // Filter out known intermediates first
        if (!options.importIntermediates && knownIntermediates.has(f)) {
            skippedIntermediates++;
            return false;
        }

        const absPath = `${imagesRoot}/outputs/images/${f}`.replace(/\\/g, '/').replace(/\/+/g, '/');

        if (ambitExistingIds.has(absPath)) {
            skippedExisting++;
            if (index < 5) console.log(`[Hybrid Sync Debug] Skipped Existing: ${f} -> ${absPath}`);
            return false;
        }

        if (index < 5) console.log(`[Hybrid Sync Debug] Found Candidate: ${f} -> ${absPath}`);
        return true;
    });

    console.log(`[Hybrid Sync Debug] Filter Results:`);
    console.log(`- Skipped (Intermediate): ${skippedIntermediates}`);
    console.log(`- Skipped (Already in Ambit): ${skippedExisting}`);
    console.log(`- Final Orphans: ${orphans.length}`);

    console.log(`[Hybrid Sync] Found ${orphans.length} genuine orphans out of ${allFiles.length} files.`);

    if (orphans.length === 0) return 0;

    // 4. Import Orphans (Phase 4)
    let processed = 0;
    const total = orphans.length;
    onProgress('Importing untracked files...', 0, total);

    // We use scan_images_bulk for speed with skip_thumbnail = true
    const CHUNK_SIZE = 100; // Increased chunk size for better batching
    for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = orphans.slice(i, i + CHUNK_SIZE);
        const chunkAbsPaths = chunk.map(rel => {
            return `${imagesRoot}/outputs/images/${rel}`.replace(/\\/g, '/').replace(/\/+/g, '/');
        });

        try {
            // skip_thumbnail = true for orphans (Strategy #2: Lazy Thumbnails)
            // thumbnailDir is NULL to prevent accidental writing to Invoke folder
            const scanResults: any[] = await invoke('scan_images_bulk', {
                paths: chunkAbsPaths,
                thumbnailDir: null,
                skipThumbnail: true
            });

            const batchToInsert: any[] = [];

            for (let j = 0; j < chunk.length; j++) {
                const meta = scanResults[j];
                const absPath = chunkAbsPaths[j];
                const relName = chunk[j];

                if (!meta || meta.failed || meta.error) continue;

                // Intermediate Filter
                if (!options.importIntermediates && meta.isIntermediate) continue;

                // Double check just in case of race condition
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
                    isIntermediate: !!meta.isIntermediate
                };

                const newImg: any = {
                    id: absPath,
                    url: convertFileSrc(absPath),
                    // Use original image as thumbnail (Strategy #2)
                    thumbnailUrl: meta.thumbnail ? convertFileSrc(meta.thumbnail) : convertFileSrc(absPath),
                    filename: relName.split('/').pop(),
                    fileSize: meta.size,
                    timestamp: meta.modified || Date.now(),
                    width: meta.width,
                    height: meta.height,
                    isFavorite: false,
                    isDeleted: false,
                    isMissing: false,
                    metadata: finalMeta
                };

                batchToInsert.push(newImg);
                processed++;
            }

            if (batchToInsert.length > 0) {
                const { insertImagesBatch } = await import('./db');
                await insertImagesBatch(batchToInsert);
            }
        } catch (e) {
            console.error("Chunk failed", e);
        }

        onProgress('Importing untracked files...', processed, total);
    }

    return processed;
};
