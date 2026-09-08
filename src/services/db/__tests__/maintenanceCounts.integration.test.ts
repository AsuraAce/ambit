// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMaintenanceCounts } from '../maintenanceRepo';

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('../connection', () => ({ getDb: mocks.getDb, dbMutex: {} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));

const migrationDir = new URL('../../../../src-tauri/src/db/migrations/', import.meta.url);
const views = readFileSync(new URL('m70_invoke_scoped_views.rs', migrationDir), 'utf8')
    .match(/CREATE VIEW scoped_images AS[\s\S]*?(?=CREATE VIEW scoped_collections AS)/)?.[0];
if (!views) throw new Error('Production image scope views not found');

const oldQuery = `SELECT
    COUNT(*) FILTER (WHERE (positive_prompt IS NULL OR positive_prompt = '') AND media_type = 'image'
        AND invoke_scope_hidden = 0 AND is_deleted = 0 AND IFNULL(is_intermediate_gen, 0) = 0
        AND IFNULL(is_invoke_asset_gen, 0) = 0) AS untagged,
    COUNT(*) FILTER (WHERE invoke_scope_hidden = 0 AND is_missing = 1 AND is_deleted = 0) AS missing,
    COUNT(*) FILTER (WHERE media_type = 'image' AND invoke_scope_hidden = 0
        AND IFNULL(is_intermediate_gen, 0) = 1 AND is_deleted = 0) AS intermediates,
    (SELECT COUNT(*) FROM scoped_removed_images WHERE invoke_scope_hidden = 0) AS trash
    FROM scoped_images AS images`;

describe('maintenance counts over SQLite', () => {
    let db: DatabaseSync;
    let query: string;
    const insert = (id: string, overrides: Record<string, SQLInputValue> = {}, removed = false) => {
        const row = { id, positive_prompt: '', media_type: 'image', invoke_scope_hidden: 0,
            is_deleted: 0, is_missing: 0, is_intermediate_gen: 0, is_invoke_asset_gen: null,
            invoke_source_id: null, invoke_owner_id: null, metadata_json: '{}', ...overrides };
        db.prepare(`INSERT INTO ${removed ? 'removed_images' : 'images'} (${Object.keys(row).join(',')})
            VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    };
    const parity = async () => {
        const expected = db.prepare(oldQuery).get();
        const actual = await getMaintenanceCounts();
        expect(actual).toEqual({ ...expected, orphans: expected?.missing, duplicates: 0 });
        return actual;
    };
    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        for (const table of ['images', 'removed_images']) {
            db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, positive_prompt TEXT, media_type TEXT,
                invoke_scope_hidden INTEGER, is_deleted INTEGER, is_missing INTEGER,
                is_intermediate_gen INTEGER, is_invoke_asset_gen INTEGER, invoke_source_id TEXT,
                invoke_owner_id TEXT, metadata_json TEXT);`);
        }
        db.exec(`CREATE TABLE invoke_owner_scope_state (state_key TEXT PRIMARY KEY,
            db_path TEXT, scope_mode TEXT, owner_id TEXT); ${views}`);
        const migration = readFileSync(new URL('m80_maintenance_count_indexes.rs', migrationDir), 'utf8');
        const indexes = migration.match(/sql: concat!\(\s*r#"([\s\S]*?)"#/)?.[1];
        const scope = readFileSync(new URL('image_scope_sql.rs', migrationDir), 'utf8')
            .match(/r#"([\s\S]*?)"#/)?.[1];
        if (!indexes || !scope) throw new Error('Production count schema SQL not found');
        db.exec(indexes);
        // Expand the literal-only view declarations using their production SQL fragment.
        const declarations = [...migration.matchAll(/image_scope_view_sql!\(\s*"([^"]+)",\s*r#"([\s\S]*?)"#,\s*"([^"]+)"\s*\)/g)];
        expect(declarations).toHaveLength(4);
        for (const [, name, projection, source] of declarations) {
            db.exec(`CREATE VIEW ${name} AS SELECT ${projection} FROM ${source} ${scope};`);
        }
        mocks.getDb.mockResolvedValue({ select: async (sql: string) => {
            query = sql;
            return db.prepare(sql).all();
        } });
    });
    afterEach(() => db?.close());

    it('returns zero for an empty library and counts Removed with no active rows', async () => {
        expect(await parity()).toMatchObject({ untagged: 0, missing: 0, intermediates: 0, trash: 0 });
        insert('removed', {}, true);
        expect(await parity()).toMatchObject({ trash: 1, untagged: 0 });
    });

    it.each(['absent', 'legacy', 'all', 'owner', 'other-owner'])('preserves %s visibility and category counts', async mode => {
        if (mode !== 'absent') db.prepare('INSERT INTO invoke_owner_scope_state VALUES (?, ?, ?, ?)')
            .run('current', 'source', mode === 'other-owner' ? 'owner' : mode, mode === 'other-owner' ? 'b' : 'a');
        const scopes: Record<string, SQLInputValue>[] = [{}, { invoke_source_id: 'source', invoke_owner_id: 'a' },
            { invoke_source_id: 'source', invoke_owner_id: 'b' }, { invoke_source_id: 'source' },
            { invoke_source_id: 'other', invoke_owner_id: 'a' }];
        const categories: Record<string, SQLInputValue>[] = [{}, { positive_prompt: null }, { positive_prompt: 'prompt' },
            { positive_prompt: ' ' }, { media_type: 'video' }, { is_intermediate_gen: 1 },
            { is_intermediate_gen: null }, { is_invoke_asset_gen: 1 }, { is_missing: 1 },
            { is_deleted: 1 }, { invoke_scope_hidden: 1 }];
        for (const [s, scope] of scopes.entries()) {
            for (const [c, category] of categories.entries()) insert(`${s}-${c}`, { ...scope, ...category });
            insert(`removed-${s}`, scope, true);
            insert(`hidden-${s}`, { ...scope, invoke_scope_hidden: 1 }, true);
        }
        await parity();
    });

    it('updates exact counts after edits, removal, restore, deletion and owner changes', async () => {
        insert('local');
        insert('owned', { invoke_source_id: 'source', invoke_owner_id: 'a' });
        db.exec("INSERT INTO invoke_owner_scope_state VALUES ('current', 'source', 'owner', 'a')");
        expect(await parity()).toMatchObject({ untagged: 2 });
        db.exec("UPDATE images SET positive_prompt = 'tagged', is_missing = 1 WHERE id = 'local'");
        expect(await parity()).toMatchObject({ untagged: 1, missing: 1 });
        db.exec("UPDATE images SET is_intermediate_gen = 1, is_invoke_asset_gen = 1 WHERE id = 'owned'");
        expect(await parity()).toMatchObject({ untagged: 0, intermediates: 1 });
        db.exec("INSERT INTO removed_images SELECT * FROM images WHERE id = 'owned'; DELETE FROM images WHERE id = 'owned'");
        expect(await parity()).toMatchObject({ trash: 1, intermediates: 0 });
        db.exec("UPDATE invoke_owner_scope_state SET owner_id = 'b'");
        expect(await parity()).toMatchObject({ trash: 0 });
        db.exec("UPDATE invoke_owner_scope_state SET owner_id = 'a'; INSERT INTO images SELECT * FROM removed_images; DELETE FROM removed_images");
        expect(await parity()).toMatchObject({ trash: 0, intermediates: 1 });
        db.exec('DELETE FROM images');
        expect(await parity()).toMatchObject({ untagged: 0, missing: 0, intermediates: 0 });
    });

    it('reads count indexes without fetching image-table columns or prompt text', async () => {
        insert('heavy', { metadata_json: JSON.stringify({ workflow: 'x'.repeat(1024 * 1024) }) });
        await parity();
        const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all().map(row => row.detail).join('\n');
        expect(plan).toContain('idx_images_maintenance_counts_v1');
        expect(plan).toContain('idx_removed_images_maintenance_counts_v1');
        const tableRoots = db.prepare("SELECT rootpage FROM sqlite_schema WHERE name IN ('images', 'removed_images')").all()
            .map(row => row.rootpage);
        const instructions = db.prepare(`EXPLAIN ${query}`).all();
        const tableCursors = instructions.filter(row => row.opcode === 'OpenRead' && tableRoots.includes(row.p2))
            .map(row => row.p1);
        expect(instructions.filter(row => row.opcode === 'Column' && tableCursors.includes(row.p1))).toEqual([]);
    });
});
