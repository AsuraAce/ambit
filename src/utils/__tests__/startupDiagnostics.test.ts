import { describe, expect, it, vi } from 'vitest';
import { createStartupDiagnostics } from '../startupDiagnostics';
import type { StartupPhase } from '../../bindings';

describe('startup diagnostics', () => {
    it.each<[StartupPhase, string]>([
        ['owner-source-open', 'invoke-source'],
        ['owner-source-schema', 'invoke-source'],
        ['owner-source-images', 'invoke-source'],
        ['owner-source-boards', 'invoke-source'],
        ['gallery-rows', 'ambit'],
        ['gallery-count', 'ambit'],
        ['gallery-global-count', 'ambit'],
        ['statistics-media', 'ambit'],
        ['statistics-steps', 'ambit'],
        ['statistics-models', 'ambit'],
        ['facet-counts', 'ambit'],
    ])('attributes %s without exposing source or query values', (phase, databaseRole) => {
        const send = vi.fn();
        const trace = createStartupDiagnostics(send, () => 0, 'a0');
        trace.start(phase)('failed', new Error('database is locked: private-source'));
        expect(send.mock.calls[1][0]).toMatchObject({ phase, databaseRole, failureKind: 'database-busy' });
        expect(JSON.stringify(send.mock.calls)).not.toContain('private-source');
    });

    it('attributes a failed visibility operation without persisting the raw error', () => {
        const send = vi.fn();
        let now = 0;
        const trace = createStartupDiagnostics(send, () => now, 'a0');
        const finish = trace.start('owner-visibility');
        now = 25;
        finish('failed', new Error('database is locked: secret-owner at D:/private/images.db'));
        expect(send.mock.calls[1][0]).toEqual({
            launchId: 'a0', phase: 'owner-visibility', status: 'failed',
            elapsedMs: 25, durationMs: 25, cacheAction: null,
            databaseRole: 'ambit', attempt: 1, failureKind: 'database-busy',
        });
        expect(JSON.stringify(send.mock.calls)).not.toMatch(/secret-owner|private/);
    });
    it('bounds normal logging while reserving readiness markers', () => {
        const send = vi.fn();
        const trace = createStartupDiagnostics(send, () => 0, 'a0');
        trace.mark('ready');
        trace.mark('ready');
        expect(send).toHaveBeenCalledTimes(1);
        for (let i = 0; i < 300; i += 1) trace.start('facets')();
        expect(send).toHaveBeenCalledTimes(257);
    });

    it.each([
        ['SQLITE_BUSY_SNAPSHOT', 'database-busy'],
        ['database table is locked', 'database-locked'],
        ['permission denied: private/path', 'other'],
    ])('classifies %s without transmitting error text', (error, failureKind) => {
        const send = vi.fn();
        const trace = createStartupDiagnostics(send, () => 0, 'a0');
        trace.start('owner-board-read', null, 2)('failed', error);
        expect(send.mock.calls[1][0]).toEqual(expect.objectContaining({
            databaseRole: 'invoke-source', attempt: 2, failureKind,
        }));
        expect(JSON.stringify(send.mock.calls)).not.toContain(error);
    });

    it('does not let a diagnostic transport failure break startup', () => {
        const trace = createStartupDiagnostics(() => { throw new Error('transport unavailable'); }, () => 0, 'a0');
        expect(() => trace.start('database')('failed')).not.toThrow();
    });
    it('records attributable bounded phase timings without user data', () => {
        let now = 100;
        const send = vi.fn();
        const trace = createStartupDiagnostics(send, () => now, 'a0-b1');
        const finish = trace.start('owner-cache', 'selective');
        now = 150;
        finish();
        finish();
        expect(send.mock.calls.map(([event]) => event)).toEqual([
            { launchId: 'a0-b1', phase: 'owner-cache', status: 'started', elapsedMs: 0, durationMs: null, cacheAction: 'selective', databaseRole: 'ambit', attempt: 1 },
            { launchId: 'a0-b1', phase: 'owner-cache', status: 'completed', elapsedMs: 50, durationMs: 50, cacheAction: 'selective', databaseRole: 'ambit', attempt: 1 },
        ]);
    });
});
