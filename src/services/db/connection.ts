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
        } catch (e) {
            console.error('[DB] Failed to set PRAGMAs', e);
        }
    }
    return db;
};
