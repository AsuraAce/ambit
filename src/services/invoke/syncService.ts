import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc } from '@tauri-apps/api/core';
import { mapInvokeMetadata } from './metadataMapper';
import { fetchBoardMappings } from './connection';

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
    const hasHasWorkflow = columns.includes('has_workflow');

    const metaCol = hasMetadataJson ? 'metadata_json' : (hasMetadata ? 'metadata' : null);

    if (!metaCol) {
        throw new Error("Could not find metadata column (checked 'metadata_json' and 'metadata')");
    }

    let hasBoardsTable = false;
    try {
        const boardsTable = await (invokeDb as any).select("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'");
        hasBoardsTable = boardsTable.length > 0;
    } catch (e) { }

    let imageToBoardId = new Map<string, string>();
    let boards = new Map<string, { name: string, createdAt: number }>();
    if (options.syncBoards && hasBoardsTable) {
        const result = await fetchBoardMappings(invokeDb);
        imageToBoardId = result.imageToBoardId;
        boards = result.boards;
    }

    const conditions: string[] = [];
    if (!options.importIntermediates && hasIsIntermediate) {
        conditions.push('i.is_intermediate = 0');
    }

    if (options.afterTimestamp && options.afterTimestamp > 0) {
        const bufferedTimestamp = options.afterTimestamp - (60 * 1000);
        const isoDate = new Date(bufferedTimestamp).toISOString().replace('T', ' ').replace('Z', '');
        conditions.push(`i.created_at > '${isoDate}'`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await (invokeDb as any).select(`SELECT count(*) as count FROM images i ${whereClause}`);
    const totalToImport = countRes[0]?.count || 0;

    const { getDb, insertImagesBatch } = await import('../db');
    const ambitDb = await getDb();
    const existingRows = await ambitDb.select('SELECT id FROM images') as { id: string }[];
    const ambitExistingIds = new Set(existingRows.map(r => r.id));
    const syncedIds = new Set<string>();

    if (totalToImport === 0) {
        if (options.syncBoards && imageToBoardId.size > 0) {
            const { invoke } = await import('@tauri-apps/api/core');
            try {
                const mappingObj: Record<string, string> = {};
                imageToBoardId.forEach((val, key) => { mappingObj[key] = val; });
                await invoke('refresh_boards_native', { boardMapping: mappingObj });
            } catch (e) { }
        }
        return { imported: 0, updated: 0, maxTimestamp: options.afterTimestamp || 0, syncedIds, boardMapping: options.syncBoards ? boards : new Map() };
    }

    let processed = 0;
    let newImportedCount = 0;
    let totalUpdated = 0;
    const BATCH_SIZE = 500;
    let offset = 0;
    let maxTimestampNum = options.afterTimestamp || 0;

    const favCol = hasStarred ? ', i.starred' : (hasIsStarred ? ', i.is_starred' : '');
    const thumbCol = hasThumbnailName ? ', i.thumbnail_name' : '';
    const workflowCol = hasWorkflow ? ', i.workflow' : (hasGraph ? ', i.graph as workflow' : '');
    const hasWfCol = hasHasWorkflow ? ', i.has_workflow' : '';

    while (true) {
        if (signal?.aborted) throw new Error('Aborted');

        const metaSelect = metaCol ? `i.${metaCol} as metadata_blob` : "NULL as metadata_blob";
        const query = `
            SELECT i.image_name, ${metaSelect}, i.created_at, i.width, i.height ${favCol} ${thumbCol} ${workflowCol} ${hasWfCol}
            ${hasSessionQueue ? ', sq.workflow as session_workflow' : ''}
            FROM images i
            ${hasSessionQueue ? 'LEFT JOIN session_queue sq ON i.session_id = sq.session_id' : ''}
            ${whereClause}
            ORDER BY i.created_at ASC
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `;

        const rows = await (invokeDb as any).select(query);
        if (rows.length === 0) break;

        const batchPaths = rows.map((row: any) => {
            const rawPath = `${imagesRoot}/outputs/images/${row.image_name}`;
            return rawPath.replace(/\\/g, '/').replace(/\/+/g, '/');
        });

        const { invoke } = await import('@tauri-apps/api/core');
        let sizes: number[] = [];
        try {
            sizes = await invoke<number[]>('get_file_sizes_bulk', { paths: batchPaths });
        } catch (e) {
            sizes = new Array(rows.length).fill(0);
        }

        const currentBatch: any[] = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const fullPath = batchPaths[i];
            const fileSize = sizes[i] || 0;

            try {
                const timeRaw = row.created_at.includes('Z') ? row.created_at : row.created_at + ' Z';
                const timestamp = new Date(timeRaw).getTime();
                if (timestamp > maxTimestampNum) maxTimestampNum = timestamp;

                const metadata = mapInvokeMetadata(row, 'metadata_blob', processed);
                if (hasIsIntermediate) metadata.isIntermediate = !!row.is_intermediate;
                if (hasHasWorkflow) metadata.hasWorkflowHint = !!row.has_workflow;

                let isFavorite = false;
                let isPinned = false;
                if (options.syncFavorites && options.starredAs && options.starredAs !== 'none') {
                    const isStarredInInvoke = (hasStarred && row.starred) || (hasIsStarred && row.is_starred);
                    if (isStarredInInvoke) {
                        const mode = options.starredAs;
                        if (mode === 'favorite' || mode === 'both') isFavorite = true;
                        if (mode === 'pin' || mode === 'both') isPinned = true;
                    }
                }

                let boardId = options.syncBoards ? imageToBoardId.get(row.image_name) : undefined;
                let thumbnailPath = (hasThumbnailName && row.thumbnail_name)
                    ? `${imagesRoot}/outputs/images/thumbnails/${row.thumbnail_name}`
                    : `${imagesRoot}/outputs/images/thumbnails/${row.image_name.replace(/\.[^/.]+$/, "") + ".webp"}`;

                const newImg: any = {
                    id: fullPath,
                    url: convertFileSrc(fullPath),
                    thumbnailUrl: thumbnailPath,
                    filename: row.image_name,
                    fileSize: fileSize,
                    timestamp: timestamp || Date.now(),
                    width: row.width || 0,
                    height: row.height || 0,
                    isFavorite,
                    isPinned,
                    isDeleted: false,
                    isMissing: false,
                    boardId: boardId,
                    metadata: metadata
                };

                if (!ambitExistingIds.has(fullPath)) {
                    newImportedCount++;
                    ambitExistingIds.add(fullPath);
                } else {
                    totalUpdated++;
                }

                currentBatch.push(newImg);
                syncedIds.add(row.image_name);
                processed++;
            } catch (e) { }
        }

        if (currentBatch.length > 0) await insertImagesBatch(currentBatch);
        offset += rows.length;
        onProgress(Math.min(processed, totalToImport), totalToImport);
        await new Promise(r => setTimeout(r, 0));
    }

    return { imported: newImportedCount, updated: totalUpdated, maxTimestamp: maxTimestampNum, syncedIds, boardMapping: boards };
};
