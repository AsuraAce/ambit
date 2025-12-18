async function fetchBoardMappings(db: Database): Promise<Map<string, string>> {
    const mapping = new Map<string, string>();
    try {
        const boards = await db.select<{ board_id: string, board_name: string }[]>("SELECT board_id, board_name FROM boards");
        console.log(`[InvokeSync] Found ${boards.length} boards.`);

        const boardMap = new Map(boards.map(b => [b.board_id, b.board_name]));

        const images = await db.select<{ image_name: string, board_id: string }[]>("SELECT image_name, board_id FROM board_images");
        console.log(`[InvokeSync] Found ${images.length} board_image associations.`);

        for (const img of images) {
            const name = boardMap.get(img.board_id);
            if (name) mapping.set(img.image_name, name);
        }
        console.log(`[InvokeSync] Mapped ${mapping.size} images to boards.`);
        if (mapping.size > 0) {
            console.log(`[InvokeSync] Sample mapping: ${images[0].image_name} -> ${mapping.get(images[0].image_name)}`);
        }

    } catch (e) {
        console.warn('Failed to fetch boards/collections mapping:', e);
    }
    return mapping;
}
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

        console.log(`Attempting connection to ${connectionString}`);

        const db = await Database.load(connectionString);
        const result = await db.select<any[]>('SELECT count(*) as count FROM images');
        const count = result[0]?.count || 0;

        return {
            success: true,
            count: count,
            message: `Connected! Found ${count} images.`
        };

    } catch (e: any) {
        console.warn(`Failed to connect to ${path}:`, e);
    }
}

return {
    success: false,
    count: 0,
    message: "Could not find valid 'invokeai.db' at this path."
};
};

// --- Helper to map InvokeAI metadata to Ambit's format ---
function mapInvokeMetadata(row: any, metaCol: string): any {
    const rawVal = row[metaCol];
    if (!rawVal) return {};

    let meta: any = {};
    try {
        meta = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
    } catch (e) { return {}; }

    const mapped: any = {
        tool: 'InvokeAI',
        model: 'Unknown',
        seed: 0,
        steps: 20,
        cfg: 7,
        sampler: 'k_lms',
        positivePrompt: '',
        negativePrompt: '',
    };

    const root = meta.image || meta;

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
    }

    return mapped;
}

// --- Helper to fetch Boards Mapping ---
async function fetchBoardMappings(db: Database): Promise<Map<string, string>> {
    const mapping = new Map<string, string>();
    try {
        const boards = await db.select<{ board_id: string, board_name: string }[]>("SELECT board_id, board_name FROM boards");
        const boardMap = new Map(boards.map(b => [b.board_id, b.board_name]));

        const images = await db.select<{ image_name: string, board_id: string }[]>("SELECT image_name, board_id FROM board_images");

        for (const img of images) {
            const name = boardMap.get(img.board_id);
            if (name) mapping.set(img.image_name, name);
        }
    } catch (e) {
        console.warn('Failed to fetch boards/collections mapping:', e);
    }
    return mapping;
}

export const syncImages = async (
    rootPath: string,
    onProgress: (current: number, total: number) => void,
    signal?: AbortSignal,
    options: { syncFavorites?: boolean, syncBoards?: boolean } = { syncFavorites: true, syncBoards: true }
): Promise<number> => {
    if (!rootPath) return 0;

    // ... (connection logic remains same)
    let dbPath = rootPath;
    const isFile = rootPath.endsWith('.db');
    if (!isFile) {
        if (rootPath.endsWith('/') || rootPath.endsWith('\\')) {
            dbPath = rootPath + 'databases/invokeai.db';
        } else {
            dbPath = rootPath + '/databases/invokeai.db';
        }
    }

    // Normalize meant for SQLite URL
    const connectionString = `sqlite:${dbPath.replace(/\\/g, '/')}`;

    let invokeDb;
    try {
        invokeDb = await Database.load(connectionString);
    } catch (e) {
        throw new Error(`Could not connect to InvokeAI DB at ${dbPath}`);
    }

    // 2. Inspect Schema
    const tableInfo = await invokeDb.select<any[]>('PRAGMA table_info(images)');
    const columns = tableInfo.map(c => c.name);

    const hasMetadataJson = columns.includes('metadata_json');
    const hasMetadata = columns.includes('metadata');
    const hasIsIntermediate = columns.includes('is_intermediate');
    const hasStarred = columns.includes('starred');
    const hasIsStarred = columns.includes('is_starred');

    const metaCol = hasMetadataJson ? 'metadata_json' : (hasMetadata ? 'metadata' : null);

    if (!metaCol) {
        throw new Error("Could not find metadata column (checked 'metadata_json' and 'metadata')");
    }

    // Check for Boards
    let hasBoards = false;
    try {
        const boardsTable = await invokeDb.select<any[]>("SELECT name FROM sqlite_master WHERE type='table' AND name='boards'");
        hasBoards = boardsTable.length > 0;
    } catch (e) { }

    // Pre-fetch Boards if requested
    let boardMapping = new Map<string, string>();
    if (options.syncBoards && hasBoards) {
        boardMapping = await fetchBoardMappings(invokeDb);
    }

    console.log('[InvokeAI Schema]', { columns, hasBoards, hasStarred, hasIsStarred });

    // 3. Prepare Import Dependencies
    const { insertImage } = await import('./db');
    const { convertFileSrc } = await import('@tauri-apps/api/core');

    let imagesRoot = rootPath;
    if (isFile) {
        imagesRoot = rootPath.replace(/[\\/](databases)?[\\/]?invokeai\.db$/, '');
    }

    // 4. Count Total
    const whereClause = hasIsIntermediate ? 'WHERE is_intermediate = 0' : '';
    const countRes = await invokeDb.select<any[]>(`SELECT count(*) as count FROM images ${whereClause}`);
    const totalToImport = countRes[0]?.count || 0;

    if (totalToImport === 0) return 0;

    // 5. Batch Process
    let imported = 0;
    const BATCH_SIZE = 500;
    let offset = 0;

    // Build SELECT Query
    const favCol = hasStarred ? ', starred' : (hasIsStarred ? ', is_starred' : '');

    while (true) {
        if (signal?.aborted) throw new Error('Aborted');

        // Dynamic column selection
        const query = `
            SELECT image_name, ${metaCol}, created_at, width, height ${favCol}
            FROM images 
            ${whereClause} 
            LIMIT ${BATCH_SIZE} OFFSET ${offset}
        `;

        const rows = await invokeDb.select<any[]>(query);

        if (rows.length === 0) break;

        for (const row of rows) {
            if (signal?.aborted) throw new Error('Aborted');

            const fullPath = `${imagesRoot}/outputs/images/${row.image_name}`;

            try {
                const metadata = mapInvokeMetadata(row, metaCol);
                const timestamp = new Date(row.created_at).getTime();

                // Determine Favorites
                let isFavorite = false;
                if (options.syncFavorites) {
                    if (hasStarred && row.starred) isFavorite = true;
                    else if (hasIsStarred && row.is_starred) isFavorite = true;
                }

                // Determine Group/Collection from Board
                let groupId: string | undefined = undefined;
                if (options.syncBoards) {
                    groupId = boardMapping.get(row.image_name);
                }

                const newImg: any = {
                    id: fullPath,
                    url: convertFileSrc(fullPath),
                    thumbnailUrl: convertFileSrc(fullPath),
                    filename: row.image_name, // Usually basename
                    fileSize: 0,
                    timestamp: isNaN(timestamp) ? Date.now() : timestamp,
                    width: row.width || 0,
                    height: row.height || 0,
                    isFavorite: isFavorite,
                    isDeleted: false,
                    isMissing: false,
                    groupId: groupId, // Store Board Name as Group ID
                    metadata: metadata
                };

                await insertImage(newImg);
                imported++;
            } catch (e) {
                console.error('Failed to import image:', fullPath, e);
            }
        }

        offset += rows.length;
        onProgress(Math.min(imported, totalToImport), totalToImport);

        // Brief pause to allow UI updates
        await new Promise(r => setTimeout(r, 0));
    }

    return imported;
};
