// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeletedImages } from '../maintenanceRepo';
import { getRemovedImagesByIds } from '../imageRepo';
import { mapRowToImage, REMOVED_IMAGE_FIELDS, type ImageRow } from '../repoUtils';
import { isImageMasked } from '../../../utils/maskingUtils';
import { isVideoAsset } from '../../../types';
import * as runtime from '../../runtime';
import * as browserMockData from '../../browserMockData';

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('../connection', () => ({ getDb: mocks.getDb, dbMutex: {} }));
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
    convertFileSrc: (path: string) => `asset://${path}`,
}));

const baseRow: Record<string, SQLInputValue> = {
    id: 'C:/library/removed.png', path: 'C:/library/removed.png',
    width: 1024, height: 768, file_size: 123456, timestamp: 10, removed_at: 20,
    thumbnail_path: 'C:/thumbs/removed.webp', micro_thumbnail: 'data:image/webp;base64,AAAA',
    thumbnail_source: 'ambit', is_favorite: 1, is_pinned: 1, is_missing: 0,
    user_masked: null, group_id: 'group', board_id: 'board', notes: 'note', is_corrupt: 0,
    invoke_image_name: 'removed.png', invoke_image_category: 'general',
    invoke_image_origin: 'internal', invoke_owner_id: 'visible', invoke_scope_hidden: 0,
    metadata_json: JSON.stringify({ positivePrompt: 'private sunset', steps: 20, sampler: 'euler' }),
    original_metadata_json: JSON.stringify({ workflow: 'archival workflow' }),
    original_parsed_json: JSON.stringify({ positivePrompt: 'original prompt', seed: 0 }),
    original_state_json: JSON.stringify({ isFavorite: true, boardId: 'original-board' }),
    media_type: 'image', media_container: null, media_mime_type: null, duration_ms: null,
    video_codec: null, video_profile: null, audio_present: null, audio_codec: null,
    frame_rate_num: null, frame_rate_den: null, rotation_degrees: null,
    probe_status: null, playback_status: null,
};
const blobFields = ['metadata_json', 'original_metadata_json', 'original_parsed_json', 'original_state_json'];

describe('Removed listings over SQLite', () => {
    let sqlite: DatabaseSync;
    let returnedRows: ImageRow[];

    const insert = (overrides: Record<string, SQLInputValue> = {}) => {
        const row = { ...baseRow, ...overrides };
        sqlite.prepare(`INSERT INTO removed_images (${Object.keys(row).join(',')})
            VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    };

    beforeEach(() => {
        sqlite = new DatabaseSync(':memory:');
        // Fixture storage columns are independent of either SELECT projection.
        sqlite.exec(`CREATE TABLE removed_images (${Object.keys(baseRow).join(',')});
            CREATE VIEW scoped_removed_images AS SELECT * FROM removed_images
            WHERE invoke_owner_id IS NULL OR invoke_owner_id = 'visible';`);
        returnedRows = [];
        mocks.getDb.mockResolvedValue({
            select: vi.fn(async (sql: string, params: SQLInputValue[] = []) => {
                const rows = sqlite.prepare(sql).all(...params);
                returnedRows.push(...rows);
                return rows;
            }),
        });
    });

    afterEach(() => {
        sqlite.close();
        vi.restoreAllMocks();
    });

    it('loads scoped rows newest first without sending archival blobs across IPC', async () => {
        insert();
        insert({ id: 'newer', path: 'C:/library/newer.png', removed_at: 30 });
        insert({ id: 'hidden', invoke_scope_hidden: 1 });
        insert({ id: 'other-owner', invoke_owner_id: 'other' });
        const images = await getDeletedImages();
        expect(images.map(image => image.id)).toEqual(['newer', baseRow.id]);
        for (const row of returnedRows) {
            for (const field of blobFields) expect(row).not.toHaveProperty(field);
        }
        expect(images[1]).toMatchObject({
            filename: 'removed.png', width: 1024, height: 768, fileSize: 123456, timestamp: 10,
            thumbnailUrl: 'asset://C:/thumbs/removed.webp', microThumbnail: baseRow.micro_thumbnail,
            isFavorite: true, isPinned: true, isMissing: false, isCorrupt: false,
            groupId: 'group', boardId: 'board', notes: 'note', invokeOwnerId: 'visible',
            invokeImageName: 'removed.png', invokeImageCategory: 'general', invokeImageOrigin: 'internal',
            metadata: { positivePrompt: 'private sunset' },
        });
        expect(images[1].originalChunks).toBeUndefined();
        expect(images[1].originalMetadata).toBeUndefined();
        expect(images[1].originalState).toBeUndefined();
    });

    it.each([
        ['current prompt wins', { positivePrompt: 'private current' }, 'private current'],
        ['nonmatching current wins', { positivePrompt: 'public current' }, 'public current'],
        ['missing prompt falls back', {}, 'private original'],
        ['empty prompt falls back', { positivePrompt: '', sampler: 'Unknown', steps: 0 }, 'private original'],
        ['null fields fall back', { positivePrompt: null, sampler: null, steps: null }, 'private original'],
        ['empty fields fall back', { positivePrompt: '', sampler: '', steps: '' }, 'private original'],
        ['sampler prevents fallback', { positivePrompt: '', sampler: 'euler', steps: 0 }, ''],
        ['steps prevent fallback', { positivePrompt: '', steps: 20 }, ''],
        ['string zero prevents fallback', { positivePrompt: '', steps: '0' }, ''],
    ])('preserves privacy for %s', async (_name, current, prompt) => {
        insert({
            metadata_json: JSON.stringify(current),
            original_parsed_json: JSON.stringify({ positivePrompt: 'private original' }),
        });
        const [light] = await getDeletedImages();
        const full = mapRowToImage(sqlite.prepare(`SELECT ${REMOVED_IMAGE_FIELDS} FROM removed_images`).get()!);
        expect(light.metadata.positivePrompt).toBe(prompt);
        expect(light.metadata.positivePrompt).toBe(full.metadata.positivePrompt);
        for (const privacyEnabled of [true, false]) {
            for (const userMasked of [undefined, true, false]) {
                expect(isImageMasked({ ...light, userMasked }, privacyEnabled, ['PRIVATE']))
                    .toBe(isImageMasked({ ...full, userMasked }, privacyEnabled, ['PRIVATE']));
            }
        }
        expect(isImageMasked(light, true, ['PRIVATE'])).toBe(String(prompt).includes('private'));
    });

    it.each([null, '', '{}'])('handles absent metadata (%s) without needing archival blobs', async metadata => {
        insert({ metadata_json: metadata, original_parsed_json: metadata });
        const [image] = await getDeletedImages();
        expect(image.metadata.positivePrompt).toBe('');
        expect(isImageMasked(image, true, ['private'])).toBe(false);
    });

    it('retains video poster and playback facts in lightweight rows', async () => {
        insert({
            path: 'C:/library/removed.mp4', media_type: 'video', thumbnail_source: 'ambit-video-v1',
            media_container: 'mp4', media_mime_type: 'video/mp4', duration_ms: 1500,
            video_codec: 'h264', video_profile: 'High', audio_present: 1, audio_codec: 'aac',
            frame_rate_num: 30, frame_rate_den: 1, rotation_degrees: 90,
            probe_status: 'ready', playback_status: 'supported',
        });
        const [image] = await getDeletedImages();
        expect(isVideoAsset(image)).toBe(true);
        expect(image).toMatchObject({
            thumbnailSource: 'ambit-video-v1', thumbnailUrl: 'asset://C:/thumbs/removed.webp',
            mediaContainer: 'mp4', mediaMimeType: 'video/mp4', durationMs: 1500,
            videoCodec: 'h264', videoProfile: 'High', audioPresent: true, audioCodec: 'aac',
            frameRateNum: 30, frameRateDen: 1, rotationDegrees: 90,
            probeStatus: 'ready', playbackStatus: 'supported',
        });
    });

    it('hydrates browser mock Removed viewers without invoking the desktop database', async () => {
        const removed = { ...mapRowToImage(baseRow), isDeleted: true };
        vi.spyOn(runtime, 'isBrowserMockMode').mockReturnValue(true);
        vi.spyOn(browserMockData, 'getBrowserMockImages').mockReturnValue([
            removed,
            { ...removed, id: 'other-removed' },
            { ...removed, id: 'active', isDeleted: false },
        ]);
        mocks.getDb.mockClear();
        expect(await getRemovedImagesByIds(['C:\\library\\removed.png', 'active'])).toEqual([removed]);
        expect(mocks.getDb).not.toHaveBeenCalled();
    });

    it('keeps full metadata available for scoped ID lookups', async () => {
        insert();
        insert({ id: 'hidden', invoke_scope_hidden: 1 });
        insert({ id: 'other-owner', invoke_owner_id: 'other' });
        const images = await getRemovedImagesByIds(['C:\\library\\removed.png', 'hidden', 'other-owner']);
        expect(images).toHaveLength(1);
        expect(images[0]).toMatchObject({
            metadata: { positivePrompt: 'private sunset', steps: 20, sampler: 'euler' },
            originalChunks: { workflow: 'archival workflow' },
            originalMetadata: { positivePrompt: 'original prompt', seed: 0 },
            originalState: { isFavorite: true, boardId: 'original-board' },
        });
        for (const field of blobFields) expect(returnedRows[0]).toHaveProperty(field, baseRow[field]);
        expect(returnedRows[0].positive_prompt).toBeNull();
    });

    it('does not grow the listing payload when unrelated workflow metadata grows', async () => {
        insert();
        const initialImages = await getDeletedImages();
        const initialPayload = JSON.stringify(returnedRows);
        const workflow = 'x'.repeat(512 * 1024);
        sqlite.prepare(`UPDATE removed_images SET metadata_json = ?, original_parsed_json = ?,
            original_metadata_json = ?, original_state_json = ?`).run(
            JSON.stringify({ positivePrompt: 'private sunset', steps: 20, sampler: 'euler', workflow }),
            JSON.stringify({ positivePrompt: 'original prompt', seed: 0, workflow }),
            JSON.stringify({ workflow }), JSON.stringify({ workflow }),
        );
        returnedRows = [];
        const enlargedImages = await getDeletedImages();
        expect(JSON.stringify(returnedRows).length).toBe(initialPayload.length);
        expect(enlargedImages).toEqual(initialImages);
        expect(JSON.stringify(returnedRows)).toBe(initialPayload);
    });
});
