import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { SelectionBar } from '../SelectionBar';

const settingsState = vi.hoisted(() => ({ privacyEnabled: true }));
vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

const image = (id: string, userMasked?: boolean, prompt = ''): AIImage => ({
    id,
    url: `asset://${id}`,
    thumbnailUrl: `asset://${id}-thumb`,
    filename: `${id}.png`,
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    userMasked,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: '',
        steps: 20,
        cfg: 7,
        sampler: '',
        positivePrompt: prompt,
        negativePrompt: '',
    },
});

const actions = () => ({
    onClearSelection: vi.fn(),
    onDelete: vi.fn(),
    onExport: vi.fn(),
    onAddToCollection: vi.fn(),
    onRemoveFromCollection: vi.fn(),
    onToggleFavorite: vi.fn(),
    onTogglePin: vi.fn(),
    onToggleMask: vi.fn(),
    onCompare: vi.fn(),
});

const renderBar = (images: AIImage[], extra: Partial<React.ComponentProps<typeof SelectionBar>> = {}) => {
    const callbacks = actions();
    render(
        <SelectionBar
            selectedIds={new Set(images.map(item => item.id))}
            filteredImages={images}
            lastSelectedId={images[0]?.id ?? null}
            isExporting={false}
            confirmDelete={false}
            maskedKeywords={['secret']}
            {...callbacks}
            {...extra}
        />
    );
    return callbacks;
};

describe('SelectionBar', () => {
    beforeEach(() => {
        settingsState.privacyEnabled = true;
    });

    it('stays hidden without a selection', () => {
        renderBar([]);
        expect(screen.queryByText('Selected')).toBeNull();
    });

    it('runs all bulk actions and force-masks automatic visible content', () => {
        const callbacks = renderBar([image('one'), image('two')], {
            activeCollectionId: 'collection-1',
        });

        for (const label of ['Compare Selected Images', 'Add Selected to Favorites', 'Pin Selected Images', 'Add Selected to Collection', 'Remove Selected from Collection', 'Export Selected Images', 'Remove Selected from Library', 'Clear Selection']) {
            fireEvent.click(screen.getByRole('button', { name: label }));
        }
        fireEvent.click(screen.getByRole('button', { name: 'Force Mask All Content' }));

        expect(callbacks.onCompare).toHaveBeenCalledOnce();
        expect(callbacks.onToggleFavorite).toHaveBeenCalledOnce();
        expect(callbacks.onTogglePin).toHaveBeenCalledOnce();
        expect(callbacks.onAddToCollection).toHaveBeenCalledOnce();
        expect(callbacks.onRemoveFromCollection).toHaveBeenCalledOnce();
        expect(callbacks.onExport).toHaveBeenCalledOnce();
        expect(callbacks.onDelete).toHaveBeenCalledOnce();
        expect(callbacks.onClearSelection).toHaveBeenCalledOnce();
        expect(callbacks.onToggleMask).toHaveBeenCalledWith(undefined, true);
    });

    it('keeps idle utilities neutral while reserving red for library removal', () => {
        renderBar([image('one'), image('two')], {
            activeCollectionId: 'collection-1',
        });

        for (const label of [
            'Compare Selected Images',
            'Add Selected to Favorites',
            'Pin Selected Images',
            'Force Mask All Content',
            'Add Selected to Collection',
            'Remove Selected from Collection',
            'Export Selected Images',
        ]) {
            const button = screen.getByRole('button', { name: label });
            expect(button.className).toContain('text-gray-500');
            expect(button.className).not.toContain('text-amethyst');
            expect(button.className).not.toContain('text-green');
            expect(button.className).not.toContain('text-red');
        }

        expect(screen.getByRole('button', { name: 'Remove Selected from Library' }).className)
            .toContain('text-red-500/70');
        expect(screen.getByRole('button', { name: 'Add Selected to Favorites' }).querySelector('svg')?.getAttribute('class'))
            .not.toContain('fill-current');
        expect(screen.getByRole('button', { name: 'Pin Selected Images' }).querySelector('svg')?.getAttribute('class'))
            .not.toContain('fill-current');
    });

    it('colors and fills favorite and pin only when every selected image shares the state', () => {
        const images = [
            { ...image('one'), isFavorite: true, isPinned: true },
            { ...image('two'), isFavorite: true, isPinned: true },
        ];
        renderBar(images);

        const favoriteButton = screen.getByRole('button', { name: 'Remove Selected from Favorites' });
        const pinButton = screen.getByRole('button', { name: 'Unpin Selected Images' });

        expect(favoriteButton.className).toContain('text-red-500');
        expect(favoriteButton.querySelector('svg')?.getAttribute('class')).toContain('fill-current');
        expect(pinButton.className).toContain('text-sage-600');
        expect(pinButton.querySelector('svg')?.getAttribute('class')).toContain('fill-current');
    });

    it('announces mixed favorite and pin state without adding active color', () => {
        const images = [
            { ...image('one'), isFavorite: true, isPinned: false },
            { ...image('two'), isFavorite: false, isPinned: true },
        ];
        renderBar(images);

        const favoriteButton = screen.getByRole('button', { name: 'Add Selected to Favorites' });
        const pinButton = screen.getByRole('button', { name: 'Pin Selected Images' });

        expect(favoriteButton.getAttribute('aria-pressed')).toBe('mixed');
        expect(favoriteButton.className).toContain('text-gray-500');
        expect(favoriteButton.querySelector('svg')?.getAttribute('class')).not.toContain('fill-current');
        expect(pinButton.getAttribute('aria-pressed')).toBe('mixed');
        expect(pinButton.className).toContain('text-gray-500');
        expect(pinButton.querySelector('svg')?.getAttribute('class')).not.toContain('fill-current');
    });

    it.each([
        ['Force Unmask All Content', [image('one', undefined, 'secret')], false, false],
        ['Unmask All Content', [image('one', true), image('two', true)], false, false],
        ['Reset All to Auto Mask', [image('one', false), image('two', false)], null, false],
        ['Consolidate: Reset All to Auto Mask', [image('one', true), image('two', false)], null, true],
    ] as const)('cycles bulk masking through %s without coloring the next action', (title, images, expected, isMixed) => {
        const callbacks = renderBar([...images]);
        const button = screen.getByRole('button', { name: title });
        expect(button.className).toContain('text-gray-500');
        expect(button.className).not.toContain('text-amethyst');
        expect(button.className).not.toContain('text-green');
        expect(button.className.includes('border-dashed')).toBe(isMixed);
        fireEvent.click(button);
        expect(callbacks.onToggleMask).toHaveBeenCalledWith(undefined, expected);
    });

    it('hides optional actions and disables export while busy', () => {
        settingsState.privacyEnabled = false;
        renderBar([image('one')], { isExporting: true, onRemoveFromCollection: undefined });
        expect(screen.queryByRole('button', { name: 'Compare Selected Images' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove Selected from Collection' })).toBeNull();
        expect((screen.getByRole('button', { name: 'Export Selected Images' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
