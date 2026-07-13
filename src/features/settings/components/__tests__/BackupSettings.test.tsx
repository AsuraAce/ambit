import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../../../../bindings';
import { showPathInFolder } from '../../../../services/osOpen';
import { BackupSettings } from '../BackupSettings';

const runtime = vi.hoisted(() => ({ browser: false }));
const addToast = vi.hoisted(() => vi.fn());
vi.mock('../../../../services/runtime', () => ({ isBrowserMockMode: () => runtime.browser }));
vi.mock('../../../../hooks/useToast', () => ({ useToast: () => ({ addToast }) }));
vi.mock('../../../../bindings', () => ({ commands: { getBackups: vi.fn(), backupDatabase: vi.fn() } }));
vi.mock('../../../../services/osOpen', () => ({
    showPathInFolder: vi.fn(),
    isOsOpenUnavailable: (error: string) => error.includes('unavailable'),
}));

const getBackups = vi.mocked(commands.getBackups);
const backupDatabase = vi.mocked(commands.backupDatabase);
const mockedShowPath = vi.mocked(showPathInFolder);
const backup = (index: number, sizeBytes = 1024) => ({
    name: `backup-${index}.db`, path: `C:/backups/backup-${index}.db`, sizeBytes, createdAt: '2026-07-11T10:00:00Z',
});

describe('BackupSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        runtime.browser = false;
        getBackups.mockResolvedValue({ status: 'ok', data: [] });
        backupDatabase.mockResolvedValue({ status: 'ok', data: backup(0) });
        mockedShowPath.mockResolvedValue({ status: 'ok', data: null });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('shows browser unavailability without native commands', async () => {
        runtime.browser = true;
        render(<BackupSettings />);
        expect(await screen.findByText('Backups are unavailable in browser mock mode')).toBeTruthy();
        expect(getBackups).not.toHaveBeenCalled();
        const backupButton = screen.getByRole('button', { name: 'Backup Now' }) as HTMLButtonElement;
        expect(backupButton.disabled).toBe(true);
        fireEvent.click(backupButton);
    });

    it('loads, formats, limits, refreshes, and opens native backups', async () => {
        getBackups.mockResolvedValue({ status: 'ok', data: [backup(1, 0), backup(2), backup(3, 1024 * 1024), backup(4)] });
        render(<BackupSettings />);
        expect(await screen.findByText('backup-1.db')).toBeTruthy();
        expect(screen.getByText('0 B')).toBeTruthy();
        expect(screen.getByText('1 KB')).toBeTruthy();
        expect(screen.getByText('1 MB')).toBeTruthy();
        expect(screen.queryByText('backup-4.db')).toBeNull();
        expect(screen.getByText('+ 1 more archived backups')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Refresh Backup List' }));
        await waitFor(() => expect(getBackups).toHaveBeenCalledTimes(2));
        fireEvent.click(screen.getByRole('button', { name: 'Folder' }));
        await waitFor(() => expect(mockedShowPath).toHaveBeenCalledWith('C:/backups/backup-1.db'));
        expect(addToast).toHaveBeenCalledWith('Opening backup folder...', 'info');
    });

    it('creates a backup and reloads the list', async () => {
        render(<BackupSettings />);
        await screen.findByText('No backups found');
        fireEvent.click(screen.getByRole('button', { name: 'Backup Now' }));
        expect(await screen.findByRole('button', { name: 'Creating...' })).toBeTruthy();
        await waitFor(() => expect(backupDatabase).toHaveBeenCalledOnce());
        await waitFor(() => expect(getBackups).toHaveBeenCalledTimes(2));
        expect(addToast).toHaveBeenCalledWith('Backup created successfully', 'success');
    });

    it('reports load and create failures', async () => {
        getBackups.mockResolvedValueOnce({ status: 'error', error: 'load failed' });
        const { unmount } = render(<BackupSettings />);
        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Failed to load backups', 'error'));
        unmount();

        getBackups.mockResolvedValue({ status: 'ok', data: [] });
        backupDatabase.mockResolvedValueOnce({ status: 'error', error: 'disk full' });
        render(<BackupSettings />);
        await screen.findByText('No backups found');
        fireEvent.click(screen.getByRole('button', { name: 'Backup Now' }));
        await waitFor(() => expect(addToast).toHaveBeenCalledWith('Backup failed: disk full', 'error'));
    });

    it('handles empty, unavailable, and ordinary folder-open failures', async () => {
        const view = render(<BackupSettings />);
        await screen.findByText('No backups found');
        expect(screen.queryByRole('button', { name: 'Folder' })).toBeNull();
        view.unmount();

        getBackups.mockResolvedValue({ status: 'ok', data: [backup(1)] });
        mockedShowPath.mockResolvedValueOnce({ status: 'error', error: 'shell unavailable' });
        const unavailable = render(<BackupSettings />);
        await screen.findByText('backup-1.db');
        fireEvent.click(screen.getByRole('button', { name: 'Folder' }));
        await waitFor(() => expect(addToast).toHaveBeenCalledWith('shell unavailable', 'info'));
        unavailable.unmount();

        mockedShowPath.mockResolvedValueOnce({ status: 'error', error: 'permission denied' });
        render(<BackupSettings />);
        await screen.findByText('backup-1.db');
        fireEvent.click(screen.getByRole('button', { name: 'Folder' }));
        await waitFor(() => expect(addToast).toHaveBeenCalledWith('permission denied', 'error'));
    });
});
