import Database from '@tauri-apps/plugin-sql';
import { commands } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import { measureStartupPhase, startupDiagnostics } from '../../utils/startupDiagnostics';

let db: Database | null = null;
let dbInitialized = false;
let dbInitializationPromise: Promise<Database> | null = null;
let dbUrlPromise: Promise<string> | null = null;
const SLOW_STARTUP_PHASE_MS = 1000;

export type StartupDbPhase =
    | 'Preparing library database'
    | 'Updating database schema'
    | 'Optimizing database'
    | 'Loading library';

interface GetDbOptions {
    onPhase?: (phase: StartupDbPhase) => void;
}

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

const getMainDatabaseUrl = () => {
    if (!dbUrlPromise) {
        dbUrlPromise = unwrap(commands.getMainDatabaseUrl()).catch((error) => {
            dbUrlPromise = null;
            throw error;
        });
    }
    return dbUrlPromise;
};

export const getDb = async (options: GetDbOptions = {}) => {
    if (!dbInitialized) {
        options.onPhase?.('Updating database schema');
        const loadStartedAt = performance.now();
        if (!dbInitializationPromise) {
            dbInitializationPromise = (async () => {
                if (!db) {
                    const databaseUrl = await getMainDatabaseUrl();
                    db = await measureStartupPhase('database-schema', () => Database.load(databaseUrl));
                    logStartupDbPhase('Database.load', loadStartedAt);
                }

                const activeDb = db;
                if (!activeDb) throw new Error('Database connection was not initialized.');
                const finishOptimization = startupDiagnostics.start('database-optimization');
                options.onPhase?.('Optimizing database');
                let optimizationError: unknown;

                const pragmaStartedAt = performance.now();
                const finishPragmas = startupDiagnostics.start('database-pragmas');
                try {
                    // Retain the measured legacy policy on one pooled connection.
                    // Applying these settings to every physical connection was rejected
                    // after synthetic latency and memory regressions.
                    await activeDb.execute('PRAGMA journal_mode=WAL');
                    await activeDb.execute('PRAGMA synchronous=NORMAL');
                    await activeDb.execute('PRAGMA busy_timeout=60000');
                    await activeDb.execute('PRAGMA cache_size=-64000');
                    await activeDb.execute('PRAGMA temp_store=MEMORY');
                    await activeDb.execute('PRAGMA mmap_size=268435456');
                    logStartupDbPhase('Performance PRAGMAs', pragmaStartedAt);
                    finishPragmas();
                } catch (error) {
                    optimizationError = error;
                    finishPragmas('failed', error);
                    console.error('[DB] Failed to set optional PRAGMAs', error);
                }

                const indexStartedAt = performance.now();
                const finishIndexes = startupDiagnostics.start('database-indexes');
                try {
                    await activeDb.execute('CREATE INDEX IF NOT EXISTS idx_images_fast_sort_v3 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), timestamp DESC, id DESC)');
                    await activeDb.execute('CREATE INDEX IF NOT EXISTS idx_images_model_stats_v2 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), resolved_model_name, model_name)');
                    await activeDb.execute('CREATE INDEX IF NOT EXISTS idx_images_privacy_fast_sort_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), privacy_hidden, timestamp DESC, id DESC)');
                    await activeDb.execute('CREATE INDEX IF NOT EXISTS idx_images_privacy_model_stats_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), privacy_hidden, resolved_model_name, model_name)');
                    await activeDb.execute('CREATE INDEX IF NOT EXISTS idx_images_name_sort_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), path ASC, id ASC)');
                    await activeDb.execute('CREATE INDEX IF NOT EXISTS idx_images_size_sort_v1 ON images(is_deleted, IFNULL(is_intermediate_gen, 0), IFNULL(is_grid_gen, 0), file_size DESC, id DESC)');
                    logStartupDbPhase('Frontend covering indexes', indexStartedAt);
                    finishIndexes();
                } catch (error) {
                    optimizationError ??= error;
                    finishIndexes('failed', error);
                    console.error('[DB] Failed to create optional indexes', error);
                }

                // Optional setup must never discard a database that loaded successfully.
                dbInitialized = true;
                if (optimizationError) finishOptimization('failed', optimizationError);
                else finishOptimization();
                return activeDb;
            })().catch((error) => {
                dbInitializationPromise = null;
                throw error;
            });
        }
        await dbInitializationPromise;
    }
    options.onPhase?.('Loading library');
    return db!;
};
