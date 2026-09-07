import { describe, expect, it, vi } from 'vitest';
import { createStartupDiagnosticBridge } from '../startupDiagnostics';

describe('startup diagnostic bridge', () => {
    it('keeps renderer elapsed times while launch identity resolves asynchronously', async () => {
        const send = vi.fn();
        let resolveLaunch: ((value: { launchId: string; processElapsedMs: number }) => void) | undefined;
        const bridge = createStartupDiagnosticBridge({
            now: () => 90,
            send,
            getLaunch: () => new Promise(resolve => { resolveLaunch = resolve; }),
            originMs: 90,
        });

        const connecting = bridge.connect();
        bridge.mark('frontend-entry');
        expect(send).not.toHaveBeenCalled();

        resolveLaunch?.({ launchId: 'native-launch', processElapsedMs: 12 });
        await connecting;

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            launchId: 'native-launch', phase: 'frontend-entry', elapsedMs: 0,
        }));
    });

    it('reserves terminal startup events when its bounded buffer is full', async () => {
        const send = vi.fn();
        let resolveLaunch: ((value: { launchId: string; processElapsedMs: number }) => void) | undefined;
        const bridge = createStartupDiagnosticBridge({
            now: () => 0,
            send,
            getLaunch: () => new Promise(resolve => { resolveLaunch = resolve; }),
            maxBufferedEvents: 2,
        });

        const connecting = bridge.connect();
        bridge.mark('facets');
        bridge.mark('collections');
        bridge.fail('startup-failure', 'render-error');
        resolveLaunch?.({ launchId: 'native-launch', processElapsedMs: 1 });
        await connecting;

        expect(send.mock.calls.map(([event]) => event.phase)).toContain('startup-failure');
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('keeps the bootstrap stall as a completed diagnostic, not a failure', async () => {
        const send = vi.fn();
        const bridge = createStartupDiagnosticBridge({
            now: () => 100,
            send,
            getLaunch: async () => ({ launchId: 'native-launch', processElapsedMs: 1 }),
        });

        bridge.ingestBootstrapEvents([{
            phase: 'renderer-stall', status: 'completed', elapsedMs: 15_000,
            durationMs: 15_000, cacheAction: null,
        }]);
        await bridge.connect();

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            phase: 'renderer-stall', status: 'completed', elapsedMs: 15_000,
        }));
    });

    it('continues to send terminal events after connected diagnostics reach their normal-event bound', async () => {
        const send = vi.fn();
        const bridge = createStartupDiagnosticBridge({
            now: () => 0,
            send,
            getLaunch: async () => ({ launchId: 'native-launch', processElapsedMs: 1 }),
            maxBufferedEvents: 1,
        });

        await bridge.connect();
        bridge.mark('facets');
        bridge.mark('collections');
        bridge.fail('startup-failure', 'render-error');

        expect(send.mock.calls.map(([event]) => event.phase)).toEqual(['facets', 'startup-failure']);
    });

    it('sends each terminal phase and status once even if it is repeatedly reported', async () => {
        const send = vi.fn();
        const bridge = createStartupDiagnosticBridge({
            now: () => 0,
            send,
            getLaunch: async () => ({ launchId: 'native-launch', processElapsedMs: 1 }),
        });

        await bridge.connect();
        bridge.fail('startup-failure', 'script-load');
        bridge.fail('startup-failure', 'uncaught-error');
        bridge.mark('ready');
        bridge.mark('ready');

        expect(send.mock.calls.map(([event]) => [event.phase, event.status, event.failureKind]))
            .toEqual([
                ['startup-failure', 'failed', 'script-load'],
                ['ready', 'completed', undefined],
            ]);
    });

    it('drains buffered diagnostics when launch lookup or a launch listener throws', async () => {
        const send = vi.fn();
        const bridge = createStartupDiagnosticBridge({
            now: () => 0,
            send,
            getLaunch: () => {
                throw new Error('synchronous launch lookup failure');
            },
        });

        bridge.mark('frontend-entry');
        await expect(bridge.connect()).resolves.toBeUndefined();
        expect(bridge.getLaunchId()).toBeNull();

        const resolvedBridge = createStartupDiagnosticBridge({
            now: () => 0,
            send,
            getLaunch: async () => ({ launchId: 'native-launch', processElapsedMs: 1 }),
        });
        resolvedBridge.subscribe(() => { throw new Error('listener failure'); });
        resolvedBridge.mark('frontend-entry');
        await resolvedBridge.connect();

        expect(send).toHaveBeenCalledWith(expect.objectContaining({
            launchId: 'native-launch', phase: 'frontend-entry',
        }));
    });

    it('notifies startup-failure listeners for direct and bootstrap failures', async () => {
        const bridge = createStartupDiagnosticBridge({
            now: () => 0,
            send: vi.fn(),
            getLaunch: async () => ({ launchId: 'native-launch', processElapsedMs: 1 }),
        });
        const onFailure = vi.fn();
        bridge.subscribeFailures(onFailure);

        bridge.fail('startup-failure', 'script-load');
        bridge.ingestBootstrapEvents([{
            phase: 'startup-failure', status: 'failed', elapsedMs: 2, durationMs: null,
            cacheAction: null, failureKind: 'uncaught-error',
        }]);

        expect(onFailure).toHaveBeenCalledTimes(2);
        const lateFailureListener = vi.fn();
        bridge.subscribeFailures(lateFailureListener);
        expect(lateFailureListener).toHaveBeenCalledWith('startup-failure');
    });

    it('does not surface a native-launch failure to boot callers', async () => {
        const bridge = createStartupDiagnosticBridge({
            now: () => 0,
            send: vi.fn(),
            getLaunch: async () => { throw new Error('unavailable'); },
        });

        await expect(bridge.connect()).resolves.toBeUndefined();
        expect(bridge.getLaunchId()).toBeNull();
    });

    it('admits opt-in SQL tracing only during the renderer startup window', async () => {
        let now = 0;
        const recordSqlFrontend = vi.fn(() => Promise.reject(new Error('diagnostic transport')));
        const bridge = createStartupDiagnosticBridge({
            now: () => now,
            send: vi.fn(),
            recordSqlFrontend,
            getLaunch: async () => ({ launchId: 'native-launch', processElapsedMs: 1, sqlTraceEnabled: true }),
        });

        await bridge.connect();
        expect(bridge.getSqlTraceCapability()).toBeUndefined();
        bridge.mark('frontend-entry');
        expect(bridge.getSqlTraceCapability()).toEqual({ launchId: 'native-launch' });
        bridge.recordSqlFrontend({
            launchId: 'native-launch', callId: 1, label: 'gallery', durationMs: 0, status: 'completed',
        });
        now = 179_999;
        expect(bridge.getSqlTraceCapability()).toEqual({ launchId: 'native-launch' });
        now = 180_000;
        expect(bridge.getSqlTraceCapability()).toBeUndefined();

        const readyBridge = createStartupDiagnosticBridge({
            now: () => 0,
            send: vi.fn(),
            getLaunch: async () => ({ launchId: 'native-launch', processElapsedMs: 1, sqlTraceEnabled: true }),
        });
        await readyBridge.connect();
        readyBridge.mark('frontend-entry');
        readyBridge.mark('ready');
        expect(readyBridge.getSqlTraceCapability()).toBeUndefined();
        await Promise.resolve();
        expect(recordSqlFrontend).toHaveBeenCalledOnce();
    });
});
