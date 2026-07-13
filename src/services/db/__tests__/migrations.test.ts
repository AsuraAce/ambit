import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../connection';
import { migrateSchema } from '../migrations';

vi.mock('../connection', () => ({ getDb: vi.fn() }));

const mockedGetDb = vi.mocked(getDb);
const createDb = () => ({
    select: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
});

describe('migrateSchema', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('keeps an existing schema normalized and applies maintenance indexes', async () => {
        const db = createDb();
        mockedGetDb.mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);

        await migrateSchema();

        expect(db.select).toHaveBeenCalledWith('SELECT is_pinned FROM images LIMIT 1');
        expect(db.execute).toHaveBeenCalledWith('UPDATE images SET is_pinned = 0 WHERE is_pinned IS NULL');
        expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('idx_images_fast_sort_v3'));
        expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('idx_images_model_stats_v2'));
        expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('thumbnail_path = REPLACE'));
    });

    it('adds the pinned column when probing an older schema', async () => {
        const db = createDb();
        db.select.mockRejectedValueOnce(new Error('no such column'));
        mockedGetDb.mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);

        await migrateSchema();

        expect(db.execute).toHaveBeenCalledWith('ALTER TABLE images ADD COLUMN is_pinned INTEGER DEFAULT 0');
        expect(db.execute).toHaveBeenCalledWith('CREATE INDEX idx_images_pinned ON images(is_pinned)');
    });

    it('continues when optional migration groups fail', async () => {
        const db = createDb();
        db.select.mockRejectedValueOnce(new Error('old schema'));
        db.execute
            .mockRejectedValueOnce(new Error('column race'))
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('index unsupported'))
            .mockRejectedValueOnce(new Error('legacy update unsupported'));
        mockedGetDb.mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);

        await expect(migrateSchema()).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith('[DB] Migration failed', expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith('[DB] Migration failed for performance indexes', expect.any(Error));
        expect(console.warn).toHaveBeenCalledWith('[DB] Migration failed for legacy thumbnail paths', expect.any(Error));
    });
});
