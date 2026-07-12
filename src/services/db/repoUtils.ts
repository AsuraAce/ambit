import { convertFileSrc } from '@tauri-apps/api/core';
import { normalizePath, getFilename } from '../../utils/pathUtils';
import { AIImage, GeneratorTool, ImageMetadata, OriginalState } from '../../types';

// Lightweight column set for grid/listing views. Keep this scalar-only: large
// JSON blobs are loaded by detail/viewer flows on demand.
export const getImageFieldsLight = (alias = 'images'): string => {
    const prefix = alias ? `${alias}.` : '';
    return `
        ${prefix}id, ${prefix}path, ${prefix}width, ${prefix}height, ${prefix}file_size, ${prefix}timestamp,
        ${prefix}thumbnail_path, ${prefix}micro_thumbnail, ${prefix}thumbnail_source,
        ${prefix}is_favorite, ${prefix}is_pinned, ${prefix}is_deleted, ${prefix}is_missing, ${prefix}is_corrupt,
        ${prefix}user_masked, ${prefix}group_id, ${prefix}board_id, ${prefix}notes,
        ${prefix}is_intermediate_gen, ${prefix}is_grid_gen,
        ${prefix}model_name, ${prefix}model_hash, ${prefix}tool, ${prefix}resolved_model_name, ${prefix}file_hash,
        ${prefix}steps, ${prefix}seed, ${prefix}cfg, ${prefix}sampler, ${prefix}generation_type,
        ${prefix}positive_prompt, ${prefix}negative_prompt
    `;
};

export const getImageFieldsFull = (alias = 'images'): string => {
    const prefix = alias ? `${alias}.` : '';
    return `
        ${getImageFieldsLight(alias)},
        ${prefix}metadata_json, ${prefix}original_metadata_json, ${prefix}original_parsed_json, ${prefix}original_state_json
    `;
};

export const REMOVED_IMAGE_FIELDS = `
    id, path, width, height, file_size, timestamp, thumbnail_path, micro_thumbnail, thumbnail_source,
    is_favorite, is_pinned, 0 as is_deleted, is_missing, user_masked, group_id, board_id, notes,
    0 as is_intermediate_gen, 0 as is_grid_gen,
    original_metadata_json, original_parsed_json, original_state_json, is_corrupt, metadata_json,
    NULL as model_name, NULL as model_hash, NULL as tool, NULL as resolved_model_name, NULL as file_hash,
    NULL as steps, NULL as seed, NULL as cfg, NULL as sampler, NULL as generation_type,
    NULL as positive_prompt, NULL as negative_prompt
`;

export type ImageRow = Record<string, unknown>;

const asString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value)
        ? value
        : (typeof value === 'string' && value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined);

const asBoolean = (value: unknown): boolean =>
    value === true || value === 1 || value === '1';

const parseJson = <T>(value: unknown): T | undefined => {
    if (typeof value !== 'string' || value.length === 0) return undefined;
    return JSON.parse(value) as T;
};

const buildLightMetadata = (row: ImageRow): ImageMetadata => ({
    tool: (asString(row.tool) || GeneratorTool.UNKNOWN) as GeneratorTool,
    model: asString(row.resolved_model_name) || asString(row.model_name) || 'Unknown',
    seed: asNumber(row.seed),
    steps: asNumber(row.steps) ?? 0,
    cfg: asNumber(row.cfg) ?? 0,
    sampler: asString(row.sampler) || 'Unknown',
    positivePrompt: asString(row.positive_prompt) || '',
    negativePrompt: asString(row.negative_prompt) || '',
    modelHash: asString(row.model_hash),
    generationType: (asString(row.generation_type) || 'unknown') as ImageMetadata['generationType'],
    isGrid: asBoolean(row.is_grid_gen),
    isIntermediate: asBoolean(row.is_intermediate_gen)
});

// Helper to keep mapping consistent
export function mapRowToImage(row: ImageRow): AIImage {
    const normalizedPath = normalizePath(asString(row.path) || asString(row.id) || '');
    const thumbValue = asString(row.thumbnail_path);
    const thumbPath = thumbValue
        ? (thumbValue.startsWith('http') || thumbValue.startsWith('data:') || thumbValue.startsWith('blob:')
            ? thumbValue
            : normalizePath(thumbValue))
        : null;

    let metadata = parseJson<ImageMetadata>(row.metadata_json) || buildLightMetadata(row);

    // Ensure model/tool and prompt basics exist even for older/full rows with sparse JSON.
    metadata = {
        ...buildLightMetadata(row),
        ...metadata,
        seed: asNumber(metadata.seed) ?? asNumber(row.seed),
        model: asString(row.resolved_model_name) || metadata.model || asString(row.model_name) || 'Unknown',
        modelHash: metadata.modelHash || asString(row.model_hash),
        tool: (metadata.tool || asString(row.tool) || GeneratorTool.UNKNOWN) as GeneratorTool,
        positivePrompt: metadata.positivePrompt || asString(row.positive_prompt) || '',
        negativePrompt: metadata.negativePrompt || asString(row.negative_prompt) || ''
    };
    const originalMetadata = parseJson<ImageMetadata>(row.original_parsed_json);

    const result: AIImage = {
        id: asString(row.id) || normalizedPath,
        url: convertFileSrc(normalizedPath),
        thumbnailUrl: thumbPath ? (thumbPath.startsWith('http') || thumbPath.startsWith('data:') || thumbPath.startsWith('blob:') ? thumbPath : convertFileSrc(thumbPath)) : convertFileSrc(normalizedPath),
        microThumbnail: asString(row.micro_thumbnail),
        thumbnailSource: asString(row.thumbnail_source),
        filename: getFilename(normalizedPath),
        fileSize: asNumber(row.file_size),
        fileHash: asString(row.file_hash),
        timestamp: asNumber(row.timestamp) ?? 0,
        width: asNumber(row.width) ?? 0,
        height: asNumber(row.height) ?? 0,
        isFavorite: asBoolean(row.is_favorite),
        isPinned: asBoolean(row.is_pinned),
        isDeleted: asBoolean(row.is_deleted),
        isMissing: asBoolean(row.is_missing),
        isCorrupt: asBoolean(row.is_corrupt),
        userMasked: row.user_masked === 1 ? true : (row.user_masked === 0 ? false : undefined),
        groupId: asString(row.group_id),
        boardId: asString(row.board_id),
        notes: asString(row.notes),
        isIntermediate: asBoolean(row.is_intermediate_gen),
        metadata,
        originalChunks: parseJson<Record<string, string>>(row.original_metadata_json),
        originalMetadata: originalMetadata
            ? { ...originalMetadata, seed: asNumber(originalMetadata.seed) }
            : undefined,
        originalState: parseJson<OriginalState>(row.original_state_json)
    };

    // FALLBACK: If metadata is very sparse (missing props from json_extract usually)
    // and we have originalMetadata, use it as a base.
    // We check if it only contains the 'light' load fields (model, tool, hash).
    const isSparse = !result.metadata.positivePrompt
        && (!result.metadata.sampler || result.metadata.sampler === 'Unknown')
        && (!result.metadata.steps || result.metadata.steps === 0);
    if (isSparse && result.originalMetadata) {
        const current = result.metadata;
        result.metadata = {
            ...result.originalMetadata,
            ...current, // Overlays current sparse metadata (which might have tool/model)
            positivePrompt: current.positivePrompt || result.originalMetadata.positivePrompt,
            negativePrompt: current.negativePrompt || result.originalMetadata.negativePrompt,
            sampler: result.originalMetadata.sampler,
            steps: current.steps || result.originalMetadata.steps,
            cfg: current.cfg || result.originalMetadata.cfg,
            seed: current.seed ?? result.originalMetadata.seed
        };
    }

    return result;
}
