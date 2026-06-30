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
            data: 'sqlite:C:/Users/Artemis/AppData/Local/io.github.asuraace.ambit/images.db',
        });
        databaseLoadMock.mockResolvedValue(createDatabaseMock());
    });

    it('loads the backend-selected main database URL', async () => {
        const { getDb } = await import('../connection');

        await getDb();

        expect(getMainDatabaseUrlMock).toHaveBeenCalledTimes(1);
        expect(databaseLoadMock).toHaveBeenCalledWith(
            'sqlite:C:/Users/Artemis/AppData/Local/io.github.asuraace.ambit/images.db'
        );
    });

    it('shares one database URL lookup across concurrent startup loads', async () => {
        const { getDb } = await import('../connection');

        await Promise.all([getDb(), getDb()]);

        expect(getMainDatabaseUrlMock).toHaveBeenCalledTimes(1);
        expect(databaseLoadMock).toHaveBeenCalledTimes(1);
    });
});
