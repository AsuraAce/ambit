import { convertFileSrc } from '@tauri-apps/api/core';
import { normalizePath, getFilename } from '../../utils/pathUtils';
import { AIImage, GeneratorTool } from '../../types';
import { mapRawInvokeMetadata, cleanModelName } from '../invoke/metadataMapper';
import { mapRawChunksToMetadata } from '../metadata/mappingUtils';

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
            try {
                const chunks = JSON.parse(row.original_metadata_json);
                let originalMeta: any;

                // Check for InvokeAI specific structure
                if (row.tool === 'InvokeAI' || chunks.invokeai_metadata || chunks['sd-metadata'] || chunks.dream_metadata || (chunks.image && chunks.image.prompt)) {
                    originalMeta = mapRawInvokeMetadata(chunks);
                } else {
                    originalMeta = mapRawChunksToMetadata(chunks, row.tool as GeneratorTool);
                }

                if (originalMeta && originalMeta.model) {
                    const originalModel = cleanModelName(originalMeta.model);
                    if (originalModel === currentModel || originalModel === resolvedModel) {
                        originalMeta.model = row.resolved_model_name;
                        // We'll pass this cached version to the return block below
                        (row as any)._preparsedOriginal = originalMeta;
                    }
                }
            } catch (e) { /* ignore */ }
        }
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
        // Only parse these if they were requested (SELECT *)
        originalMetadata: (() => {
            const pre = (row as any)._preparsedOriginal;
            if (pre) {
                if (row.has_workflow_hint !== undefined) pre.hasWorkflowHint = row.has_workflow_hint === 1 || row.has_workflow_hint === true || row.has_workflow_hint === 'true';
                return pre;
            }
            if (row.original_metadata_json) {
                let parsedJson: any;
                try {
                    parsedJson = JSON.parse(row.original_metadata_json);
                } catch (e) { return undefined; }

                // Same logic as above: detect if it looks like InvokeAI
                const isInvokeStructure = row.tool === 'InvokeAI' ||
                    parsedJson.invokeai_metadata || parsedJson['sd-metadata'] || parsedJson.dream_metadata || (parsedJson.image && parsedJson.image.prompt);

                const parsed = isInvokeStructure
                    ? mapRawInvokeMetadata(parsedJson)
                    : mapRawChunksToMetadata(parsedJson, row.tool as GeneratorTool);

                if (row.has_workflow_hint !== undefined) parsed.hasWorkflowHint = row.has_workflow_hint === 1 || row.has_workflow_hint === true || row.has_workflow_hint === 'true';
                return parsed;
            }
            return undefined;
        })(),
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
