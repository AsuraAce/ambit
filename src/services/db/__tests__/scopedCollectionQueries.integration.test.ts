// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImageFieldsLight } from '../repoUtils';
import { countImages, countLibraryScopes, searchImages } from '../searchRepo';

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), selectReadonly: vi.fn() }));
vi.mock('../connection', () => ({ getDb: mocks.getDb, dbMutex: {} }));
vi.mock('../readonlySelect', () => ({ selectReadonly: mocks.selectReadonly }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));

// The production owner-scope view of collections, as the latest migration that defines it.
const migration = readFileSync(new URL('../../../../src-tauri/src/db/migrations/m85_invoke_name_override.rs', import.meta.url), 'utf8');
const scopedCollectionsView = migration.match(/CREATE VIEW scoped_collections AS[\s\S]*?\);/)?.[0];
if (!scopedCollectionsView) throw new Error('Production scoped_collections view not found');

const imageColumns = [
    ...new Set([
        ...getImageFieldsLight('')
            .split(',')
            .map((column) => column.trim())
            .filter(Boolean),
        'invoke_scope_hidden',
        'is_invoke_asset_gen',
        'invoke_source_id',
    ]),
];

const DB_PATH = 'D:/Invoke/databases/invokeai.db';

/**
 * Oscar's view after an owner switch, with a System board still selected (#572). The board holds one of
 * Oscar's images, so a query that trusts the stale id would show that membership in Oscar's view.
 */
describe('collection-filtered queries in an owner scope', () => {
    let db: DatabaseSync;
    const run = async (sql: string, params: readonly unknown[] = []) => db.prepare(sql).all(...(params as SQLInputValue[]));

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`
            CREATE TABLE images (${imageColumns.map((column) => `${column}`).join(', ')});
            CREATE TABLE invoke_owner_scope_state (state_key TEXT PRIMARY KEY, db_path TEXT, scope_mode TEXT,
                owner_id TEXT, boards_verified INTEGER);
            CREATE VIEW scoped_images AS SELECT images.* FROM images
                JOIN invoke_owner_scope_state s ON s.state_key = 'current'
                WHERE s.scope_mode = 'all' OR images.invoke_owner_id = s.owner_id;
            CREATE VIEW scoped_count_images AS SELECT * FROM scoped_images;
            CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT, source TEXT, invoke_source_id TEXT,
                invoke_owner_id TEXT, invoke_suppressed INTEGER NOT NULL DEFAULT 0,
                invoke_board_verified INTEGER NOT NULL DEFAULT 0);
            ${scopedCollectionsView}
            CREATE TABLE collection_images (collection_id TEXT NOT NULL, image_id TEXT NOT NULL,
                PRIMARY KEY (collection_id, image_id));
            CREATE INDEX idx_collection_images_lookup ON collection_images(image_id, collection_id);
            CREATE INDEX idx_collection_images_by_collection ON collection_images(collection_id, image_id);
            CREATE TABLE image_loras (image_id TEXT, lora_name TEXT);
        `);
        const insertImage = (id: string, owner: string) =>
            db
                .prepare(
                    `INSERT INTO images (id, path, timestamp, invoke_owner_id, invoke_source_id, invoke_scope_hidden, is_deleted,
                        media_type, source_kind) VALUES (?, ?, 1, ?, ?, 0, 0, 'image', 'generated')`
                )
                .run(id, `D:/Invoke/outputs/images/${id}.png`, owner, DB_PATH);
        insertImage('oscar-image', 'oscar');
        insertImage('system-image', 'system');
        const insertBoard = db.prepare(
            `INSERT INTO collections (id, name, source, invoke_source_id, invoke_owner_id, invoke_board_verified)
             VALUES (?, ?, 'invoke', ?, ?, 1)`
        );
        insertBoard.run('system-board', 'Explicit - Unsorted', DB_PATH, 'system');
        insertBoard.run('oscar-board', 'Oscar board', DB_PATH, 'oscar');
        const addMember = db.prepare('INSERT INTO collection_images VALUES (?, ?)');
        addMember.run('system-board', 'oscar-image');
        addMember.run('system-board', 'system-image');
        addMember.run('oscar-board', 'oscar-image');
        db.prepare('INSERT INTO image_loras VALUES (?, ?)').run('oscar-image', 'detailer');
        db.prepare("INSERT INTO invoke_owner_scope_state VALUES ('current', ?, 'owner', 'oscar', 1)").run(DB_PATH);

        mocks.getDb.mockResolvedValue({ select: run });
        mocks.selectReadonly.mockImplementation(run);
    });
    afterEach(() => db?.close());

    const search = (collectionId: string, loraName?: string) =>
        searchImages('', [], 50, 'timestamp', 'DESC', false, collectionId, loraName).then((images) => images.map((image) => image.id));

    it('returns no rows and a zero count for a board the owner scope cannot see', async () => {
        expect(await search('system-board')).toEqual([]);
        expect(await search('system-board', 'detailer')).toEqual([]);
        expect(await countImages('', [], 'system-board')).toBe(0);
        expect(await countImages('', [], 'system-board', 'detailer')).toBe(0);
        expect((await countLibraryScopes('', [], 'system-board')).media.all).toBe(0);
    });

    it("still filters by the owner's own board", async () => {
        expect(await search('oscar-board')).toEqual(['oscar-image']);
        expect(await search('oscar-board', 'detailer')).toEqual(['oscar-image']);
        expect(await countImages('', [], 'oscar-board')).toBe(1);
        expect((await countLibraryScopes('', [], 'oscar-board')).media.all).toBe(1);
    });

    it('shows the same board in All users, where it is visible', async () => {
        db.exec("UPDATE invoke_owner_scope_state SET scope_mode = 'all', owner_id = NULL");
        expect((await search('system-board')).sort()).toEqual(['oscar-image', 'system-image']);
        expect(await countImages('', [], 'system-board')).toBe(2);
    });

    it('keeps the collection index lookup driven by the selected id', async () => {
        await countImages('', [], 'system-board');
        const [sql, params] = mocks.selectReadonly.mock.calls.at(-1) as [string, SQLInputValue[]];
        const plan = db
            .prepare(`EXPLAIN QUERY PLAN ${sql}`)
            .all(...params)
            .map((row) => String((row as { detail: string }).detail));
        expect(plan.some((detail) => /SEARCH ci USING COVERING INDEX \w+ \(collection_id=\?\)/.test(detail))).toBe(true);
    });
});
