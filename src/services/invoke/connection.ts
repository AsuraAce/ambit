import Database from '@tauri-apps/plugin-sql';

export async function fetchBoardMappings(db: Database): Promise<{ imageToBoardId: Map<string, string>, boards: Map<string, { name: string, createdAt: number }> }> {
    const imageToBoardId = new Map<string, string>();
    const boards = new Map<string, { name: string, createdAt: number }>();

    try {
        const boardsRows = await (db as any).select("SELECT board_id, board_name, created_at FROM boards");
        boardsRows.forEach((b: any) => {
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
        const tableInfo = await (db as any).select('PRAGMA table_info(images)');
        const columns = tableInfo.map((c: any) => c.name);

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
