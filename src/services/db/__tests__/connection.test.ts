import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const databaseLoadMock = vi.hoisted(() => vi.fn());
const getMainDatabaseUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-sql', () => ({
    default: {
        load: databaseLoadMock,
    },
}));

vi.mock('../../../bindings', () => ({
    commands: {
        getMainDatabaseUrl: getMainDatabaseUrlMock,
    },
}));

const createDatabaseMock = () => ({
    execute: vi.fn().mockResolvedValue(undefined),
});

describe('database connection', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        getMainDatabaseUrlMock.mockResolvedValue({
            status: 'ok',
            data: 'sqlite:C:/Users/AmbitTester/AppData/Local/io.github.asuraace.ambit/images.db',
        });
        databaseLoadMock.mockResolvedValue(createDatabaseMock());
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('loads the backend-selected main database URL', async () => {
        const { getDb } = await import('../connection');

        await getDb();

        expect(getMainDatabaseUrlMock).toHaveBeenCalledTimes(1);
        expect(databaseLoadMock).toHaveBeenCalledWith(
            'sqlite:C:/Users/AmbitTester/AppData/Local/io.github.asuraace.ambit/images.db'
        );
    });

    it('shares one database URL lookup across concurrent startup loads', async () => {
        const { getDb } = await import('../connection');

        await Promise.all([getDb(), getDb()]);

        expect(getMainDatabaseUrlMock).toHaveBeenCalledTimes(1);
        expect(databaseLoadMock).toHaveBeenCalledTimes(1);
    });

    it('retains the measured legacy PRAGMAs before creating existing indexes', async () => {
        const database = createDatabaseMock();
        databaseLoadMock.mockResolvedValue(database);
        const { getDb } = await import('../connection');

        await getDb();

        expect(database.execute).toHaveBeenCalledTimes(12);
        expect(database.execute.mock.calls.slice(0, 6).map(([statement]) => statement)).toEqual([
            'PRAGMA journal_mode=WAL',
            'PRAGMA synchronous=NORMAL',
            'PRAGMA busy_timeout=60000',
            'PRAGMA cache_size=-64000',
            'PRAGMA temp_store=MEMORY',
            'PRAGMA mmap_size=268435456',
        ]);
        for (const [statement] of database.execute.mock.calls.slice(6)) {
            expect(statement).toMatch(/^CREATE INDEX IF NOT EXISTS /);
        }
    });

    it('logs startup database phases so slow local libraries can be diagnosed', async () => {
        const { getDb } = await import('../connection');
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        let nowMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
        const timedDatabase = createDatabaseMock();
        timedDatabase.execute.mockImplementation(async () => { nowMs += 1; });
        databaseLoadMock.mockImplementation(async () => {
            nowMs += 10;
            return timedDatabase;
        });

        await getDb();

        expect(infoSpy).toHaveBeenCalledWith('[Startup DB] Database.load completed in 10ms');
        expect(infoSpy).toHaveBeenCalledWith('[Startup DB] Performance PRAGMAs completed in 6ms');
        expect(infoSpy).toHaveBeenCalledWith('[Startup DB] Frontend covering indexes completed in 6ms');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('logs database optimization failures without blocking library load', async () => {
        const dbMock = createDatabaseMock();
        const optimizationError = new Error('index failed');
        dbMock.execute.mockImplementation(async (statement: string) => {
            if (statement.startsWith('CREATE INDEX')) throw optimizationError;
        });
        databaseLoadMock.mockResolvedValue(dbMock);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { getDb } = await import('../connection');

        await expect(getDb()).resolves.toBe(dbMock);

        expect(errorSpy).toHaveBeenCalledWith('[DB] Failed to create optional indexes', optimizationError);
    });
});
