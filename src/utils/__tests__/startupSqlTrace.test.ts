import { describe, expect, it, vi } from 'vitest';
import {
    createStartupTracedSelect,
    STARTUP_SQL_TRACE_LIMIT,
    type StartupSqlTraceLabel,
} from '../startupSqlTrace';

const labels: StartupSqlTraceLabel[] = ['collection', 'maintenance', 'gallery', 'global-gallery'];

const createDb = () => ({
    path: 'sqlite:C:/Ambit/images.db',
    select: vi.fn(),
});

describe('startup SQL trace', () => {
    it('uses the database select unchanged when launch tracing is absent or malformed', async () => {
        const db = createDb();
        db.select.mockResolvedValueOnce(['absent']).mockResolvedValueOnce(['malformed']);
        const invoke = vi.fn();
        const capability = vi.fn()
            .mockReturnValueOnce(undefined)
            .mockReturnValueOnce({ launchId: 42 });
        const select = createStartupTracedSelect({
            getCapability: capability,
            invoke,
            now: () => 0,
            report: vi.fn(),
        });

        await expect(select<string[]>(db, 'gallery', 'SELECT ?', ['secret'])).resolves.toEqual(['absent']);
        await expect(select<string[]>(db, 'gallery', 'SELECT ?', ['secret'])).resolves.toEqual(['malformed']);

        expect(db.select).toHaveBeenNthCalledWith(1, 'SELECT ?', ['secret']);
        expect(db.select).toHaveBeenNthCalledWith(2, 'SELECT ?', ['secret']);
        expect(invoke).not.toHaveBeenCalled();
    });

    it('contains capability and clock failures without fabricating a report', async () => {
        const db = createDb();
        db.select.mockResolvedValue(['fallback']);
        const fallback = createStartupTracedSelect({
            getCapability: () => { throw new Error('capability unavailable'); },
            invoke: vi.fn(),
            now: () => 0,
            report: vi.fn(),
        });
        await expect(fallback<string[]>(db, 'gallery', 'SELECT fallback', ['same'])).resolves.toEqual(['fallback']);
        expect(db.select).toHaveBeenCalledWith('SELECT fallback', ['same']);

        const report = vi.fn();
        const select = createStartupTracedSelect({
            getCapability: () => ({ launchId: 'launch-1' }),
            invoke: vi.fn().mockResolvedValue(['traced']),
            now: () => Number.NaN,
            report,
        });
        await expect(select<string[]>(db, 'gallery', 'SELECT traced', [])).resolves.toEqual(['traced']);
        expect(report).not.toHaveBeenCalled();

        const clockFailure = createStartupTracedSelect({
            getCapability: () => ({ launchId: 'launch-2' }),
            invoke: vi.fn().mockResolvedValue(['still-traced']),
            now: () => { throw new Error('clock unavailable'); },
            report,
        });
        await expect(clockFailure<string[]>(db, 'gallery', 'SELECT still traced', [])).resolves.toEqual(['still-traced']);
        expect(report).not.toHaveBeenCalled();

        const overflowedClock = vi.fn()
            .mockReturnValueOnce(-Number.MAX_VALUE)
            .mockReturnValueOnce(Number.MAX_VALUE);
        const overflow = createStartupTracedSelect({
            getCapability: () => ({ launchId: 'launch-3' }),
            invoke: vi.fn().mockResolvedValue(['overflow-safe']),
            now: overflowedClock,
            report,
        });
        await expect(overflow<string[]>(db, 'gallery', 'SELECT overflow safe', [])).resolves.toEqual(['overflow-safe']);
        expect(report).not.toHaveBeenCalled();
    });

    it('preserves the four count labels and exact SQL-plugin query arguments', async () => {
        const db = createDb();
        const invoke = vi.fn().mockResolvedValue([]);
        const report = vi.fn();
        const select = createStartupTracedSelect({
            getCapability: () => ({ launchId: 'launch-1' }),
            invoke,
            now: () => 100,
            report,
        });

        for (const [index, label] of labels.entries()) {
            await select(db, label, `SELECT count(*) /* ${label} */`, index === 0 ? undefined : [index]);
        }

        expect(invoke.mock.calls).toEqual(labels.map((label, index) => [
            'plugin:sql|select',
            {
                db: 'sqlite:C:/Ambit/images.db',
                query: `SELECT count(*) /* ${label} */`,
                values: index === 0 ? [] : [index],
                startupTrace: { launchId: 'launch-1', callId: index + 1, label },
            },
        ]));
        expect(report.mock.calls.map(([entry]) => entry)).toEqual(labels.map((label, index) => ({
            launchId: 'launch-1', callId: index + 1, label, durationMs: 0, status: 'completed',
        })));
        expect(db.select).not.toHaveBeenCalled();
    });

    it('caps admitted calls while preserving the normal select for the next query', async () => {
        const db = createDb();
        db.select.mockResolvedValue(['fallback']);
        const invoke = vi.fn().mockResolvedValue([]);
        const select = createStartupTracedSelect({
            getCapability: () => ({ launchId: 'launch-1' }),
            invoke,
            now: () => 0,
            report: vi.fn(),
        });

        for (let index = 0; index < STARTUP_SQL_TRACE_LIMIT; index += 1) {
            await select(db, 'gallery', 'SELECT 1', [index]);
        }
        await expect(select<string[]>(db, 'gallery', 'SELECT 2', ['unchanged'])).resolves.toEqual(['fallback']);

        expect(invoke).toHaveBeenCalledTimes(STARTUP_SQL_TRACE_LIMIT);
        expect(invoke.mock.calls.at(-1)?.[1]).toEqual(expect.objectContaining({
            startupTrace: expect.objectContaining({ callId: STARTUP_SQL_TRACE_LIMIT }),
        }));
        expect(db.select).toHaveBeenCalledWith('SELECT 2', ['unchanged']);
    });

    it('reports completion after readiness closes admission and never masks select or reporting failures', async () => {
        const db = createDb();
        let active = true;
        let resolveInvoke: ((value: string[]) => void) | undefined;
        const invoke = <T>() => new Promise<T>(resolve => {
            resolveInvoke = value => resolve(value as T);
        });
        const report = vi.fn(() => Promise.reject(new Error('transport')));
        const select = createStartupTracedSelect({
            getCapability: () => active ? { launchId: 'launch-1' } : undefined,
            invoke,
            now: () => 12,
            report,
        });

        const pending = select<string[]>(db, 'collection', 'SELECT collection', ['private']);
        active = false;
        resolveInvoke?.(['result']);
        await expect(pending).resolves.toEqual(['result']);
        await Promise.resolve();
        expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', label: 'collection' }));

        const failure = new Error('SQL failure');
        const failedReport = vi.fn(() => { throw new Error('report failure'); });
        const rejected = createStartupTracedSelect({
            getCapability: () => ({ launchId: 'launch-2' }),
            invoke: vi.fn().mockRejectedValue(failure),
            now: () => 12,
            report: failedReport,
        });
        await expect(rejected(db, 'maintenance', 'SELECT maintenance', [])).rejects.toBe(failure);
        expect(failedReport).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', label: 'maintenance' }));
        expect(db.select).not.toHaveBeenCalled();
    });
});
