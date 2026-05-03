import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GridItem } from '../GridItem';
import { AIImage, GeneratorTool } from '../../../../types';

vi.mock('../ImageCard', () => ({
    ImageCard: () => <div data-testid="image-card" />
}));

vi.mock('../../../../bindings', () => ({
    commands: {
        verifyImagePaths: vi.fn()
    }
}));

const selectedIds = new Set<string>();
const maskedKeywords: string[] = [];

const image: AIImage = {
    id: 'image-1',
    url: 'file:///image-1.png',
    thumbnailUrl: 'file:///image-1-thumb.png',
    filename: 'image-1.png',
    timestamp: 1,
    width: 120,
    height: 90,
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

const layoutPos = { x: 0, y: 0, width: 120, height: 90 };

const baseStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 120,
    height: 90,
    transform: 'translate3d(0px, 0px, 0)'
};

const createProps = (style: React.CSSProperties): React.ComponentProps<typeof GridItem> => ({
    image,
    style,
    index: 0,
    isSelected: false,
    selectedIds,
    maskedKeywords,
    setImages: () => undefined,
    onClick: () => undefined,
    onToggleSelection: () => undefined,
    onTogglePin: () => undefined,
    onToggleFavorite: () => undefined,
    onContextMenu: () => undefined,
    layoutPos
});

const getGridItemRoot = () => {
    const root = screen.getByTestId('image-card').parentElement?.parentElement;

    if (!(root instanceof HTMLElement)) {
        throw new Error('Expected GridItem root element');
    }

    return root;
};

describe('GridItem memoized motion styles', () => {
    afterEach(() => {
        cleanup();
    });

    it('rerenders when temporary motion style fields are added and removed', () => {
        const { rerender } = render(<GridItem {...createProps(baseStyle)} />);

        expect(getGridItemRoot().style.transition).toBe('');
        expect(getGridItemRoot().style.willChange).toBe('');

        rerender(
            <GridItem
                {...createProps({
                    ...baseStyle,
                    transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), width 220ms cubic-bezier(0.16, 1, 0.3, 1), height 220ms cubic-bezier(0.16, 1, 0.3, 1)',
                    willChange: 'transform',
                    opacity: 0.98
                })}
            />
        );

        expect(getGridItemRoot().style.transition).toContain('transform 220ms');
        expect(getGridItemRoot().style.willChange).toBe('transform');
        expect(getGridItemRoot().style.opacity).toBe('0.98');

        rerender(<GridItem {...createProps(baseStyle)} />);

        expect(getGridItemRoot().style.transition).toBe('');
        expect(getGridItemRoot().style.willChange).toBe('');
        expect(getGridItemRoot().style.opacity).toBe('');
    });
});
