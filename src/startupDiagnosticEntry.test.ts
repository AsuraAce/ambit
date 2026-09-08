import { beforeEach, describe, expect, it, vi } from 'vitest';

const diagnostics = vi.hoisted(() => ({
    connect: vi.fn(() => Promise.resolve()),
    getLaunchId: vi.fn((): string | null => 'native-launch'),
    mark: vi.fn(),
    fail: vi.fn(),
    startStartupHeartbeat: vi.fn(),
}));
const entryMocks = vi.hoisted(() => ({ indexLoaded: vi.fn() }));

vi.mock('./utils/startupDiagnostics', () => ({
    startupDiagnostics: diagnostics,
    startStartupHeartbeat: diagnostics.startStartupHeartbeat,
}));
vi.mock('./index', () => {
    entryMocks.indexLoaded();
    return {};
});

describe('startup diagnostic entry', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        entryMocks.indexLoaded.mockReset();
        diagnostics.connect.mockResolvedValue(undefined);
        diagnostics.getLaunchId.mockReturnValue('native-launch');
        delete window.__AMBIT_STARTUP_BOOTSTRAP__;
    });

    it('loads the application while the native handshake remains unresolved', async () => {
        diagnostics.connect.mockImplementation(() => new Promise(() => undefined));

        await import('./startupDiagnosticEntry');
        await vi.dynamicImportSettled();

        expect(diagnostics.connect).toHaveBeenCalledOnce();
        expect(diagnostics.mark).toHaveBeenCalledWith('frontend-entry');
        expect(diagnostics.startStartupHeartbeat).toHaveBeenCalledOnce();
        expect(entryMocks.indexLoaded).toHaveBeenCalledOnce();
        expect(diagnostics.fail).not.toHaveBeenCalled();
    });

    it('reports an application-module rejection through the fixed bootstrap fallback', async () => {
        const showFailure = vi.fn();
        window.__AMBIT_STARTUP_BOOTSTRAP__ = {
            showFailure,
            takeEvents: vi.fn(),
            markReactMounted: vi.fn(),
            markReady: vi.fn(),
            markTransportUnavailable: vi.fn(),
            setFailureLaunchId: vi.fn(),
        };
        const { startApplication } = await import('./startupDiagnosticEntry');
        await Promise.resolve();

        startApplication(() => Promise.reject(new Error('module unavailable')));
        await Promise.resolve();

        expect(showFailure).toHaveBeenCalledOnce();
        expect(diagnostics.fail).toHaveBeenCalledWith('startup-failure', 'script-load');
    });

    it('leaves a healthy application nonfatal when native diagnostics are unavailable', async () => {
        const showFailure = vi.fn();
        const markTransportUnavailable = vi.fn();
        diagnostics.getLaunchId.mockReturnValue(null);
        window.__AMBIT_STARTUP_BOOTSTRAP__ = {
            showFailure,
            takeEvents: vi.fn(),
            markReactMounted: vi.fn(),
            markReady: vi.fn(),
            markTransportUnavailable,
            setFailureLaunchId: vi.fn(),
        };

        await import('./startupDiagnosticEntry');
        await Promise.resolve();

        expect(markTransportUnavailable).toHaveBeenCalledOnce();
        expect(showFailure).not.toHaveBeenCalled();
        expect(diagnostics.fail).not.toHaveBeenCalled();
    });
});
