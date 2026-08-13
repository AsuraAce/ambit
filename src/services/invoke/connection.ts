import Database from '@tauri-apps/plugin-sql';
import type { InvokeOwnerDiscovery, InvokeOwnerSummary, InvokeSourceFingerprint } from '../../types';
import type { InvokeSyncScope } from './syncScope';

interface BoardRow {
    board_id: string;
    board_name: string;
    created_at: string;
    user_id?: string | null;
}

interface BoardImageRow {
    image_name: string;
    board_id: string | null;
}

interface CountRow {
    count: number;
}

interface TableRow {
    name: string;
}

interface FingerprintRow {
    count: number;
    updated_at?: string | null;
    max_row_id?: string | null;
}

interface OwnerRow {
    owner_id: string | null;
    display_name?: string | null;
    count: number;
    intermediate_count?: number;
}

interface CategoryRow {
    image_category?: string;
    image_origin?: string;
    is_intermediate?: number;
    count: number;
}

export interface InvokeDiagnostics {
    totalInDb: number;
    columns: string[];
    categories: CategoryRow[];
    origins: CategoryRow[];
    intermediateStatus: CategoryRow[];
    dbPath: string;
    imagesRoot: string;
    tables: Array<{ name: string; count: number | 'Error' }>;
}

export interface InvokePaths {
    dbPath: string;
    imagesRoot: string;
}

export const resolveInvokePaths = (rootPath: string): InvokePaths => {
    let imagesRoot = rootPath.replace(/\\/g, '/').replace(/\/$/, '');
    const isFile = /\.db$/i.test(imagesRoot);
    if (isFile) {
        imagesRoot = imagesRoot.replace(/\/(?:databases\/)?invokeai\.db$/i, '');
    } else if (/\/databases$/i.test(imagesRoot)) {
        imagesRoot = imagesRoot.replace(/\/databases$/i, '');
    }

    return {
        dbPath: isFile ? rootPath.replace(/\\/g, '/') : `${imagesRoot}/databases/invokeai.db`,
        imagesRoot,
    };
};

export const discoverInvokeOwners = async (rootPath: string): Promise<InvokeOwnerDiscovery> => {
    if (!rootPath) throw new Error('No InvokeAI path provided.');

    const { dbPath, imagesRoot } = resolveInvokePaths(rootPath);
    const db = await Database.load(`sqlite:${dbPath}`);
    const imageColumns = new Set(
        (await db.select<TableRow[]>('PRAGMA table_info(images)')).map(column => column.name)
    );
    if (!imageColumns.has('user_id')) {
        return { schemaMode: 'legacy', dbPath, imagesRoot, owners: [], unassignedImageCount: 0 };
    }

    const tables = new Set(
        (await db.select<TableRow[]>("SELECT name FROM sqlite_master WHERE type='table'"))
            .map(table => table.name)
    );
    let canReadDisplayNames = false;
    if (tables.has('users')) {
        const userColumns = new Set(
            (await db.select<TableRow[]>('PRAGMA table_info(users)')).map(column => column.name)
        );
        canReadDisplayNames = userColumns.has('user_id') && userColumns.has('display_name');
    }

    const intermediateCountSelect = imageColumns.has('is_intermediate')
        ? ', SUM(CASE WHEN COALESCE(i.is_intermediate, 0) = 1 THEN 1 ELSE 0 END) AS intermediate_count'
        : '';

    const ownerRows = canReadDisplayNames
        ? await db.select<OwnerRow[]>(`
            SELECT CAST(i.user_id AS TEXT) AS owner_id,
                   MAX(NULLIF(TRIM(u.display_name), '')) AS display_name,
                   count(*) AS count${intermediateCountSelect}
            FROM images i
            LEFT JOIN users u ON u.user_id = i.user_id
            GROUP BY i.user_id
            ORDER BY display_name COLLATE NOCASE, owner_id
        `)
        : await db.select<OwnerRow[]>(`
            SELECT CAST(i.user_id AS TEXT) AS owner_id, count(*) AS count${intermediateCountSelect}
            FROM images i
            GROUP BY i.user_id
            ORDER BY owner_id
        `);
    let unassignedImageCount = 0;
    let unassignedBoardCount = 0;
    const ownersById = new Map<string, InvokeOwnerSummary>();
    ownerRows.forEach(row => {
        const ownerId = row.owner_id?.trim() ?? '';
        if (!ownerId) {
            unassignedImageCount += row.count;
            return;
        }

        const existing = ownersById.get(ownerId);
        ownersById.set(ownerId, {
            ownerId,
            displayName: row.display_name?.trim() || existing?.displayName,
            imageCount: (existing?.imageCount ?? 0) + row.count,
            ...((row.intermediate_count ?? 0) > 0 ? {
                intermediateImageCount: (existing?.intermediateImageCount ?? 0) + (row.intermediate_count ?? 0),
            } : {}),
        });
    });

    if (tables.has('boards')) {
        const boardColumns = new Set(
            (await db.select<TableRow[]>('PRAGMA table_info(boards)')).map(column => column.name)
        );
        if (boardColumns.has('user_id')) {
            const boardOwnerRows = canReadDisplayNames
                ? await db.select<OwnerRow[]>(`
                    SELECT CAST(b.user_id AS TEXT) AS owner_id,
                           MAX(NULLIF(TRIM(u.display_name), '')) AS display_name,
                           count(*) AS count
                    FROM boards b
                    LEFT JOIN users u ON u.user_id = b.user_id
                    GROUP BY b.user_id
                    ORDER BY display_name COLLATE NOCASE, owner_id
                `)
                : await db.select<OwnerRow[]>(`
                    SELECT CAST(user_id AS TEXT) AS owner_id, count(*) AS count
                    FROM boards
                    GROUP BY user_id
                    ORDER BY owner_id
                `);
            boardOwnerRows.forEach(row => {
                const ownerId = row.owner_id?.trim() ?? '';
                if (!ownerId) {
                    unassignedBoardCount += row.count;
                    return;
                }
                const existing = ownersById.get(ownerId);
                ownersById.set(ownerId, {
                    ...existing,
                    ownerId,
                    displayName: row.display_name?.trim() || existing?.displayName,
                    imageCount: existing?.imageCount ?? 0,
                    boardCount: (existing?.boardCount ?? 0) + row.count,
                });
            });
        } else {
            const [row] = await db.select<CountRow[]>('SELECT count(*) AS count FROM boards');
            unassignedBoardCount = row?.count ?? 0;
        }
    }

    return {
        schemaMode: 'multi_user',
        dbPath,
        imagesRoot,
        owners: Array.from(ownersById.values()).sort((left, right) =>
            (left.displayName || left.ownerId).localeCompare(right.displayName || right.ownerId)),
        unassignedImageCount,
        unassignedBoardCount,
    };
};

const readColumns = async (db: Database, table: string): Promise<Set<string>> => new Set(
    (await db.select<TableRow[]>(`PRAGMA table_info(${table})`)).map(column => column.name)
);

const maxTimestampExpression = (columns: Set<string>): string => {
    if (columns.has('updated_at')) return 'MAX(updated_at)';
    if (columns.has('created_at')) return 'MAX(created_at)';
    return 'NULL';
};

export const readInvokeSourceFingerprint = async (
    rootPath: string,
    scope: InvokeSyncScope
): Promise<InvokeSourceFingerprint> => {
    const { dbPath } = resolveInvokePaths(rootPath);
    const db = await Database.load(`sqlite:${dbPath}`);
    const tables = new Set(
        (await db.select<TableRow[]>("SELECT name FROM sqlite_master WHERE type='table'"))
            .map(table => table.name)
    );
    const imageColumns = await readColumns(db, 'images');
    const imageOwnerClause = scope.mode === 'owner' && imageColumns.has('user_id')
        ? ' WHERE user_id = ?'
        : '';
    const ownerParams = scope.mode === 'owner' && imageColumns.has('user_id')
        ? [scope.ownerId]
        : [];
    const [image] = await db.select<FingerprintRow[]>(`
        SELECT COUNT(*) AS count, ${maxTimestampExpression(imageColumns)} AS updated_at
        FROM images${imageOwnerClause}
    `, ownerParams);

    let board: FingerprintRow = { count: 0, updated_at: null };
    let membership: FingerprintRow = { count: 0, max_row_id: null };
    if (tables.has('boards')) {
        const boardColumns = await readColumns(db, 'boards');
        const boardOwnerClause = scope.mode === 'owner' && boardColumns.has('user_id')
            ? ' WHERE user_id = ?'
            : '';
        const boardParams = scope.mode === 'owner' && boardColumns.has('user_id')
            ? [scope.ownerId]
            : [];
        [board] = await db.select<FingerprintRow[]>(`
            SELECT COUNT(*) AS count, ${maxTimestampExpression(boardColumns)} AS updated_at
            FROM boards${boardOwnerClause}
        `, boardParams);

        if (tables.has('board_images')) {
            const membershipJoin = scope.mode === 'owner' && boardColumns.has('user_id')
                ? ' INNER JOIN boards b ON b.board_id = bi.board_id AND b.user_id = ?'
                : '';
            [membership] = await db.select<FingerprintRow[]>(`
                SELECT COUNT(*) AS count, CAST(MAX(bi.rowid) AS TEXT) AS max_row_id
                FROM board_images bi${membershipJoin}
            `, boardParams);
        }
    }

    return {
        schemaVersion: 1,
        imageCount: image?.count ?? 0,
        imageUpdatedAt: image?.updated_at ?? null,
        boardCount: board?.count ?? 0,
        boardUpdatedAt: board?.updated_at ?? null,
        membershipCount: membership?.count ?? 0,
        membershipMaxRowId: membership?.max_row_id ?? null,
    };
};

export interface InvokeBoardInfo {
    name: string;
    createdAt: number;
    ownerId?: string;
}

export interface InvokeBoardMappings {
    imageToBoardId: Map<string, string>;
    boards: Map<string, InvokeBoardInfo>;
    isAuthoritative: boolean;
}

export interface InvokeBoards {
    boards: Map<string, InvokeBoardInfo>;
    isAuthoritative: boolean;
}

export async function fetchBoards(
    db: Database,
    scope: InvokeSyncScope
): Promise<InvokeBoards> {
    const boards = new Map<string, InvokeBoardInfo>();

    try {
        const boardColumns = scope.mode === 'legacy'
            ? new Set<string>()
            : new Set(
                (await db.select<TableRow[]>('PRAGMA table_info(boards)')).map(column => column.name)
            );
        if (scope.mode === 'owner' && !boardColumns.has('user_id')) {
            return { boards, isAuthoritative: false };
        }

        const ownerSelect = scope.mode !== 'legacy' && boardColumns.has('user_id')
            ? ', b.user_id'
            : '';
        const ownerClause = scope.mode === 'owner' ? 'WHERE b.user_id = ?' : '';
        const ownerParams = scope.mode === 'owner' ? [scope.ownerId] : [];
        const rows = await db.select<BoardRow[]>(`
            SELECT b.board_id, b.board_name, b.created_at${ownerSelect}
            FROM boards b
            ${ownerClause}
        `, ownerParams);

        rows.forEach(board => {
            const timeRaw = board.created_at.includes('Z') ? board.created_at : `${board.created_at} Z`;
            boards.set(board.board_id, {
                name: board.board_name,
                createdAt: new Date(timeRaw).getTime(),
                ownerId: board.user_id?.trim() || undefined,
            });
        });
        return { boards, isAuthoritative: true };
    } catch (error) {
        console.warn('Failed to fetch InvokeAI boards:', error);
        return { boards, isAuthoritative: false };
    }
}

export async function fetchBoardMappings(
    db: Database,
    scope: InvokeSyncScope
): Promise<InvokeBoardMappings> {
    const imageToBoardId = new Map<string, string>();
    const boards = new Map<string, InvokeBoardInfo>();

    try {
        const boardColumns = scope.mode === 'legacy'
            ? new Set<string>()
            : new Set(
                (await db.select<TableRow[]>('PRAGMA table_info(boards)')).map(column => column.name)
            );
        if (scope.mode === 'owner' && !boardColumns.has('user_id')) {
            console.warn('InvokeAI boards are not owner-scoped because boards.user_id is missing.');
            return { imageToBoardId, boards, isAuthoritative: false };
        }

        if (scope.mode === 'legacy') {
            const boardsRows = await db.select<BoardRow[]>('SELECT board_id, board_name, created_at FROM boards');
            boardsRows.forEach((board) => {
                const timeRaw = board.created_at.includes('Z') ? board.created_at : board.created_at + ' Z';
                boards.set(board.board_id, {
                    name: board.board_name,
                    createdAt: new Date(timeRaw).getTime(),
                });
            });
            const images = await db.select<BoardImageRow[]>('SELECT image_name, board_id FROM board_images');
            images.forEach((image) => {
                if (image.board_id) imageToBoardId.set(String(image.image_name), image.board_id);
            });
            return { imageToBoardId, boards, isAuthoritative: true };
        }

        const ownerSelect = boardColumns.has('user_id') ? ', b.user_id' : '';
        const ownerWhere = scope.mode === 'owner' ? 'WHERE b.user_id = ?' : '';
        const ownerParams = scope.mode === 'owner' ? [scope.ownerId] : [];
        const boardsRows = await db.select<BoardRow[]>(`
            SELECT b.board_id, b.board_name, b.created_at${ownerSelect}
            FROM boards b
            ${ownerWhere}
        `, ownerParams);
        boardsRows.forEach((b) => {
            const timeRaw = b.created_at.includes('Z') ? b.created_at : b.created_at + ' Z';
            const timestamp = new Date(timeRaw).getTime();
            boards.set(b.board_id, {
                name: b.board_name,
                createdAt: timestamp,
                ownerId: b.user_id?.trim() || undefined,
            });
        });

        const mappingJoin = scope.mode === 'owner'
            ? 'INNER JOIN boards b ON b.board_id = bi.board_id AND b.user_id = ?'
            : '';
        const images = await db.select<BoardImageRow[]>(`
            SELECT bi.image_name, bi.board_id
            FROM board_images bi
            ${mappingJoin}
        `, ownerParams);
        for (const img of images) {
            if (img.board_id) imageToBoardId.set(String(img.image_name), img.board_id);
        }
        return { imageToBoardId, boards, isAuthoritative: true };
    } catch (e) {
        console.warn('Failed to fetch boards/collections mapping:', e);
        imageToBoardId.clear();
        boards.clear();
    }
    return { imageToBoardId, boards, isAuthoritative: false };
}

export const testConnection = async (rootPath: string): Promise<{ success: boolean, count: number, message: string }> => {
    if (!rootPath) return { success: false, count: 0, message: "No path provided." };

    const isFile = rootPath.endsWith('.db');
    const rawCandidates = isFile ? [rootPath] : [
        `${rootPath}/databases/invokeai.db`,
        `${rootPath}\\databases\\invokeai.db`,
        `${rootPath}/invokeai.db`
    ];
    const candidates = Array.from(new Set(rawCandidates.map(path => path.replace(/\\/g, '/'))));

    for (const path of candidates) {
        try {
            const connectionString = `sqlite:${path}`;

            console.log(`[InvokeAI] Testing connection to ${connectionString}`);
            const db = await Database.load(connectionString);
            const result = await db.select<CountRow[]>('SELECT count(*) as count FROM images');
            const count = result[0]?.count || 0;

            return {
                success: true,
                count: count,
                message: `Connected! Found ${count} images.`
            };
        } catch (e: unknown) {
            console.warn(`[InvokeAI] Failed to connect to ${path}:`, e);
        }
    }

    return {
        success: false,
        count: 0,
        message: "Could not find valid 'invokeai.db' at this path."
    };
};

export const diagnoseInvokeAI = async (rootPath: string): Promise<InvokeDiagnostics | { error: string }> => {
    if (!rootPath) return { error: "No path provided." };

    const { dbPath, imagesRoot } = resolveInvokePaths(rootPath);
    const connectionString = `sqlite:${dbPath}`;

    try {
        const db = await Database.load(connectionString);
        const tableInfo = await db.select<TableRow[]>('PRAGMA table_info(images)');
        const columns = tableInfo.map((c) => c.name);

        const totalImages = (await db.select<CountRow[]>('SELECT count(*) as count FROM images'))[0]?.count ?? 0;

        const categories = columns.includes('image_category')
            ? await db.select<CategoryRow[]>('SELECT image_category, count(*) as count FROM images GROUP BY image_category')
            : [];

        const origins = columns.includes('image_origin')
            ? await db.select<CategoryRow[]>('SELECT image_origin, count(*) as count FROM images GROUP BY image_origin')
            : [];

        const intermediateStatus = columns.includes('is_intermediate')
            ? await db.select<CategoryRow[]>('SELECT is_intermediate, count(*) as count FROM images GROUP BY is_intermediate')
            : [];

        const tablesList = await db.select<TableRow[]>("SELECT name FROM sqlite_master WHERE type='table'");
        const tableCounts: Array<{ name: string; count: number | 'Error' }> = [];
        for (const t of tablesList) {
            try {
                const res = await db.select<CountRow[]>(`SELECT count(*) as count FROM ${t.name}`);
                tableCounts.push({ name: t.name, count: res[0]?.count ?? 0 });
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
    } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
};
