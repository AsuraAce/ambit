import { convertFileSrc } from '@tauri-apps/api/core';
import { normalizePath, getFilename } from '../../utils/pathUtils';
import { AIImage } from '../../types';
import { mapRawInvokeMetadata, cleanModelName } from '../invoke/metadataMapper';

// Lightweight column set for grid/listing views
// Lightweight column set for grid/listing views
// NOTE: We EXCLUDE full metadata_json to save RAM (10KB-100KB per image).
// We rely on denormalized columns for the grid info (Model, Tool, etc.)
export const IMAGE_FIELDS_LIGHT = `
    images.id, images.path, images.width, images.height, images.file_size, images.timestamp, images.thumbnail_path, images.micro_thumbnail, images.thumbnail_source,
    images.is_favorite, images.is_pinned, images.is_deleted, images.is_missing, images.user_masked, images.group_id, images.board_id, images.notes,
    images.original_metadata_json,
    images.model_name, images.model_hash, images.tool, images.resolved_model_name,
    json_extract(images.metadata_json, '$.positivePrompt') as positive_prompt,
    json_extract(images.metadata_json, '$.negativePrompt') as negative_prompt,
    json_extract(images.metadata_json, '$.overrideModel') as override_model,
    json_extract(images.metadata_json, '$.hasWorkflowHint') as has_workflow_hint
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
            tool: row.tool || 'Unknown',
            overrideModel: row.override_model,
            positivePrompt: row.positive_prompt || '',
            negativePrompt: row.negative_prompt || '',
            hasWorkflowHint: row.has_workflow_hint === 1 || row.has_workflow_hint === true || row.has_workflow_hint === 'true'
        };
    }

    // Ensure model is set if we have the resolved column (priority)
    if (row.resolved_model_name) {
        // We clean before comparison to be safe
        const currentModel = cleanModelName(metadata.model);
        const resolvedModel = cleanModelName(row.resolved_model_name);

        metadata.model = row.resolved_model_name;

        // Propagation: If the original metadata model also matches the current raw model, 
        // we update IT as well to prevent a "modification" flag for system-level resolution.
        if (row.original_metadata_json) {
            const rawObj = JSON.parse(row.original_metadata_json);
            const isInvoke = (
                row.tool === 'InvokeAI' ||
                (typeof rawObj === 'object' && rawObj !== null && (
                    rawObj.sd || rawObj.invokeai || rawObj.invoke ||
                    (Array.isArray(rawObj) && rawObj.some((c: any) => c.sd || c.invokeai || c.invoke))
                ))
            );

            if (isInvoke) {
                // Need to parse original metadata early to compare
                const originalMeta = mapRawInvokeMetadata(rawObj);
                const originalModel = cleanModelName(originalMeta.model);

                if (originalModel === currentModel || originalModel === resolvedModel) {
                    originalMeta.model = row.resolved_model_name;
                    // We'll pass this cached version to the return block below
                    (row as any)._preparsedOriginal = originalMeta;
                }
            }
        }
    }

    return {
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
        metadata: metadata,
        // Populate raw chunks for re-parsing (CRITICAL for Force Refresh logic)
        originalChunks: row.original_metadata_json ? JSON.parse(row.original_metadata_json) : undefined,
        // Only parse these if they were requested (SELECT *)
        originalMetadata: (() => {
            const pre = (row as any)._preparsedOriginal;
            if (pre) {
                if (row.has_workflow_hint !== undefined) pre.hasWorkflowHint = row.has_workflow_hint === 1 || row.has_workflow_hint === true || row.has_workflow_hint === 'true';
                return pre;
            }
            if (row.original_metadata_json) {
                const rawObj = JSON.parse(row.original_metadata_json);
                // Resilient detection: If it looks like Invoke metadata (contains sd, invokeai, etc.),
                // we map it as such regardless of the current 'tool' column value.
                const isInvoke = (
                    row.tool === 'InvokeAI' ||
                    (typeof rawObj === 'object' && rawObj !== null && (
                        rawObj.sd || rawObj.invokeai || rawObj.invoke ||
                        (Array.isArray(rawObj) && rawObj.some((c: any) => c.sd || c.invokeai || c.invoke))
                    ))
                );

                const parsed = isInvoke
                    ? mapRawInvokeMetadata(rawObj)
                    : rawObj;

                if (row.has_workflow_hint !== undefined) {
                    parsed.hasWorkflowHint = row.has_workflow_hint === 1 || row.has_workflow_hint === true || row.has_workflow_hint === 'true';
                }
                return parsed;
            }
            return undefined;
        })(),
        originalState: row.original_state_json ? JSON.parse(row.original_state_json) : undefined
    };
}
