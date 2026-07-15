import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '../../../test/testUtils';
import { GeneratorTool, type AIImage } from '../../../types';
import type { DuplicateGroup } from '../../../hooks/useDuplicateFinder';
import { DuplicateFinder } from './DuplicateFinder';

vi.mock('../../library/components/VirtualGrid', () => ({
    VirtualGrid: ({
        items,
        renderItem,
    }: {
        items: DuplicateGroup[];
        renderItem: (item: DuplicateGroup, style: React.CSSProperties) => React.ReactNode;
    }) => <>{items.map(item => <React.Fragment key={item.id}>{renderItem(item, {})}</React.Fragment>)}</>,
}));

const createImage = (id: string, timestamp: number): AIImage => ({
    id,
    url: `file:///${id}.png`,
    thumbnailUrl: `file:///${id}-thumb.webp`,
    filename: `${id}.png`,
    timestamp,
    width: 512,
    height: 512,
    isFavorite: false,
    fileHash: 'shared-hash',
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: '',
        seed: 1,
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: 'duplicate',
        negativePrompt: '',
    },
});

describe('DuplicateFinder duplicate actions', () => {
    it('reveals the hover-hidden overlay when one of its actions receives focus', () => {
        render(
            <DuplicateFinder
                images={[createImage('one', 1), createImage('two', 2)]}
                onResolve={vi.fn()}
                maskedKeywords={[]}
                onViewImage={vi.fn()}
                onCompareImages={vi.fn()}
                scrollContainerRef={React.createRef<HTMLDivElement>()}
            />
        );

        const openButton = screen.getAllByRole('button', { name: 'Open in Viewer' })[0];
        const overlay = openButton.parentElement?.parentElement;
        expect(overlay?.className).toContain('opacity-0');
        expect(overlay?.className).toContain('focus-within:opacity-100');
    });
});
