import { fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-shell';
import { UpdateDialog } from '../UpdateDialog';

const defaultProps = {
    availableVersion: '0.8.0',
    currentVersion: '0.7.0',
    errorMessage: null,
    isOpen: true,
    publishedAt: '2026-07-11T12:00:00Z',
    status: 'available' as const,
    onClose: vi.fn(),
    onInstall: vi.fn().mockResolvedValue(undefined),
};

describe('UpdateDialog', () => {
    it("presents Markdown release notes as What's New", () => {
        render(
            <UpdateDialog
                {...defaultProps}
                notes={'### Features\n\n- **Faster** library browsing\n- Safer updates'}
            />
        );

        expect(screen.getByRole('dialog', { name: 'Ambit 0.8.0' })).toBeTruthy();
        expect(screen.getByText("What's New")).toBeTruthy();
        expect(screen.getByText('Features')).toBeTruthy();
        expect(screen.getByText('Faster')).toBeTruthy();
        expect(screen.getByText('library browsing')).toBeTruthy();
        expect(screen.queryByText('### Features')).toBeNull();
    });

    it('opens the allowlisted GitHub Releases page', async () => {
        render(<UpdateDialog {...defaultProps} notes="A smaller update." />);

        fireEvent.click(screen.getByRole('button', { name: /view release on github/i }));

        await waitFor(() => {
            expect(open).toHaveBeenCalledWith('https://github.com/AsuraAce/ambit/releases');
        });
    });

    it('explains when the updater feed has no release notes', () => {
        render(<UpdateDialog {...defaultProps} notes={null} />);

        expect(screen.getByText('No release notes were included with this update.')).toBeTruthy();
    });

    it('renders supported release-note blocks while suppressing links and images', () => {
        render(
            <UpdateDialog
                {...defaultProps}
                notes={'# One\n\n## Two\n\n#### Four\n\n1. Ordered\n\n`code` [link](https://example.com) ![image](https://example.com/image.png)'}
            />
        );

        expect(screen.getByText('One').tagName).toBe('H4');
        expect(screen.getByText('Two').tagName).toBe('H4');
        expect(screen.getByText('Four').tagName).toBe('H4');
        expect(screen.getByText('Ordered').closest('ol')).not.toBeNull();
        expect(screen.getByText('code').tagName).toBe('CODE');
        expect(screen.getByText('link').tagName).toBe('SPAN');
        expect(document.querySelector('img')).toBeNull();
    });
});
