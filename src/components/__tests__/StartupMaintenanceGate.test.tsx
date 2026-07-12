import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '../../test/testUtils';
import { StartupMaintenanceGate } from '../StartupMaintenanceGate';
import { getDb } from '../../services/db/connection';
import { isBrowserMockMode } from '../../services/runtime';

vi.mock('../../services/db/connection', () => ({
    getDb: vi.fn()
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: vi.fn()
}));

const requestAnimationFrameMock = (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
};

describe('StartupMaintenanceGate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isBrowserMockMode).mockReturnValue(false);
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    });

    afterEach(() => {
        vi.useRealTimers();
        document.getElementById('static-loading')?.remove();
    });

    it('shows database maintenance before mounting the app', async () => {
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

        expect(screen.getByText('Startup Maintenance')).toBeTruthy();
        expect(screen.getByText('Preparing library database')).toBeTruthy();
        expect(screen.queryByText('Library ready')).toBeNull();

        await waitFor(() => {
            expect(screen.getByText('Updating database schema')).toBeTruthy();
            expect(screen.getByText('Updating library database. Startup may take longer than usual this time.')).toBeTruthy();
        });

        resolveDb();

        await waitFor(() => {
            expect(screen.getByText('Library ready')).toBeTruthy();
        });
    });

    it('dismisses the static preloader so startup maintenance is visible', async () => {
        vi.useFakeTimers();
        const staticLoader = document.createElement('div');
        staticLoader.id = 'static-loading';
        document.body.appendChild(staticLoader);
        vi.mocked(getDb).mockImplementation(() => new Promise(() => undefined));

        render(
            <StartupMaintenanceGate>
                <div>Library ready</div>
            </StartupMaintenanceGate>
        );

        await act(async () => Promise.resolve());
        expect(staticLoader.style.opacity).toBe('0');
        expect(staticLoader.style.pointerEvents).toBe('none');
        expect(screen.getByText('Startup Maintenance')).toBeTruthy();
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(document.getElementById('static-loading')).toBeNull();
    });

    it('skips database preparation in browser mock mode', () => {
        vi.mocked(isBrowserMockMode).mockReturnValue(true);

        render(
            <StartupMaintenanceGate>
                <div>Browser mock app</div>
            </StartupMaintenanceGate>
        );

        expect(screen.getByText('Browser mock app')).toBeTruthy();
        expect(vi.mocked(getDb)).not.toHaveBeenCalled();
    });

    it('shows an actionable error when database preparation fails', async () => {
        vi.mocked(getDb).mockRejectedValue(new Error('migration failed'));

        render(
            <StartupMaintenanceGate>
                <div>Library ready</div>
            </StartupMaintenanceGate>
        );

        await waitFor(() => {
            expect(screen.getByText('Database startup failed')).toBeTruthy();
            expect(screen.getByText('Ambit could not prepare the local library database. Restart the app and contact support if this repeats.')).toBeTruthy();
            expect(screen.getByText('migration failed')).toBeTruthy();
        });
        expect(screen.queryByText('Library ready')).toBeNull();
    });

    it('ignores phase and completion callbacks after unmount', async () => {
        let onPhase: ((phase: 'Loading library') => void) | undefined;
        let resolveDb!: () => void;
        vi.mocked(getDb).mockImplementation((options = {}) => new Promise((resolve) => {
            onPhase = options.onPhase as typeof onPhase;
            resolveDb = () => resolve({} as Awaited<ReturnType<typeof getDb>>);
        }));
        const view = render(<StartupMaintenanceGate><div>Library ready</div></StartupMaintenanceGate>);
        await act(async () => Promise.resolve());

        view.unmount();
        onPhase?.('Loading library');
        resolveDb();
        await act(async () => Promise.resolve());
    });

    it('ignores rejected preparation after unmount and formats non-Error failures', async () => {
        let rejectDb!: (reason: unknown) => void;
        vi.mocked(getDb).mockImplementationOnce(() => new Promise((_resolve, reject) => {
            rejectDb = reject;
        }));
        const view = render(<StartupMaintenanceGate><div>Library ready</div></StartupMaintenanceGate>);
        await act(async () => Promise.resolve());
        view.unmount();
        rejectDb('late failure');
        await act(async () => Promise.resolve());

        vi.mocked(getDb).mockRejectedValueOnce('bridge unavailable');
        render(<StartupMaintenanceGate><div>Library ready</div></StartupMaintenanceGate>);
        await waitFor(() => expect(screen.getByText('bridge unavailable')).toBeTruthy());
    });
});
