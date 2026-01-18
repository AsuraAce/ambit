import { convertFileSrc } from '@tauri-apps/api/core';
import { normalizePath, getFilename } from '../../utils/pathUtils';
import { AIImage } from '../../types';

// Lightweight column set for grid/listing views
// NOTE: We fetch full metadata_json and strip heavy fields in JS (faster than SQLite's json_remove)
export const IMAGE_FIELDS_LIGHT = `
    images.id, images.path, images.width, images.height, images.file_size, images.timestamp, images.thumbnail_path, 
    images.is_favorite, images.is_pinned, images.is_deleted, images.is_missing, images.user_masked, images.group_id, images.board_id, images.notes,
    images.metadata_json, images.original_metadata_json, images.original_state_json
`;

// Helper to keep mapping consistent
export function mapRowToImage(row: any): AIImage {
    const normalizedPath = normalizePath(row.path);
    const thumbPath = row.thumbnail_path ? normalizePath(row.thumbnail_path) : null;

    const metadata = JSON.parse(row.metadata_json || '{}');

    // Strip heavy fields in JS (much faster than SQLite's json_remove on every row)
    delete metadata.workflowJson;
    delete metadata.rawParameters;

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
        originalMetadata: row.original_metadata_json ? JSON.parse(row.original_metadata_json) : undefined,
        originalState: row.original_state_json ? JSON.parse(row.original_state_json) : undefined
    };
}
