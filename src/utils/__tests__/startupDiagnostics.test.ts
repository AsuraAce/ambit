import { describe, expect, it, vi } from 'vitest';
import { createStartupDiagnostics } from '../startupDiagnostics';

describe('startup diagnostics', () => {
    it('bounds logging and deduplicates readiness markers', () => {
        const send = vi.fn();
        const trace = createStartupDiagnostics(send, () => 0, 'a0');
        trace.mark('ready');
        trace.mark('ready');
        expect(send).toHaveBeenCalledTimes(1);
        for (let i = 0; i < 300; i += 1) trace.start('facets')();
        expect(send).toHaveBeenCalledTimes(256);
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
            { launchId: 'a0-b1', phase: 'owner-cache', status: 'started', elapsedMs: 0, durationMs: null, cacheAction: 'selective' },
            { launchId: 'a0-b1', phase: 'owner-cache', status: 'completed', elapsedMs: 50, durationMs: 50, cacheAction: 'selective' },
        ]);
    });
});
