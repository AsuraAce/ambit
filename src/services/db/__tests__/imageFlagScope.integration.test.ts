// @vitest-environment node
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toggleImageFavorite, toggleImagePin, updateFavorite, updatePinned, updateVideoPlaybackStatus } from '../imageRepo';

// A favorite or pin is one row. Its scope check must not scan the library while the write holds
// SQLite's write lock: on a 296k-image library that scan took 20 s cold, and every other write
// (the next pin, the collection cache clear) failed with "database is locked" behind it (#457).
// The viewer also records a video's playback status on every play, right where a pin follows.

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('../connection', () => ({ getDb: mocks.getDb, dbMutex: {} }));
vi.mock('../readonlySelect', () => ({ selectReadonly: vi.fn() }));
vi.mock('../../runtime', () => ({ isBrowserMockMode: () => false }));
vi.mock('../../metadataParser', () => ({ scanImageNative: vi.fn() }));
vi.mock('../../../bindings', () => ({ commands: {} }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }));

const migrationDir = new URL('../../../../src-tauri/src/db/migrations/', import.meta.url);
const scope = readFileSync(new URL('image_scope_sql.rs', migrationDir), 'utf8').match(/r#"([\s\S]*?)"#/)?.[1];
if (!scope) throw new Error('Production image scope SQL not found');

const writes = { toggleImageFavorite, toggleImagePin, updateFavorite, updatePinned };
const column = (name: string) => (/Favorite/.test(name) ? 'is_favorite' : 'is_pinned');

describe('favorite and pin writes over SQLite', () => {
    let db: DatabaseSync;
    let plans: string[];

    const insert = (id: string, overrides: Record<string, SQLInputValue> = {}) => {
        const row = { id, invoke_scope_hidden: 0, invoke_source_id: null, invoke_owner_id: null, ...overrides };
        db.prepare(
            `INSERT INTO images (${Object.keys(row).join(',')}) VALUES (${Object.keys(row)
                .map(() => '?')
                .join(',')})`
        ).run(...Object.values(row));
    };
    const flag = (name: string, id: string) =>
        (db.prepare(`SELECT ${column(name)} AS value FROM images WHERE id = ?`).get(id) as { value: number }).value;

    beforeEach(() => {
        db = new DatabaseSync(':memory:');
        db.exec(`CREATE TABLE images (id TEXT PRIMARY KEY, is_favorite INTEGER DEFAULT 0, is_pinned INTEGER DEFAULT 0,
            invoke_scope_hidden INTEGER, invoke_source_id TEXT, invoke_owner_id TEXT, metadata_json TEXT,
            media_type TEXT DEFAULT 'image', playback_status TEXT DEFAULT 'unknown');
            CREATE TABLE invoke_owner_scope_state (state_key TEXT PRIMARY KEY, db_path TEXT, scope_mode TEXT, owner_id TEXT);
            CREATE TABLE collection_images (collection_id TEXT, image_id TEXT);
            CREATE VIEW scoped_images AS SELECT i.rowid AS rowid, i.* FROM images i ${scope};`);
        for (let index = 0; index < 50; index += 1) insert(`C:/library/${index}.png`);
        plans = [];
        mocks.getDb.mockResolvedValue({
            execute: async (pluginSql: string, params: SQLInputValue[] = []) => {
                // sqlx binds `$n` by position; node:sqlite reads it as a name, so use SQLite's `?n`.
                const sql = pluginSql.replace(/\$(\d+)/g, '?$1');
                if (/^\s*UPDATE images SET (is_favorite|is_pinned|playback_status)/.test(sql)) {
                    const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
                    plans.push(rows.map((row) => row.detail).join('\n'));
                }
                const result = db.prepare(sql).run(...params);
                return { rowsAffected: Number(result.changes) };
            },
            select: async (sql: string, params: SQLInputValue[] = []) => db.prepare(sql).all(...params),
        });
    });
    afterEach(() => db?.close());

    it.each(Object.keys(writes))('%s reads only the target row', async (name) => {
        await writes[name as keyof typeof writes]('C:\\library\\7.png', true);

        expect(flag(name, 'C:/library/7.png')).toBe(1);
        expect(flag(name, 'C:/library/8.png')).toBe(0);
        expect(plans).toHaveLength(1);
        // The only table scan allowed is the one-row scope state the view joins.
        expect(plans[0]).not.toMatch(/SCAN (i|images)\b/);
    });

    it.each([
        ['absent', {}, true],
        ['all', { invoke_source_id: 'source', invoke_owner_id: 'b' }, true],
        ['owner', { invoke_source_id: 'source', invoke_owner_id: 'a' }, true],
        ['owner', { invoke_source_id: 'source', invoke_owner_id: 'b' }, false],
        ['absent', { invoke_source_id: 'source', invoke_owner_id: 'a' }, false],
        ['all', { invoke_scope_hidden: 1 }, false],
        ['legacy', { invoke_source_id: 'source', invoke_owner_id: 'b' }, true],
        ['all', { invoke_source_id: 'other-source', invoke_owner_id: 'a' }, false],
        ['owner', { invoke_source_id: 'source', invoke_owner_id: 'a' }, false, null],
        ['owner', { invoke_source_id: 'source', invoke_owner_id: null }, false, null],
    ] as [string, Record<string, SQLInputValue>, boolean, (string | null)?][])(
        'keeps the library scope: %s mode, row %j, writable %s, scope owner %s',
        async (mode, overrides, writable, owner = 'a') => {
            if (mode !== 'absent')
                db.prepare('INSERT INTO invoke_owner_scope_state VALUES (?, ?, ?, ?)').run('current', 'source', mode, owner);
            insert('C:/library/scoped.png', overrides);

            for (const [name, write] of Object.entries(writes)) {
                const saved = write('C:/library/scoped.png', true);
                if (writable) {
                    await expect(saved).resolves.toBeUndefined();
                    expect(flag(name, 'C:/library/scoped.png')).toBe(1);
                } else {
                    await expect(saved).rejects.toThrow('was not found');
                    expect(flag(name, 'C:/library/scoped.png')).toBe(0);
                }
            }
        }
    );

    it('records video playback status reading only the target row, within scope', async () => {
        insert('C:/library/clip.mp4', { media_type: 'video' });
        insert('C:/library/hidden.mp4', { media_type: 'video', invoke_scope_hidden: 1 });
        const status = (id: string) =>
            (db.prepare('SELECT playback_status AS value FROM images WHERE id = ?').get(id) as { value: string }).value;

        await updateVideoPlaybackStatus('C:\\library\\clip.mp4', 'playable');

        expect(status('C:/library/clip.mp4')).toBe('playable');
        expect(plans).toHaveLength(1);
        expect(plans[0]).not.toMatch(/SCAN (i|images)\b/);
        await expect(updateVideoPlaybackStatus('C:/library/hidden.mp4', 'playable')).rejects.toThrow('was not found');
        expect(status('C:/library/hidden.mp4')).toBe('unknown');
    });
});
