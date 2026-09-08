import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getStartupLaunch: vi.fn(),
    recordStartupDiagnostic: vi.fn(),
    recordStartupHeartbeat: vi.fn(),
}));

vi.mock('../../bindings', () => ({
    commands: mocks,
}));
vi.mock('../../services/runtime', () => ({
    isTauriRuntime: () => true,
}));

const loadDiagnostics = async () => {
    const diagnostics = await import('../startupDiagnostics');
    await Promise.resolve();
    return diagnostics;
};

describe('startup diagnostics heartbeat integration', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        mocks.getStartupLaunch.mockResolvedValue({ launchId: 'launch-1', processElapsedMs: 0 });
        mocks.recordStartupHeartbeat.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stops future heartbeats when startup becomes ready', async () => {
        const { startStartupHeartbeat, startupDiagnostics } = await loadDiagnostics();
        startupDiagnostics.mark('frontend-entry');
        startStartupHeartbeat();
        await vi.advanceTimersByTimeAsync(0);
        startupDiagnostics.mark('ready');
        await vi.advanceTimersByTimeAsync(2_000);

        expect(mocks.recordStartupHeartbeat).toHaveBeenCalledOnce();
    });

    it('stops future heartbeats after a direct startup failure', async () => {
        const { startStartupHeartbeat, startupDiagnostics } = await loadDiagnostics();
        startupDiagnostics.mark('frontend-entry');
        startStartupHeartbeat();
        await vi.advanceTimersByTimeAsync(0);
        startupDiagnostics.fail('startup-failure', 'script-load');
        await vi.advanceTimersByTimeAsync(2_000);

        expect(mocks.recordStartupHeartbeat).toHaveBeenCalledOnce();
    });

    it('stops future heartbeats after an ingested bootstrap failure', async () => {
        const { startStartupHeartbeat, startupDiagnostics } = await loadDiagnostics();
        startupDiagnostics.mark('frontend-entry');
        startStartupHeartbeat();
        await vi.advanceTimersByTimeAsync(0);
        startupDiagnostics.ingestBootstrapEvents([{
            phase: 'startup-failure',
            status: 'failed',
            elapsedMs: 1,
            durationMs: null,
            cacheAction: null,
            failureKind: 'script-load',
        }]);
        await vi.advanceTimersByTimeAsync(2_000);

        expect(mocks.recordStartupHeartbeat).toHaveBeenCalledOnce();
    });

    it('stops future heartbeats when the page is interrupted', async () => {
        const { startStartupHeartbeat, startupDiagnostics } = await loadDiagnostics();
        startupDiagnostics.mark('frontend-entry');
        startStartupHeartbeat();
        await vi.advanceTimersByTimeAsync(0);
        window.dispatchEvent(new Event('pagehide'));
        await vi.advanceTimersByTimeAsync(2_000);

        expect(mocks.recordStartupHeartbeat).toHaveBeenCalledOnce();
    });
});
