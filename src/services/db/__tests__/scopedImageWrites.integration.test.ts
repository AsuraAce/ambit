// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as imageRepo from '../imageRepo';
import { pruneMissingLinks } from '../maintenanceRepo';
import { pruneBrokenThumbnails } from '../../thumbnailService';

// Every image write checks the library scope while it holds SQLite's write lock. The form
// `id IN (SELECT id FROM scoped_images)` reads the whole library first: 20 s cold on a 296k-image
// library, and every other write fails with "database is locked" behind it (#457, #463). A bulk
// force-mask of 30 images ran 30 of those at once, most failed, and the mask reverted. Each write
// here must read only the rows it changes, and must still refuse rows outside the scope.

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('../connection', () => ({ getDb: mocks.getDb, dbMutex: { dispatch: <T>(task: () => Promise<T>) => task() } }));
vi.mock('../readonlySelect', () => ({ selectReadonly: vi.fn() }));
vi.mock('../../runtime', () => ({ isBrowserMockMode: () => false, isTauriRuntime: () => true }));
vi.mock('../../metadataParser', () => ({ scanImageNative: vi.fn(), scanImagesBulk: vi.fn() }));
vi.mock('../../../bindings', () => ({ commands: {} }));
vi.mock('../../assetScope', () => ({ libraryPathsExist: async (paths: string[]) => paths.map(() => false) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/api/path', () => ({
    appLocalDataDir: async () => 'C:/appdata',
    join: async (...parts: string[]) => parts.join('/'),
}));
vi.mock('@tauri-apps/plugin-fs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@tauri-apps/plugin-fs')>()),
    exists: async () => false,
}));

const migrationDir = new URL('../../../../src-tauri/src/db/migrations/', import.meta.url);
const scope = readFileSync(new URL('image_scope_sql.rs', migrationDir), 'utf8').match(/r#"([\s\S]*?)"#/)?.[1];
if (!scope) throw new Error('Production image scope SQL not found');

// Plan steps that read images other than by id: a scan, or a search on another index, which still
// reads most of the library. Scans of the one-row scope state and the caller's id list are fine.
const fullReads = (plan: string) =>
    plan.split('\n').filter((step) => /^SCAN (i|images)\b/.test(step) || (/^SEARCH (i|images) /.test(step) && !step.includes('(id=?)')));

const IN_SCOPE = 'C:/library/7.png';
const OUT_OF_SCOPE = 'C:/library/hidden.png';

interface ScopedWrite {
    name: string;
    run: (id: string) => Promise<unknown>;
    /** Reads the column the write changes, so a refused write shows as unchanged. */
    read: string;
}

const writes: ScopedWrite[] = [
    { name: 'setImageMasks', run: (id) => imageRepo.setImageMasks([{ id, userMasked: true }]), read: 'user_masked' },
    { name: 'updateImageNotesCol', run: (id) => imageRepo.updateImageNotesCol(id, 'note'), read: 'notes' },
    { name: 'toggleImageIntermediate', run: (id) => imageRepo.toggleImageIntermediate(id, true), read: 'metadata_json' },
    { name: 'updateImageMetadataFields', run: (id) => imageRepo.updateImageMetadataFields(id, { seed: 42 }), read: 'seed' },
    { name: 'revertImageMetadata', run: (id) => imageRepo.revertImageMetadata(id), read: 'seed' },
    { name: 'updateImageWorkflow', run: (id) => imageRepo.updateImageWorkflow(id, '{"nodes":[]}'), read: 'metadata_json' },
    { name: 'updateImageWorkflowHint', run: (id) => imageRepo.updateImageWorkflowHint(id, true), read: 'metadata_json' },
    { name: 'updateThumbnailPath', run: (id) => imageRepo.updateThumbnailPath(id, 'C:/thumbs/new.webp'), read: 'thumbnail_path' },
    {
        name: 'updateThumbnailPathsBatch',
        run: (id) => imageRepo.updateThumbnailPathsBatch([{ id, thumbnailPath: 'C:/thumbs/new.webp', thumbnailSource: 'ambit' }]),
        read: 'thumbnail_path',
    },
    // Takes ids as the database stores them.
    { name: 'pruneMissingLinks', run: (id) => pruneMissingLinks([id.replace(/\\/g, '/')]), read: 'is_missing' },
];

describe('scoped image writes over SQLite', () => {
    let db: DatabaseSync;
    let plans: string[];

    const insert = (id: string, overrides: Record<string, SQLInputValue> = {}) => {
        const row = {
            id,
            invoke_scope_hidden: 0,
            metadata_json: '{"seed":1}',
            original_parsed_json: '{"seed":7}',
            seed: 1,
            thumbnail_path: 'C:/appdata/.thumbnails/old.webp',
            ...overrides,
        };
        db.prepare(
            `INSERT INTO images (${Object.keys(row).join(',')}) VALUES (${Object.keys(row)
                .map(() => '?')
                .join(',')})`
        ).run(...Object.values(row));
    };
    const value = (column: string, id: string) =>
        (db.prepare(`SELECT ${column} AS value FROM images WHERE id = ?`).get(id) as { value: SQLInputValue }).value;

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`CREATE TABLE images (id TEXT PRIMARY KEY, invoke_scope_hidden INTEGER, invoke_source_id TEXT, invoke_owner_id TEXT,
            media_type TEXT DEFAULT 'image', metadata_json TEXT, original_parsed_json TEXT, tool TEXT, model_hash TEXT,
            model_name TEXT, resolved_model_name TEXT, seed INTEGER, generation_type TEXT, positive_prompt TEXT,
            negative_prompt TEXT, notes TEXT, user_masked INTEGER, is_missing INTEGER DEFAULT 0, thumbnail_path TEXT,
            micro_thumbnail TEXT, thumbnail_source TEXT, thumbnail_version INTEGER DEFAULT 0,
            thumbnail_failure_count INTEGER DEFAULT 0, thumbnail_last_error TEXT, thumbnail_last_attempt_at INTEGER);
            CREATE TABLE invoke_owner_scope_state (state_key TEXT PRIMARY KEY, db_path TEXT, scope_mode TEXT, owner_id TEXT);
            CREATE TABLE collection_images (collection_id TEXT, image_id TEXT);
            CREATE VIEW scoped_images AS SELECT i.rowid AS rowid, i.* FROM images i ${scope};`);
        for (let index = 0; index < 50; index += 1) insert(`C:/library/${index}.png`);
        insert(OUT_OF_SCOPE, { invoke_scope_hidden: 1 });
        plans = [];
        // sqlx binds `$n` by position; node:sqlite reads it as a name, so use SQLite's `?n`. The app's
        // SQLite also reads `""` as an empty string, which node:sqlite's build refuses.
        const toNodeSql = (pluginSql: string) => pluginSql.replace(/\$(\d+)/g, '?$1').replace(/""/g, "''");
        mocks.getDb.mockResolvedValue({
            execute: async (pluginSql: string, params: SQLInputValue[] = []) => {
                const sql = toNodeSql(pluginSql);
                if (/^\s*UPDATE images\b/.test(sql)) {
                    const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
                    plans.push(rows.map((row) => row.detail).join('\n'));
                }
                const result = db.prepare(sql).run(...params);
                return { rowsAffected: Number(result.changes) };
            },
            select: async (sql: string, params: SQLInputValue[] = []) => db.prepare(toNodeSql(sql)).all(...params),
        });
    });
    afterEach(() => db?.close());

    it.each(writes)('$name reads only the rows it changes', async ({ run, read }) => {
        const before = value(read, 'C:/library/8.png');

        await run('C:\\library\\7.png');

        expect(value(read, IN_SCOPE)).not.toEqual(value(read, 'C:/library/8.png'));
        expect(value(read, 'C:/library/8.png')).toEqual(before);
        expect(plans.length).toBeGreaterThan(0);
        for (const plan of plans) expect(fullReads(plan)).toEqual([]);
    });

    it.each(writes)('$name leaves rows outside the library scope unchanged', async ({ run, read }) => {
        const before = value(read, OUT_OF_SCOPE);

        await run(OUT_OF_SCOPE).catch(() => undefined);

        expect(value(read, OUT_OF_SCOPE)).toEqual(before);
    });

    it('pruneBrokenThumbnails clears missing thumbnails reading only those rows, within scope', async () => {
        db.prepare("UPDATE images SET thumbnail_path = NULL WHERE id != ? AND id != 'C:/library/8.png'").run(IN_SCOPE);
        db.prepare("UPDATE images SET thumbnail_path = 'C:/appdata/.thumbnails/hidden.webp' WHERE id = ?").run(OUT_OF_SCOPE);

        await expect(pruneBrokenThumbnails()).resolves.toBe(2);

        expect(value('thumbnail_path', IN_SCOPE)).toBeNull();
        expect(value('thumbnail_path', 'C:/library/8.png')).toBeNull();
        expect(value('thumbnail_path', OUT_OF_SCOPE)).toBe('C:/appdata/.thumbnails/hidden.webp');
        expect(plans).toHaveLength(1);
        expect(fullReads(plans[0])).toEqual([]);
    });

    it('setImageMasks writes a mixed selection in one statement and reports images outside the scope', async () => {
        await imageRepo.setImageMasks([
            { id: 'C:/library/1.png', userMasked: true },
            { id: 'C:\\library\\2.png', userMasked: false },
            { id: 'C:/library/3.png', userMasked: null },
        ]);

        expect(plans).toHaveLength(1);
        expect([1, 2, 3].map((index) => value('user_masked', `C:/library/${index}.png`))).toEqual([1, 0, null]);

        await expect(
            imageRepo.setImageMasks([
                { id: 'C:/library/4.png', userMasked: true },
                { id: OUT_OF_SCOPE, userMasked: true },
            ])
        ).rejects.toThrow('not found');
        expect(value('user_masked', OUT_OF_SCOPE)).toBeNull();
    });
});
