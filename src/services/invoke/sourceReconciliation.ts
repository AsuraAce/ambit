import Database from '@tauri-apps/plugin-sql';
import {
    commands,
    type InvokeImageReferenceSet,
    type InvokeImageSourceUpdate,
} from '../../bindings';
import { normalizePath } from '../../utils/pathUtils';
import { unwrap } from '../../utils/spectaUtils';
import { createInvokeImagePathResolver } from './pathResolver';
import { extractInvokeImageReferences } from './referenceExtractor';
import { invokeOwnerPredicate, type InvokeSyncScope } from './syncScope';

interface InvokeSourceIdentityRow {
    source_rowid?: number;
    image_name: string;
    image_subfolder?: string | null;
}

interface InvokeSourceFactRow extends InvokeSourceIdentityRow {
    image_category: string | null;
    image_origin: string | null;
    user_id: string | null;
    metadata_blob: unknown;
}

interface ReconcileInvokeSourceFactsOptions {
    db: Database;
    columns: ReadonlySet<string>;
    pathResolver: ReturnType<typeof createInvokeImagePathResolver>;
    scope: InvokeSyncScope;
    onProgress: (current: number, total: number, message?: string) => void;
    signal?: AbortSignal;
}

const BATCH_SIZE = 500;

const sourceKey = (row: InvokeSourceIdentityRow): string =>
    `${normalizePath(row.image_subfolder || '').toLowerCase()}\u0000${normalizePath(row.image_name).toLowerCase()}`;

const pathKey = (path: string): string => normalizePath(path).toLowerCase();

const claimPath = (owners: Map<string, string | null>, path: string, owner: string): void => {
    const key = pathKey(path);
    if (!owners.has(key)) {
        owners.set(key, owner);
    } else if (owners.get(key) !== owner) {
        owners.set(key, null);
    }
};

const claimLegacyTarget = (
    targets: Map<string, string | null>,
    legacyPath: string,
    canonicalPath: string
): void => {
    const legacyKey = pathKey(legacyPath);
    if (!targets.has(legacyKey)) {
        targets.set(legacyKey, canonicalPath);
        return;
    }

    const existing = targets.get(legacyKey);
    if (existing && pathKey(existing) !== pathKey(canonicalPath)) {
        targets.set(legacyKey, null);
    }
};

const throwIfAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) throw new Error('Aborted');
};

const supportsImageRowId = async (db: Database): Promise<boolean> => {
    try {
        await db.select('SELECT rowid AS source_rowid FROM images LIMIT 1');
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/no such column:\s*rowid/i.test(message)) throw error;
        console.info('[InvokeAI] Source reconciliation is using compatibility pagination.');
        return false;
    }
};

export const reconcileInvokeSourceFacts = async ({
    db,
    columns,
    pathResolver,
    scope,
    onProgress,
    signal,
}: ReconcileInvokeSourceFactsOptions): Promise<number> => {
    if (scope.mode === 'owner' && !columns.has('user_id')) {
        throw new Error('This InvokeAI database cannot enforce the selected owner because images.user_id is missing.');
    }
    const hasImageSubfolder = columns.has('image_subfolder');
    const subfolderSelect = hasImageSubfolder ? ', i.image_subfolder' : '';
    const fallbackOrderBy = `i.image_name ASC${hasImageSubfolder ? ', i.image_subfolder ASC' : ''}`;
    const ownerPredicate = invokeOwnerPredicate(scope, 'i');
    const whereClause = ownerPredicate.clause ? `WHERE ${ownerPredicate.clause}` : '';
    onProgress(0, 0, 'Indexing InvokeAI image files...');
    const countRows = await db.select<Array<{ count: number }>>(
        `SELECT count(*) as count FROM images i ${whereClause}`,
        ownerPredicate.params
    );
    const total = countRows[0]?.count ?? 0;
    if (total === 0) return 0;
    const useRowId = await supportsImageRowId(db);
    const cursorWhereClause = ownerPredicate.clause
        ? `WHERE ${ownerPredicate.clause} AND i.rowid > ?`
        : 'WHERE i.rowid > ?';

    const canonicalOwners = new Map<string, string | null>();
    const legacyOwners = new Map<string, string | null>();
    const legacyPaths = new Map<string, string>();
    const legacyTargets = new Map<string, string | null>();
    let identityProcessed = 0;
    let identityCursor = 0;
    let identityOffset = 0;
    const identityStartedAt = performance.now();

    while (identityProcessed < total) {
        throwIfAborted(signal);
        const rows = await db.select<InvokeSourceIdentityRow[]>(`
            SELECT i.image_name${subfolderSelect}${useRowId ? ', i.rowid AS source_rowid' : ''}
            FROM images i
            ${useRowId ? cursorWhereClause : whereClause}
            ORDER BY ${useRowId ? 'i.rowid ASC' : fallbackOrderBy}
            LIMIT ${BATCH_SIZE}${useRowId ? '' : ` OFFSET ${identityOffset}`}
        `, useRowId ? [...ownerPredicate.params, identityCursor] : ownerPredicate.params);
        if (rows.length === 0) break;

        const resolvedPaths = await Promise.all(rows.map(row =>
            pathResolver.resolveImagePath(row.image_name, row.image_subfolder)
        ));
        rows.forEach((row, index) => {
            const resolved = resolvedPaths[index];
            if (!resolved.absolutePath || resolved.ambiguous) return;

            const owner = sourceKey(row);
            claimPath(canonicalOwners, resolved.absolutePath, owner);
            const legacyPath = pathResolver.getLegacyFlatImagePath(row.image_name);
            if (legacyPath && pathKey(legacyPath) !== pathKey(resolved.absolutePath)) {
                claimPath(legacyOwners, legacyPath, owner);
                legacyPaths.set(pathKey(legacyPath), legacyPath);
                claimLegacyTarget(legacyTargets, legacyPath, resolved.absolutePath);
            }
        });

        identityProcessed += rows.length;
        onProgress(
            Math.min(identityProcessed, total),
            total,
            'Mapping InvokeAI image locations...'
        );
        if (rows.length < BATCH_SIZE) break;
        if (useRowId) {
            const nextCursor = rows.at(-1)?.source_rowid;
            if (typeof nextCursor !== 'number') {
                throw new Error('InvokeAI source row cursor was not returned.');
            }
            identityCursor = nextCursor;
        } else {
            identityOffset += rows.length;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    console.info(`[InvokeAI] Image-location mapping completed in ${Math.round(performance.now() - identityStartedAt)}ms.`);

    const aliasCandidates = Array.from(legacyOwners.entries())
        .map(([legacyKey, owner]) => ({
            legacyKey,
            legacyPath: legacyPaths.get(legacyKey),
            canonicalPath: legacyTargets.get(legacyKey),
            owner,
        }))
        .filter((candidate): candidate is {
            legacyKey: string;
            legacyPath: string;
            canonicalPath: string;
            owner: string;
        } => (
            candidate.owner !== null
            && !!candidate.legacyPath
            && !!candidate.canonicalPath
            && !canonicalOwners.has(candidate.legacyKey)
        ));
    const pathsToVerify = Array.from(new Set(aliasCandidates.flatMap(candidate => [
        candidate.legacyPath,
        candidate.canonicalPath,
    ])));
    const missingPathKeys = new Set<string>();

    if (pathsToVerify.length > 0) {
        onProgress(0, pathsToVerify.length, 'Checking legacy image locations...');
    }
    for (let offset = 0; offset < pathsToVerify.length; offset += BATCH_SIZE) {
        throwIfAborted(signal);
        const missingPaths = await unwrap(commands.verifyImagePaths(
            pathsToVerify.slice(offset, offset + BATCH_SIZE)
        ));
        missingPaths.forEach(path => missingPathKeys.add(pathKey(path)));
        onProgress(
            Math.min(offset + BATCH_SIZE, pathsToVerify.length),
            pathsToVerify.length,
            'Checking legacy image locations...'
        );
    }

    const safeLegacyAliases = new Set(aliasCandidates
        .filter(candidate => (
            missingPathKeys.has(candidate.legacyKey)
            && !missingPathKeys.has(pathKey(candidate.canonicalPath))
        ))
        .map(candidate => candidate.legacyKey));

    const categorySelect = columns.has('image_category')
        ? ', i.image_category'
        : ', NULL AS image_category';
    const originSelect = columns.has('image_origin')
        ? ', i.image_origin'
        : ', NULL AS image_origin';
    const ownerSelect = columns.has('user_id')
        ? ', CAST(i.user_id AS TEXT) AS user_id'
        : ', NULL AS user_id';
    const metadataSelect = columns.has('metadata_json')
        ? ', i.metadata_json AS metadata_blob'
        : (columns.has('metadata')
            ? ', i.metadata AS metadata_blob'
            : ', NULL AS metadata_blob');
    let processed = 0;
    let updated = 0;
    let factCursor = 0;
    let factOffset = 0;
    const factsStartedAt = performance.now();
    onProgress(0, total, 'Updating InvokeAI image details...');

    while (processed < total) {
        throwIfAborted(signal);
        const rows = await db.select<InvokeSourceFactRow[]>(`
            SELECT i.image_name${subfolderSelect}${categorySelect}${originSelect}${ownerSelect}${metadataSelect}${useRowId ? ', i.rowid AS source_rowid' : ''}
            FROM images i
            ${useRowId ? cursorWhereClause : whereClause}
            ORDER BY ${useRowId ? 'i.rowid ASC' : fallbackOrderBy}
            LIMIT ${BATCH_SIZE}${useRowId ? '' : ` OFFSET ${factOffset}`}
        `, useRowId ? [...ownerPredicate.params, factCursor] : ownerPredicate.params);
        if (rows.length === 0) break;

        const resolvedPaths = await Promise.all(rows.map(row =>
            pathResolver.resolveImagePath(row.image_name, row.image_subfolder)
        ));
        const updatesById = new Map<string, InvokeImageSourceUpdate>();
        const referenceSetsById = new Map<string, InvokeImageReferenceSet>();

        rows.forEach((row, index) => {
            const resolved = resolvedPaths[index];
            if (!resolved.absolutePath || resolved.ambiguous) return;

            const owner = sourceKey(row);
            const updateFor = (id: string): InvokeImageSourceUpdate => ({
                id,
                invokeImageName: row.image_name,
                invokeImageCategory: row.image_category ?? null,
                invokeImageOrigin: row.image_origin ?? null,
                invokeOwnerId: row.user_id?.trim() || null,
            });
            const extraction = extractInvokeImageReferences(row.metadata_blob);
            const addUpdate = (key: string, id: string): void => {
                updatesById.set(key, updateFor(id));
                if (extraction.status === 'valid') {
                    referenceSetsById.set(key, {
                        sourceImageId: id,
                        references: extraction.references,
                    });
                }
            };
            const canonicalKey = pathKey(resolved.absolutePath);
            if (canonicalOwners.get(canonicalKey) === owner) {
                addUpdate(canonicalKey, resolved.absolutePath);
            }

            const legacyPath = pathResolver.getLegacyFlatImagePath(row.image_name);
            if (!legacyPath || pathKey(legacyPath) === canonicalKey) return;
            const legacyKey = pathKey(legacyPath);
            if (safeLegacyAliases.has(legacyKey) && legacyOwners.get(legacyKey) === owner) {
                addUpdate(legacyKey, legacyPath);
            }
        });

        throwIfAborted(signal);
        const updates = Array.from(updatesById.values());
        if (updates.length > 0) {
            const result = await unwrap(commands.reconcileInvokeImageSources(updates));
            updated += result.activeUpdated + result.removedUpdated;
        }
        const referenceSets = Array.from(referenceSetsById.values());
        if (referenceSets.length > 0) {
            throwIfAborted(signal);
            await unwrap(commands.replaceInvokeImageReferences(referenceSets));
        }

        processed += rows.length;
        onProgress(Math.min(processed, total), total, 'Updating InvokeAI image details...');
        if (rows.length === BATCH_SIZE) {
            if (useRowId) {
                const nextCursor = rows.at(-1)?.source_rowid;
                if (typeof nextCursor !== 'number') {
                    throw new Error('InvokeAI source row cursor was not returned.');
                }
                factCursor = nextCursor;
            } else {
                factOffset += rows.length;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    console.info(`[InvokeAI] Image-detail reconciliation completed in ${Math.round(performance.now() - factsStartedAt)}ms.`);

    return updated;
};
