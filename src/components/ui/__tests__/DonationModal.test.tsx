import { fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-shell';
import { DonationModal } from '../DonationModal';

describe('DonationModal', () => {
    it('shows support routes and live donation providers', async () => {
        render(<DonationModal isOpen={true} onClose={vi.fn()} />);

        expect(screen.getByText('Buy me a coffee')).toBeTruthy();
        expect(screen.getByText('Sponsor on GitHub')).toBeTruthy();
        expect(screen.getByText('Thank you for being part of the journey.')).toBeTruthy();
        expect(screen.queryByText('Report a bug')).toBeNull();
        expect(screen.queryByText('Follow releases')).toBeNull();
        expect(screen.queryByText('Donations are not configured yet')).toBeNull();

        fireEvent.click(screen.getByText('Sponsor on GitHub'));

        await waitFor(() => {
            expect(open).toHaveBeenCalledWith('https://github.com/sponsors/AsuraAce');
        });

        fireEvent.click(screen.getByText('Buy me a coffee'));

        await waitFor(() => {
            expect(open).toHaveBeenCalledWith('https://ko-fi.com/astraoriondev');
        });
    });
});
