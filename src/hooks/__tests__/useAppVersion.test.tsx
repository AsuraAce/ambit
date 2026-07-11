import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getVersionMock = vi.hoisted(() => vi.fn());
const browserMockModeMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/app', () => ({ getVersion: getVersionMock }));
vi.mock('../../services/runtime', () => ({ isBrowserMockMode: browserMockModeMock }));

describe('useAppVersion', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.unstubAllEnvs();
        browserMockModeMock.mockReturnValue(false);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('uses the configured browser version and development fallback', async () => {
        browserMockModeMock.mockReturnValue(true);
        vi.stubEnv('VITE_APP_VERSION', '2.4.0-browser');
        let module = await import('../useAppVersion');
        const configured = renderHook(() => module.useAppVersion());
        await waitFor(() => expect(configured.result.current).toBe('2.4.0-browser'));
        configured.unmount();

        vi.resetModules();
        vi.stubEnv('VITE_APP_VERSION', '');
        module = await import('../useAppVersion');
        const fallback = renderHook(() => module.useAppVersion());
        await waitFor(() => expect(fallback.result.current).toBe('browser-dev'));
    });

    it('shares native requests and reuses the resolved cache', async () => {
        let resolveVersion!: (version: string) => void;
        getVersionMock.mockReturnValue(new Promise(resolve => { resolveVersion = resolve; }));
        const { useAppVersion } = await import('../useAppVersion');
        const first = renderHook(() => useAppVersion());
        const second = renderHook(() => useAppVersion());
        expect(getVersionMock).toHaveBeenCalledOnce();

        await act(async () => resolveVersion('3.1.4'));
        await waitFor(() => expect(first.result.current).toBe('3.1.4'));
        await waitFor(() => expect(second.result.current).toBe('3.1.4'));

        const cached = renderHook(() => useAppVersion());
        expect(cached.result.current).toBe('3.1.4');
        expect(getVersionMock).toHaveBeenCalledOnce();
    });

    it('reports native failures without updating an unmounted hook', async () => {
        let rejectVersion!: (error: Error) => void;
        getVersionMock.mockReturnValue(new Promise((_resolve, reject) => { rejectVersion = reject; }));
        const { useAppVersion } = await import('../useAppVersion');
        const hook = renderHook(() => useAppVersion());
        hook.unmount();

        await act(async () => rejectVersion(new Error('runtime unavailable')));
        expect(console.error).toHaveBeenCalledWith(
            '[AppVersion] Failed to load runtime version:',
            expect.any(Error)
        );
    });
});
