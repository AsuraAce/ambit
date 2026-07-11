import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../types';
import { MaintenanceItem } from './MaintenanceItem';

const settingsState = vi.hoisted(() => ({ privacyEnabled: true }));
vi.mock('../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

const image = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'image-1',
    url: 'asset://image-1',
    thumbnailUrl: 'asset://image-1-thumb',
    filename: 'image-1.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: '',
        steps: 20,
        cfg: 7,
        sampler: '',
        positivePrompt: 'contains secret material',
        negativePrompt: '',
    },
    ...overrides,
});

describe('MaintenanceItem', () => {
    beforeEach(() => {
        settingsState.privacyEnabled = true;
    });

    it('reveals masked content without triggering selection and remasks on leave', () => {
        const onClick = vi.fn();
        const { container } = render(
            <MaintenanceItem
                img={image()}
                style={{ width: 200 }}
                onClick={onClick}
                maskedKeywords={['secret']}
                overlayActions={<button>Open</button>}
            >
                <span>Child badge</span>
            </MaintenanceItem>
        );

        const photo = container.querySelector('img') as HTMLImageElement;
        expect(photo.className).toContain('blur-xl');
        expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        expect(onClick).not.toHaveBeenCalled();
        expect(photo.className).not.toContain('blur-xl');
        expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
        expect(screen.getByText('Child badge')).toBeTruthy();
        expect(screen.getByText('image-1.png')).toBeTruthy();

        fireEvent.mouseLeave(photo.closest('.cursor-pointer') as Element);
        expect(screen.getByRole('button', { name: 'Reveal' })).toBeTruthy();
    });

    it('renders selected missing content and optional presentation controls', () => {
        settingsState.privacyEnabled = false;
        const onClick = vi.fn();
        const { container } = render(
            <MaintenanceItem
                img={image({ userMasked: true })}
                style={{ height: 180 }}
                isSelected
                onClick={onClick}
                maskedKeywords={['secret']}
                showFilename={false}
                imageClassName="custom-image"
                isMissing
            />
        );

        expect(screen.getByText('Missing Source')).toBeTruthy();
        expect(screen.queryByText('image-1.png')).toBeNull();
        expect((container.querySelector('img') as HTMLImageElement).className).toContain('custom-image');
        fireEvent.click(container.querySelector('.cursor-pointer') as Element);
        expect(onClick).toHaveBeenCalledOnce();
    });
});
