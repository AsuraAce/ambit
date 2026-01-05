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
            await db.execute('PRAGMA busy_timeout=30000'); // Higher timeout for massive batches
            await db.execute('PRAGMA cache_size=-64000');   // 64MB cache for large libraries
            await db.execute('PRAGMA temp_store=MEMORY');   // Faster sorting/grouping
            await db.execute('PRAGMA mmap_size=268435456'); // 256MB memory-mapped I/O
            console.log('[DB] Applied performance PRAGMAs');

            // Initialize Keyword Index (FTS5)
            await db.execute(`
                CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
                    id UNINDEXED,
                    positive_prompt
                )
            `);

            // Sync triggers for automatic indexing
            await db.execute(`
                CREATE TRIGGER IF NOT EXISTS images_ai AFTER INSERT ON images BEGIN
                    INSERT INTO images_fts(id, positive_prompt) 
                    VALUES (new.id, json_extract(new.metadata_json, '$.positivePrompt'));
                END
            `);

            await db.execute(`
                CREATE TRIGGER IF NOT EXISTS images_ad AFTER DELETE ON images BEGIN
                    DELETE FROM images_fts WHERE id = old.id;
                END
            `);

            await db.execute(`
                CREATE TRIGGER IF NOT EXISTS images_au AFTER UPDATE OF metadata_json ON images BEGIN
                    UPDATE images_fts 
                    SET positive_prompt = json_extract(new.metadata_json, '$.positivePrompt')
                    WHERE id = old.id;
                END
            `);

            // Backfill if empty (for existing libraries)
            const ftsCount = await db.select<any[]>('SELECT count(*) as count FROM images_fts');
            if (ftsCount[0]?.count === 0) {
                console.log('[DB] Backfilling FTS index...');
                await db.execute(`
                    INSERT INTO images_fts(id, positive_prompt)
                    SELECT id, json_extract(metadata_json, '$.positivePrompt')
                    FROM images
                    WHERE is_deleted = 0;
                `);
            }

        } catch (e) {
            console.error('[DB] Failed to set PRAGMAs or init FTS', e);
        }
    }
    return db;
};
