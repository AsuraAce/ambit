import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineView } from '../TimelineView';
import { AIImage, GeneratorTool } from '../../../../types';

vi.mock('../ImageCard', () => ({
    ImageCard: ({ image, onClick }: { image: AIImage; onClick: (event: React.MouseEvent) => void }) => (
        <button type="button" data-testid={`timeline-card-${image.id}`} onClick={onClick}>
            {image.id}
        </button>
    )
}));

let resizeObserverCallback: ResizeObserverCallback | null = null;
let resizeObserverInstance: ResizeObserver | null = null;

const emitResize = (target: Element, width: number) => {
    if (!resizeObserverCallback || !resizeObserverInstance) {
        throw new Error('ResizeObserver mock has not been initialized');
    }

    resizeObserverCallback([{
        target,
        contentRect: {
            x: 0,
            y: 0,
            width,
            height: 600,
            top: 0,
            right: width,
            bottom: 600,
            left: 0,
            toJSON: () => ({})
        }
    } as ResizeObserverEntry], resizeObserverInstance);
};

const createImage = (id: string, timestamp: number, isPinned = false): AIImage => ({
    id,
    url: `file:///${id}.png`,
    thumbnailUrl: `file:///${id}-thumb.png`,
    filename: `${id}.png`,
    timestamp,
    width: 100,
    height: 100,
    isFavorite: false,
    isPinned,
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
});

describe('TimelineView', () => {
    beforeEach(() => {
        resizeObserverCallback = null;
        resizeObserverInstance = null;
        vi.stubGlobal('ResizeObserver', class ResizeObserver {
            constructor(callback: ResizeObserverCallback) {
                resizeObserverCallback = callback;
                resizeObserverInstance = this as unknown as ResizeObserver;
            }

            observe(target: Element) {
                emitResize(target, 600);
            }

            unobserve() {
                return undefined;
            }

            disconnect() {
                return undefined;
            }
        });
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('opens the clicked image using its source index when pins reorder the timeline', async () => {
        const onImageClick = vi.fn();
        const images = [
            createImage('regular-first', new Date(2020, 0, 1, 11, 0, 0).getTime(), false),
            createImage('pinned-second', new Date(2020, 0, 1, 10, 0, 0).getTime(), true)
        ];

        render(
            <TimelineView
                images={images}
                selectedIds={new Set()}
                sortOption="date_desc"
                onImageClick={onImageClick}
                onSelectionToggle={() => undefined}
                onToggleFavorite={() => undefined}
                onContextMenu={() => undefined}
                maskedKeywords={[]}
            />
        );

        await waitFor(() => expect(screen.getByTestId('timeline-card-pinned-second')).toBeTruthy());

        fireEvent.click(screen.getByTestId('timeline-card-pinned-second'));

        expect(onImageClick).toHaveBeenCalledWith(expect.anything(), 'pinned-second', 1);
    });
});
