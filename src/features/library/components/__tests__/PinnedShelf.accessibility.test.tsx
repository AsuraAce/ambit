import { fireEvent, render, screen } from '../../../../test/testUtils';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { PinnedShelf } from '../PinnedShelf';

vi.mock('../GridItem', () => ({
    GridItem: () => <div data-testid="grid-item" />
}));

const image: AIImage = {
    id: 'pinned-image',
    url: 'asset://pinned-image.png',
    thumbnailUrl: 'asset://pinned-image.webp',
    filename: 'pinned-image.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: '',
        negativePrompt: ''
    }
};

describe('PinnedShelf collapse control', () => {
    it('keeps native keyboard activation local to the shelf header', () => {
        const onToggleCollapse = vi.fn();
        const onWindowKeyDown = vi.fn();
        window.addEventListener('keydown', onWindowKeyDown);

        try {
            render(
                <PinnedShelf
                    images={[image]}
                    isCollapsed={false}
                    onToggleCollapse={onToggleCollapse}
                    selectedIds={new Set()}
                    maskedKeywords={[]}
                    setImages={vi.fn()}
                    onImageClick={vi.fn()}
                    onToggleSelection={vi.fn()}
                    onTogglePin={vi.fn()}
                    onToggleFavorite={vi.fn()}
                    onContextMenu={vi.fn()}
                    thumbnailSize={200}
                />
            );

            const header = screen.getByRole('button', { name: /Pinned/ });
            for (const key of ['Enter', ' ']) {
                const keyEvent = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
                fireEvent(header, keyEvent);
                expect(keyEvent.defaultPrevented).toBe(false);
            }

            expect(onWindowKeyDown).not.toHaveBeenCalled();
            fireEvent.click(header);
            expect(onToggleCollapse).toHaveBeenCalledOnce();
        } finally {
            window.removeEventListener('keydown', onWindowKeyDown);
        }
    });
});
