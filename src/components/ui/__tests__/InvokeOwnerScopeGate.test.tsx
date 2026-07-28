import { render, screen } from '../../../test/testUtils';
import { describe, expect, it } from 'vitest';
import { InvokeOwnerScopeGate } from '../InvokeOwnerScopeGate';

describe('InvokeOwnerScopeGate', () => {
    it('explains the safety boundary while owner discovery is pending', () => {
        render(<InvokeOwnerScopeGate state={{
            status: 'discovering',
            progress: { current: 0, total: 0, message: 'Checking InvokeAI owner information...' },
        }} />);

        expect(screen.getByRole('status')).toBeTruthy();
        expect(screen.getByText('Preparing your InvokeAI library')).toBeTruthy();
        expect(screen.getByText('No images or collections are being deleted.')).toBeTruthy();
        expect(screen.getByText('Checking InvokeAI owner information...')).toBeTruthy();
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull();
    });

    it('shows real reconciliation counts without inventing a global percentage', () => {
        render(<InvokeOwnerScopeGate state={{
            status: 'applying',
            progress: { current: 500, total: 2000, message: 'Reconciling sources: 500 / 2000' },
        }} />);

        expect(screen.getByText('500 / 2,000')).toBeTruthy();
        expect(screen.getByText('Reconciling sources: 500 / 2000')).toBeTruthy();
        expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('500');
        expect(screen.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('2000');
    });
});
