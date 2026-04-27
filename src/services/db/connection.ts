import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;
let dbInitialized = false;

// Simple Mutex to prevent concurrent write transactions
export class Mutex {
    private mutex = Promise.resolve();
    lock(): Promise<() => void> {
        return new Promise(resolve => {
            this.mutex = this.mutex.then(() => {
                return new Promise<void>(unlock => {
                    resolve(unlock);
                });
            });
        });
    }

    async dispatch<T>(fn: (() => T) | (() => PromiseLike<T>)): Promise<T> {
        const unlock = await this.lock();
        try {
            return await Promise.resolve(fn());
        } finally {
            unlock();
        }
    }
}

export const dbMutex = new Mutex();

export const getDb = async () => {
    if (!db) {
        db = await Database.load('sqlite:images.db');
    }

    if (!dbInitialized && db) {
        dbInitialized = true;
        // Enable WAL mode and busy timeout for better concurrency
        try {
            await db.execute('PRAGMA journal_mode=WAL');
            await db.execute('PRAGMA synchronous=NORMAL');
            await db.execute('PRAGMA busy_timeout=60000'); // Higher timeout for massive batches
            await db.execute('PRAGMA cache_size=-64000');   // 64MB cache for large libraries
            await db.execute('PRAGMA temp_store=MEMORY');   // Faster sorting/grouping
            await db.execute('PRAGMA mmap_size=268435456'); // 256MB memory-mapped I/O
            console.log('[DB] Applied performance PRAGMAs');

            // --- AMBIT PERFORMANCE PATCHES ---
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_fast_sort_v3 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), timestamp DESC, id DESC)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_model_stats_v2 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), resolved_model_name, model_name)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_privacy_fast_sort_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), privacy_hidden, timestamp DESC, id DESC)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_privacy_model_stats_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), privacy_hidden, resolved_model_name, model_name)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_name_sort_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), path ASC, id ASC)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_size_sort_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), file_size DESC, id DESC)');
            console.log('[DB] Applied Performance Covering Indexes');
        } catch (e) {
            console.error('[DB] Failed to set PRAGMAs or Indexes', e);
        }
    }
    return db;
};
