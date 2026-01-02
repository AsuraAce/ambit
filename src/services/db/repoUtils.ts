import { convertFileSrc } from '@tauri-apps/api/core';
import { normalizePath, getFilename } from '../../utils/pathUtils';
import { AIImage } from '../../types';

// Lightweight column set for grid/listing views to avoid heavy JSON payloads
export const IMAGE_FIELDS_LIGHT = `
    id, path, width, height, file_size, timestamp, thumbnail_path, 
    is_favorite, is_pinned, is_deleted, is_missing, user_masked, group_id, board_id, notes,
    json_remove(metadata_json, '$.workflowJson', '$.rawParameters') as metadata_json
`;

// Helper to keep mapping consistent
export function mapRowToImage(row: any): AIImage {
    const normalizedPath = normalizePath(row.path);
    const thumbPath = row.thumbnail_path ? normalizePath(row.thumbnail_path) : null;

    const metadata = JSON.parse(row.metadata_json || '{}');
    if (row.resolved_model_name) {
        metadata.model = row.resolved_model_name;
    }

    return {
        id: row.id,
        url: convertFileSrc(normalizedPath),
        thumbnailUrl: thumbPath ? (thumbPath.startsWith('http') || thumbPath.startsWith('data:') || thumbPath.startsWith('blob:') ? thumbPath : convertFileSrc(thumbPath)) : convertFileSrc(normalizedPath),
        filename: getFilename(normalizedPath),
        fileSize: row.file_size,
        timestamp: row.timestamp,
        width: row.width,
        height: row.height,
        isFavorite: !!row.is_favorite,
        isPinned: !!row.is_pinned,
        isDeleted: !!row.is_deleted,
        isMissing: !!row.is_missing,
        userMasked: row.user_masked === 1 ? true : (row.user_masked === 0 ? false : undefined),
        groupId: row.group_id,
        boardId: row.board_id,
        notes: row.notes,
        metadata: metadata,
        originalMetadata: row.original_metadata_json ? JSON.parse(row.original_metadata_json) : undefined
    };
}
