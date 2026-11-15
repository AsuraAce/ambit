import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDb: vi.fn(),
    selectReadonly: vi.fn(),
}));

vi.mock('../connection', () => ({ getDb: mocks.getDb }));
vi.mock('../../../bindings', () => ({ commands: { selectReadonly: mocks.selectReadonly } }));

import { selectReadonly } from '../readonlySelect';

describe('selectReadonly', () => {
    beforeEach(() => {
        mocks.getDb.mockReset().mockResolvedValue({});
        mocks.selectReadonly.mockReset().mockResolvedValue({ status: 'ok', data: [{ count: 2 }] });
    });

    it('binds the values the plugin accepted, with undefined as NULL', async () => {
        await expect(selectReadonly('SELECT ?, ?, ?, ?, ?', ['a', 1.5, true, null, undefined])).resolves.toEqual([{ count: 2 }]);

        expect(mocks.selectReadonly).toHaveBeenCalledWith('SELECT ?, ?, ?, ?, ?', ['a', 1.5, true, null, null]);
    });

    it('binds a number that is not finite as NULL, as the plugin did', async () => {
        // "steps:abc" binds Number('abc'); the count must read as no matches instead of failing.
        await selectReadonly('SELECT ?, ?, ?', [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);

        expect(mocks.selectReadonly).toHaveBeenCalledWith('SELECT ?, ?, ?', [null, null, null]);
    });

    it('refuses a value it cannot bind instead of sending it as something else', async () => {
        // An object would lose its meaning on the way, which would silently change a filter.
        await expect(selectReadonly('SELECT ?', [{ id: 1 }])).rejects.toThrow(TypeError);
        expect(mocks.selectReadonly).not.toHaveBeenCalled();
    });

    it('waits for the plugin to open and migrate the library before reading', async () => {
        // The read-only connection never creates or migrates the database itself.
        mocks.getDb.mockRejectedValue(new Error('database unavailable'));

        await expect(selectReadonly('SELECT 1')).rejects.toThrow('database unavailable');
        expect(mocks.selectReadonly).not.toHaveBeenCalled();
    });

    it('rejects with the command error, including a read stopped by exit or reload', async () => {
        mocks.selectReadonly.mockResolvedValue({ status: 'error', error: 'Read stopped: the page reloaded or Ambit is closing.' });

        await expect(selectReadonly('SELECT 1')).rejects.toBe('Read stopped: the page reloaded or Ambit is closing.');
    });
});
