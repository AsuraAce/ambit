import Database from '@tauri-apps/plugin-sql';
import {
    commands,
    type InvokeImageReferenceSet,
    type InvokeImageSourceUpdate,
} from '../../bindings';
import { getInvokePathIdentity } from './pathIdentity';
import { unwrap } from '../../utils/spectaUtils';
import { createInvokeImagePathResolver } from './pathResolver';
import { extractInvokeImageReferences } from './referenceExtractor';
import { invokeOwnerPredicate, type InvokeSyncScope } from './syncScope';
import type { StartupRepairCollector } from '../../utils/startupRepairDiagnostics';

interface InvokeSourceIdentityRow {
    source_rowid?: number;
    image_name: string;
    image_subfolder?: string | null;
    user_id: string | null;
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
    diagnostics?: StartupRepairCollector;
}

const BATCH_SIZE = 500;

const pathKey = (path: string): string => getInvokePathIdentity(path);

const claimPath = (identities: Map<string, string | null>, path: string, sourceIdentity: string): void => {
    const key = pathKey(path);
    if (!identities.has(key)) {
        identities.set(key, sourceIdentity);
    } else if (identities.get(key) !== sourceIdentity) {
        identities.set(key, null);
    }
};

const claimOwnerId = (
    owners: Map<string, string | null>,
    identity: string,
    ownerId: string | null
): void => {
    if (!owners.has(identity)) {
        owners.set(identity, ownerId);
    } else if (owners.get(identity) !== ownerId) {
        owners.set(identity, null);
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
    diagnostics,
}: ReconcileInvokeSourceFactsOptions): Promise<number> => {
    diagnostics?.stage('setup');
    const setupDone = diagnostics?.start('setup');
    if (scope.mode === 'owner' && !columns.has('user_id')) {
        throw new Error('This InvokeAI database cannot enforce the selected owner because images.user_id is missing.');
    }
    const hasImageSubfolder = columns.has('image_subfolder');
    const subfolderSelect = hasImageSubfolder ? ', i.image_subfolder' : '';
    const fallbackOrderBy = `i.image_name ASC${hasImageSubfolder ? ', i.image_subfolder ASC' : ''}`;
    const ownerPredicate = invokeOwnerPredicate(scope, 'i');
    const whereClause = ownerPredicate.clause ? `WHERE ${ownerPredicate.clause}` : '';
    onProgress(0, 0, 'Indexing InvokeAI image files...');
    const [identityCountRow] = await db.select<Array<{ count: number }>>(
        'SELECT count(*) as count FROM images i'
    );
    const [factCountRow] = await db.select<Array<{ count: number }>>(
        `SELECT count(*) as count FROM images i ${whereClause}`,
        ownerPredicate.params
    );
    const identityTotal = identityCountRow?.count ?? 0;
    const total = factCountRow?.count ?? 0;
    const useRowId = await supportsImageRowId(db);
    setupDone?.();
    const cursorWhereClause = ownerPredicate.clause
        ? `WHERE ${ownerPredicate.clause} AND i.rowid > ?`
        : 'WHERE i.rowid > ?';

    const canonicalPathIdentities = new Map<string, string | null>();
    const canonicalPaths = new Map<string, string>();
    const legacyPathIdentities = new Map<string, string | null>();
    const legacyPaths = new Map<string, string>();
    const legacyTargets = new Map<string, string | null>();
    const ownerIdBySourceIdentity = new Map<string, string | null>();
    let identityProcessed = 0;
    let identityCursor = 0;
    let identityOffset = 0;
    const identityStartedAt = performance.now();
    diagnostics?.stage('identity');

    while (identityProcessed < identityTotal) {
        throwIfAborted(signal);
        const readDone = diagnostics?.start('identity-read');
        const rows = await db.select<InvokeSourceIdentityRow[]>(`
            SELECT i.image_name${subfolderSelect},
                   ${columns.has('user_id') ? 'CAST(i.user_id AS TEXT)' : 'NULL'} AS user_id
                   ${useRowId ? ', i.rowid AS source_rowid' : ''}
            FROM images i
            ${useRowId ? 'WHERE i.rowid > ?' : ''}
            ORDER BY ${useRowId ? 'i.rowid ASC' : fallbackOrderBy}
            LIMIT ${BATCH_SIZE}${useRowId ? '' : ` OFFSET ${identityOffset}`}
        `, useRowId ? [identityCursor] : []);
        readDone?.();
        diagnostics?.count('identityRows', rows.length);
        if (rows.length === 0) break;

        const pathsDone = diagnostics?.start('identity-paths');
        const resolvedPaths = await Promise.all(rows.map(row =>
            pathResolver.resolveImagePath(row.image_name, row.image_subfolder)
        ));
        pathsDone?.();
        const matchingDone = diagnostics?.start('identity-matching');
        rows.forEach((row, index) => {
            const resolved = resolvedPaths[index];
            if (!resolved.absolutePath || resolved.ambiguous) return;

            const sourceIdentity = pathKey(resolved.absolutePath);
            claimOwnerId(ownerIdBySourceIdentity, sourceIdentity, row.user_id?.trim() || null);
            claimPath(canonicalPathIdentities, resolved.absolutePath, sourceIdentity);
            canonicalPaths.set(pathKey(resolved.absolutePath), resolved.absolutePath);
            const legacyPath = pathResolver.getLegacyFlatImagePath(row.image_name);
            if (legacyPath && pathKey(legacyPath) !== pathKey(resolved.absolutePath)) {
                claimPath(legacyPathIdentities, legacyPath, sourceIdentity);
                legacyPaths.set(pathKey(legacyPath), legacyPath);
                claimLegacyTarget(legacyTargets, legacyPath, resolved.absolutePath);
            }
        });
        matchingDone?.();

        identityProcessed += rows.length;
        onProgress(
            Math.min(identityProcessed, identityTotal),
            identityTotal,
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
        const yieldDone = diagnostics?.start('batch-yield');
        await new Promise(resolve => setTimeout(resolve, 0));
        yieldDone?.();
    }
    console.info(`[InvokeAI] Image-location mapping completed in ${Math.round(performance.now() - identityStartedAt)}ms.`);

    diagnostics?.stage('legacy-paths');
    const aliasesDone = diagnostics?.start('inventory-build');
    const aliasCandidates = Array.from(legacyPathIdentities.entries())
        .map(([legacyKey, sourceIdentity]) => ({
            legacyKey,
            legacyPath: legacyPaths.get(legacyKey),
            canonicalPath: legacyTargets.get(legacyKey),
            sourceIdentity,
        }))
        .filter((candidate): candidate is {
            legacyKey: string;
            legacyPath: string;
            canonicalPath: string;
            sourceIdentity: string;
        } => (
            candidate.sourceIdentity !== null
            && !!candidate.legacyPath
            && !!candidate.canonicalPath
            && !canonicalPathIdentities.has(candidate.legacyKey)
        ));
    const pathsToVerify = Array.from(new Set(aliasCandidates.flatMap(candidate => [
        candidate.legacyPath,
        candidate.canonicalPath,
    ])));
    const missingPathKeys = new Set<string>();
    aliasesDone?.();

    if (pathsToVerify.length > 0) {
        onProgress(0, pathsToVerify.length, 'Checking legacy image locations...');
    }
    for (let offset = 0; offset < pathsToVerify.length; offset += BATCH_SIZE) {
        throwIfAborted(signal);
        diagnostics?.count('pathsChecked', Math.min(BATCH_SIZE, pathsToVerify.length - offset));
        const verifyDone = diagnostics?.start('legacy-paths');
        const missingPaths = await unwrap(commands.verifyImagePaths(
            pathsToVerify.slice(offset, offset + BATCH_SIZE)
        ));
        verifyDone?.();
        missingPaths.forEach(path => missingPathKeys.add(pathKey(path)));
        onProgress(
            Math.min(offset + BATCH_SIZE, pathsToVerify.length),
            pathsToVerify.length,
            'Checking legacy image locations...'
        );
    }

    diagnostics?.stage('inventory');
    const inventoryBuildDone = diagnostics?.start('inventory-build');
    const safeLegacyAliases = new Set(aliasCandidates
        .filter(candidate => (
            missingPathKeys.has(candidate.legacyKey)
            && !missingPathKeys.has(pathKey(candidate.canonicalPath))
        ))
        .map(candidate => candidate.legacyKey));

    const ownerInventory = Array.from(canonicalPathIdentities, ([key, sourceIdentity]) => ({
        id: canonicalPaths.get(key),
        invokeOwnerId: sourceIdentity ? (ownerIdBySourceIdentity.get(sourceIdentity) ?? null) : null,
    }))
        .filter((item): item is { id: string; invokeOwnerId: string | null } => !!item.id);
    safeLegacyAliases.forEach(key => {
        const sourceIdentity = legacyPathIdentities.get(key);
        const id = legacyPaths.get(key);
        if (sourceIdentity && id) {
            ownerInventory.push({
                id,
                invokeOwnerId: ownerIdBySourceIdentity.get(sourceIdentity) ?? null,
            });
        }
    });
    inventoryBuildDone?.();
    throwIfAborted(signal);
    diagnostics?.count('inventorySubmitted', ownerInventory.length);
    const inventoryDone = diagnostics?.start('inventory');
    const inventoryResult = await unwrap(commands.reconcileInvokeOwnerInventory({
        dbPath: scope.dbPath,
        images: ownerInventory,
    }));
    inventoryDone?.();
    diagnostics?.count('inventoryApplied', inventoryResult.activeUpdated + inventoryResult.removedUpdated);
    let updated = inventoryResult.activeUpdated + inventoryResult.removedUpdated;

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
    let factCursor = 0;
    let factOffset = 0;
    const factsStartedAt = performance.now();
    onProgress(0, total, 'Updating InvokeAI image details...');
    diagnostics?.stage('facts');

    while (processed < total) {
        throwIfAborted(signal);
        const readDone = diagnostics?.start('fact-read');
        const rows = await db.select<InvokeSourceFactRow[]>(`
            SELECT i.image_name${subfolderSelect}${categorySelect}${originSelect}${ownerSelect}${metadataSelect}${useRowId ? ', i.rowid AS source_rowid' : ''}
            FROM images i
            ${useRowId ? cursorWhereClause : whereClause}
            ORDER BY ${useRowId ? 'i.rowid ASC' : fallbackOrderBy}
            LIMIT ${BATCH_SIZE}${useRowId ? '' : ` OFFSET ${factOffset}`}
        `, useRowId ? [...ownerPredicate.params, factCursor] : ownerPredicate.params);
        readDone?.();
        diagnostics?.count('factRows', rows.length);
        if (rows.length === 0) break;

        const pathsDone = diagnostics?.start('fact-paths');
        const resolvedPaths = await Promise.all(rows.map(row =>
            pathResolver.resolveImagePath(row.image_name, row.image_subfolder)
        ));
        pathsDone?.();
        const extractionDone = diagnostics?.start('fact-extraction');
        const updatesById = new Map<string, InvokeImageSourceUpdate>();
        const referenceSetsById = new Map<string, InvokeImageReferenceSet>();

        rows.forEach((row, index) => {
            const resolved = resolvedPaths[index];
            if (!resolved.absolutePath || resolved.ambiguous) return;

            const sourceIdentity = pathKey(resolved.absolutePath);
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
            if (canonicalPathIdentities.get(canonicalKey) === sourceIdentity) {
                addUpdate(canonicalKey, resolved.absolutePath);
            }

            const legacyPath = pathResolver.getLegacyFlatImagePath(row.image_name);
            if (!legacyPath || pathKey(legacyPath) === canonicalKey) return;
            const legacyKey = pathKey(legacyPath);
            if (safeLegacyAliases.has(legacyKey) && legacyPathIdentities.get(legacyKey) === sourceIdentity) {
                addUpdate(legacyKey, legacyPath);
            }
        });
        extractionDone?.();

        throwIfAborted(signal);
        const updates = Array.from(updatesById.values());
        if (updates.length > 0) {
            diagnostics?.count('factsSubmitted', updates.length);
            const writeDone = diagnostics?.start('fact-write');
            const result = await unwrap(commands.reconcileInvokeImageSources(updates));
            writeDone?.();
            diagnostics?.count('factsApplied', result.activeUpdated + result.removedUpdated);
            updated += result.activeUpdated + result.removedUpdated;
        }
        const referenceSets = Array.from(referenceSetsById.values());
        if (referenceSets.length > 0) {
            throwIfAborted(signal);
            diagnostics?.count('referenceSetsSubmitted', referenceSets.length);
            const referencesDone = diagnostics?.start('reference-write');
            const referencesResult = await unwrap(commands.replaceInvokeImageReferences(referenceSets));
            referencesDone?.();
            diagnostics?.count('referenceSourcesReplaced', referencesResult.sourcesReplaced);
        }

        processed += rows.length;
        onProgress(Math.min(processed, total), total, 'Updating InvokeAI image details...');
        if (rows.length < BATCH_SIZE) break;
        if (useRowId) {
            const nextCursor = rows.at(-1)?.source_rowid;
            if (typeof nextCursor !== 'number') {
                throw new Error('InvokeAI source row cursor was not returned.');
            }
            factCursor = nextCursor;
        } else {
            factOffset += rows.length;
        }
        const yieldDone = diagnostics?.start('batch-yield');
        await new Promise(resolve => setTimeout(resolve, 0));
        yieldDone?.();
    }

    console.info(`[InvokeAI] Image-detail reconciliation completed in ${Math.round(performance.now() - factsStartedAt)}ms.`);

    return updated;
};
