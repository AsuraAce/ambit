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

        for (const title of ['Compare', 'Favorite All', 'Pin All', 'Add to Collection', 'Remove from this Collection', 'Export', 'Remove from Library', 'Clear Selection']) {
            fireEvent.click(screen.getByTitle(title));
        }
        fireEvent.click(screen.getByTitle('Force Mask All Content'));

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

    it.each([
        ['Force Unmask All Content', [image('one', undefined, 'secret')], false],
        ['Unmask All Content', [image('one', true), image('two', true)], false],
        ['Reset All to Auto Mask', [image('one', false), image('two', false)], null],
        ['Consolidate: Reset All to Auto Mask', [image('one', true), image('two', false)], null],
    ] as const)('cycles bulk masking through %s', (title, images, expected) => {
        const callbacks = renderBar([...images]);
        fireEvent.click(screen.getByTitle(title));
        expect(callbacks.onToggleMask).toHaveBeenCalledWith(undefined, expected);
    });

    it('hides optional actions and disables export while busy', () => {
        settingsState.privacyEnabled = false;
        renderBar([image('one')], { isExporting: true, onRemoveFromCollection: undefined });
        expect(screen.queryByTitle('Compare')).toBeNull();
        expect(screen.queryByTitle('Remove from this Collection')).toBeNull();
        expect((screen.getByTitle('Export') as HTMLButtonElement).disabled).toBe(true);
    });
});
