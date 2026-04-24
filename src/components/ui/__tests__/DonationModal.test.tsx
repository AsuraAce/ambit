import { fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-shell';
import { DonationModal } from '../DonationModal';

describe('DonationModal', () => {
    it('shows support routes and live donation providers', async () => {
        render(<DonationModal isOpen={true} onClose={vi.fn()} />);

        expect(screen.getByText('Report a bug')).toBeTruthy();
        expect(screen.getByText('Follow releases')).toBeTruthy();
        expect(screen.getByText(/Ko-fi/)).toBeTruthy();
        expect(screen.getByText(/GitHub Sponsors/)).toBeTruthy();
        expect(screen.queryByText('Donations are not configured yet')).toBeNull();

        fireEvent.click(screen.getByText('Report a bug'));

        await waitFor(() => {
            expect(open).toHaveBeenCalledWith('https://github.com/AsuraAce/ambit/issues');
        });

        fireEvent.click(screen.getByText(/GitHub Sponsors/));

        await waitFor(() => {
            expect(open).toHaveBeenCalledWith('https://github.com/sponsors/AsuraAce');
        });

        fireEvent.click(screen.getByText(/Ko-fi/));

        await waitFor(() => {
            expect(open).toHaveBeenCalledWith('https://ko-fi.com/astraoriondev');
        });
    });
});
