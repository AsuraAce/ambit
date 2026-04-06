import { convertFileSrc } from '@tauri-apps/api/core';
import { normalizePath, getFilename } from '../../utils/pathUtils';
import { AIImage } from '../../types';
import { cleanModelName } from '../invoke/metadataMapper';

// Lightweight column set for grid/listing views
// Lightweight column set for grid/listing views
// NOTE: We EXCLUDE full metadata_json to save RAM (10KB-100KB per image).
// We rely on denormalized columns for the grid info (Model, Tool, etc.)
export const IMAGE_FIELDS_LIGHT = `
    images.id, images.path, images.width, images.height, images.file_size, images.timestamp, images.thumbnail_path, images.micro_thumbnail, images.thumbnail_source,
    images.is_favorite, images.is_pinned, images.is_deleted, images.is_missing, images.user_masked, images.group_id, images.board_id, images.notes,
    images.original_parsed_json,
    images.model_name, images.model_hash, images.tool, images.resolved_model_name
`;

// Helper to keep mapping consistent
export function mapRowToImage(row: any): AIImage {
    const normalizedPath = normalizePath(row.path);
    const thumbPath = row.thumbnail_path ? normalizePath(row.thumbnail_path) : null;

    let metadata: any = {};

    if (row.metadata_json) {
        // Full Load (Details View): Parse everything
        // We no longer strip workflowJson here, assuming if we requested the JSON, we want the data.
        metadata = JSON.parse(row.metadata_json);
    } else {
        // Light Load (Grid View): Construct sparse metadata from columns
        metadata = {
            model: row.resolved_model_name || row.model_name || 'Unknown',
            modelHash: row.model_hash,
            tool: row.tool || 'Unknown'
        };
    }

    // Ensure model is set if we have the resolved column (priority)
    if (row.resolved_model_name) {
        metadata.model = row.resolved_model_name;
    }

    const result: AIImage = {
        id: row.id,
        url: convertFileSrc(normalizedPath),
        thumbnailUrl: thumbPath ? (thumbPath.startsWith('http') || thumbPath.startsWith('data:') || thumbPath.startsWith('blob:') ? thumbPath : convertFileSrc(thumbPath)) : convertFileSrc(normalizedPath),
        microThumbnail: row.micro_thumbnail || undefined,
        thumbnailSource: row.thumbnail_source || undefined,
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
        isIntermediate: row.is_intermediate_gen === 1 || row.is_intermediate_gen === true || row.is_intermediate_gen === '1',
        metadata: metadata,
        // Populate raw chunks for re-parsing (CRITICAL for Force Refresh logic)
        originalChunks: row.original_metadata_json ? JSON.parse(row.original_metadata_json) : undefined,
        // Read the parsed baseline directly from DB - no re-parsing needed
        // This eliminates parser drift between Rust and TypeScript
        originalMetadata: row.original_parsed_json ? JSON.parse(row.original_parsed_json) : undefined,
        originalState: row.original_state_json ? JSON.parse(row.original_state_json) : undefined
    };

    // FALLBACK: If metadata is very sparse (missing props from json_extract usually)
    // and we have originalMetadata, use it as a base.
    // We check if it only contains the 'light' load fields (model, tool, hash).
    const isSparse = !result.metadata.positivePrompt && !result.metadata.sampler && (!result.metadata.steps || result.metadata.steps === 0);
    if (isSparse && result.originalMetadata) {
        result.metadata = {
            ...result.originalMetadata,
            ...result.metadata // Overlays current sparse metadata (which might have tool/model)
        };
    }

    return result;
}
