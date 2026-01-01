import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc } from '@tauri-apps/api/core';
import { mapInvokeMetadata } from './metadataMapper';
import { fetchBoardMappings } from './connection';

export const syncImages = async (
    rootPath: string,
    onProgress: (current: number, total: number, message?: string) => void,
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

    onProgress(0, 0, 'Connecting to InvokeAI database...');
    let invokeDb;
    try {
        invokeDb = await Database.load(connectionString);
    } catch (e) {
        throw new Error(`Could not connect to InvokeAI DB at ${dbPath}`);
    }

    onProgress(0, 0, 'Analyzing database schema...');
    const tableInfo = await (invokeDb as any).select('PRAGMA table_info(images)');
    const columns = tableInfo.map(c => c.name);

    const allTablesRows = await (invokeDb as any).select("SELECT name FROM sqlite_master WHERE type='table'");
    const allTables = allTablesRows.map((t: any) => t.name);
    const hasGraphsTable = allTables.includes('graphs');

    const hasMetadataJson = columns.includes('metadata_json');
    const hasMetadata = columns.includes('metadata');
    const hasIsIntermediate = columns.includes('is_intermediate');
    const hasStarred = columns.includes('starred');
    const hasIsStarred = columns.includes('is_starred');
    const hasThumbnailName = columns.includes('thumbnail_name');
    const hasHasWorkflow = columns.includes('has_workflow');
    const hasUpdatedAt = columns.includes('updated_at');

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
        onProgress(0, 0, 'Fetching board mappings...');
        const result = await fetchBoardMappings(invokeDb);
        imageToBoardId = result.imageToBoardId;
        boards = result.boards;
    }

    const conditions: string[] = [];
    // We now always import intermediates so that the "View Options" toggle can work.
    // They are hidden by default in the Ambit UI.

    if (options.afterTimestamp && options.afterTimestamp > 0) {
        const bufferedTimestamp = options.afterTimestamp; // Remove 60s buffer
        const isoDate = new Date(bufferedTimestamp).toISOString().replace('T', ' ').replace('Z', '');
        const timeCond = `i.created_at > '${isoDate}'`;
        if (hasUpdatedAt) {
            conditions.push(`(${timeCond} OR i.updated_at > '${isoDate}')`);
        } else {
            conditions.push(timeCond);
        }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRes = await (invokeDb as any).select(`SELECT count(*) as count FROM images i ${whereClause}`);
    const totalToImport = countRes[0]?.count || 0;

    onProgress(0, 0, 'Scanning Ambit library...');
    const { getDb, insertImagesBatch } = await import('../db');
    const ambitDb = await getDb();
    const existingRows = await ambitDb.select('SELECT id FROM images') as { id: string }[];
    const ambitExistingIds = new Set(existingRows.map(r => r.id));

    // Fetch existing states for favorite/pin/board to preserve them if sync is disabled for those fields
    const { getImagesByIds } = await import('../db/imageRepo');
    const existingImagesMeta = new Map<string, { isFavorite: boolean, isPinned: boolean, boardId?: string }>();

    const syncedIds = new Set<string>();

    if (totalToImport === 0) {
        if (options.syncBoards && imageToBoardId.size > 0) {
            const { invoke } = await import('@tauri-apps/api/core');
            try {
                const mappingObj: Record<string, string> = {};
                imageToBoardId.forEach((val, key) => { mappingObj[key] = val; });
                await invoke('refresh_boards_native', { boardMapping: mappingObj });
                const { syncCollectionImages } = await import('../db/imageRepo');
                await syncCollectionImages();
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
    const hasWfCol = hasHasWorkflow ? ', i.has_workflow' : '';
    const updatedCol = hasUpdatedAt ? ', i.updated_at' : '';
    const intermediateCol = hasIsIntermediate ? ', i.is_intermediate' : '';

    const createdBoardIds = new Set<string>();

    while (true) {
        if (signal?.aborted) throw new Error('Aborted');

        const metaSelect = metaCol ? `i.${metaCol} as metadata_blob` : "NULL as metadata_blob";
        const query = `
            SELECT i.image_name, ${metaSelect}, i.created_at, i.width, i.height ${favCol} ${thumbCol} ${hasWfCol} ${updatedCol} ${intermediateCol}
            FROM images i
            ${whereClause}
            ORDER BY i.created_at ASC, ${hasUpdatedAt ? 'i.updated_at ASC' : 'i.image_name ASC'}
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

        const existingImagesInBatch = await getImagesByIds(batchPaths);
        const existingMap = new Map(existingImagesInBatch.map(img => [img.id, img]));

        const currentBatch: any[] = [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const fullPath = batchPaths[i];
            const fileSize = sizes[i] || 0;

            try {
                const timeRaw = row.created_at.includes('Z') ? row.created_at : row.created_at + ' Z';
                const timestamp = new Date(timeRaw).getTime();
                let lastModified = timestamp;
                if (hasUpdatedAt && row.updated_at) {
                    const upTimeRaw = row.updated_at.includes('Z') ? row.updated_at : row.updated_at + ' Z';
                    lastModified = new Date(upTimeRaw).getTime();
                }

                if (lastModified > maxTimestampNum) maxTimestampNum = lastModified;

                const metadata = mapInvokeMetadata(row, 'metadata_blob', processed);
                if (hasIsIntermediate) metadata.isIntermediate = !!row.is_intermediate;
                if (hasHasWorkflow) metadata.hasWorkflowHint = !!row.has_workflow;

                let isFavorite = false;
                let isPinned = false;

                // Sync protection: If we already have this image, and sync options are OFF, keep the old values
                const existing = existingMap.get(fullPath);

                if (options.syncFavorites && options.starredAs && options.starredAs !== 'none') {
                    const isStarredInInvoke = (hasStarred && (row.starred === 1 || row.starred === true)) ||
                        (hasIsStarred && (row.is_starred === 1 || row.is_starred === true));

                    if (isStarredInInvoke) {
                        const mode = options.starredAs;
                        if (mode === 'favorite' || mode === 'both') isFavorite = true;
                        if (mode === 'pin' || mode === 'both') isPinned = true;
                    }
                } else if (existing) {
                    isFavorite = existing.isFavorite;
                    isPinned = existing.isPinned || false;
                }

                let boardId = options.syncBoards ? imageToBoardId.get(row.image_name) : undefined;
                if (!options.syncBoards && existing) {
                    boardId = existing.boardId;
                }

                let needsUpdate = false;
                if (!existing) {
                    needsUpdate = true;
                } else {
                    // Only update if favorite, pin, or board changed
                    if (isFavorite !== existing.isFavorite) needsUpdate = true;
                    if (isPinned !== (existing.isPinned || false)) needsUpdate = true;
                    if (boardId !== existing.boardId) needsUpdate = true;
                    // Note: We don't check metadata updates here to keep it simple and performance-oriented
                    // but since InvokeAI metadata is usually immutable after creation, this is safe.
                }

                if (!needsUpdate) {
                    processed++;
                    syncedIds.add(row.image_name);
                    continue;
                }

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

                if (!existing) {
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

        if (currentBatch.length > 0) {
            // Lazy Board Creation
            if (options.syncBoards) {
                const { upsertCollection } = await import('../db/collectionRepo');
                const batchBoardIds = new Set(currentBatch.map(img => img.boardId).filter(id => id && !createdBoardIds.has(id)));
                for (const bId of batchBoardIds) {
                    const boardInfo = boards.get(bId!);
                    if (boardInfo) {
                        await upsertCollection({
                            id: bId!,
                            name: boardInfo.name,
                            createdAt: boardInfo.createdAt || Date.now(),
                            source: 'invoke'
                        });
                        createdBoardIds.add(bId!);
                    }
                }
            }

            await insertImagesBatch(currentBatch);

            // Incremental Linking
            if (options.syncBoards) {
                const { syncCollectionImages } = await import('../db/imageRepo');
                await syncCollectionImages(currentBatch.map(img => img.id));
            }
        }
        offset += rows.length;
        onProgress(Math.min(processed, totalToImport), totalToImport, `Importing: ${Math.min(processed, totalToImport)} / ${totalToImport}`);
        await new Promise(r => setTimeout(r, 0));
    }

    // Final cleanup / sync (optional fallback)
    if (options.syncBoards && boards.size > 0) {
        // We've already done incremental sync, but this ensures everything is correct
        // especially for images that might have been updated/synced without being in a new batch
        const { syncCollectionImages } = await import('../db/imageRepo');
        await syncCollectionImages();
    }

    return { imported: newImportedCount, updated: totalUpdated, maxTimestamp: maxTimestampNum, syncedIds, boardMapping: boards };
};
