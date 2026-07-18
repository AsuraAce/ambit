import Database from '@tauri-apps/plugin-sql';
import { commands, type InvokeImageSourceUpdate } from '../../bindings';
import { normalizePath } from '../../utils/pathUtils';
import { unwrap } from '../../utils/spectaUtils';
import { createInvokeImagePathResolver } from './pathResolver';

interface InvokeSourceIdentityRow {
    image_name: string;
    image_subfolder?: string | null;
}

interface InvokeSourceFactRow extends InvokeSourceIdentityRow {
    image_category: string | null;
    image_origin: string | null;
}

interface ReconcileInvokeSourceFactsOptions {
    db: Database;
    columns: ReadonlySet<string>;
    pathResolver: ReturnType<typeof createInvokeImagePathResolver>;
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

const throwIfAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) throw new Error('Aborted');
};

export const reconcileInvokeSourceFacts = async ({
    db,
    columns,
    pathResolver,
    onProgress,
    signal,
}: ReconcileInvokeSourceFactsOptions): Promise<number> => {
    const hasImageSubfolder = columns.has('image_subfolder');
    const subfolderSelect = hasImageSubfolder ? ', i.image_subfolder' : '';
    const orderBy = `i.image_name ASC${hasImageSubfolder ? ', i.image_subfolder ASC' : ''}`;
    const countRows = await db.select<Array<{ count: number }>>('SELECT count(*) as count FROM images');
    const total = countRows[0]?.count ?? 0;
    if (total === 0) return 0;

    onProgress(0, total, 'Preparing InvokeAI source reconciliation...');
    const canonicalOwners = new Map<string, string | null>();
    const legacyOwners = new Map<string, string | null>();

    for (let offset = 0; offset < total; offset += BATCH_SIZE) {
        throwIfAborted(signal);
        const rows = await db.select<InvokeSourceIdentityRow[]>(`
            SELECT i.image_name${subfolderSelect}
            FROM images i
            ORDER BY ${orderBy}
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `);
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
            }
        });
    }

    const categorySelect = columns.has('image_category')
        ? ', i.image_category'
        : ', NULL AS image_category';
    const originSelect = columns.has('image_origin')
        ? ', i.image_origin'
        : ', NULL AS image_origin';
    let processed = 0;
    let updated = 0;

    for (let offset = 0; offset < total; offset += BATCH_SIZE) {
        throwIfAborted(signal);
        const rows = await db.select<InvokeSourceFactRow[]>(`
            SELECT i.image_name${subfolderSelect}${categorySelect}${originSelect}
            FROM images i
            ORDER BY ${orderBy}
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `);
        if (rows.length === 0) break;

        const resolvedPaths = await Promise.all(rows.map(row =>
            pathResolver.resolveImagePath(row.image_name, row.image_subfolder)
        ));
        const updatesById = new Map<string, InvokeImageSourceUpdate>();

        rows.forEach((row, index) => {
            const resolved = resolvedPaths[index];
            if (!resolved.absolutePath || resolved.ambiguous) return;

            const owner = sourceKey(row);
            const updateFor = (id: string): InvokeImageSourceUpdate => ({
                id,
                invokeImageName: row.image_name,
                invokeImageCategory: row.image_category ?? null,
                invokeImageOrigin: row.image_origin ?? null,
            });
            const canonicalKey = pathKey(resolved.absolutePath);
            if (canonicalOwners.get(canonicalKey) === owner) {
                updatesById.set(canonicalKey, updateFor(resolved.absolutePath));
            }

            const legacyPath = pathResolver.getLegacyFlatImagePath(row.image_name);
            if (!legacyPath || pathKey(legacyPath) === canonicalKey) return;
            const legacyKey = pathKey(legacyPath);
            if (!canonicalOwners.has(legacyKey) && legacyOwners.get(legacyKey) === owner) {
                updatesById.set(legacyKey, updateFor(legacyPath));
            }
        });

        throwIfAborted(signal);
        const updates = Array.from(updatesById.values());
        if (updates.length > 0) {
            const result = await unwrap(commands.reconcileInvokeImageSources(updates));
            updated += result.activeUpdated + result.removedUpdated;
        }

        processed += rows.length;
        onProgress(Math.min(processed, total), total, `Reconciling sources: ${Math.min(processed, total)} / ${total}`);
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    return updated;
};
