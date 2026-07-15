import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppSettings } from '../../constants/defaultSettings';
import { SettingsProvider, useSettings } from '../SettingsContext';
import {
    settingsPersistenceCoordinator,
    SettingsPersistenceClosingError,
    SettingsPersistencePausedError,
} from '../../utils/settingsPersistenceCoordinator';

const store = vi.hoisted(() => ({
    settings: {} as ReturnType<typeof createDefaultAppSettings>,
    isLoaded: true,
    privacyEnabled: true,
    setSettings: vi.fn(),
    setPrivacyEnabled: vi.fn(),
    flushSettings: vi.fn(),
    initialize: vi.fn(),
}));

const lifecycle = vi.hoisted(() => ({
    tauriRuntime: false,
    close: vi.fn(),
    unlisten: vi.fn(),
    closeHandler: undefined as undefined | ((event: { preventDefault: () => void }) => Promise<void>),
}));

vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock('../../services/runtime', () => ({
    isTauriRuntime: () => lifecycle.tauriRuntime,
}));

vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({
        close: lifecycle.close,
        onCloseRequested: vi.fn(async (handler) => {
            lifecycle.closeHandler = handler;
            return lifecycle.unlisten;
        }),
    }),
}));

describe('SettingsContext', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        settingsPersistenceCoordinator.reopenAdmission();
        store.settings = createDefaultAppSettings({ theme: 'light' });
        store.isLoaded = true;
        store.privacyEnabled = true;
        store.flushSettings.mockResolvedValue(undefined);
        lifecycle.tauriRuntime = false;
        lifecycle.closeHandler = undefined;
    });

    it('requires a provider', () => {
        expect(() => renderHook(() => useSettings())).toThrow('useSettings must be used within SettingsProvider');
    });

    it('initializes, forwards actions, and keeps the compatibility ref current', () => {
        const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
        const { result, rerender } = renderHook(() => useSettings(), { wrapper });
        expect(store.initialize).toHaveBeenCalledOnce();
        expect(result.current.settingsRef.current.theme).toBe('light');

        act(() => {
            result.current.setSettings({ theme: 'dark' });
            result.current.setPrivacyEnabled(false);
        });
        expect(store.setSettings).toHaveBeenCalledWith({ theme: 'dark' });
        expect(store.setPrivacyEnabled).toHaveBeenCalledWith(false);

        store.settings = createDefaultAppSettings({ theme: 'dark' });
        rerender();
        expect(result.current.settingsRef.current.theme).toBe('dark');
        expect(result.current.isLoaded).toBe(true);
    });

    it('flushes settings before allowing a Tauri close request', async () => {
        lifecycle.tauriRuntime = true;
        let resolveFlush: () => void = () => undefined;
        store.flushSettings.mockReturnValue(new Promise<void>((resolve) => {
            resolveFlush = resolve;
        }));
        const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
        const { unmount } = renderHook(() => useSettings(), { wrapper });
        await waitFor(() => expect(lifecycle.closeHandler).toBeDefined());
        const preventDefault = vi.fn();

        const closeRequest = lifecycle.closeHandler?.({ preventDefault });
        await waitFor(() => expect(store.flushSettings).toHaveBeenCalledOnce());

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(lifecycle.close).not.toHaveBeenCalled();

        resolveFlush();
        await act(async () => {
            await closeRequest;
        });

        expect(lifecycle.unlisten).toHaveBeenCalledOnce();
        expect(lifecycle.close).toHaveBeenCalledOnce();
        expect(lifecycle.unlisten.mock.invocationCallOrder[0]).toBeLessThan(
            lifecycle.close.mock.invocationCallOrder[0]
        );
        unmount();
        expect(lifecycle.unlisten).toHaveBeenCalledOnce();
    });

    it('allows close and cleans up the listener when settings flush rejects', async () => {
        lifecycle.tauriRuntime = true;
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        store.flushSettings.mockRejectedValueOnce(new Error('disk full'));
        const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
        const { unmount } = renderHook(() => useSettings(), { wrapper });
        await waitFor(() => expect(lifecycle.closeHandler).toBeDefined());
        const preventDefault = vi.fn();

        await act(async () => {
            await lifecycle.closeHandler?.({ preventDefault });
        });

        expect(preventDefault).toHaveBeenCalledOnce();
        expect(store.flushSettings).toHaveBeenCalledOnce();
        expect(error).toHaveBeenCalledWith(
            '[SettingsStore] Failed to flush settings before close',
            expect.any(Error)
        );
        expect(lifecycle.unlisten).toHaveBeenCalledOnce();
        expect(lifecycle.close).toHaveBeenCalledOnce();
        unmount();
        expect(lifecycle.unlisten).toHaveBeenCalledOnce();
        error.mockRestore();
    });

    it('coalesces overlapping close requests into one flush and guarded close', async () => {
        lifecycle.tauriRuntime = true;
        let resolveFlush: () => void = () => undefined;
        store.flushSettings.mockReturnValue(new Promise<void>((resolve) => {
            resolveFlush = resolve;
        }));
        const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
        const { unmount } = renderHook(() => useSettings(), { wrapper });
        await waitFor(() => expect(lifecycle.closeHandler).toBeDefined());
        const firstPreventDefault = vi.fn();
        const secondPreventDefault = vi.fn();

        const firstClose = lifecycle.closeHandler?.({ preventDefault: firstPreventDefault });
        const secondClose = lifecycle.closeHandler?.({ preventDefault: secondPreventDefault });
        await act(async () => secondClose);

        expect(firstPreventDefault).toHaveBeenCalledOnce();
        expect(secondPreventDefault).toHaveBeenCalledOnce();
        expect(store.flushSettings).toHaveBeenCalledOnce();
        expect(lifecycle.close).not.toHaveBeenCalled();

        resolveFlush();
        await act(async () => firstClose);

        expect(lifecycle.unlisten).toHaveBeenCalledOnce();
        expect(lifecycle.close).toHaveBeenCalledOnce();
        unmount();
        expect(lifecycle.unlisten).toHaveBeenCalledOnce();
    });

    it('drains an admitted failed-save rollback before the final close flush', async () => {
        lifecycle.tauriRuntime = true;
        let rejectSave!: (error: Error) => void;
        const save = new Promise<void>((_resolve, reject) => {
            rejectSave = reject;
        });
        let resolveRollback!: () => void;
        const rollback = new Promise<void>(resolve => {
            resolveRollback = resolve;
        });
        const rollbackStarted = vi.fn();
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const transaction = settingsPersistenceCoordinator.run(async () => {
            try {
                await save;
            } catch (saveError) {
                rollbackStarted();
                await rollback;
                throw saveError;
            }
        });
        const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
        renderHook(() => useSettings(), { wrapper });
        await waitFor(() => expect(lifecycle.closeHandler).toBeDefined());

        const closeRequest = lifecycle.closeHandler?.({ preventDefault: vi.fn() });
        const lateTransaction = vi.fn(async () => undefined);
        await expect(settingsPersistenceCoordinator.run(lateTransaction)).rejects.toBeInstanceOf(SettingsPersistenceClosingError);
        expect(lateTransaction).not.toHaveBeenCalled();
        rejectSave(new Error('disk full'));
        await waitFor(() => expect(rollbackStarted).toHaveBeenCalledOnce());

        expect(store.flushSettings).not.toHaveBeenCalled();
        expect(lifecycle.close).not.toHaveBeenCalled();

        resolveRollback();
        await expect(transaction).rejects.toThrow('disk full');
        await act(async () => closeRequest);

        expect(error).toHaveBeenCalledWith(
            '[SettingsStore] Settings transaction drain failed before close',
            expect.any(AggregateError)
        );
        expect(store.flushSettings).toHaveBeenCalledOnce();
        expect(lifecycle.close).toHaveBeenCalledOnce();
        error.mockRestore();
    });

    it('waits for an admitted pre-marker purge before the final close flush', async () => {
        lifecycle.tauriRuntime = true;
        let releasePurge!: () => void;
        const purgeAtPreMarker = new Promise<void>(resolve => {
            releasePurge = resolve;
        });
        const purgeTransaction = settingsPersistenceCoordinator.runExclusive(() => purgeAtPreMarker);
        const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
        renderHook(() => useSettings(), { wrapper });
        await waitFor(() => expect(lifecycle.closeHandler).toBeDefined());

        const closeRequest = lifecycle.closeHandler?.({ preventDefault: vi.fn() });
        await Promise.resolve();

        expect(store.flushSettings).not.toHaveBeenCalled();
        expect(lifecycle.close).not.toHaveBeenCalled();

        releasePurge();
        await purgeTransaction;
        await act(async () => closeRequest);

        expect(store.flushSettings).toHaveBeenCalledOnce();
        expect(lifecycle.close).toHaveBeenCalledOnce();
    });

    it('reopens transaction admission and close interception when the window does not close', async () => {
        lifecycle.tauriRuntime = true;
        lifecycle.close.mockRejectedValueOnce(new Error('close cancelled'));
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
        renderHook(() => useSettings(), { wrapper });
        await waitFor(() => expect(lifecycle.closeHandler).toBeDefined());
        const firstCloseHandler = lifecycle.closeHandler;

        await act(async () => firstCloseHandler?.({ preventDefault: vi.fn() }));

        expect(error).toHaveBeenCalledWith('[SettingsStore] Failed to close app window', expect.any(Error));
        expect(lifecycle.closeHandler).not.toBe(firstCloseHandler);
        const admittedAfterCancellation = vi.fn(async () => undefined);
        await expect(settingsPersistenceCoordinator.run(admittedAfterCancellation)).resolves.toBeUndefined();
        expect(admittedAfterCancellation).toHaveBeenCalledOnce();
        error.mockRestore();
    });

    it('restores exclusive admission when a close request cannot close the window', async () => {
        lifecycle.tauriRuntime = true;
        lifecycle.close.mockRejectedValueOnce(new Error('close cancelled'));
        let releaseExclusive!: () => void;
        const exclusiveWork = settingsPersistenceCoordinator.runExclusive(() => (
            new Promise<void>(resolve => {
                releaseExclusive = resolve;
            })
        ));
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const wrapper = ({ children }: { children: React.ReactNode }) => <SettingsProvider>{children}</SettingsProvider>;
        renderHook(() => useSettings(), { wrapper });
        await waitFor(() => expect(lifecycle.closeHandler).toBeDefined());

        const closeRequest = lifecycle.closeHandler?.({ preventDefault: vi.fn() });
        releaseExclusive();
        await exclusiveWork;
        await act(async () => closeRequest);

        const rejectedWork = vi.fn(async () => undefined);
        await expect(settingsPersistenceCoordinator.run(rejectedWork)).rejects.toBeInstanceOf(
            SettingsPersistencePausedError
        );
        expect(rejectedWork).not.toHaveBeenCalled();
        error.mockRestore();
    });
});
