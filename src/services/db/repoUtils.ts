import { convertFileSrc } from '@tauri-apps/api/core';
import { normalizePath, getFilename } from '../../utils/pathUtils';
import { AIImage } from '../../types';

// Helper to keep mapping consistent
export function mapRowToImage(row: any): AIImage {
    const normalizedPath = normalizePath(row.path);
    const thumbPath = row.thumbnail_path ? normalizePath(row.thumbnail_path) : null;

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
        metadata: JSON.parse(row.metadata_json || '{}'),
        originalMetadata: row.original_metadata_json ? JSON.parse(row.original_metadata_json) : undefined
    };
}
