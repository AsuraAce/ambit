import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool } from '../../../types';
import { getImageFieldsFull, getImageFieldsLight, mapRowToImage } from '../repoUtils';

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: (path: string) => `asset://${path}`,
}));

const baseLightRow = {
    id: 'C:/images/sample.png',
    path: 'C:/images/sample.png',
    width: 1024,
    height: 768,
    file_size: 123456,
    timestamp: 1700000000000,
    thumbnail_path: 'C:/thumbs/sample.webp',
    micro_thumbnail: null,
    thumbnail_source: 'ambit',
    is_favorite: 1,
    is_pinned: 0,
    is_deleted: 0,
    is_missing: 0,
    is_corrupt: 0,
    user_masked: null,
    group_id: null,
    board_id: null,
    notes: null,
    is_intermediate_gen: 0,
    is_grid_gen: 0,
    model_name: 'Fallback Model',
    model_hash: 'abc123',
    tool: GeneratorTool.COMFYUI,
    resolved_model_name: 'Resolved Model',
    steps: 28,
    seed: 0,
    cfg: 7.5,
    sampler: 'euler',
    generation_type: 'txt2img',
    positive_prompt: 'sunlit atrium',
    negative_prompt: 'low quality'
};

describe('repoUtils lightweight image rows', () => {
    it('keeps gallery field selection scalar-only', () => {
        const fields = getImageFieldsLight();

        expect(fields).toContain('images.positive_prompt');
        expect(fields).toContain('images.seed');
        expect(fields).not.toContain('metadata_json');
        expect(fields).not.toContain('original_metadata_json');
        expect(fields).not.toContain('original_parsed_json');
        expect(fields).not.toContain('original_state_json');
    });

    it('adds full metadata JSON columns only for full row selection', () => {
        const fields = getImageFieldsFull();

        expect(fields).toContain('images.positive_prompt');
        expect(fields).toContain('images.metadata_json');
        expect(fields).toContain('images.original_metadata_json');
        expect(fields).toContain('images.original_parsed_json');
        expect(fields).toContain('images.original_state_json');

        expect(getImageFieldsLight('')).toContain('id, path');
        expect(getImageFieldsFull('')).toContain('metadata_json');
    });

    it('maps prompt metadata from scalar columns without original metadata JSON', () => {
        const image = mapRowToImage(baseLightRow);

        expect(image.metadata.model).toBe('Resolved Model');
        expect(image.metadata.positivePrompt).toBe('sunlit atrium');
        expect(image.metadata.negativePrompt).toBe('low quality');
        expect(image.metadata.steps).toBe(28);
        expect(image.metadata.seed).toBe(0);
        expect(image.originalMetadata).toBeUndefined();
    });

    it('keeps an unavailable lightweight seed unknown', () => {
        const image = mapRowToImage({ ...baseLightRow, seed: null });

        expect(image.metadata.seed).toBeUndefined();
    });

    it('normalizes nullable full metadata seeds at the domain boundary', () => {
        const image = mapRowToImage({
            ...baseLightRow,
            seed: null,
            metadata_json: JSON.stringify({ seed: null }),
            original_parsed_json: JSON.stringify({ seed: null }),
        });

        expect(image.metadata.seed).toBeUndefined();
        expect(image.originalMetadata?.seed).toBeUndefined();
    });

    it('populates original metadata when full rows intentionally select it', () => {
        const originalMetadata = {
            tool: GeneratorTool.AUTOMATIC1111,
            model: 'Original Model',
            seed: 42,
            steps: 20,
            cfg: 6,
            sampler: 'dpmpp',
            positivePrompt: 'original prompt',
            negativePrompt: '',
        };

        const image = mapRowToImage({
            ...baseLightRow,
            metadata_json: JSON.stringify({ ...originalMetadata, model: 'Edited Model' }),
            original_parsed_json: JSON.stringify(originalMetadata),
        });

        expect(image.metadata.model).toBe('Resolved Model');
        expect(image.originalMetadata?.model).toBe('Original Model');
        expect(image.originalMetadata?.positivePrompt).toBe('original prompt');
    });

    it('preserves full metadata and raw originals for sync-sensitive rows', () => {
        const originalMetadata = {
            tool: GeneratorTool.INVOKEAI,
            model: 'Invoke Model',
            seed: 99,
            steps: 24,
            cfg: 5,
            sampler: 'dpmpp',
            positivePrompt: 'original invoke prompt',
            negativePrompt: '',
        };

        const image = mapRowToImage({
            ...baseLightRow,
            metadata_json: JSON.stringify({
                ...originalMetadata,
                positivePrompt: 'edited full prompt',
                workflowJson: '{"nodes":[]}',
                loras: ['detail.safetensors']
            }),
            original_metadata_json: JSON.stringify({
                invokeai_metadata: JSON.stringify({ positive_prompt: 'raw invoke prompt' })
            }),
            original_parsed_json: JSON.stringify(originalMetadata),
            original_state_json: JSON.stringify({ isFavorite: true, isPinned: false, boardId: 'board-a' })
        });

        expect(image.metadata.positivePrompt).toBe('edited full prompt');
        expect(image.metadata.workflowJson).toBe('{"nodes":[]}');
        expect(image.metadata.loras).toEqual(['detail.safetensors']);
        expect(image.originalMetadata?.positivePrompt).toBe('original invoke prompt');
        expect(image.originalChunks?.invokeai_metadata).toBe(JSON.stringify({ positive_prompt: 'raw invoke prompt' }));
        expect(image.originalState).toEqual({ isFavorite: true, isPinned: false, boardId: 'board-a' });
    });

    it('restores generation fields from original metadata when the current row is sparse', () => {
        const image = mapRowToImage({
            ...baseLightRow,
            resolved_model_name: 'Current Model',
            steps: 0,
            cfg: 0,
            sampler: '',
            positive_prompt: '',
            negative_prompt: '',
            seed: null,
            metadata_json: JSON.stringify({ tool: GeneratorTool.COMFYUI, model: 'Current Model' }),
            original_parsed_json: JSON.stringify({
                tool: GeneratorTool.INVOKEAI,
                model: 'Original Model',
                seed: '42',
                steps: 30,
                cfg: 6.5,
                sampler: 'dpmpp',
                positivePrompt: 'restored prompt',
                negativePrompt: 'restored negative',
            }),
        });

        expect(image.metadata).toMatchObject({
            tool: GeneratorTool.COMFYUI,
            model: 'Current Model',
            seed: 42,
            steps: 30,
            cfg: 6.5,
            sampler: 'dpmpp',
            positivePrompt: 'restored prompt',
            negativePrompt: 'restored negative',
        });
    });

    it('normalizes legacy scalar encodings and absent paths at the row boundary', () => {
        const image = mapRowToImage({
            id: 'fallback.png',
            path: '',
            width: '640',
            height: 'not-a-number',
            file_size: '',
            timestamp: '12',
            thumbnail_path: null,
            is_favorite: true,
            is_pinned: '1',
            is_deleted: 1,
            is_missing: false,
            is_corrupt: 0,
            user_masked: 1,
            tool: '',
            model_name: '',
            resolved_model_name: '',
            steps: '20',
            cfg: 'invalid',
            sampler: '',
            positive_prompt: '',
            negative_prompt: '',
            generation_type: '',
            metadata_json: '',
            original_metadata_json: '',
            original_parsed_json: '',
            original_state_json: '',
        });

        expect(image).toMatchObject({
            id: 'fallback.png',
            url: 'asset://fallback.png',
            thumbnailUrl: 'asset://fallback.png',
            width: 640,
            height: 0,
            timestamp: 12,
            isFavorite: true,
            isPinned: true,
            isDeleted: true,
            userMasked: true,
        });
        expect(image.fileSize).toBeUndefined();
        expect(image.metadata).toMatchObject({ model: 'Unknown', steps: 20, cfg: 0, sampler: 'Unknown' });
    });

    it.each(['https://example.com/thumb.webp', 'data:image/webp;base64,abc', 'blob:thumb']) (
        'preserves the %s thumbnail scheme',
        (thumbnailPath) => {
            expect(mapRowToImage({
                ...baseLightRow,
                thumbnail_path: thumbnailPath,
                user_masked: 0,
            })).toMatchObject({ thumbnailUrl: thumbnailPath, userMasked: false });
        }
    );

    it('falls back to a normalized path id and keeps unknown mask state', () => {
        const image = mapRowToImage({
            ...baseLightRow,
            id: '',
            user_masked: 'legacy',
            metadata_json: JSON.stringify({
                model: '',
                tool: '',
                positivePrompt: '',
                negativePrompt: '',
                sampler: '',
                steps: 0,
                cfg: 0,
            }),
        });

        expect(image.id).toBe('C:/images/sample.png');
        expect(image.userMasked).toBeUndefined();
    });

    it('uses final scalar defaults when persisted metadata fields are empty', () => {
        const image = mapRowToImage({
            id: '',
            path: '',
            width: null,
            height: null,
            timestamp: null,
            steps: null,
            cfg: null,
            model_name: 'Row Model',
            resolved_model_name: '',
            tool: '',
            metadata_json: JSON.stringify({ model: '', tool: '' }),
        });

        expect(image).toMatchObject({ id: '', width: 0, height: 0, timestamp: 0 });
        expect(image.metadata).toMatchObject({ model: 'Row Model', tool: GeneratorTool.UNKNOWN, steps: 0 });

        const unknownModel = mapRowToImage({
            id: 'unknown.png',
            model_name: '',
            resolved_model_name: '',
            tool: '',
            metadata_json: JSON.stringify({ model: '', tool: '' }),
        });
        expect(unknownModel.metadata.model).toBe('Unknown');
    });
});
