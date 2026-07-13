import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

type EditCallbacks = Pick<React.ComponentProps<typeof MetadataInfoTab>, 'onUpdateTool' | 'onUpdateModel'>;

const renderTab = (value: AIImage, editCallbacks: EditCallbacks = {}) => render(<MetadataInfoTab
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
    {...editCallbacks}
/>);

describe('MetadataInfoTab prompt revert control', () => {
    it('keeps hover-hidden metadata edit actions visible to keyboard focus', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        renderTab(
            image(metadata(), metadata()),
            { onUpdateTool: vi.fn(), onUpdateModel: vi.fn() },
        );

        for (const name of ['Edit Generation Tool', 'Edit Model']) {
            const editButton = screen.getByRole('button', { name });
            expect(editButton.className).toContain('opacity-0');
            expect(editButton.className).toContain('focus-visible:opacity-100');
        }
    });
});
