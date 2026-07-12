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

    it('logs startup database phases so slow local libraries can be diagnosed', async () => {
        const { getDb } = await import('../connection');
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        let nowMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => {
            nowMs += 10;
            return nowMs;
        });

        await getDb();

        expect(infoSpy).toHaveBeenCalledWith('[Startup DB] Database.load completed in 10ms');
        expect(infoSpy).toHaveBeenCalledWith('[Startup DB] Performance PRAGMAs completed in 10ms');
        expect(infoSpy).toHaveBeenCalledWith('[Startup DB] Frontend covering indexes completed in 10ms');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('logs database optimization failures without blocking library load', async () => {
        const dbMock = createDatabaseMock();
        const optimizationError = new Error('pragma failed');
        dbMock.execute.mockRejectedValueOnce(optimizationError);
        databaseLoadMock.mockResolvedValue(dbMock);
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { getDb } = await import('../connection');

        await expect(getDb()).resolves.toBe(dbMock);

        expect(errorSpy).toHaveBeenCalledWith('[DB] Failed to set PRAGMAs or Indexes', optimizationError);
    });
});
