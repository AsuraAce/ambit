import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../test/testUtils';
import { DonationModal } from '../DonationModal';

// vi.mock is hoisted above the import, so the component loads with no providers.
// A static import keeps the cold module load out of the test body, where it
// counted against the test timeout when the machine was under load.
vi.mock('../../../constants/support', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../constants/support')>()),
    ENABLED_DONATION_PROVIDERS: [],
}));

describe('DonationModal without configured providers', () => {
    it('explains how donation links are configured', () => {
        render(<DonationModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Donations are not configured yet')).toBeTruthy();
    });
});
