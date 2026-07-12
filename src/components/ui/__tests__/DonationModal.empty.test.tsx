import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../test/testUtils';

vi.mock('../../../constants/support', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../constants/support')>(),
    ENABLED_DONATION_PROVIDERS: [],
}));

describe('DonationModal without configured providers', () => {
    it('explains how donation links are configured', async () => {
        const { DonationModal } = await import('../DonationModal');

        render(<DonationModal isOpen onClose={vi.fn()} />);

        expect(screen.getByText('Donations are not configured yet')).toBeTruthy();
    });
});
