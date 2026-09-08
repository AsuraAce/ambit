import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    it('serializes mutex work and unlocks after a rejected operation', async () => {
        const { Mutex } = await import('../connection');
        const mutex = new Mutex();
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });

        const first = mutex.dispatch(async () => {
            events.push('first-start');
            await firstGate;
            events.push('first-end');
            throw new Error('first failed');
        });
        const second = mutex.dispatch(() => {
            events.push('second');
            return 2;
        });
        await vi.waitFor(() => expect(events).toEqual(['first-start']));
        releaseFirst();

        await expect(first).rejects.toThrow('first failed');
        await expect(second).resolves.toBe(2);
        expect(events).toEqual(['first-start', 'first-end', 'second']);
    });

    it('reports startup phases and reuses the initialized database', async () => {
        const database = createDatabaseMock();
        databaseLoadMock.mockResolvedValue(database);
        const onPhase = vi.fn();
        const { getDb } = await import('../connection');

        const first = await getDb({ onPhase });
        const second = await getDb({ onPhase });

        expect(first).toBe(database);
        expect(second).toBe(database);
        expect(onPhase).toHaveBeenCalledWith('Updating database schema');
        expect(onPhase).toHaveBeenCalledWith('Optimizing database');
        expect(onPhase).toHaveBeenCalledWith('Loading library');
        expect(databaseLoadMock).toHaveBeenCalledTimes(1);
        expect(database.execute).toHaveBeenCalledTimes(12);
    });

    it('retries database URL lookup after a transient backend failure', async () => {
        getMainDatabaseUrlMock
            .mockRejectedValueOnce(new Error('backend unavailable'))
            .mockResolvedValueOnce({ status: 'ok', data: 'sqlite:C:/retry.db' });
        const { getDb } = await import('../connection');

        await expect(getDb()).rejects.toThrow('backend unavailable');
        await expect(getDb()).resolves.toBeTruthy();

        expect(getMainDatabaseUrlMock).toHaveBeenCalledTimes(2);
        expect(databaseLoadMock).toHaveBeenCalledWith('sqlite:C:/retry.db');
    });

    it('retries database loading after the plugin rejects', async () => {
        databaseLoadMock
            .mockRejectedValueOnce(new Error('file locked'))
            .mockResolvedValueOnce(createDatabaseMock());
        const { getDb } = await import('../connection');

        await expect(getDb()).rejects.toThrow('file locked');
        await expect(getDb()).resolves.toBeTruthy();

        expect(databaseLoadMock).toHaveBeenCalledTimes(2);
        expect(getMainDatabaseUrlMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the loaded database available when optional optimization fails', async () => {
        const database = createDatabaseMock();
        database.execute.mockImplementation(async (statement: string) => {
            if (statement.startsWith('CREATE INDEX')) throw new Error('index creation failed');
        });
        databaseLoadMock.mockResolvedValue(database);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { getDb } = await import('../connection');

        await expect(getDb()).resolves.toBe(database);
        await expect(getDb()).resolves.toBe(database);

        expect(error).toHaveBeenCalledWith('[DB] Failed to create optional indexes', expect.any(Error));
        expect(databaseLoadMock).toHaveBeenCalledTimes(1);
        expect(database.execute).toHaveBeenCalledTimes(7);
        error.mockRestore();
    });
    it.each([1, 6])('holds every caller until optional index operation %i settles', async (heldCall) => {
        const database = createDatabaseMock();
        let releaseInitialization!: () => void;
        const initializationGate = new Promise<void>(resolve => {
            releaseInitialization = resolve;
        });
        let calls = 0;
        database.execute.mockImplementation(async () => {
            calls += 1;
            if (calls === 6 + heldCall) await initializationGate;
        });
        databaseLoadMock.mockResolvedValue(database);
        const { getDb } = await import('../connection');

        const returned = vi.fn();
        const load = () => getDb().then(db => { returned(); return db; });
        const first = load();
        const second = load();
        await vi.waitFor(() => expect(database.execute).toHaveBeenCalledTimes(6 + heldCall));
        const lateCaller = load();
        await Promise.resolve();
        await Promise.resolve();
        expect(returned).not.toHaveBeenCalled();
        expect(getMainDatabaseUrlMock).toHaveBeenCalledTimes(1);
        expect(databaseLoadMock).toHaveBeenCalledTimes(1);

        releaseInitialization();
        await expect(Promise.all([first, second, lateCaller])).resolves.toEqual([database, database, database]);
        expect(database.execute).toHaveBeenCalledTimes(12);
    });

    it('continues to indexes when legacy PRAGMA setup fails', async () => {
        const database = createDatabaseMock();
        database.execute.mockRejectedValueOnce(new Error('pragma failed'));
        databaseLoadMock.mockResolvedValue(database);
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { getDb } = await import('../connection');

        await expect(getDb()).resolves.toBe(database);

        expect(error).toHaveBeenCalledWith('[DB] Failed to set optional PRAGMAs', expect.any(Error));
        expect(database.execute).toHaveBeenCalledTimes(7);
        for (const [statement] of database.execute.mock.calls.slice(1)) {
            expect(statement).toMatch(/^CREATE INDEX IF NOT EXISTS /);
        }
        error.mockRestore();
    });

    it('warns when startup phases exceed the slow threshold', async () => {
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => {
            now += 1500;
            return now;
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { getDb } = await import('../connection');

        await getDb();

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('[Startup DB] Database.load completed'));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('[Startup DB] Frontend covering indexes completed'));
        warn.mockRestore();
    });
});
