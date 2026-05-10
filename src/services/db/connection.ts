import Database from '@tauri-apps/plugin-sql';

let db: Database | null = null;
let dbInitialized = false;
const SLOW_STARTUP_PHASE_MS = 1000;

const logStartupDbPhase = (phase: string, startedAt: number) => {
    const elapsed = Math.round(performance.now() - startedAt);
    const message = `[Startup DB] ${phase} completed in ${elapsed}ms`;
    if (elapsed >= SLOW_STARTUP_PHASE_MS) {
        console.warn(message);
    } else {
        console.info(message);
    }
};

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
        const loadStartedAt = performance.now();
        db = await Database.load('sqlite:images.db');
        logStartupDbPhase('Database.load', loadStartedAt);
    }

    if (!dbInitialized && db) {
        dbInitialized = true;
        // Enable WAL mode and busy timeout for better concurrency
        try {
            const pragmaStartedAt = performance.now();
            await db.execute('PRAGMA journal_mode=WAL');
            await db.execute('PRAGMA synchronous=NORMAL');
            await db.execute('PRAGMA busy_timeout=60000'); // Higher timeout for massive batches
            await db.execute('PRAGMA cache_size=-64000');   // 64MB cache for large libraries
            await db.execute('PRAGMA temp_store=MEMORY');   // Faster sorting/grouping
            await db.execute('PRAGMA mmap_size=268435456'); // 256MB memory-mapped I/O
            logStartupDbPhase('Performance PRAGMAs', pragmaStartedAt);

            // --- AMBIT PERFORMANCE PATCHES ---
            const indexStartedAt = performance.now();
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_fast_sort_v3 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), timestamp DESC, id DESC)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_model_stats_v2 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), resolved_model_name, model_name)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_privacy_fast_sort_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), privacy_hidden, timestamp DESC, id DESC)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_privacy_model_stats_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), privacy_hidden, resolved_model_name, model_name)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_name_sort_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), path ASC, id ASC)');
            await db.execute('CREATE INDEX IF NOT EXISTS idx_images_size_sort_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), file_size DESC, id DESC)');
            logStartupDbPhase('Frontend covering indexes', indexStartedAt);
        } catch (e) {
            console.error('[DB] Failed to set PRAGMAs or Indexes', e);
        }
    }
    return db;
};
