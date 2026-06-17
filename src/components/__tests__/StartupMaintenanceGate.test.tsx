import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '../../test/testUtils';
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
        const staticLoader = document.createElement('div');
        staticLoader.id = 'static-loading';
        document.body.appendChild(staticLoader);
        vi.mocked(getDb).mockImplementation(() => new Promise(() => undefined));

        render(
            <StartupMaintenanceGate>
                <div>Library ready</div>
            </StartupMaintenanceGate>
        );

        await waitFor(() => {
            expect(staticLoader.style.opacity).toBe('0');
            expect(staticLoader.style.pointerEvents).toBe('none');
        });
        expect(screen.getByText('Startup Maintenance')).toBeTruthy();
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
});
