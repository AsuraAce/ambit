import { invoke } from '@tauri-apps/api/core';
import { AIImage, GeneratorTool } from '../../types';
import { getDb, dbMutex } from './connection';
import { mapRowToImage, IMAGE_FIELDS_LIGHT } from './repoUtils';
import { normalizePath } from '../../utils/pathUtils';

export const insertImage = async (image: AIImage) => {
    await dbMutex.dispatch(async () => {
        const db = await getDb();
        const id = normalizePath(image.id);
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
                id,
                image.width,
                image.height,
                image.fileSize,
                image.timestamp,
                JSON.stringify(image.metadata),
                normalizePath(image.thumbnailUrl?.replace(/^https?:\/\/tauri\.localhost\/_up_\//i, '') || ''),
                image.isFavorite ? 1 : 0,
                image.isPinned ? 1 : 0,
                image.isDeleted ? 1 : 0,
                image.isMissing ? 1 : 0,
                image.userMasked === true ? 1 : (image.userMasked === false ? 0 : null),
                image.groupId,
                image.boardId,
                image.notes,
                image.originalMetadata ? JSON.stringify(image.originalMetadata) : null
            ]
        );

        // Junction Table Sync
        if (image.boardId) {
            await db.execute(
                'INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)',
                [image.boardId, id]
            );
        }
    });
};

export const insertImagesBatch = async (images: AIImage[]) => {
    if (images.length === 0) return;

    await dbMutex.dispatch(async () => {
        const records = images.map(img => ({
            id: normalizePath(img.id),
            path: normalizePath(img.id),
            width: img.width,
            height: img.height,
            fileSize: img.fileSize || 0,
            timestamp: img.timestamp,
            metadataJson: JSON.stringify(img.metadata),
            thumbnailPath: normalizePath((img.thumbnailUrl || '').replace(/^https?:\/\/tauri\.localhost\/_up_\//i, '')),
            isFavorite: !!img.isFavorite,
            isPinned: !!img.isPinned,
            isDeleted: !!img.isDeleted,
            isMissing: !!img.isMissing,
            userMasked: img.userMasked === true ? true : (img.userMasked === false ? false : null),
            groupId: img.groupId || null,
            boardId: img.boardId || null,
            notes: img.notes || null,
            originalMetadataJson: img.originalMetadata ? JSON.stringify(img.originalMetadata) : null
        }));

        const CHUNK_SIZE = 5000;
        for (let i = 0; i < records.length; i += CHUNK_SIZE) {
            const chunk = records.slice(i, i + CHUNK_SIZE);
            try {
                await invoke('save_images_batch', { images: chunk });
            } catch (e) {
                console.error('[DB] Rust batch insert failed', e);
                throw e;
            }
        }
    });

    const db = await getDb();
    await db.execute('UPDATE images SET user_masked = NULL WHERE user_masked = 0');
};

export const isImageNew = async (id: string): Promise<boolean> => {
    const db = await getDb();
    const result = await db.select<any[]>(`SELECT count(*) as count FROM images WHERE id = ?`, [id]);
    return (result[0]?.count || 0) === 0;
};

export const getAllImages = async (limit?: number, offset: number = 0, prioritizePinned: boolean = false): Promise<AIImage[]> => {
    const db = await getDb();
    const orderBy = prioritizePinned ? 'ORDER BY is_pinned DESC, timestamp DESC' : 'ORDER BY timestamp DESC';

    const query = limit
        ? `SELECT ${IMAGE_FIELDS_LIGHT} FROM images WHERE is_deleted = 0 ${orderBy} LIMIT ${limit} OFFSET ${offset}`
        : `SELECT ${IMAGE_FIELDS_LIGHT} FROM images WHERE is_deleted = 0 ${orderBy}`;

    const rows = await db.select<any[]>(query);
    return rows.map(mapRowToImage);
};

export const getImagesByIds = async (ids: string[]): Promise<AIImage[]> => {
    if (ids.length === 0) return [];
    const db = await getDb();

    const CHUNK_SIZE = 900;
    let allImages: AIImage[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const query = `SELECT ${IMAGE_FIELDS_LIGHT} FROM images WHERE id IN (${placeholders})`;
        const rows = await db.select<any[]>(query, chunk);
        allImages = [...allImages, ...rows.map(mapRowToImage)];
    }

    return allImages;
};

export const getImageWithFullMetadata = async (id: string): Promise<AIImage | null> => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    const rows = await db.select<any[]>('SELECT * FROM images WHERE id = ?', [normalizedId]);
    if (rows.length === 0) return null;
    return mapRowToImage(rows[0]);
};

export const toggleImagePin = async (id: string, isPinned: boolean) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_pinned = $1 WHERE id = $2', [isPinned ? 1 : 0, normalizedId]);
};

export const toggleImageFavorite = async (id: string, isFavorite: boolean) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_favorite = $1 WHERE id = $2', [isFavorite ? 1 : 0, normalizedId]);
};

export const toggleImageMask = async (id: string, userMasked: boolean | null) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    let value: number | null = null;
    if (userMasked === true) value = 1;
    if (userMasked === false) value = 0;

    await db.execute('UPDATE images SET user_masked = $1 WHERE id = $2', [value, normalizedId]);
};

export const toggleImageIntermediate = async (id: string, isIntermediate: boolean) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);

    await db.execute(
        "UPDATE images SET metadata_json = json_set(metadata_json, '$.isIntermediate', $1) WHERE id = $2",
        [isIntermediate ? 1 : 0, normalizedId]
    );
};

export const deleteImage = async (id: string) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('DELETE FROM images WHERE id = $1', [normalizedId]);
};

export const markAsDeleted = async (ids: string[], deleted: boolean) => {
    if (ids.length === 0) return;
    const normalizedIds = ids.map(normalizePath);
    const db = await getDb();
    const placeholders = normalizedIds.map(() => '?').join(',');
    await db.execute(`UPDATE images SET is_deleted = ? WHERE id IN (${placeholders})`, [deleted ? 1 : 0, ...normalizedIds]);
};

export const updateImageWorkflow = async (id: string, workflowJson: string): Promise<void> => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    const rows = await db.select('SELECT metadata_json FROM images WHERE id = ?', [normalizedId]) as any[];
    if (rows.length === 0) return;

    try {
        const metadata = JSON.parse(rows[0].metadata_json);
        metadata.workflowJson = workflowJson;

        await db.execute('UPDATE images SET metadata_json = ? WHERE id = ?', [JSON.stringify(metadata), normalizedId]);
    } catch (e) {
        console.error('[DB] Failed to update workflow for image', normalizedId, e);
    }
};

export const updateFavorite = async (id: string, isFavorite: boolean) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_favorite = ? WHERE id = ?', [isFavorite ? 1 : 0, normalizedId]);
};

export const updatePinned = async (id: string, isPinned: boolean) => {
    const db = await getDb();
    const normalizedId = normalizePath(id);
    await db.execute('UPDATE images SET is_pinned = ? WHERE id = ?', [isPinned ? 1 : 0, normalizedId]);
};
export const updateImagesBoard = async (ids: string[], boardId: string | null) => {
    if (ids.length === 0) return;
    const db = await getDb();
    const normalizedIds = ids.map(normalizePath);
    const placeholders = normalizedIds.map(() => '?').join(',');

    await db.execute(`UPDATE images SET board_id = ? WHERE id IN (${placeholders})`, [boardId, ...normalizedIds]);

    // Junction Table Sync
    if (boardId) {
        for (const id of normalizedIds) {
            await db.execute('INSERT OR IGNORE INTO collection_images (collection_id, image_id) VALUES (?, ?)', [boardId, id]);
        }
    } else {
        // If boardId is null, we don't necessarily know which collection to remove it from in the M:N world,
        // but since board_id was 1:N, we should probably remove it from any 'invoke' source collections?
        // Actually, a simpler approach is to use the dedicated collection removal tools for manual changes.
    }
};
