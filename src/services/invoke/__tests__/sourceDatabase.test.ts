import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from '@tauri-apps/plugin-sql';
import { commands } from '../../../bindings';
import { openInvokeSourceDatabase } from '../sourceDatabase';

vi.mock('../../../bindings', () => ({
    commands: {
        selectInvokeSource: vi.fn(),
    },
}));

describe('openInvokeSourceDatabase', () => {
    beforeEach(() => {
        vi.mocked(commands.selectInvokeSource).mockReset();
        vi.mocked(Database.load).mockClear();
    });

    // #364: InvokeAI's database is read through the read-only command, never a read-write plugin handle.
    it('reads InvokeAI through the read-only command and never opens a plugin handle', async () => {
        vi.mocked(commands.selectInvokeSource)
            .mockResolvedValueOnce({ status: 'ok', data: { columns: ['1'], rows: [[1]] } })
            .mockResolvedValueOnce({
                status: 'ok',
                data: {
                    columns: ['image_name', 'width', 'user_id'],
                    rows: [
                        ['a.png', 512, null],
                        ['b.png', 640, 'alice'],
                    ],
                },
            });

        const db = await openInvokeSourceDatabase('D:/Invoke/databases/invokeai.db');
        const rows = await db.select('SELECT image_name, width, user_id FROM images WHERE user_id = ? AND starred = ? AND width > ?', [
            'alice',
            true,
            1.5,
        ]);

        expect(rows).toEqual([
            { image_name: 'a.png', width: 512, user_id: null },
            { image_name: 'b.png', width: 640, user_id: 'alice' },
        ]);
        expect(commands.selectInvokeSource).toHaveBeenNthCalledWith(1, 'D:/Invoke/databases/invokeai.db', 'SELECT 1', []);
        expect(commands.selectInvokeSource).toHaveBeenNthCalledWith(
            2,
            'D:/Invoke/databases/invokeai.db',
            'SELECT image_name, width, user_id FROM images WHERE user_id = ? AND starred = ? AND width > ?',
            ['alice', 1, 1.5]
        );
        expect(Database.load).not.toHaveBeenCalled();
    });

    it('fails at open time when the source cannot be read', async () => {
        vi.mocked(commands.selectInvokeSource).mockResolvedValue({
            status: 'error',
            error: 'InvokeAI database is outside the allowed filesystem scope: D:/Other/databases/invokeai.db',
        });

        await expect(openInvokeSourceDatabase('D:/Other')).rejects.toMatch('outside the allowed filesystem scope');
    });

    it('rejects parameter types the source command cannot bind', async () => {
        vi.mocked(commands.selectInvokeSource).mockResolvedValue({ status: 'ok', data: { columns: [], rows: [] } });
        const db = await openInvokeSourceDatabase('D:/Invoke');

        await expect(db.select('SELECT 1 WHERE ? IS NULL', [{ value: 1 }])).rejects.toThrow('Unsupported InvokeAI query parameter type');
    });
});
