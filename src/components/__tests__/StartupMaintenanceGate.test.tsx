import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '../../test/testUtils';
import { StartupMaintenanceGate } from '../StartupMaintenanceGate';
import { getDb } from '../../services/db/connection';
import { isBrowserMockMode } from '../../services/runtime';

vi.mock('../../services/db/connection', () => ({
    getDb: vi.fn()
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: vi.fn()
}));

const addStaticLoader = () => {
    const staticLoader = document.createElement('div');
    staticLoader.id = 'static-loading';
    document.body.appendChild(staticLoader);
    return staticLoader;
};

const flushAsyncWork = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

describe('StartupMaintenanceGate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        vi.mocked(isBrowserMockMode).mockReturnValue(false);
    });

    afterEach(() => {
        document.getElementById('static-loading')?.remove();
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('keeps fast database startup behind the static loader without flashing maintenance', async () => {
        const staticLoader = addStaticLoader();
        vi.mocked(getDb).mockResolvedValue({} as Awaited<ReturnType<typeof getDb>>);

        render(
            <StartupMaintenanceGate>
                <div>Library ready</div>
            </StartupMaintenanceGate>
        );

        await flushAsyncWork();

        expect(screen.getByText('Library ready')).toBeTruthy();
        expect(screen.queryByText('Startup Maintenance')).toBeNull();
        expect(staticLoader.style.opacity).toBe('');
        expect(staticLoader.style.pointerEvents).toBe('');
    });

    it('keeps pending database startup on the static loader before the reveal delay', async () => {
        const staticLoader = addStaticLoader();
        vi.mocked(getDb).mockImplementation(() => new Promise(() => undefined));

        render(
            <StartupMaintenanceGate>
                <div>Library ready</div>
            </StartupMaintenanceGate>
        );

        await act(async () => {
            await vi.advanceTimersByTimeAsync(699);
        });

        expect(screen.queryByText('Startup Maintenance')).toBeNull();
        expect(screen.queryByText('Library ready')).toBeNull();
        expect(staticLoader.style.opacity).toBe('');
        expect(staticLoader.style.pointerEvents).toBe('');
    });

    it('reveals database maintenance for slow startup and keeps tracking phase updates', async () => {
        const staticLoader = addStaticLoader();
        let resolveDb!: () => void;
        vi.mocked(getDb).mockImplementation(({ onPhase } = {}) => new Promise((resolve) => {
            onPhase?.('Updating database schema');
            resolveDb = () => resolve({} as Awaited<ReturnType<typeof getDb>>);
        }));

        render(
            <StartupMaintenanceGate>
                <div>Library ready</div>
            </StartupMaintenanceGate>
        );

        expect(screen.queryByText('Startup Maintenance')).toBeNull();
        expect(screen.queryByText('Library ready')).toBeNull();

        await act(async () => {
            await vi.advanceTimersByTimeAsync(700);
        });

        expect(staticLoader.style.opacity).toBe('0');
        expect(staticLoader.style.pointerEvents).toBe('none');
        expect(screen.getByText('Startup Maintenance')).toBeTruthy();
        expect(screen.getByText('Preparing database')).toBeTruthy();
        expect(screen.getByText('Preparing the local database. Startup may take longer than usual this time.')).toBeTruthy();

        await act(async () => {
            resolveDb();
            await Promise.resolve();
        });

        expect(screen.getByText('Library ready')).toBeTruthy();
    });

    it('shows an actionable error immediately when database preparation fails', async () => {
        const staticLoader = addStaticLoader();
        const startupError = new Error('migration failed');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(getDb).mockRejectedValue(startupError);

        render(
            <StartupMaintenanceGate>
                <div>Library ready</div>
            </StartupMaintenanceGate>
        );

        await flushAsyncWork();

        expect(staticLoader.style.opacity).toBe('0');
        expect(staticLoader.style.pointerEvents).toBe('none');
        expect(screen.getByText('Startup Maintenance')).toBeTruthy();
        expect(screen.getByText('Database startup failed')).toBeTruthy();
        expect(screen.getByText('Ambit could not prepare the local library database. Restart the app and contact support if this repeats.')).toBeTruthy();
        expect(screen.getByText('migration failed')).toBeTruthy();
        expect(screen.queryByText('Library ready')).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith('[Startup] Failed to prepare database', startupError);
        errorSpy.mockRestore();
    });

    it('skips database preparation in browser mock mode', () => {
        vi.mocked(isBrowserMockMode).mockReturnValue(true);

        render(
            <StartupMaintenanceGate>
                <div>Browser mock app</div>
            </StartupMaintenanceGate>
        );

        expect(screen.getByText('Browser mock app')).toBeTruthy();
        expect(screen.queryByText('Startup Maintenance')).toBeNull();
        expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    });
});
