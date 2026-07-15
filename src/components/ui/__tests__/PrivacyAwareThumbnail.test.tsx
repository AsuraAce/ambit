import { render, screen } from '../../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrivacyAwareThumbnail } from '../PrivacyAwareThumbnail';
import { useSettingsStore } from '../../../stores/settingsStore';

vi.mock('../../../features/library/components/SmartImage', () => ({
    SmartImage: ({ src, alt, imgClassName }: { src: string; alt: string; imgClassName?: string }) => (
        <img data-testid="smart-image" src={src} alt={alt} className={imgClassName} />
    )
}));

describe('PrivacyAwareThumbnail', () => {
    beforeEach(() => {
        useSettingsStore.setState({
            privacyEnabled: true,
            privacyMaskIndexStatus: 'ready',
            settings: {
                ...useSettingsStore.getState().settings,
                maskingMode: 'blur'
            }
        });
    });

    it('never renders a thumbnail while the privacy index is stale', () => {
        useSettingsStore.setState({ privacyMaskIndexStatus: 'pending' });

        render(<PrivacyAwareThumbnail src="unsafe.webp" alt="Example" />);

        expect(screen.queryByTestId('smart-image')).toBeNull();
        expect(screen.getByTestId('privacy-thumbnail-placeholder')).not.toBeNull();
    });

    it('treats thumbnails as non-sensitive by default', () => {
        render(<PrivacyAwareThumbnail src="plain.webp" alt="Plain" />);
        expect(screen.getByTestId('smart-image').getAttribute('src')).toBe('plain.webp');
    });

    it('renders the normal thumbnail when privacy is disabled', () => {
        useSettingsStore.setState({ privacyEnabled: false });

        render(<PrivacyAwareThumbnail src="unsafe.webp" alt="Example" isSensitive />);

        expect(screen.getByTestId('smart-image').getAttribute('src')).toBe('unsafe.webp');
        expect(screen.getByTestId('smart-image').className).not.toContain('blur-xl');
    });

    it('blurs a sensitive thumbnail in blur mode when no safe source exists', () => {
        render(<PrivacyAwareThumbnail src="unsafe.webp" alt="Example" isSensitive />);

        expect(screen.getByTestId('smart-image').getAttribute('src')).toBe('unsafe.webp');
        expect(screen.getByTestId('smart-image').className).toContain('blur-xl');
    });

    it('uses the safe source for a sensitive thumbnail when available', () => {
        useSettingsStore.setState({
            settings: {
                ...useSettingsStore.getState().settings,
                maskingMode: 'hide'
            }
        });

        render(<PrivacyAwareThumbnail src="unsafe.webp" safeSrc="safe.webp" alt="Example" isSensitive />);

        expect(screen.getByTestId('smart-image').getAttribute('src')).toBe('safe.webp');
    });

    it('renders a placeholder for sensitive thumbnails in hide mode without a safe source', () => {
        useSettingsStore.setState({
            settings: {
                ...useSettingsStore.getState().settings,
                maskingMode: 'hide'
            }
        });

        render(<PrivacyAwareThumbnail src="unsafe.webp" alt="Example" isSensitive />);

        expect(screen.queryByTestId('smart-image')).toBeNull();
    });
});
