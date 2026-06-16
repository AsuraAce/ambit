import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../../../types';
import { ImageViewer } from '../ImageViewer';

const mockGetImageWithFullMetadata = vi.fn();
const mockMetadataSidebar = vi.fn();

vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
            <div {...props}>{children}</div>
        ),
    },
}));

vi.mock('../../../../services/db/imageRepo', () => ({
    getImageWithFullMetadata: (...args: unknown[]) => mockGetImageWithFullMetadata(...args),
}));

vi.mock('../MetadataSidebar', () => ({
    MetadataSidebar: (props: { image: AIImage }) => {
        mockMetadataSidebar(props);
        return <div data-testid="metadata-sidebar" />;
    },
}));

vi.mock('../ImageCanvas', () => ({
    ImageCanvas: () => <div />,
}));

vi.mock('../ViewerToolbar', () => ({
    ViewerToolbar: () => <div />,
}));

vi.mock('../VersionSelector', () => ({
    VersionSelector: () => <div />,
}));

vi.mock('../AIResultModal', () => ({
    AIResultModal: () => <div />,
}));

vi.mock('../../../../hooks/useZoomPan', () => ({
    useZoomPan: () => ({
        scale: 1,
        position: { x: 0, y: 0 },
        isDragging: false,
        resetZoom: vi.fn(),
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        handlers: {},
    }),
}));

vi.mock('../../../../hooks/usePalette', () => ({
    usePalette: () => ({ palette: [], isLoading: false }),
}));

vi.mock('../../../../hooks/useImageAI', () => ({
    useImageAI: () => ({
        closeModal: vi.fn(),
        analyzePrompt: vi.fn(),
        generateVariations: vi.fn(),
    }),
}));

vi.mock('../../../../stores/settingsStore', () => ({
    useSettingsStore: (selector: (state: { settings: Record<string, unknown> }) => unknown) => (
        selector({
            settings: {
                enableAI: true,
                aiModel: 'gemini-3.1-flash-lite',
                aiThinkingMode: 'default',
            },
        })
    ),
}));

vi.mock('../../../../stores/collectionStore', () => ({
    useCollectionStore: (selector: (state: { collections: never[] }) => unknown) => (
        selector({ collections: [] })
    ),
}));

vi.mock('../../../../services/assetScope', () => ({
    ensureAssetPathAccessible: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../hooks/useToast', () => ({
    useToast: () => ({ addToast: vi.fn() }),
}));

const metadata = (positivePrompt: string) => ({
    tool: GeneratorTool.UNKNOWN,
    model: 'Unknown',
    seed: 0,
    steps: 0,
    cfg: 0,
    sampler: 'Unknown',
    positivePrompt,
    negativePrompt: '',
});

const lightImage: AIImage = {
    id: 'C:/library/image.png',
    url: 'asset://image.png',
    thumbnailUrl: 'asset://thumb.webp',
    filename: 'image.png',
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata: metadata('Recovered prompt'),
};

describe('ImageViewer full metadata loading', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps persisted original metadata when a lightweight image omits it after restart', async () => {
        const originalMetadata = {
            ...metadata('Original prompt'),
            seed: 42,
            steps: 30,
            cfg: 8,
            sampler: 'DPM++',
        };
        const originalChunks = { parameters: 'raw metadata' };
        const originalState = { isFavorite: false };
        mockGetImageWithFullMetadata.mockResolvedValue({
            ...lightImage,
            metadata: {
                ...originalMetadata,
                positivePrompt: 'Recovered prompt',
            },
            originalMetadata,
            originalChunks,
            originalState,
        });

        render(<ImageViewer
            image={lightImage}
            onAddToCollection={vi.fn()}
            onClose={vi.fn()}
            onNext={vi.fn()}
            onPrev={vi.fn()}
            onSearch={vi.fn()}
            onToggleFavorite={vi.fn()}
            onOpenSettings={vi.fn()}
            isOpen
        />);

        await waitFor(() => {
            const latestProps = mockMetadataSidebar.mock.calls.at(-1)?.[0] as { image: AIImage };
            expect(latestProps.image.originalMetadata).toEqual(originalMetadata);
            expect(latestProps.image.originalChunks).toEqual(originalChunks);
            expect(latestProps.image.originalState).toEqual(originalState);
            expect(latestProps.image.metadata.positivePrompt).toBe('Recovered prompt');
            expect(latestProps.image.metadata).toMatchObject({
                seed: 42,
                steps: 30,
                cfg: 8,
                sampler: 'DPM++',
            });
        });
    });
});
