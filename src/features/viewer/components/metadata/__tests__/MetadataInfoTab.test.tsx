import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type ImageMetadata } from '../../../../../types';
import { MetadataInfoTab } from '../MetadataInfoTab';

const metadata = (overrides: Partial<ImageMetadata> = {}): ImageMetadata => ({
    tool: GeneratorTool.UNKNOWN,
    model: 'Unknown',
    seed: 1,
    steps: 20,
    cfg: 7,
    sampler: 'Euler',
    positivePrompt: 'Original prompt',
    negativePrompt: '',
    ...overrides,
});

const image = (current: ImageMetadata, original: ImageMetadata): AIImage => ({
    id: 'C:/library/image.png',
    url: 'asset://image.png',
    thumbnailUrl: 'asset://thumb.webp',
    filename: 'image.png',
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata: current,
    originalMetadata: original,
});

const renderTab = (value: AIImage) => render(<MetadataInfoTab
    image={value}
    promptValue={value.metadata.positivePrompt}
    setPromptValue={vi.fn()}
    negativePromptValue={value.metadata.negativePrompt}
    palette={[]}
    isPaletteLoading={false}
    onSearch={vi.fn()}
    onClose={vi.fn()}
    onRecoverMetadata={vi.fn()}
    onRevertMetadata={vi.fn()}
    onAIAnalysis={vi.fn()}
    onGenerateVariations={vi.fn()}
    isAnalyzing={false}
/>);

describe('MetadataInfoTab prompt revert control', () => {
    it('does not show revert when only imported technical metadata differs', () => {
        renderTab(image(
            metadata({ steps: 0, cfg: 0 }),
            metadata({ steps: 20, cfg: 7 }),
        ));

        expect(screen.queryByTitle('Revert all metadata to original')).toBeNull();
    });

    it('shows revert after the prompt has actually changed', () => {
        renderTab(image(
            metadata({ positivePrompt: 'Recovered prompt' }),
            metadata({ positivePrompt: 'Original prompt' }),
        ));

        expect(screen.getByTitle('Revert all metadata to original')).not.toBeNull();
    });
});
