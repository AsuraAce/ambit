import Database from '@tauri-apps/plugin-sql';

interface BoardRow {
    board_id: string;
    board_name: string;
    created_at: string;
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

export async function fetchBoardMappings(db: Database): Promise<{ imageToBoardId: Map<string, string>, boards: Map<string, { name: string, createdAt: number }> }> {
    const imageToBoardId = new Map<string, string>();
    const boards = new Map<string, { name: string, createdAt: number }>();

    try {
        const boardsRows = await db.select<BoardRow[]>("SELECT board_id, board_name, created_at FROM boards");
        boardsRows.forEach((b) => {
            const timeRaw = b.created_at.includes('Z') ? b.created_at : b.created_at + ' Z';
            const timestamp = new Date(timeRaw).getTime();
            boards.set(b.board_id, { name: b.board_name, createdAt: timestamp });
        });

        const images = await db.select<BoardImageRow[]>("SELECT image_name, board_id FROM board_images");
        for (const img of images) {
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
