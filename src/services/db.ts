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

export const insertImage = async (image: AIImage) => {
    const db = await getDb();
    await db.execute(
        `INSERT INTO images (id, path, width, height, file_size, timestamp, metadata_json, thumbnail_path, is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, notes, original_metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT(id) DO UPDATE SET 
            path=excluded.path,
            timestamp=excluded.timestamp, 
            file_size=excluded.file_size,
            metadata_json=excluded.metadata_json,
            thumbnail_path=excluded.thumbnail_path,
            is_favorite=excluded.is_favorite
        `,
        [
            image.id,
            image.id, // Use Full Path (stored in id) for the path column
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
            image.notes,
            image.originalMetadata ? JSON.stringify(image.originalMetadata) : null
        ]
    );
};

export const getAllImages = async (): Promise<AIImage[]> => {
    const db = await getDb();
    const rows = await db.select<any[]>('SELECT * FROM images WHERE is_deleted = 0 ORDER BY timestamp DESC');

    return rows.map(row => ({
        id: row.id,
        url: convertFileSrc(row.path),
        thumbnailUrl: row.thumbnail_path,
        filename: row.path,
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
        notes: row.notes,
        metadata: JSON.parse(row.metadata_json || '{}'),
        originalMetadata: row.original_metadata_json ? JSON.parse(row.original_metadata_json) : undefined
    }));
};
