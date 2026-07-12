import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppUpdaterStatus } from '../../../hooks/useAppUpdater';
import { UpdateDialog } from '../UpdateDialog';

const renderDialog = (overrides: Partial<React.ComponentProps<typeof UpdateDialog>> = {}) => {
    const onClose = vi.fn();
    const onInstall = vi.fn().mockResolvedValue(undefined);
    const props = {
        availableVersion: '2.0.0',
        currentVersion: '1.0.0',
        errorMessage: null,
        isOpen: true,
        status: 'available' as AppUpdaterStatus,
        onClose,
        onInstall,
        ...overrides,
    };
    return { ...render(<UpdateDialog {...props} />), onClose, onInstall };
};

describe('UpdateDialog', () => {
    it('renders only while open and installs an available update', () => {
        const closed = render(
            <UpdateDialog availableVersion="2" currentVersion="1" errorMessage={null} isOpen={false} status="idle" onClose={vi.fn()} onInstall={vi.fn()} />
        );
        expect(screen.queryByText('Update Available')).toBeNull();
        closed.unmount();

        const { onInstall } = renderDialog({ notes: '  Fixed things.  ', publishedAt: '2026-07-10T12:00:00Z' });
        expect(screen.getByText('Fixed things.')).toBeTruthy();
        expect(screen.getByText('Published', { exact: false })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Download and Install' }));
        expect(onInstall).toHaveBeenCalledOnce();
    });

    it('shows fallback metadata, invalid dates, and errors', () => {
        renderDialog({ currentVersion: null, notes: '   ', publishedAt: 'not-a-date', errorMessage: 'Signature verification failed' });
        expect(screen.getByText('Loading...')).toBeTruthy();
        expect(screen.getByText('No release notes were included with this update.')).toBeTruthy();
        expect(screen.queryByText('Published', { exact: false })).toBeNull();
        expect(screen.getByText('Signature verification failed')).toBeTruthy();
    });

    it.each([
        ['downloading', 'Downloading update...'],
        ['installing', 'Installing update...'],
    ] as const)('locks dismissal while %s', (status, label) => {
        const { container, onClose, onInstall } = renderDialog({ status, publishedAt: null });
        const install = screen.getByRole('button', { name: label }) as HTMLButtonElement;
        expect(install.disabled).toBe(true);
        fireEvent.click(container.querySelector('.absolute.inset-0') as Element);
        fireEvent.click(screen.getByRole('button', { name: 'Later' }));
        expect(onClose).not.toHaveBeenCalled();
        expect(onInstall).not.toHaveBeenCalled();
    });

    it('supports backdrop, close, and later dismissal when idle', () => {
        const { container, onClose } = renderDialog({ status: 'idle', notes: null, publishedAt: undefined });
        fireEvent.click(container.querySelector('.absolute.inset-0') as Element);
        fireEvent.click(screen.getByRole('button', { name: 'Later' }));
        const closeButtons = screen.getAllByRole('button').filter(button => button.textContent === '');
        fireEvent.click(closeButtons[0]);
        expect(onClose).toHaveBeenCalledTimes(3);
    });
});
