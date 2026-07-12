import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { ExportModal } from '../ExportModal';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
const mockedOpen = vi.mocked(open);

describe('ExportModal', () => {
    beforeEach(() => vi.clearAllMocks());

    it('renders only while open and supports panel-safe and explicit dismissal', () => {
        const onClose = vi.fn();
        const { container, rerender } = render(
            <ExportModal isOpen={false} onClose={onClose} count={2} onConfirm={vi.fn()} isExporting={false} />
        );
        expect(screen.queryByText('Export Selection')).toBeNull();

        rerender(<ExportModal isOpen onClose={onClose} count={2} onConfirm={vi.fn()} isExporting={false} />);
        fireEvent.click(screen.getByText('Export Selection'));
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalledOnce();
        fireEvent.click(container.querySelector('.absolute.inset-0') as Element);
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('validates the name and folder before confirming', async () => {
        mockedOpen.mockResolvedValueOnce(null).mockResolvedValueOnce('C:/Exports');
        const onConfirm = vi.fn();
        render(<ExportModal isOpen onClose={vi.fn()} count={3} onConfirm={onConfirm} isExporting={false} />);
        const filename = screen.getByPlaceholderText('Enter filename...') as HTMLInputElement;
        const begin = screen.getByRole('button', { name: 'Begin Export' }) as HTMLButtonElement;
        expect(begin.disabled).toBe(true);

        fireEvent.change(filename, { target: { value: '   ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Choose destination folder...' }));
        await waitFor(() => expect(mockedOpen).toHaveBeenCalledOnce());
        expect(begin.disabled).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Choose destination folder...' }));
        await screen.findByText('C:/Exports');
        fireEvent.change(filename, { target: { value: 'archive-name' } });
        fireEvent.click(begin);
        expect(onConfirm).toHaveBeenCalledWith('archive-name', 'C:/Exports');
        expect(mockedOpen).toHaveBeenLastCalledWith({ directory: true, multiple: false, title: 'Select Export Destination' });
    });

    it('locks controls and shows progress while exporting', () => {
        render(<ExportModal isOpen onClose={vi.fn()} count={1} onConfirm={vi.fn()} isExporting />);
        expect((screen.getByPlaceholderText('Enter filename...') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Exporting...' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
