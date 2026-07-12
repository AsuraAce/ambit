import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc } from '@tauri-apps/api/core';
import { commands } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import { mapInvokeMetadata } from './metadataMapper';
import { fetchBoardMappings } from './connection';
import { APP_NAME } from '../../constants/app';
import { AIImage, FacetType } from '../../types';
import {
    debugLiveWatchPerf,
    elapsedMs,
    infoLiveWatchPerf,
    InvokeLiveWatchPerfContext,
    liveWatchNow,
} from '../../utils/liveWatchPerf';
import {
    collectTouchedFacetResourcesFromMetadataDiff,
    collectTouchedFacetTypesFromMetadataDiff,
    createEmptyTouchedFacetResources,
    mergeTouchedFacetResources,
    orderFacetTypes,
    TouchedFacetResources
} from '../../utils/touchedFacetTypes';
import { insertImagesBatch } from '../db';
import {
    getFlatInvokeImageIdsForRoot,
    getImagesByIds,
    ImagePathIdentityMove,
    moveImagePathIdentities,
    moveImagePathIdentity,
    syncCollectionImages
} from '../db/imageRepo';
import { upsertCollection } from '../db/collectionRepo';
import { createInvokeImagePathResolver, ResolvedInvokeImagePath } from './pathResolver';
import { getFilename, normalizePath } from '../../utils/pathUtils';

interface InvokeSyncOptions {
    syncFavorites?: boolean;
    syncBoards?: boolean;
    afterTimestamp?: number | null;
    importIntermediates?: boolean;
    starredAs?: 'favorite' | 'pin' | 'both' | 'none';
    perfContext?: InvokeLiveWatchPerfContext;
    mode?: 'manual' | 'startup' | 'live';
}

interface CountRow {
    count: number;
}

interface InvokeImageRow {
    image_name: string;
    image_subfolder?: string | null;
    metadata_blob: string | null;
    created_at: string;
    updated_at?: string | null;
    width?: number | null;
    height?: number | null;
    starred?: number | boolean | null;
    is_starred?: number | boolean | null;
    thumbnail_name?: string | null;
    has_workflow?: number | boolean | null;
    is_intermediate?: number | boolean | null;
}

interface InvokeRepairCandidate {
    legacyFlatPath: string;
    targetPath: string;
    thumbnailPath: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

export const syncImages = async (
    rootPath: string,
    onProgress: (current: number, total: number, message?: string) => void,
    signal?: AbortSignal,
    options: InvokeSyncOptions = { syncFavorites: true, syncBoards: true, importIntermediates: false, starredAs: 'favorite' }
): Promise<{ imported: number, updated: number, maxTimestamp: number | null, syncedIds: Set<string>, boardMapping: Map<string, { name: string, createdAt: number }>, touchedFacetTypes: FacetType[], touchedFacetResources: TouchedFacetResources }> => {
    console.log('[InvokeAI Sync] syncImages started with path:', rootPath);
    const syncStartedAt = liveWatchNow();
    const cycleId = options.perfContext?.cycleId;
    const logSyncDebug = (label: string, data: Record<string, unknown>) => {
        debugLiveWatchPerf(label, {
            cycleId,
            ...data
        });
    };
    const logSyncInfo = (label: string, data: Record<string, unknown>) => {
        infoLiveWatchPerf(label, {
            cycleId,
            ...data
        });
    };
    if (!rootPath) return { imported: 0, updated: 0, maxTimestamp: null, syncedIds: new Set(), boardMapping: new Map(), touchedFacetTypes: [], touchedFacetResources: createEmptyTouchedFacetResources() };

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
    let invokeDb: Database;
    const connectStartedAt = liveWatchNow();
    try {
        invokeDb = await Database.load(connectionString);
    } catch (e) {
        throw new Error(`Could not connect to InvokeAI DB at ${dbPath}`);
    }
    logSyncDebug('Invoke DB connect complete', {
        dbPath,
        connectMs: elapsedMs(connectStartedAt)
    });

    onProgress(0, 0, 'Analyzing database schema...');
    const schemaStartedAt = liveWatchNow();
    const tableInfo = await invokeDb.select<Array<{ name: string }>>('PRAGMA table_info(images)');
    const columns = tableInfo.map(c => c.name);

    const allTablesRows = await invokeDb.select<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table'");
    const allTables = allTablesRows.map(t => t.name);
    const hasGraphsTable = allTables.includes('graphs');
    logSyncDebug('Invoke DB schema analyzed', {
        schemaMs: elapsedMs(schemaStartedAt),
        columnCount: columns.length,
        tableCount: allTables.length,
        hasGraphsTable
    });

    const hasMetadataJson = columns.includes('metadata_json');
    const hasMetadata = columns.includes('metadata');
    const hasIsIntermediate = columns.includes('is_intermediate');
    const hasStarred = columns.includes('starred');
    const hasIsStarred = columns.includes('is_starred');
    const hasThumbnailName = columns.includes('thumbnail_name');
    const hasHasWorkflow = columns.includes('has_workflow');
    const hasUpdatedAt = columns.includes('updated_at');
    const hasImageSubfolder = columns.includes('image_subfolder');

    const metaCol = hasMetadataJson ? 'metadata_json' : (hasMetadata ? 'metadata' : null);

    if (!metaCol) {
        throw new Error("Could not find metadata column (checked 'metadata_json' and 'metadata')");
    }

    const conditions: string[] = [];

    // Filter out intermediates unless explicitly enabled
    if (!options.importIntermediates && hasIsIntermediate) {
        conditions.push('i.is_intermediate = 0');
    }

    if (options.afterTimestamp && options.afterTimestamp > 0) {
        const bufferedTimestamp = options.afterTimestamp;
        const isoDate = new Date(bufferedTimestamp).toISOString().replace('T', ' ').replace('Z', '');
        const timeCond = `i.created_at > '${isoDate}'`;
        if (hasUpdatedAt) {
            conditions.push(`(${timeCond} OR i.updated_at > '${isoDate}')`);
        } else {
            conditions.push(timeCond);
        }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')} ` : '';
    let totalToImport = 0;
    let hasCandidates = true;
    let boards = new Map<string, { name: string, createdAt: number }>();

    if (options.mode === 'live' || (options.mode === 'startup' && options.afterTimestamp && options.afterTimestamp > 0)) {
        const candidateCheckStartedAt = liveWatchNow();
        const candidateRes = await invokeDb.select<Array<{ found: number }>>(`SELECT 1 as found FROM images i ${whereClause} LIMIT 1`);
        hasCandidates = candidateRes.length > 0;
        logSyncDebug('Invoke candidate detection complete', {
            mode: options.mode,
            hasCandidates,
            candidateCheckMs: elapsedMs(candidateCheckStartedAt)
        });
        if (options.mode === 'startup' && !hasCandidates) {
            console.info('[Startup Catch-up] Invoke sync skipped; no candidates after saved cursor.', {
                afterTimestamp: options.afterTimestamp,
                candidateCheckMs: elapsedMs(candidateCheckStartedAt)
            });
        }
    }

    if (hasCandidates) {
        const countStartedAt = liveWatchNow();
        const countRes = await invokeDb.select<CountRow[]>(`SELECT count(*) as count FROM images i ${whereClause} `);
        totalToImport = countRes[0]?.count || 0;
        logSyncDebug('Invoke sync candidate count computed', {
            totalToImport,
            countMs: elapsedMs(countStartedAt),
            hasUpdatedAt,
            importIntermediates: options.importIntermediates ?? false
        });
    } else {
        logSyncDebug('Invoke sync candidate count computed', {
            totalToImport,
            countMs: 0,
            hasUpdatedAt,
            importIntermediates: options.importIntermediates ?? false
        });
    }

    const syncedIds = new Set<string>();
    const touchedFacetTypes = new Set<FacetType>();
    let touchedFacetResources = createEmptyTouchedFacetResources();

    onProgress(0, 0, `Scanning ${APP_NAME} library...`);
    const pathResolver = createInvokeImagePathResolver(imagesRoot, async () =>
        unwrap(commands.listInvokeaiImages(imagesRoot))
    );

    const resolveThumbnailPathsForRows = async (
        rows: InvokeImageRow[],
        resolvedPaths: ResolvedInvokeImagePath[]
    ): Promise<string[]> => {
        const candidatesByRow = rows.map((row, index) =>
            pathResolver.getThumbnailPathCandidates(
                hasThumbnailName ? row.thumbnail_name : undefined,
                resolvedPaths[index]
            )
        );
        const allCandidates = Array.from(new Set(candidatesByRow.flat()));
        let existingThumbnailPaths: Set<string> | undefined;

        if (allCandidates.length > 0) {
            try {
                const missingPaths = await unwrap(commands.verifyImagePaths(allCandidates));
                const missingSet = new Set(missingPaths.map(path => path.replace(/\\/g, '/')));
                existingThumbnailPaths = new Set(
                    allCandidates.filter(path => !missingSet.has(path.replace(/\\/g, '/')))
                );
            } catch (error) {
                console.warn('[InvokeAI Sync] Failed to verify InvokeAI thumbnail paths; using source image fallback.', error);
                existingThumbnailPaths = new Set();
            }
        }

        return resolvedPaths.map((resolvedPath, index) =>
            pathResolver.resolveThumbnailPath(
                hasThumbnailName ? rows[index].thumbnail_name : undefined,
                resolvedPath,
                existingThumbnailPaths
            ) || resolvedPath.absolutePath || ''
        );
    };

    const repairStaleInvokeImagePaths = async (): Promise<number> => {
        onProgress(0, 0, 'Repairing existing InvokeAI image paths...');
        const staleFlatPaths = await getFlatInvokeImageIdsForRoot(imagesRoot);
        if (staleFlatPaths.length === 0) return 0;

        const stalePathByName = new Map<string, string>();
        staleFlatPaths.forEach((path) => {
            const filename = getFilename(path);
            if (filename) stalePathByName.set(filename.toLowerCase(), path);
        });

        const repairConditions: string[] = [];
        if (!options.importIntermediates && hasIsIntermediate) {
            repairConditions.push('i.is_intermediate = 0');
        }
        const REPAIR_NAME_BATCH_SIZE = 500;
        const REPAIR_MOVE_BATCH_SIZE = 250;
        let repairedCount = 0;
        let matchedRows = 0;
        let relativeRowsScanned = 0;
        let skippedTargetMissing = 0;
        let skippedTargetExists = 0;
        let skippedSourceMissing = 0;
        let skippedAmbiguous = 0;
        let skippedUnresolved = 0;
        const staleNames = Array.from(stalePathByName.keys());
        const repairSelectFields = `i.image_name${hasImageSubfolder ? ', i.image_subfolder' : ''}${hasThumbnailName ? ', i.thumbnail_name' : ''}`;
        const normalizedImageNameExpr = "LOWER(REPLACE(i.image_name, '\\', '/'))";
        const repairRowsByKey = new Map<string, InvokeImageRow>();
        const matchedStaleNames = new Set<string>();
        const addRepairRows = (rows: InvokeImageRow[]) => {
            rows.forEach((row) => {
                const staleName = getFilename(row.image_name).toLowerCase();
                if (!stalePathByName.has(staleName)) return;
                matchedStaleNames.add(staleName);

                const key = [
                    normalizePath(row.image_name).toLowerCase(),
                    normalizePath(row.image_subfolder || '').toLowerCase()
                ].join('|');
                repairRowsByKey.set(key, row);
            });
        };

        for (let offset = 0; offset < staleNames.length; offset += REPAIR_NAME_BATCH_SIZE) {
            if (signal?.aborted) throw new Error('Aborted');

            const nameChunk = staleNames.slice(offset, offset + REPAIR_NAME_BATCH_SIZE);
            const placeholders = nameChunk.map(() => '?').join(',');
            const repairWhereClause = [
                `${normalizedImageNameExpr} IN (${placeholders})`,
                ...repairConditions
            ].join(' AND ');
            const repairRows = await invokeDb.select<InvokeImageRow[]>(`
                SELECT ${repairSelectFields}
                FROM images i
                WHERE ${repairWhereClause}
                ORDER BY i.created_at ASC, i.image_name ASC
            `, nameChunk);
            addRepairRows(repairRows);
        }

        if (matchedStaleNames.size < staleNames.length) {
            const relativeRepairWhereClause = [
                "instr(REPLACE(i.image_name, '\\', '/'), '/') > 0",
                ...repairConditions
            ].join(' AND ');
            const relativeRepairRows = await invokeDb.select<InvokeImageRow[]>(`
                SELECT ${repairSelectFields}
                FROM images i
                WHERE ${relativeRepairWhereClause}
                ORDER BY i.created_at ASC, i.image_name ASC
            `);
            relativeRowsScanned = relativeRepairRows.length;
            addRepairRows(relativeRepairRows);
        }

        const repairCandidates = Array.from(repairRowsByKey.values());
        matchedRows = repairCandidates.length;

        for (let offset = 0; offset < repairCandidates.length; offset += REPAIR_MOVE_BATCH_SIZE) {
            if (signal?.aborted) throw new Error('Aborted');

            const repairRows = repairCandidates.slice(offset, offset + REPAIR_MOVE_BATCH_SIZE);

            const resolvedPaths = await Promise.all(
                repairRows.map(row => pathResolver.resolveImagePath(row.image_name, row.image_subfolder))
            );
            const targetPaths = resolvedPaths
                .map(resolved => resolved.absolutePath)
                .filter((path): path is string => !!path);
            const legacyFlatPaths = repairRows.map(row =>
                stalePathByName.get(getFilename(row.image_name).toLowerCase()) as string
            );
            const lookupPaths = Array.from(new Set([
                ...targetPaths,
                ...legacyFlatPaths.filter((path): path is string => !!path)
            ]));

            let sizes: number[] = [];
            try {
                sizes = await unwrap(commands.getFileSizesBulk(targetPaths));
            } catch (error) {
                console.warn('[InvokeAI Sync] Failed to probe resolved InvokeAI paths during repair.', error);
                sizes = new Array(targetPaths.length).fill(0);
            }
            const existingImagesInBatch = await getImagesByIds(lookupPaths);
            const existingMap = new Map(existingImagesInBatch.map(img => [img.id, img]));
            const sizeByPath = new Map(targetPaths.map((path, index) => [path, sizes[index] || 0]));
            const thumbnailPaths = await resolveThumbnailPathsForRows(repairRows, resolvedPaths);
            const moves: ImagePathIdentityMove[] = [];
            const candidatesBySource = new Map<string, InvokeRepairCandidate[]>();

            for (let i = 0; i < repairRows.length; i++) {
                const resolvedPath = resolvedPaths[i];
                const targetPath = resolvedPath.absolutePath;
                const legacyFlatPath = legacyFlatPaths[i];
                if (resolvedPath.ambiguous) {
                    skippedAmbiguous++;
                    continue;
                }
                if (!targetPath || !legacyFlatPath) {
                    skippedUnresolved++;
                    continue;
                }
                if (legacyFlatPath === targetPath) {
                    skippedUnresolved++;
                    continue;
                }
                if ((sizeByPath.get(targetPath) || 0) <= 0) {
                    skippedTargetMissing++;
                    continue;
                }
                if (existingMap.has(targetPath)) {
                    skippedTargetExists++;
                    continue;
                }
                if (!existingMap.has(legacyFlatPath)) {
                    skippedSourceMissing++;
                    continue;
                }

                const thumbnailPath = thumbnailPaths[i];
                const candidates = candidatesBySource.get(legacyFlatPath) || [];
                candidates.push({ legacyFlatPath, targetPath, thumbnailPath });
                candidatesBySource.set(legacyFlatPath, candidates);
            }

            for (const candidates of candidatesBySource.values()) {
                const targetPathsForSource = new Set(candidates.map(candidate => candidate.targetPath));
                if (targetPathsForSource.size > 1) {
                    skippedAmbiguous += candidates.length;
                    continue;
                }

                const candidate = candidates[0];
                moves.push({
                    oldId: candidate.legacyFlatPath,
                    newId: candidate.targetPath,
                    thumbnailPath: candidate.thumbnailPath,
                    thumbnailSource: candidate.thumbnailPath === candidate.targetPath ? null : 'invokeai'
                });
            }

            if (moves.length > 0) {
                const moveResult = await moveImagePathIdentities(moves);
                repairedCount += moveResult.moved;
                skippedTargetExists += moveResult.skippedTargetExists;
                skippedSourceMissing += moveResult.skippedSourceMissing;

                for (const move of moves.slice(0, moveResult.moved)) {
                    const legacyExisting = existingMap.get(move.oldId) as AIImage;
                    existingMap.delete(move.oldId);
                    existingMap.set(move.newId, { ...legacyExisting, id: move.newId });
                }
            }

            console.info('[InvokeAI Sync] Stale InvokeAI path repair batch complete.', {
                staleFlatRows: staleFlatPaths.length,
                matchedRows,
                relativeRowsScanned,
                queuedMoves: moves.length,
                repairedCount,
                skippedTargetExists,
                skippedTargetMissing,
                skippedSourceMissing,
                skippedAmbiguous,
                skippedUnresolved
            });
            await new Promise(r => setTimeout(r, 0));
        }

        console.info('[InvokeAI Sync] Stale InvokeAI path repair complete.', {
            staleFlatRows: staleFlatPaths.length,
            matchedRows,
            relativeRowsScanned,
            repairedCount,
            skippedTargetExists,
            skippedTargetMissing,
            skippedSourceMissing,
            skippedAmbiguous,
            skippedUnresolved
        });
        return repairedCount;
    };

    let repairedExistingCount = 0;
    const shouldRepairExistingPaths = (options.mode ?? 'manual') === 'manual';
    if (shouldRepairExistingPaths) {
        repairedExistingCount = await repairStaleInvokeImagePaths();
    }

    if (totalToImport === 0) {
        logSyncInfo('Invoke sync service complete', {
            totalToImport,
            importedCount: 0,
            updatedCount: repairedExistingCount,
            batchCount: 0,
            totalMs: elapsedMs(syncStartedAt)
        });
        return { imported: 0, updated: repairedExistingCount, maxTimestamp: options.afterTimestamp || 0, syncedIds, boardMapping: options.syncBoards ? boards : new Map(), touchedFacetTypes: [], touchedFacetResources: createEmptyTouchedFacetResources() };
    }

    let hasBoardsTable = false;
    try {
        const boardsTable = await invokeDb.select<Array<{ name: string }>>("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'");
        hasBoardsTable = boardsTable.length > 0;
    } catch (e) { }

    let imageToBoardId = new Map<string, string>();
    if (options.syncBoards && hasBoardsTable) {
        onProgress(0, 0, 'Fetching board mappings...');
        const boardMappingStartedAt = liveWatchNow();
        const result = await fetchBoardMappings(invokeDb);
        imageToBoardId = result.imageToBoardId;
        boards = result.boards;
        logSyncDebug('Invoke board mappings loaded', {
            boardCount: boards.size,
            imageBoardLinks: imageToBoardId.size,
            boardMappingMs: elapsedMs(boardMappingStartedAt)
        });
    }

    let processed = 0;
    let newImportedCount = 0;
    let totalUpdated = repairedExistingCount;
    const BATCH_SIZE = 500;
    let offset = 0;
    let maxTimestampNum = options.afterTimestamp || 0;

    const favCol = hasStarred ? ', i.starred' : (hasIsStarred ? ', i.is_starred' : '');
    const thumbCol = hasThumbnailName ? ', i.thumbnail_name' : '';
    const hasWfCol = hasHasWorkflow ? ', i.has_workflow' : '';
    const updatedCol = hasUpdatedAt ? ', i.updated_at' : '';
    const intermediateCol = hasIsIntermediate ? ', i.is_intermediate' : '';
    const imageSubfolderCol = hasImageSubfolder ? ', i.image_subfolder' : '';

    const createdBoardIds = new Set<string>();
    let batchCount = 0;

    while (true) {
        if (signal?.aborted) throw new Error('Aborted');

        const batchStartedAt = liveWatchNow();
        const batchIndex = batchCount + 1;
        const metaSelect = `i.${metaCol} as metadata_blob`;
        const query = `
            SELECT i.image_name, ${metaSelect}, i.created_at, i.width, i.height ${favCol} ${thumbCol} ${hasWfCol} ${updatedCol} ${intermediateCol} ${imageSubfolderCol}
            FROM images i
            ${whereClause}
            ORDER BY i.created_at ASC, ${hasUpdatedAt ? 'i.updated_at ASC' : 'i.image_name ASC'}
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
`;

        const batchQueryStartedAt = liveWatchNow();
        const rows = await invokeDb.select<InvokeImageRow[]>(query);
        const batchQueryMs = elapsedMs(batchQueryStartedAt);
        if (rows.length === 0) break;
        batchCount++;

        const resolvedPaths = await Promise.all(rows.map((row) => pathResolver.resolveImagePath(row.image_name, row.image_subfolder)));
        const thumbnailPaths = await resolveThumbnailPathsForRows(rows, resolvedPaths);
        const batchPaths = resolvedPaths
            .map((resolved) => resolved.absolutePath)
            .filter((path): path is string => !!path);
        const legacyFlatPaths = rows.map((row) => pathResolver.getLegacyFlatImagePath(row.image_name));
        const lookupPaths = Array.from(new Set([
            ...batchPaths,
            ...legacyFlatPaths.filter((path): path is string => !!path)
        ]));

        let sizes: number[] = [];
        const fileSizeProbeStartedAt = liveWatchNow();
        if (batchPaths.length > 0) {
            try {
                sizes = await unwrap(commands.getFileSizesBulk(batchPaths));
            } catch (e) {
                sizes = new Array(batchPaths.length).fill(0);
            }
        }
        const fileSizeProbeMs = elapsedMs(fileSizeProbeStartedAt);

        const existingLookupStartedAt = liveWatchNow();
        const existingImagesInBatch = await getImagesByIds(lookupPaths);
        const existingMap = new Map(existingImagesInBatch.map(img => [img.id, img]));
        const sizeByPath = new Map(batchPaths.map((path, index) => [path, sizes[index] || 0]));
        const existingLookupMs = elapsedMs(existingLookupStartedAt);

        const currentBatch: AIImage[] = [];
        const batchBuildStartedAt = liveWatchNow();
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const resolvedPath: ResolvedInvokeImagePath = resolvedPaths[i];
            if (!resolvedPath.absolutePath) {
                processed++;
                continue;
            }

            const fullPath = resolvedPath.absolutePath;
            const fileSize = sizeByPath.get(fullPath) || 0;
            const legacyFlatPath = legacyFlatPaths[i];
            let pathRepaired = false;

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
                let existing = existingMap.get(fullPath);
                if (!existing && legacyFlatPath && legacyFlatPath !== fullPath) {
                    const legacyExisting = existingMap.get(legacyFlatPath);
                    if (legacyExisting) {
                        const repairedThumbnailPath = thumbnailPaths[i];
                        pathRepaired = await moveImagePathIdentity(
                            legacyFlatPath,
                            fullPath,
                            repairedThumbnailPath,
                            repairedThumbnailPath === fullPath ? null : 'invokeai'
                        );

                        if (pathRepaired) {
                            existing = {
                                ...legacyExisting,
                                id: fullPath,
                                url: convertFileSrc(fullPath),
                                thumbnailUrl: repairedThumbnailPath,
                                thumbnailSource: repairedThumbnailPath === fullPath ? undefined : 'invokeai',
                                filename: row.image_name.split(/[\\/]/).pop() as string,
                                isMissing: false
                            };
                            existingMap.set(fullPath, existing);
                        }
                    }
                }

                if (options.syncFavorites && options.starredAs && options.starredAs !== 'none') {
                    const isStarredInInvoke = (hasStarred && (row.starred === 1 || row.starred === true)) ||
                        (hasIsStarred && (row.is_starred === 1 || row.is_starred === true));

                    if (existing) {
                        // SMART SYNC: Check if user has modified from original state
                        // CRITICAL: For legacy images without originalState, preserve Ambit's current values
                        // (we can't know if user modified them, so assume they did)
                        if (!existing.originalState) {
                            // Legacy image - preserve current Ambit values
                            isFavorite = existing.isFavorite;
                            isPinned = existing.isPinned || false;
                        } else {
                            // Has originalState - can check for modifications
                            const userModifiedFavorite = existing.isFavorite !== existing.originalState.isFavorite;
                            const userModifiedPinned = (existing.isPinned || false) !== (existing.originalState.isPinned || false);

                            if (userModifiedFavorite) {
                                // User explicitly changed it - preserve their choice
                                isFavorite = existing.isFavorite;
                            } else {
                                // User hasn't touched it - apply InvokeAI's current value
                                const mode = options.starredAs;
                                if (isStarredInInvoke && (mode === 'favorite' || mode === 'both')) isFavorite = true;
                            }

                            if (userModifiedPinned) {
                                isPinned = existing.isPinned || false;
                            } else {
                                const mode = options.starredAs;
                                if (isStarredInInvoke && (mode === 'pin' || mode === 'both')) isPinned = true;
                            }
                        }
                    } else {
                        // New image - apply InvokeAI's starred value directly
                        if (isStarredInInvoke) {
                            const mode = options.starredAs;
                            if (mode === 'favorite' || mode === 'both') isFavorite = true;
                            if (mode === 'pin' || mode === 'both') isPinned = true;
                        }
                    }
                } else if (existing) {
                    isFavorite = existing.isFavorite;
                    isPinned = existing.isPinned || false;
                }

                // Determine board with smart sync
                const invokeBoard = options.syncBoards ? imageToBoardId.get(row.image_name) : undefined;
                let boardId: string | undefined;

                if (existing) {
                    // SMART SYNC: Check if user has modified board from original state
                    // CRITICAL: For legacy images without originalState, preserve Ambit's current board
                    if (!existing.originalState) {
                        // Legacy image - preserve current Ambit board
                        boardId = existing.boardId;
                    } else {
                        const userModifiedBoard = existing.boardId !== existing.originalState.boardId;

                        if (userModifiedBoard) {
                            // User explicitly changed it - preserve their choice
                            boardId = existing.boardId;
                        } else if (options.syncBoards) {
                            // User hasn't touched it - apply InvokeAI's current value
                            boardId = invokeBoard;
                        } else {
                            boardId = existing.boardId;
                        }
                    }
                } else {
                    // New image
                    boardId = invokeBoard;
                }

                let needsUpdate = false;
                if (!existing) {
                    needsUpdate = true;
                } else {
                    // CRITICAL: If image is missing raw original chunks, we NEED to update it 
                    // to backfill the data required for Refresh Metadata to work.
                    // Also check if existing originalMetadata looks like it was accidentally mapped already
                    // (Raw InvokeAI uses positive_prompt, while mapped uses positivePrompt)
                    const isMissingRaw = !existing.originalMetadata && !existing.originalChunks;

                    // We can inspect the raw chunks if they exist
                    let formatLooksMapped = false;
                    const rawChunkValue = existing.originalChunks?.invokeai_metadata;
                    if (rawChunkValue) {
                        const parsedMeta: unknown = typeof rawChunkValue === 'string'
                            ? JSON.parse(rawChunkValue)
                            : rawChunkValue;
                        const meta = isRecord(parsedMeta) ? parsedMeta : {};

                        // If it has positivePrompt (camelCase) it's already mapped data, not truly raw
                        // Check for both snake_case and camelCase to determine if it's already mapped
                        if ((meta.positivePrompt !== undefined && meta.positive_prompt === undefined) ||
                            (meta.negativePrompt !== undefined && meta.negative_prompt === undefined)) {
                            formatLooksMapped = true;
                        }
                    }

                    if (isMissingRaw || formatLooksMapped) needsUpdate = true;

                    // Only update if favorite, pin, or board changed
                    if (isFavorite !== existing.isFavorite) needsUpdate = true;
                    if (isPinned !== (existing.isPinned || false)) needsUpdate = true;
                    if (boardId !== existing.boardId) needsUpdate = true;
                }

                if (!needsUpdate) {
                    if (pathRepaired) totalUpdated++;
                    processed++;
                    syncedIds.add(row.image_name);
                    syncedIds.add(resolvedPath.relativePath as string);
                    continue;
                }

                const thumbnailPath = thumbnailPaths[i];

                // Capture originalState for new images (InvokeAI import-time values)
                const isStarredInInvoke = (hasStarred && (row.starred === 1 || row.starred === true)) ||
                    (hasIsStarred && (row.is_starred === 1 || row.is_starred === true));
                const originalState = existing?.originalState || {
                    isFavorite: isStarredInInvoke && options.starredAs !== 'none' && (options.starredAs === 'favorite' || options.starredAs === 'both'),
                    isPinned: isStarredInInvoke && options.starredAs !== 'none' && (options.starredAs === 'pin' || options.starredAs === 'both'),
                    boardId: invokeBoard
                };

                // For existing images: preserve metadata (user edits are sacred)
                // For new images: use freshly parsed metadata
                const finalMetadata = existing ? existing.metadata : metadata;
                const finalOriginalMetadata = existing?.originalMetadata || (existing ? existing.metadata : metadata);

                // Ensure we store the RAW object, not a string, to avoid double-stringification
                const rawInvokeMeta = row.metadata_blob
                    ? (typeof row.metadata_blob === 'string' ? JSON.parse(row.metadata_blob) : row.metadata_blob)
                    : {};

                // Inject the hint status so it survives in original chunks/originalMetadata
                if (hasHasWorkflow && row.has_workflow !== undefined) {
                    rawInvokeMeta.has_workflow = !!row.has_workflow;
                }

                const newImg: AIImage = {
                    id: fullPath,
                    url: convertFileSrc(fullPath),
                    thumbnailUrl: thumbnailPath,
                    thumbnailSource: thumbnailPath === fullPath ? undefined : 'invokeai',
                    filename: row.image_name.split(/[\\/]/).pop() as string,
                    fileSize: fileSize,
                    timestamp: timestamp || Date.now(),
                    width: row.width || 0,
                    height: row.height || 0,
                    isFavorite,
                    isPinned,
                    isDeleted: existing?.isDeleted || false,
                    isMissing: false,
                    boardId: boardId,
                    notes: existing?.notes, // Preserve user notes
                    metadata: finalMetadata,
                    originalMetadata: finalOriginalMetadata,
                    originalChunks: {
                        'invokeai_metadata': rawInvokeMeta
                    },
                    originalState: originalState
                };

                if (!existing) {
                    newImportedCount++;
                } else {
                    totalUpdated++;
                }

                collectTouchedFacetTypesFromMetadataDiff(existing?.metadata, finalMetadata).forEach(type => {
                    touchedFacetTypes.add(type);
                });
                touchedFacetResources = mergeTouchedFacetResources(
                    touchedFacetResources,
                    collectTouchedFacetResourcesFromMetadataDiff(existing?.metadata, finalMetadata)
                );

                currentBatch.push(newImg);
                syncedIds.add(row.image_name);
                syncedIds.add(resolvedPath.relativePath as string);
                processed++;
            } catch (e) { }
        }
        const batchBuildMs = elapsedMs(batchBuildStartedAt);

        let boardCreateMs = 0;
        let insertMs = 0;
        let collectionSyncMs = 0;
        if (currentBatch.length > 0) {
            // Lazy Board Creation
            if (options.syncBoards) {
                const boardCreateStartedAt = liveWatchNow();
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
                boardCreateMs = elapsedMs(boardCreateStartedAt);
            }

            const insertStartedAt = liveWatchNow();
            await insertImagesBatch(currentBatch);
            insertMs = elapsedMs(insertStartedAt);

            // Incremental Linking
            if (options.syncBoards) {
                const collectionSyncStartedAt = liveWatchNow();
                await syncCollectionImages(currentBatch.map(img => img.id));
                collectionSyncMs = elapsedMs(collectionSyncStartedAt);
            }
        }
        logSyncDebug('Invoke sync batch complete', {
            batchIndex,
            rowCount: rows.length,
            upsertCount: currentBatch.length,
            queryMs: batchQueryMs,
            fileSizeProbeMs,
            existingLookupMs,
            batchBuildMs,
            boardCreateMs,
            insertMs,
            collectionSyncMs,
            batchMs: elapsedMs(batchStartedAt)
        });
        offset += rows.length;
        onProgress(Math.min(processed, totalToImport), totalToImport, `Importing: ${Math.min(processed, totalToImport)} / ${totalToImport}`);
        await new Promise(r => setTimeout(r, 0));
    }

    // Final cleanup / sync (optional fallback)
    if (options.syncBoards && boards.size > 0 && options.mode !== 'live' && options.mode !== 'startup') {
        // We've already done incremental sync, but this ensures everything is correct
        // especially for images that might have been updated/synced without being in a new batch
        const finalCollectionSyncStartedAt = liveWatchNow();
        await syncCollectionImages();
        logSyncDebug('Invoke final collection sync complete', {
            collectionSyncMs: elapsedMs(finalCollectionSyncStartedAt)
        });
    }

    logSyncInfo('Invoke sync service complete', {
        totalToImport,
        importedCount: newImportedCount,
        updatedCount: totalUpdated,
        batchCount,
        totalMs: elapsedMs(syncStartedAt)
    });

    return {
        imported: newImportedCount,
        updated: totalUpdated,
        maxTimestamp: maxTimestampNum,
        syncedIds,
        boardMapping: boards,
        touchedFacetTypes: orderFacetTypes(touchedFacetTypes),
        touchedFacetResources
    };
};
