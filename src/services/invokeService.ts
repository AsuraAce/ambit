import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc } from '@tauri-apps/api/core';

// --- Helper to map InvokeAI metadata to Ambit's format ---
// --- Helper to map InvokeAI metadata to Ambit's format ---
function mapInvokeMetadata(row: any, metaCol: string, processedIndex: number): any {
    const rawVal = row[metaCol];
    const sessionWorkflow = row.session_workflow; // From JOIN

    if (!rawVal && !sessionWorkflow) return {};

    let meta: any = {};
    if (rawVal) {
        try {
            meta = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
        } catch (e) { meta = {}; }
    }

    const mapped: any = {
        tool: 'InvokeAI',
        positivePrompt: '',
        negativePrompt: '',
        hasWorkflowHint: row.has_workflow === 1 || row.has_workflow === true
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
        if (typeof root.model === 'string') mapped.model = root.model;
        else if (root.model.model_name) mapped.model = root.model.model_name;
        else if (root.model.name) mapped.model = root.model.name;
        else if (root.model.default) mapped.model = root.model.default;
    }

    // Extract LoRAs
    if (root.loras && Array.isArray(root.loras)) {
        mapped.loras = root.loras.map((l: any) => {
            if (typeof l === 'string') return l;
            if (l.model && typeof l.model === 'object') {
                return l.model.model_name || l.model.name || 'Unknown LoRA';
            }
            if (l.lora && typeof l.lora === 'object') return l.lora.model_name || l.lora.name;
            return l.model_name || l.name || 'Unknown LoRA';
        }).filter(Boolean);
    }

    // -- DATA AUTOPSY --
    if (processedIndex === 0 || row.image_name?.includes('autopsy')) {
        console.log('[InvokeAI Data Autopsy]', {
            image: row.image_name,
            col_workflow: !!row.workflow,
            col_graph: !!row.graph,
            col_session_workflow: !!row.session_workflow,
            meta_workflow: !!root.workflow,
            meta_graph: !!root.graph,
            meta_keys: Object.keys(root)
        });
    }

    // Extract Workflow - Prioritize Session Workflow if found via JOIN
    if (sessionWorkflow) {
        mapped.workflowJson = typeof sessionWorkflow === 'string' ? sessionWorkflow : JSON.stringify(sessionWorkflow);
        console.log('[InvokeAI Sync Trace] Workflow found via session_queue JOIN for', row.image_name, 'Length:', mapped.workflowJson.length);
    } else if (root.workflow || root.graph) {
        const wf = root.workflow || root.graph;
        mapped.workflowJson = typeof wf === 'string' ? wf : JSON.stringify(wf);
        console.log('[InvokeAI Sync Trace] Workflow found in metadata blob for', row.image_name, 'Length:', mapped.workflowJson.length);
    } else if (row.workflow || row.graph || row.workflow_json || row.workflowJson) {
        const wf = row.workflow || row.graph || row.workflow_json || row.workflowJson;
        mapped.workflowJson = typeof wf === 'string' ? wf : JSON.stringify(wf);
        console.log('[InvokeAI Sync Trace] Workflow found in row fallback for', row.image_name || row.path, 'Length:', mapped.workflowJson.length);
    }

    return mapped;
}

// --- Helper to fetch Boards Mapping ---
// --- Helper to fetch Boards Mapping ---
async function fetchBoardMappings(db: Database): Promise<{ imageToBoardId: Map<string, string>, boards: Map<string, { name: string, createdAt: number }> }> {
    const imageToBoardId = new Map<string, string>();
    const boards = new Map<string, { name: string, createdAt: number }>(); // ID -> {Name, Timestamp}

    try {
        const boardsRows = await (db as any).select("SELECT board_id, board_name, created_at FROM boards");
        boardsRows.forEach((b: any) => {
            // Force UTC parsing as InvokeAI SQLite uses UTC
            const timeRaw = b.created_at.includes('Z') ? b.created_at : b.created_at + ' Z';
            const timestamp = new Date(timeRaw).getTime();
            boards.set(b.board_id, { name: b.board_name, createdAt: timestamp });
        });

        const images = await (db as any).select("SELECT image_name, board_id FROM board_images");
        for (const img of images as any[]) {
            if (img.board_id) imageToBoardId.set(String(img.image_name), img.board_id);
        }
    } catch (e) {
        console.warn('Failed to fetch boards/collections mapping:', e);
    }
    return { imageToBoardId, boards };
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
    options: { syncFavorites?: boolean, syncBoards?: boolean, afterTimestamp?: any, importIntermediates?: boolean, starredAs?: 'favorite' | 'pin' | 'both' | 'none' } = { syncFavorites: true, syncBoards: true, importIntermediates: false, starredAs: 'favorite' }
): Promise<{ imported: number, updated: number, maxTimestamp: any, syncedIds: Set<string>, boardMapping: Map<string, { name: string, createdAt: number }> }> => {
    console.log('[InvokeAI Sync] syncImages started with path:', rootPath);
    if (!rootPath) return { imported: 0, updated: 0, maxTimestamp: '', syncedIds: new Set(), boardMapping: new Map() };

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

    const allTablesRows = await (invokeDb as any).select("SELECT name FROM sqlite_master WHERE type='table'");
    const allTables = allTablesRows.map((t: any) => t.name);
    const hasSessionQueue = allTables.includes('session_queue');
    const hasGraphsTable = allTables.includes('graphs');

    const hasMetadataJson = columns.includes('metadata_json');
    const hasMetadata = columns.includes('metadata');
    const hasIsIntermediate = columns.includes('is_intermediate');
    const hasStarred = columns.includes('starred');
    const hasIsStarred = columns.includes('is_starred');
    const hasThumbnailName = columns.includes('thumbnail_name');
    const hasWorkflow = columns.includes('workflow');
    const hasGraph = columns.includes('graph');

    console.log('[InvokeAI Sync] Schema Check:', {
        hasWorkflow, hasGraph,
        hasSessionQueue, hasGraphsTable,
        columns: columns.length
    });

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
    let imageToBoardId = new Map<string, string>();
    let boards = new Map<string, { name: string, createdAt: number }>(); // ID -> {Name, Timestamp}
    if (options.syncBoards && hasBoardsTable) {
        const result = await fetchBoardMappings(invokeDb);
        imageToBoardId = result.imageToBoardId;
        boards = result.boards;
    }



    console.log('[InvokeAI Sync] Using root:', imagesRoot);
    console.log('[InvokeAI Sync] Detected Columns:', columns);
    console.log('[InvokeAI Sync] Has Workflow Col:', hasWorkflow, 'Has Graph Col:', hasGraph);

    // 4. Count Total & Prepare Filter
    const conditions: string[] = [];

    // Intermediate Filter
    if (!options.importIntermediates && hasIsIntermediate) {
        conditions.push('i.is_intermediate = 0');
    }

    // Incremental Sync Logic
    if (options.afterTimestamp && options.afterTimestamp > 0) {
        // Use a 1-minute buffer (shrunk from 5) to catch drift but minimize duplicates
        // IMPORTANT: InvokeAI stores created_at in UTC.
        const bufferedTimestamp = options.afterTimestamp - (60 * 1000);
        const isoDate = new Date(bufferedTimestamp).toISOString().replace('T', ' ').replace('Z', '');
        conditions.push(`i.created_at > '${isoDate}'`);
        console.log('[InvokeAI Sync] Incremental Scan since (buffered):', isoDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await (invokeDb as any).select(`SELECT count(*) as count FROM images i ${whereClause}`);
    const totalToImport = countRes[0]?.count || 0;

    const { getDb, insertImagesBatch } = await import('./db');

    // Get all existing IDs from Ambit DB once to avoid individual SELECTs
    const ambitDb = await getDb();
    const existingRows = await ambitDb.select('SELECT id FROM images') as { id: string }[];
    const ambitExistingIds = new Set(existingRows.map(r => r.id));

    const syncedIds = new Set<string>();

    if (totalToImport === 0) {
        if (options.syncBoards && imageToBoardId.size > 0) {
            console.log('[InvokeAI Sync] Refreshing board associations natively...');
            const { invoke } = await import('@tauri-apps/api/core');
            try {
                // Convert Map to plain object for Rust HashMap compatibility
                const mappingObj: Record<string, string> = {};
                imageToBoardId.forEach((val, key) => { mappingObj[key] = val; });

                const updatedCount = await invoke<number>('refresh_boards_native', { boardMapping: mappingObj });
                console.log(`[InvokeAI Sync] Native board mapping complete. Updated ${updatedCount} images.`);
            } catch (e) {
                console.error('[InvokeAI Sync] Native board refresh failed', e);
            }
        }
        // Return boards map so LibraryContext can still sync collection names/existence even if no images changed
        return { imported: 0, updated: 0, maxTimestamp: options.afterTimestamp || 0, syncedIds, boardMapping: options.syncBoards ? boards : new Map() };
    }

    // 5. Batch Process
    let processed = 0;
    let newImportedCount = 0;
    let totalUpdated = 0;
    const BATCH_SIZE = 500;
    let offset = 0;
    let maxTimestampNum = options.afterTimestamp || 0;

    const favCol = hasStarred ? ', i.starred' : (hasIsStarred ? ', i.is_starred' : '');
    const thumbCol = hasThumbnailName ? ', i.thumbnail_name' : '';
    const workflowCol = hasWorkflow ? ', i.workflow' : (hasGraph ? ', i.graph as workflow' : '');

    while (true) {
        if (signal?.aborted) throw new Error('Aborted');

        const metaSelect = metaCol ? `i.${metaCol} as metadata_blob` : "NULL as metadata_blob";
        const query = `
            SELECT i.image_name, ${metaSelect}, i.created_at, i.width, i.height ${favCol} ${thumbCol} ${workflowCol}
            ${hasSessionQueue ? ', sq.workflow as session_workflow' : ''}
            FROM images i
            ${hasSessionQueue ? 'LEFT JOIN session_queue sq ON i.session_id = sq.session_id' : ''}
            ${whereClause}
            ORDER BY i.created_at ASC
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `;

        const rows = await (invokeDb as any).select(query);
        console.log(`[InvokeAI Sync] Batch fetch results: ${rows.length} rows.`);
        if (processed === 0) {
            console.log('[InvokeAI Sync Debug] Query:', query);
            if (rows.length > 0) {
                console.log('[InvokeAI Sync Debug] First Row Keys:', Object.keys(rows[0]));
                console.log('[InvokeAI Sync Debug] First Row Workflow:', rows[0].workflow ? (typeof rows[0].workflow === 'string' ? rows[0].workflow.substring(0, 50) + '...' : 'Object') : 'NULL/Undefined');
            }
        }
        if (rows.length === 0) break;

        // Fetch file sizes in bulk for this batch
        const batchPaths = rows.map((row: any) => {
            const rawPath = `${imagesRoot}/outputs/images/${row.image_name}`;
            return rawPath.replace(/\\/g, '/').replace(/\/+/g, '/');
        });

        let sizes: number[] = [];
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            sizes = await invoke<number[]>('get_file_sizes_bulk', { paths: batchPaths });
            const missing = sizes.filter(s => s === 0).length;
            if (missing > 0) {
                console.warn(`[InvokeAI Sync] ${missing}/${rows.length} files missing in batch at ${imagesRoot}/outputs/images/`);
                if (processed === 0) {
                    console.log('[InvokeAI Sync Debug] Target missing path example:', batchPaths[sizes.findIndex(s => s === 0)]);
                }
            }
        } catch (e) {
            console.warn('[InvokeAI Sync] Failed to fetch file sizes', e);
            sizes = new Array(rows.length).fill(0);
        }

        const currentBatch: any[] = [];

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const fullPath = batchPaths[i];
            const fileSize = sizes[i] || 0;

            try {
                if (signal?.aborted) throw new Error('Aborted');

                // Force UTC parsing as InvokeAI SQLite uses UTC
                const timeRaw = row.created_at.includes('Z') ? row.created_at : row.created_at + ' Z';
                const timestamp = new Date(timeRaw).getTime();

                if (processed === 0) console.log('[InvokeAI Sync] First image found timestamp:', row.created_at, '->', timestamp);
                if (timestamp > maxTimestampNum) {
                    maxTimestampNum = timestamp;
                }

                // Map metadata using same helper
                // Note: we use 'metadata_blob' because that's what it's aliased to in the SELECT above
                const metadata = mapInvokeMetadata(row, 'metadata_blob', processed);

                // Tag as intermediate if applicable
                if (hasIsIntermediate) {
                    metadata.isIntermediate = !!row.is_intermediate;
                }

                let isFavorite = false;
                let isPinned = false;

                if (options.syncFavorites && options.starredAs && options.starredAs !== 'none') {
                    const isStarredInInvoke = (hasStarred && row.starred) || (hasIsStarred && row.is_starred);
                    if (isStarredInInvoke) {
                        const mode = options.starredAs; // Guaranteed to be a valid mapping mode here
                        if (mode === 'favorite' || mode === 'both') isFavorite = true;
                        if (mode === 'pin' || mode === 'both') isPinned = true;
                    }
                }

                let boardId: string | undefined = undefined;
                if (options.syncBoards) {
                    boardId = imageToBoardId.get(row.image_name);
                }

                let thumbnailPath = fullPath;
                if (hasThumbnailName && row.thumbnail_name) {
                    thumbnailPath = `${imagesRoot}/outputs/images/thumbnails/${row.thumbnail_name}`;
                } else {
                    const inferredThumbName = row.image_name.replace(/\.[^/.]+$/, "") + ".webp";
                    thumbnailPath = `${imagesRoot}/outputs/images/thumbnails/${inferredThumbName}`;
                }

                const newImg: any = {
                    id: fullPath,
                    url: convertFileSrc(fullPath),
                    thumbnailUrl: thumbnailPath,
                    filename: row.image_name,
                    fileSize: fileSize,
                    timestamp: timestamp || Date.now(),
                    width: row.width || 0,
                    height: row.height || 0,
                    isFavorite: isFavorite,
                    isPinned: isPinned,
                    isDeleted: false,
                    isMissing: false,
                    userMasked: undefined,
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

    return { imported: newImportedCount, updated: totalUpdated, maxTimestamp: maxTimestampNum, syncedIds, boardMapping: boards };
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
            console.log(`[Hybrid Sync] Loading intermediates from: ${dbPath}`);
            const invokeDb = await Database.load(`sqlite:${dbPath.replace(/\\/g, '/')}`);
            const interRows = await (invokeDb as any).select("SELECT image_name FROM images WHERE is_intermediate = 1");
            knownIntermediates = new Set(interRows.map((r: any) => r.image_name));
            console.log(`[Hybrid Sync] Loaded ${knownIntermediates.size} known intermediates to ignore.`);
            // Close not strictly necessary as plugin manages valid pool
        } catch (e) {
            console.error("[Hybrid Sync] ERROR loading intermediates from Invoke DB:", e);
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
    const orphans = allFiles.filter(f => {
        // Filter out known intermediates first
        if (!options.importIntermediates && knownIntermediates.has(f)) return false;

        const absPath = `${imagesRoot}/outputs/images/${f}`.replace(/\\/g, '/').replace(/\/+/g, '/');
        return !ambitExistingIds.has(absPath);
    });

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
                skipThumbnail: true,
                extractWorkflow: false
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
                    workflowJson: meta.metadata?.workflowJson,
                    rawParameters: meta.metadata?.rawParameters,
                    isIntermediate: !!meta.isIntermediate || !meta.metadata // Heuristic: No metadata = Intermediate
                };

                if (processed === 0) {
                    console.log('[Hybrid Sync Debug] First Orphan finalMeta:', {
                        hasWorkflow: !!finalMeta.workflowJson,
                        workflowLength: finalMeta.workflowJson?.length,
                        tool: finalMeta.tool
                    });
                }

                const newImg: any = {
                    id: absPath,
                    url: convertFileSrc(absPath),
                    // Use original image as thumbnail (Strategy #2)
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
                    userMasked: undefined,
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
