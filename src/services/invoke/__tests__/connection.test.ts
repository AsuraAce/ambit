import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from '@tauri-apps/plugin-sql';
import { diagnoseInvokeAI, discoverInvokeOwners, fetchBoardMappings as fetchBoardMappingsImpl, resolveInvokePaths, testConnection } from '../connection';

const fetchBoardMappings = (db: Database) => fetchBoardMappingsImpl(db, {
    mode: 'legacy',
    dbPath: 'D:/InvokeAI/databases/invokeai.db',
    imagesRoot: 'D:/InvokeAI',
});

const sqlMock = vi.hoisted(() => ({
    load: vi.fn()
}));

vi.mock('@tauri-apps/plugin-sql', () => ({
    default: {
        load: sqlMock.load
    }
}));

const createDb = (select: (sql: string) => Promise<unknown[]>) => ({
    select: vi.fn(select)
});

describe('InvokeAI connection helpers', () => {
    beforeEach(() => {
        sqlMock.load.mockReset();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('canonicalizes root, databases-directory, and direct database paths consistently', () => {
        expect(resolveInvokePaths('D:\\Invoke\\')).toEqual({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
        });
        expect(resolveInvokePaths('D:\\Invoke\\databases\\')).toEqual({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
        });
        expect(resolveInvokePaths('D:\\Invoke\\databases\\invokeai.db')).toEqual({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
        });
    });

    it('treats Invoke databases without images.user_id as legacy and reads no user data', async () => {
        const db = createDb(async (sql) => {
            expect(sql).toBe('PRAGMA table_info(images)');
            return [{ name: 'image_name' }];
        });
        sqlMock.load.mockResolvedValue(db);

        await expect(discoverInvokeOwners('D:/Invoke')).resolves.toEqual({
            schemaMode: 'legacy',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [],
            unassignedImageCount: 0,
        });
        expect(db.select).toHaveBeenCalledOnce();
    });

    it('discovers only owners represented by image rows and labels them with display name plus stable ID', async () => {
        const db = createDb(async (sql) => {
            if (sql === 'PRAGMA table_info(images)') return [{ name: 'image_name' }, { name: 'user_id' }];
            if (sql === "SELECT name FROM sqlite_master WHERE type='table'") return [{ name: 'images' }, { name: 'users' }];
            if (sql === 'PRAGMA table_info(users)') return [{ name: 'user_id' }, { name: 'display_name' }, { name: 'email' }];
            if (sql.includes('LEFT JOIN users')) {
                return [
                    { owner_id: 'owner-a', display_name: ' Artemis ', count: 12 },
                    { owner_id: 'owner-b', display_name: null, count: 4 },
                ];
            }
            if (sql.includes('user_id IS NULL')) return [{ count: 2 }];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        sqlMock.load.mockResolvedValue(db);

        await expect(discoverInvokeOwners('D:/Invoke/databases/invokeai.db')).resolves.toEqual({
            schemaMode: 'multi_user',
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            owners: [
                { ownerId: 'owner-a', displayName: 'Artemis', imageCount: 12 },
                { ownerId: 'owner-b', displayName: undefined, imageCount: 4 },
            ],
            unassignedImageCount: 2,
        });
        const queriedSql = db.select.mock.calls.map(([sql]) => sql).join('\n').toLowerCase();
        expect(queriedSql).not.toContain('select email');
        expect(queriedSql).not.toContain('password');
    });

    it('falls back to stable owner IDs when the users table is unavailable', async () => {
        const db = createDb(async (sql) => {
            if (sql === 'PRAGMA table_info(images)') return [{ name: 'user_id' }];
            if (sql === "SELECT name FROM sqlite_master WHERE type='table'") return [{ name: 'images' }];
            if (sql.includes('GROUP BY TRIM')) return [{ owner_id: 'owner-only', count: 3 }];
            if (sql.includes('user_id IS NULL')) return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        sqlMock.load.mockResolvedValue(db);

        await expect(discoverInvokeOwners('D:/Invoke')).resolves.toMatchObject({
            owners: [{ ownerId: 'owner-only', displayName: undefined, imageCount: 3 }],
            unassignedImageCount: 0,
        });
    });

    it('maps boards and image membership while tolerating Invoke timestamps without Z', async () => {
        const db = createDb(async (sql) => {
            if (sql === 'SELECT board_id, board_name, created_at FROM boards') {
                return [
                    { board_id: 'board-a', board_name: 'Favorites', created_at: '2026-01-02T03:04:05' },
                    { board_id: 'board-b', board_name: 'Archive', created_at: '2026-01-02T03:04:05Z' }
                ];
            }
            if (sql === 'SELECT image_name, board_id FROM board_images') {
                return [
                    { image_name: 'first.png', board_id: 'board-a' },
                    { image_name: 'loose.png', board_id: null },
                    { image_name: 123, board_id: 'board-b' }
                ];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });

        const result = await fetchBoardMappings(db as unknown as Database);

        expect(result.boards.get('board-a')).toEqual({
            name: 'Favorites',
            createdAt: new Date('2026-01-02T03:04:05 Z').getTime()
        });
        expect(result.boards.get('board-b')).toEqual({
            name: 'Archive',
            createdAt: new Date('2026-01-02T03:04:05Z').getTime()
        });
        expect(result.isAuthoritative).toBe(true);
        expect([...result.imageToBoardId.entries()]).toEqual([
            ['first.png', 'board-a'],
            ['123', 'board-b']
        ]);
    });

    it('returns empty board mappings when Invoke board tables are unavailable', async () => {
        const db = createDb(async (sql) => {
            if (sql === 'SELECT board_id, board_name, created_at FROM boards') {
                return [{
                    board_id: 'partial-board',
                    board_name: 'Must not leak',
                    created_at: '2026-01-02T03:04:05Z',
                }];
            }
            throw new Error('missing boards');
        });

        const result = await fetchBoardMappings(db as unknown as Database);

        expect(result.boards.size).toBe(0);
        expect(result.imageToBoardId.size).toBe(0);
        expect(result.isAuthoritative).toBe(false);
        expect(console.warn).toHaveBeenCalledWith(
            'Failed to fetch boards/collections mapping:',
            expect.any(Error)
        );
    });

    it('loads only directly owned boards and memberships for a selected owner', async () => {
        const db = createDb(async (sql) => {
            if (sql === 'PRAGMA table_info(boards)') return [{ name: 'user_id' }];
            if (sql.includes('FROM boards b')) {
                return [{ board_id: 'board-a', board_name: 'Owned', created_at: '2026-01-02T03:04:05Z', user_id: 'owner-a' }];
            }
            if (sql.includes('FROM board_images bi')) {
                return [{ image_name: 'owned.png', board_id: 'board-a' }];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });

        const result = await fetchBoardMappingsImpl(db as unknown as Database, {
            mode: 'owner',
            ownerId: 'owner-a',
            dbPath: 'D:/InvokeAI/databases/invokeai.db',
            imagesRoot: 'D:/InvokeAI',
        });

        expect(result.boards.get('board-a')).toEqual(expect.objectContaining({ ownerId: 'owner-a' }));
        expect(result.isAuthoritative).toBe(true);
        const calls = db.select.mock.calls as Array<[string, unknown[]?]>;
        expect(calls.find(([sql]) => sql.includes('FROM boards b'))?.[1]).toEqual(['owner-a']);
        expect(calls.find(([sql]) => sql.includes('FROM board_images bi'))?.[0]).toContain('b.user_id = ?');
        expect(calls.find(([sql]) => sql.includes('FROM board_images bi'))?.[1]).toEqual(['owner-a']);
    });

    it('skips board mapping without failing image sync when board ownership is unavailable', async () => {
        const db = createDb(async (sql) => {
            if (sql === 'PRAGMA table_info(boards)') return [{ name: 'board_id' }];
            throw new Error(`Unexpected SQL: ${sql}`);
        });

        const result = await fetchBoardMappingsImpl(db as unknown as Database, {
            mode: 'owner',
            ownerId: 'owner-a',
            dbPath: 'D:/InvokeAI/databases/invokeai.db',
            imagesRoot: 'D:/InvokeAI',
        });

        expect(result).toEqual({
            imageToBoardId: new Map(),
            boards: new Map(),
            isAuthoritative: false,
        });
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('boards.user_id is missing'));
    });

    it('reports an empty connection request without touching the database', async () => {
        await expect(testConnection('')).resolves.toEqual({
            success: false,
            count: 0,
            message: 'No path provided.'
        });
        expect(sqlMock.load).not.toHaveBeenCalled();
    });

    it('loads a direct database path with normalized separators', async () => {
        const db = createDb(async (sql) => {
            expect(sql).toBe('SELECT count(*) as count FROM images');
            return [{ count: 42 }];
        });
        sqlMock.load.mockResolvedValue(db);

        await expect(testConnection('D:\\Invoke\\databases\\invokeai.db')).resolves.toEqual({
            success: true,
            count: 42,
            message: 'Connected! Found 42 images.'
        });
        expect(sqlMock.load).toHaveBeenCalledWith('sqlite:D:/Invoke/databases/invokeai.db');
    });

    it('treats a missing connection count row as zero', async () => {
        sqlMock.load.mockResolvedValue(createDb(async () => []));

        await expect(testConnection('D:/Invoke/invokeai.db')).resolves.toMatchObject({
            success: true,
            count: 0,
        });
    });

    it('tries Invoke root candidates until one contains an images table', async () => {
        const db = createDb(async () => [{ count: 7 }]);
        sqlMock.load
            .mockRejectedValueOnce(new Error('not here'))
            .mockResolvedValueOnce(db);

        await expect(testConnection('D:/Invoke')).resolves.toEqual({
            success: true,
            count: 7,
            message: 'Connected! Found 7 images.'
        });
        expect(sqlMock.load).toHaveBeenNthCalledWith(1, 'sqlite:D:/Invoke/databases/invokeai.db');
        expect(sqlMock.load).toHaveBeenNthCalledWith(2, 'sqlite:D:/Invoke/invokeai.db');
        expect(console.warn).toHaveBeenCalledWith(
            '[InvokeAI] Failed to connect to D:/Invoke/databases/invokeai.db:',
            expect.any(Error)
        );
    });

    it('returns the not-found message after every candidate fails', async () => {
        sqlMock.load.mockRejectedValue(new Error('unreadable'));

        await expect(testConnection('D:/Invoke')).resolves.toEqual({
            success: false,
            count: 0,
            message: "Could not find valid 'invokeai.db' at this path."
        });
        expect(sqlMock.load).toHaveBeenCalledTimes(2);
    });

    it('reports an empty diagnostics request without touching the database', async () => {
        await expect(diagnoseInvokeAI('')).resolves.toEqual({ error: 'No path provided.' });
        expect(sqlMock.load).not.toHaveBeenCalled();
    });

    it('diagnoses a direct database path and only queries optional columns that exist', async () => {
        const db = createDb(async (sql) => {
            if (sql === 'PRAGMA table_info(images)') {
                return [
                    { name: 'image_name' },
                    { name: 'image_category' },
                    { name: 'is_intermediate' }
                ];
            }
            if (sql === 'SELECT count(*) as count FROM images') return [{ count: 3 }];
            if (sql === 'SELECT image_category, count(*) as count FROM images GROUP BY image_category') {
                return [{ image_category: 'general', count: 2 }];
            }
            if (sql === 'SELECT is_intermediate, count(*) as count FROM images GROUP BY is_intermediate') {
                return [{ is_intermediate: 0, count: 3 }];
            }
            if (sql === "SELECT name FROM sqlite_master WHERE type='table'") {
                return [{ name: 'images' }, { name: 'broken_table' }];
            }
            if (sql === 'SELECT count(*) as count FROM broken_table') {
                throw new Error('corrupt table');
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        sqlMock.load.mockResolvedValue(db);

        await expect(diagnoseInvokeAI('D:/Invoke/databases/invokeai.db')).resolves.toEqual({
            totalInDb: 3,
            columns: ['image_name', 'image_category', 'is_intermediate'],
            categories: [{ image_category: 'general', count: 2 }],
            origins: [],
            intermediateStatus: [{ is_intermediate: 0, count: 3 }],
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            tables: [
                { name: 'images', count: 3 },
                { name: 'broken_table', count: 'Error' }
            ]
        });
        expect(sqlMock.load).toHaveBeenCalledWith('sqlite:D:/Invoke/databases/invokeai.db');
    });

    it('derives diagnostics paths from a databases directory root', async () => {
        const db = createDb(async (sql) => {
            if (sql === 'PRAGMA table_info(images)') return [{ name: 'image_origin' }];
            if (sql === 'SELECT count(*) as count FROM images') return [{ count: 0 }];
            if (sql === 'SELECT image_origin, count(*) as count FROM images GROUP BY image_origin') return [];
            if (sql === "SELECT name FROM sqlite_master WHERE type='table'") return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        sqlMock.load.mockResolvedValue(db);

        await expect(diagnoseInvokeAI('D:\\Invoke\\databases\\')).resolves.toMatchObject({
            dbPath: 'D:/Invoke/databases/invokeai.db',
            imagesRoot: 'D:/Invoke',
            columns: ['image_origin'],
            categories: [],
            origins: []
        });
        expect(sqlMock.load).toHaveBeenCalledWith('sqlite:D:/Invoke/databases/invokeai.db');
    });

    it('returns stringified diagnostics load failures', async () => {
        sqlMock.load.mockRejectedValue('permission denied');

        await expect(diagnoseInvokeAI('D:/Invoke')).resolves.toEqual({
            error: 'permission denied'
        });

        sqlMock.load.mockRejectedValueOnce(new Error('database locked'));
        await expect(diagnoseInvokeAI('D:/Invoke')).resolves.toEqual({
            error: 'database locked'
        });
    });

    it('defaults missing diagnostic count rows to zero', async () => {
        const db = createDb(async (sql) => {
            if (sql === 'PRAGMA table_info(images)') return [];
            if (sql === 'SELECT count(*) as count FROM images') return [];
            if (sql === "SELECT name FROM sqlite_master WHERE type='table'") return [{ name: 'empty_table' }];
            if (sql === 'SELECT count(*) as count FROM empty_table') return [];
            throw new Error(`Unexpected SQL: ${sql}`);
        });
        sqlMock.load.mockResolvedValue(db);

        await expect(diagnoseInvokeAI('D:/Invoke')).resolves.toMatchObject({
            totalInDb: 0,
            tables: [{ name: 'empty_table', count: 0 }],
        });
    });
});
