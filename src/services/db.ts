import Database from '@tauri-apps/plugin-sql';
import { convertFileSrc } from '@tauri-apps/api/core';
import { AIImage } from '../types';

let db: Database | null = null;

export const getDb = async () => {
    if (!db) {
        db = await Database.load('sqlite:images.db');
    }
    return db;
};

export const normalizeAllPaths = async () => {
    const db = await getDb();
    console.log('[DB] Normalizing all paths to use forward slashes...');
    // Replace backslashes with forward slashes in both 'id' and 'path' columns
    // We do this for all rows where a backslash is present
    await db.execute(`
        UPDATE images 
        SET id = REPLACE(id, '\\', '/'), 
            path = REPLACE(path, '\\', '/')
        WHERE id LIKE '%\\%' OR path LIKE '%\\%'
    `);
    console.log('[DB] Path normalization complete.');
};

export const insertImage = async (image: AIImage) => {
    const db = await getDb();
    // Normalize path to forward slashes for consistency
    const id = image.id.replace(/\\/g, '/').replace(/\/+/g, '/');
    await db.execute(
        `INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes, original_metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT(id) DO UPDATE SET 
            path=excluded.path,
            timestamp=excluded.timestamp, 
            file_size=excluded.file_size,
            metadata_json=excluded.metadata_json,
            thumbnail_path=excluded.thumbnail_path,
            is_favorite=excluded.is_favorite,
            group_id=excluded.group_id,
            board_id=excluded.board_id
        `,
        [
            id,
            id, // Use Full Path (stored in id) for the path column
            image.width,
            image.height,
            image.fileSize,
            image.timestamp,
            JSON.stringify(image.metadata),
            image.thumbnailUrl,
            image.isFavorite ? 1 : 0,
            image.isPinned ? 1 : 0,
            image.isDeleted ? 1 : 0,
            image.isMissing ? 1 : 0,
            image.userMasked ? 1 : 0,
            image.groupId,
            image.boardId,
            image.notes,
            image.originalMetadata ? JSON.stringify(image.originalMetadata) : null
        ]
    );
};

export const isImageNew = async (id: string): Promise<boolean> => {
    const db = await getDb();
    const result = await db.select<any[]>(`SELECT count(*) as count FROM images WHERE id = ?`, [id]);
    return (result[0]?.count || 0) === 0;
};

export const getAllImages = async (limit?: number, offset: number = 0): Promise<AIImage[]> => {
    const db = await getDb();
    const query = limit
        ? `SELECT * FROM images WHERE is_deleted = 0 ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
        : 'SELECT * FROM images WHERE is_deleted = 0 ORDER BY timestamp DESC';

    const rows = await db.select<any[]>(query);

    return rows.map(mapRowToImage);
};

// --- New SQL-Based Search & Filtering ---

export const countImages = async (whereClause: string, params: any[]): Promise<number> => {
    const db = await getDb();
    // Ensure we don't count deleted unless explicitly asked (usually handled in whereClause generation)
    // But for safety, if whereClause is empty, we default to is_deleted=0
    const finalWhere = whereClause ? whereClause : 'WHERE is_deleted = 0';

    const query = `SELECT count(*) as count FROM images ${finalWhere}`;
    const result = await db.select<any[]>(query, params);
    return result[0]?.count || 0;
};

export const searchImages = async (
    whereClause: string,
    params: any[],
    limit: number,
    offset: number,
    sortField: string = 'timestamp',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
): Promise<AIImage[]> => {
    const db = await getDb();
    const finalWhere = whereClause ? whereClause : 'WHERE is_deleted = 0';

    const query = `
        SELECT * FROM images 
        ${finalWhere} 
        ORDER BY ${sortField} ${sortOrder} 
        LIMIT ${limit} OFFSET ${offset}
    `;

    // console.log('[DB Search]', query, params);
    const rows = await db.select<any[]>(query, params);
    return rows.map(mapRowToImage);
};

// Helper to keep mapping consistent
function mapRowToImage(row: any): AIImage {
    return {
        id: row.id,
        url: convertFileSrc(row.path),
        thumbnailUrl: row.thumbnail_path,
        filename: row.path.split(/[\\/]/).pop() || row.path, // Re-derive filename for safety
        fileSize: row.file_size,
        timestamp: row.timestamp,
        width: row.width,
        height: row.height,
        isFavorite: !!row.is_favorite,
        isPinned: !!row.is_pinned,
        isDeleted: !!row.is_deleted,
        isMissing: !!row.is_missing,
        userMasked: !!row.user_masked,
        groupId: row.group_id,
        boardId: row.board_id,
        notes: row.notes,
        metadata: JSON.parse(row.metadata_json || '{}'),
        originalMetadata: row.original_metadata_json ? JSON.parse(row.original_metadata_json) : undefined
    };
}

