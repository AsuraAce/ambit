import { getDb } from './connection';

export const migrateSchema = async () => {
    const db = await getDb();
    try {
        await db.select('SELECT is_pinned FROM images LIMIT 1');
    } catch (e) {
        console.log('[DB] Adding is_pinned column...');
        try {
            await db.execute('ALTER TABLE images ADD COLUMN is_pinned INTEGER DEFAULT 0');
            await db.execute('CREATE INDEX idx_images_pinned ON images(is_pinned)');
        } catch (inner) {
            console.error('[DB] Migration failed', inner);
        }
    }

    await db.execute('UPDATE images SET is_pinned = 0 WHERE is_pinned IS NULL');

    // Performance Patches: Add covering indexes for strict equality matching
    try {
        await db.execute('CREATE INDEX IF NOT EXISTS idx_images_fast_sort_v3 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), timestamp DESC, id DESC)');
        await db.execute('CREATE INDEX IF NOT EXISTS idx_images_model_stats_v2 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), resolved_model_name, model_name)');
    } catch (e) {
        console.warn('[DB] Migration failed for performance indexes', e);
    }

    try {
        await db.execute(`
            UPDATE images 
            SET thumbnail_path = REPLACE(REPLACE(thumbnail_path, 'http://tauri.localhost/_up_/', ''), 'https://tauri.localhost/_up_/', '')
            WHERE thumbnail_path LIKE 'http%://tauri.localhost/_up_/%'
        `);
    } catch (e) {
        console.warn('[DB] Migration failed for legacy thumbnail paths', e);
    }
};
