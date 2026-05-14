import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useAppUpdater } from '../useAppUpdater';

const mockAddToast = vi.fn();

const createMockUpdate = () => ({
    version: '0.4.0',
    body: 'New release notes',
    date: '2026-04-17T12:00:00Z',
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
}) as unknown as Update;

describe('useAppUpdater', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(check).mockResolvedValue(null);
        vi.mocked(relaunch).mockResolvedValue(undefined);
    });

    it('checks once after settings load and stays idle when no update is available', async () => {
        const { result, rerender } = renderHook(
            ({ isSettingsLoaded }) => useAppUpdater({
                addToast: mockAddToast,
                autoCheckEnabled: true,
                isSettingsLoaded,
                isDevBuild: false,
            }),
            {
                initialProps: { isSettingsLoaded: false },
            }
        );

        expect(vi.mocked(check)).not.toHaveBeenCalled();

        rerender({ isSettingsLoaded: true });

        await waitFor(() => {
            expect(vi.mocked(check)).toHaveBeenCalledTimes(1);
        });

        rerender({ isSettingsLoaded: true });

        await waitFor(() => {
            expect(result.current.status).toBe('idle');
        });

        expect(result.current.isDialogOpen).toBe(false);
        expect(result.current.errorMessage).toBeNull();
        expect(mockAddToast).not.toHaveBeenCalled();
    });

    it('opens the update prompt when a release is available and does not install until confirmed', async () => {
        const mockUpdate = createMockUpdate();
        vi.mocked(check).mockResolvedValue(mockUpdate);

        const { result } = renderHook(() => useAppUpdater({
            addToast: mockAddToast,
            autoCheckEnabled: true,
            isSettingsLoaded: true,
            isDevBuild: false,
        }));

        await waitFor(() => {
            expect(result.current.status).toBe('available');
        });

        expect(result.current.isDialogOpen).toBe(true);
        expect(result.current.update?.version).toBe('0.4.0');
        expect(mockUpdate.downloadAndInstall).not.toHaveBeenCalled();
        expect(vi.mocked(relaunch)).not.toHaveBeenCalled();
    });

    it('allows manual checks even when automatic startup checks are disabled', async () => {
        const mockUpdate = createMockUpdate();
        vi.mocked(check).mockResolvedValue(mockUpdate);

        const { result } = renderHook(() => useAppUpdater({
            addToast: mockAddToast,
            autoCheckEnabled: false,
            isSettingsLoaded: true,
            isDevBuild: false,
        }));

        expect(vi.mocked(check)).not.toHaveBeenCalled();

        await act(async () => {
            await result.current.checkForUpdates({ manual: true });
        });

        expect(vi.mocked(check)).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe('available');
        expect(result.current.isDialogOpen).toBe(true);
    });

    it('surfaces manual check failures and recovers with an error state', async () => {
        vi.mocked(check).mockRejectedValue(new Error('Network down'));

        const { result } = renderHook(() => useAppUpdater({
            addToast: mockAddToast,
            autoCheckEnabled: true,
            isSettingsLoaded: true,
            isDevBuild: false,
        }));

        await act(async () => {
            await result.current.checkForUpdates({ manual: true });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.errorMessage).toBe('Network down');
        expect(mockAddToast).toHaveBeenCalledWith('Failed to check for updates: Network down', 'error');
    });

    it('explains private or unreachable release feeds without treating latest-version checks as failures', async () => {
        vi.mocked(check).mockRejectedValue(new Error('404 Not Found'));

        const { result } = renderHook(() => useAppUpdater({
            addToast: mockAddToast,
            autoCheckEnabled: false,
            isSettingsLoaded: true,
            isDevBuild: false,
        }));

        await act(async () => {
            await result.current.checkForUpdates({ manual: true });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.errorMessage).toContain('release assets to be publicly reachable');
        expect(result.current.errorMessage).toContain('already up to date');
        expect(mockAddToast).toHaveBeenCalledWith(
            expect.stringContaining('release assets to be publicly reachable'),
            'error'
        );
    });

    it('preserves raw install errors when package download or installation fails', async () => {
        const mockUpdate = createMockUpdate();
        vi.mocked(mockUpdate.downloadAndInstall).mockRejectedValue(new Error('404 Not Found'));
        vi.mocked(check).mockResolvedValue(mockUpdate);

        const { result } = renderHook(() => useAppUpdater({
            addToast: mockAddToast,
            autoCheckEnabled: false,
            isSettingsLoaded: true,
            isDevBuild: false,
        }));

        await act(async () => {
            await result.current.checkForUpdates({ manual: true });
        });

        await act(async () => {
            await result.current.installUpdate();
        });

        expect(result.current.status).toBe('error');
        expect(result.current.errorMessage).toBe('404 Not Found');
        expect(mockAddToast).toHaveBeenCalledWith('Failed to install update: 404 Not Found', 'error');
    });
});
