import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type ImageMetadata } from '../../../../../types';
import { MetadataInfoTab } from '../MetadataInfoTab';
import type { ComponentProps } from 'react';

vi.mock('../MetadataRawInspector', () => ({ MetadataRawInspector: () => <div>raw inspector</div> }));
vi.mock('../HighlightedPromptText', () => ({
    HighlightedPromptText: ({ text, terms }: { text: string; terms?: string[] }) => <span data-terms={terms?.join('|')}>{text}</span>,
}));

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

const image = (current: ImageMetadata, original: ImageMetadata, overrides: Partial<AIImage> = {}): AIImage => ({
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
    ...overrides,
});

const renderTab = (value: AIImage, overrides: Partial<ComponentProps<typeof MetadataInfoTab>> = {}) => {
    const props: ComponentProps<typeof MetadataInfoTab> = {
        image: value,
        promptValue: value.metadata.positivePrompt,
        setPromptValue: vi.fn(),
        negativePromptValue: value.metadata.negativePrompt,
        setNegativePromptValue: vi.fn(),
        availableTags: [],
        onUpdatePrompt: vi.fn(),
        onUpdateNegativePrompt: vi.fn(),
        onSearch: vi.fn(),
        onClose: vi.fn(),
        onRecoverMetadata: vi.fn(),
        onRevertMetadata: vi.fn(),
        onUpdateModel: vi.fn(),
        onUpdateTool: vi.fn(),
        onAIAnalysis: vi.fn(),
        onGenerateVariations: vi.fn(),
        isAnalyzing: false,
        ...overrides,
    };
    return { ...render(<MetadataInfoTab {...props} />), props };
};

describe('MetadataInfoTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                readText: vi.fn().mockResolvedValue(''),
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
    });

    it('uses the compact metadata layout and preserves explicit zero values', () => {
        renderTab(image(metadata({ seed: 0, steps: 0, cfg: 0 }), metadata({ seed: 0, steps: 0, cfg: 0 })));

        expect(screen.queryByText('Generation Data')).toBeNull();
        const parameters = screen.getByLabelText('Generation parameters');
        expect(parameters.textContent).toContain('Seed0');
        expect(parameters.textContent).toContain('StepsUnknown');
        expect(parameters.textContent).toContain('CFGUnknown');
        expect(screen.getByRole('button', { name: 'Copy generation data' }).closest('section')?.contains(parameters)).toBe(true);
        const heading = screen.getByRole('heading', { name: 'Generation parameters' });
        expect(heading.closest('section')).toBe(parameters.closest('section'));
        expect(heading.parentElement?.parentElement).not.toBe(parameters.parentElement);
    });

    it('places prompts before other generation metadata', () => {
        renderTab(image(metadata(), metadata()));

        const positivePrompt = screen.getByLabelText('Positive prompt');
        const negativePrompt = screen.getByLabelText('Negative prompt');
        const generator = screen.getByRole('heading', { name: 'Generator software' });
        expect(positivePrompt.compareDocumentPosition(negativePrompt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(negativePrompt.compareDocumentPosition(generator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(screen.getByText('Creative Assistant').closest('.shrink-0')).toBeTruthy();
    });

    it('shows source badges only for genuinely modified values', () => {
        renderTab(image(
            metadata({ model: 'Unknown', sampler: 'DDIM', cfg: 7.00001 }),
            metadata({ model: '', sampler: 'Euler', cfg: 7 }),
        ));

        expect(screen.getByRole('button', { name: 'Source: user override' })).toBeTruthy();
        expect(screen.getByText('Sampler').parentElement?.textContent).toContain('DDIM');
        expect(screen.getByText('CFG').parentElement?.querySelector('[aria-label="Source: user override"]')).toBeNull();
    });

    it('does not save prompts merely because they received and lost focus', () => {
        const { props } = renderTab(image(metadata(), metadata()));

        fireEvent.blur(screen.getByRole('textbox', { name: 'Positive prompt' }));
        fireEvent.blur(screen.getByRole('textbox', { name: 'Negative prompt' }));

        expect(props.onUpdatePrompt).not.toHaveBeenCalled();
        expect(props.onUpdateNegativePrompt).not.toHaveBeenCalled();
    });

    it('saves changed positive and negative prompts on blur', () => {
        const { props } = renderTab(image(metadata(), metadata()));
        const positive = screen.getByRole('textbox', { name: 'Positive prompt' });
        const negative = screen.getByRole('textbox', { name: 'Negative prompt' });

        fireEvent.change(positive, { target: { value: 'Changed prompt' } });
        fireEvent.blur(positive);
        fireEvent.change(negative, { target: { value: 'Changed negative' } });
        fireEvent.blur(negative);

        expect(props.setPromptValue).toHaveBeenCalledWith('Changed prompt');
        expect(props.onUpdatePrompt).toHaveBeenCalledWith('C:/library/image.png', 'Changed prompt');
        expect(props.setNegativePromptValue).toHaveBeenCalledWith('Changed negative');
        expect(props.onUpdateNegativePrompt).toHaveBeenCalledWith('C:/library/image.png', 'Changed negative');
    });

    it('saves an autocomplete selection exactly once with the selected value', () => {
        const { props } = renderTab(image(metadata(), metadata()), {
            promptValue: 'portrait, ca',
            availableTags: ['castle'],
        });
        const prompt = screen.getByRole('textbox', { name: 'Positive prompt' });

        fireEvent.change(prompt, { target: { value: 'portrait, cas' } });
        const suggestion = screen.getByRole('button', { name: /castle/i });
        fireEvent.blur(prompt, { relatedTarget: suggestion });
        fireEvent.click(suggestion);

        expect(props.setPromptValue).toHaveBeenLastCalledWith('portrait, castle, ');
        expect(props.onUpdatePrompt).toHaveBeenCalledOnce();
        expect(props.onUpdatePrompt).toHaveBeenCalledWith('C:/library/image.png', 'portrait, castle, ');
    });

    it('shows a read-only original prompt without mutating the editable draft', () => {
        const { props } = renderTab(image(
            metadata({ positivePrompt: 'Current prompt' }),
            metadata({ positivePrompt: 'Imported prompt' }),
        ));

        fireEvent.click(screen.getByRole('button', { name: 'Original' }));
        const prompt = screen.getByRole('textbox', { name: 'Positive prompt' }) as HTMLTextAreaElement;
        expect(prompt.value).toBe('Imported prompt');
        expect(prompt.readOnly).toBe(true);
        expect(props.setPromptValue).not.toHaveBeenCalled();
    });

    it('only shows revert when editable metadata differs', () => {
        const unchanged = renderTab(image(metadata({ steps: 0 }), metadata({ steps: 20 })));
        expect(screen.queryByRole('button', { name: 'Revert All Metadata to Original' })).toBeNull();
        unchanged.unmount();

        const { props } = renderTab(image(
            metadata({ positivePrompt: 'Recovered prompt' }),
            metadata({ positivePrompt: 'Original prompt' }),
        ));
        fireEvent.click(screen.getByRole('button', { name: 'Revert All Metadata to Original' }));
        expect(props.onRevertMetadata).toHaveBeenCalledWith('C:/library/image.png');
    });

    it.each([
        ['generator software', metadata({ tool: GeneratorTool.COMFYUI }), metadata({ tool: GeneratorTool.AUTOMATIC1111 })],
        ['model override', metadata({ model: 'Original model', overrideModel: 'Chosen model' }), metadata({ model: 'Original model' })],
    ])('offers revert for a %s-only override', (_label, current, original) => {
        const { props } = renderTab(image(current, original));

        fireEvent.click(screen.getByRole('button', { name: 'Revert All Metadata to Original' }));

        expect(props.onRevertMetadata).toHaveBeenCalledWith('C:/library/image.png');
    });

    it('copies raw A1111 data and formats normalized parameters otherwise', () => {
        const raw = renderTab(image(metadata({
            tool: GeneratorTool.AUTOMATIC1111,
            rawParameters: 'raw generation parameters',
        }), metadata()));
        const copyGenerationData = screen.getByRole('button', { name: 'Copy generation data' });
        fireEvent.mouseEnter(copyGenerationData);
        expect(screen.getByRole('tooltip').textContent).toBe('Copy prompts and generation settings in the best available source-compatible format.');
        fireEvent.click(copyGenerationData);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('raw generation parameters');
        expect(screen.getByRole('button', { name: 'Generation parameters' }).getAttribute('aria-expanded')).toBe('true');
        raw.unmount();

        renderTab(image(metadata({
            positivePrompt: 'A castle', negativePrompt: 'fog', steps: 0, sampler: '', cfg: 8,
            seed: 0, modelHash: 'abc', model: 'Model X', tool: GeneratorTool.COMFYUI,
        }), metadata()), { negativePromptValue: 'fog' });
        fireEvent.click(screen.getByRole('button', { name: 'Copy generation data' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            'A castle\nNegative prompt: fog\nSteps: 0, Sampler: Euler a, CFG scale: 8, Seed: 0, Size: 100x100, Model hash: abc, Model: Model X',
        );
    });

    it('copies prompt text and clears feedback after two seconds', () => {
        vi.useFakeTimers();
        renderTab(image(metadata(), metadata()));
        fireEvent.click(screen.getByRole('button', { name: 'Copy Prompt' }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Original prompt');
        act(() => vi.advanceTimersByTime(2000));
        vi.useRealTimers();
    });

    it('edits generator software and model values', () => {
        const { props } = renderTab(image(metadata({ tool: GeneratorTool.COMFYUI, model: 'SDXL 1.0' }), metadata()));

        fireEvent.click(screen.getByRole('button', { name: 'Edit Generation Tool' }));
        fireEvent.change(screen.getByRole('combobox'), { target: { value: GeneratorTool.INVOKEAI } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(props.onUpdateTool).toHaveBeenCalledWith('C:/library/image.png', GeneratorTool.INVOKEAI);

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.click(screen.getByRole('option', { name: /Custom model/i }));
        fireEvent.change(screen.getByLabelText('Custom model name'), { target: { value: 'My Model' } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(props.onUpdateModel).toHaveBeenCalledWith('C:/library/image.png', 'My Model');
    });

    it('cancels generator and model drafts on outside click or Escape', () => {
        const { props } = renderTab(image(metadata({ tool: GeneratorTool.COMFYUI, model: 'SDXL 1.0' }), metadata()));

        fireEvent.click(screen.getByRole('button', { name: 'Edit Generation Tool' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Generator software' }), { target: { value: GeneratorTool.INVOKEAI } });
        fireEvent.pointerDown(document.body);
        expect(screen.getByRole('button', { name: 'Edit Generation Tool' })).toBeTruthy();
        expect(props.onUpdateTool).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.click(screen.getByRole('option', { name: /Custom model/i }));
        const customModel = screen.getByLabelText('Custom model name');
        fireEvent.change(customModel, { target: { value: 'Unsaved Model' } });
        fireEvent.keyDown(customModel, { key: 'Escape' });
        expect(screen.getByRole('button', { name: 'Edit Model' })).toBeTruthy();
        expect(props.onUpdateModel).not.toHaveBeenCalled();
    });

    it('discards model and generator drafts when navigating between assets with equal values', () => {
        const first = image(metadata({ tool: GeneratorTool.COMFYUI, model: 'Shared Model' }), metadata());
        const { props, rerender } = renderTab(first);

        fireEvent.click(screen.getByRole('button', { name: 'Edit Generation Tool' }));
        fireEvent.change(screen.getByRole('combobox'), { target: { value: GeneratorTool.INVOKEAI } });
        rerender(<MetadataInfoTab {...props} image={{ ...first, id: 'C:/library/next.png' }} />);
        expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
        expect(screen.getByRole('button', { name: 'Edit Generation Tool' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.click(screen.getByRole('option', { name: /Custom model/i }));
        fireEvent.change(screen.getByLabelText('Custom model name'), { target: { value: 'Unsaved Model' } });
        rerender(<MetadataInfoTab {...props} image={{ ...first, id: 'C:/library/third.png' }} />);
        expect(screen.queryByLabelText('Custom model name')).toBeNull();
        expect(screen.getByRole('button', { name: 'Edit Model' })).toBeTruthy();
        expect(props.onUpdateTool).not.toHaveBeenCalled();
        expect(props.onUpdateModel).not.toHaveBeenCalled();
    });

    it('renders only populated optional parameter and resource rows', () => {
        const { props } = renderTab(image(metadata({
            hiresSteps: 10,
            loras: ['detail-lora'],
        }), metadata()));

        expect(screen.getByText('Hires Steps').parentElement?.textContent).toContain('10');
        expect(screen.queryByText('Hires Upscale')).toBeNull();
        expect(screen.queryByText('ControlNet')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /detail-lora/i }));
        expect(props.onSearch).toHaveBeenCalledWith('lora:detail-lora');
        expect(props.onClose).toHaveBeenCalled();
    });

    it('groups populated generation resources separately from smart tags', () => {
        renderTab(image(metadata({
            positivePrompt: 'portrait, dramatic lighting',
            loras: ['detail-lora'],
        }), metadata()));

        const tagsSection = screen.getByRole('heading', { name: 'Smart Tags' }).closest('section');
        const resourcesSection = screen.getByRole('heading', { name: 'Resources' }).closest('section');
        const loraSection = screen.getByRole('heading', { name: 'LoRAs' }).closest('section');
        expect(tagsSection?.parentElement).toBe(resourcesSection?.parentElement);
        expect(loraSection?.parentElement?.closest('section')).toBe(resourcesSection);
        expect(screen.getByRole('button', { name: 'portrait' }).className).toContain('rounded-lg');
        expect(screen.getByRole('button', { name: 'detail-lora' }).className).toContain('rounded-lg');
    });

    it('collapses smart tags independently and keeps the tag count visible', () => {
        renderTab(image(metadata({ positivePrompt: 'portrait, dramatic lighting' }), metadata()));

        const disclosure = screen.getByRole('button', { name: 'Smart Tags' });
        expect(disclosure.closest('section')?.textContent).toContain('2');
        fireEvent.click(disclosure);

        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByRole('button', { name: 'portrait' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Generation parameters' }).getAttribute('aria-expanded')).toBe('true');
    });

    it('selects a known model from library-backed options', () => {
        const { props } = renderTab(image(metadata({ model: 'Current Model' }), metadata()), {
            modelOptions: ['Library Model', 'Another Model'],
        });

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        fireEvent.click(screen.getByRole('option', { name: 'Library Model' }));
        fireEvent.click(screen.getByRole('button', { name: /save/i }));

        expect(props.onUpdateModel).toHaveBeenCalledWith('C:/library/image.png', 'Library Model');
    });

    it('shows an unresolved model hash once without treating it as a user model', () => {
        const { props } = renderTab(image(
            metadata({ model: 'Unknown', modelHash: 'f8bb2922e1' }),
            metadata({ model: 'Unknown', modelHash: 'f8bb2922e1' }),
        ));

        expect(screen.getByText('f8bb2922e1')).toBeTruthy();
        expect(screen.getByText('Unresolved hash')).toBeTruthy();
        expect(screen.queryByText('Model Hash')).toBeNull();

        fireEvent.focus(screen.getByRole('button', { name: 'About unresolved model hash' }));
        expect(screen.getByRole('tooltip').textContent).toContain('Settings → Connections → Resources → Resolve Online');
        expect(screen.getByRole('tooltip').textContent).toContain('Only the hash is sent');

        fireEvent.click(screen.getByRole('button', { name: 'Edit Model' }));
        expect((screen.getByRole('combobox', { name: 'Search models' }) as HTMLInputElement).value).toBe('');
        expect(props.onUpdateModel).not.toHaveBeenCalled();
    });

    it('shows a resolved model name with its hash as supporting data', () => {
        renderTab(image(
            metadata({ model: 'Resolved Model', modelHash: 'f8bb2922e1' }),
            metadata({ model: 'Resolved Model', modelHash: 'f8bb2922e1' }),
        ));

        expect(screen.getByText('Resolved Model')).toBeTruthy();
        expect(screen.queryByText('Unresolved hash')).toBeNull();
        expect(screen.getByText('Model Hash').parentElement?.textContent).toContain('f8bb2922e1');
    });

    it('places InvokeAI provenance first for assets and later for generated images', () => {
        const asset = image(metadata(), metadata(), {
            invokeImageName: 'control-source.png',
            invokeImageCategory: 'control',
        });
        const { rerender, props } = renderTab(asset);
        const assetSource = screen.getByRole('heading', { name: 'Source' });
        const assetGenerator = screen.getByRole('heading', { name: 'Generator software' });
        expect(assetSource.compareDocumentPosition(assetGenerator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        rerender(<MetadataInfoTab {...props} image={image(metadata(), metadata(), {
            invokeImageName: 'generation.png',
            invokeImageCategory: 'general',
        })} />);
        const generatedSource = screen.getByRole('heading', { name: 'Source' });
        const parameters = screen.getByLabelText('Generation parameters');
        expect(parameters.compareDocumentPosition(generatedSource) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(generatedSource.compareDocumentPosition(screen.getByText('raw inspector')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('routes smart tags and highlights both prompts', () => {
        const { props } = renderTab(image(metadata({
            positivePrompt: 'portrait, dramatic lighting',
            negativePrompt: 'bad anatomy',
        }), metadata()), {
            searchHighlights: { positivePrompt: ['portrait'], negativePrompt: ['anatomy'] },
        });

        expect(document.querySelector('[data-terms="portrait"]')?.textContent).toContain('portrait');
        expect(document.querySelector('[data-terms="anatomy"]')?.textContent).toBe('bad anatomy');
        fireEvent.click(screen.getByRole('button', { name: 'portrait' }));
        expect(props.onSearch).toHaveBeenCalledWith('portrait');
    });

    it('wires creative assistant controls and busy state', () => {
        const { props, rerender } = renderTab(image(metadata(), metadata()), { onOpenAIResult: vi.fn() });
        const assistantHeading = screen.getByText('Creative Assistant');
        expect(assistantHeading.className).toContain('text-amethyst-600');
        expect(assistantHeading.className).toContain('dark:text-amethyst-300');
        fireEvent.click(screen.getByRole('button', { name: /prompt analysis/i }));
        fireEvent.click(screen.getByRole('button', { name: /variations/i }));
        fireEvent.click(screen.getByRole('button', { name: /view last result/i }));
        expect(props.onAIAnalysis).toHaveBeenCalledTimes(1);
        expect(props.onGenerateVariations).toHaveBeenCalledTimes(1);
        expect(props.onOpenAIResult).toHaveBeenCalledTimes(1);

        rerender(<MetadataInfoTab {...props} isAnalyzing />);
        expect(screen.getByText('Analyzing...')).toBeTruthy();
        expect(screen.getByText('Creating...')).toBeTruthy();
    });

    it('parses compatible clipboard prompts into both editable fields', async () => {
        vi.mocked(navigator.clipboard.readText).mockResolvedValue(
            'A lighthouse\nNegative prompt: fog\nSteps: 20, Sampler: Euler',
        );
        const { props } = renderTab(image(metadata(), metadata()));

        fireEvent.click(screen.getByRole('button', { name: 'Parse Prompt from Clipboard' }));
        await act(async () => undefined);

        expect(props.setPromptValue).toHaveBeenCalledWith('A lighthouse');
        expect(props.onUpdatePrompt).toHaveBeenCalledWith('C:/library/image.png', 'A lighthouse');
        expect(props.setNegativePromptValue).toHaveBeenCalledWith('fog');
        expect(props.onUpdateNegativePrompt).toHaveBeenCalledWith('C:/library/image.png', 'fog');
    });

    it('does not offer clipboard prompt mutation when prompt fields are read-only', () => {
        renderTab(image(metadata({ tool: GeneratorTool.AUTOMATIC1111 }), metadata()), {
            onUpdatePrompt: undefined,
            onUpdateNegativePrompt: undefined,
        });

        expect(screen.queryByRole('button', { name: 'Parse Prompt from Clipboard' })).toBeNull();
        expect((screen.getByRole('textbox', { name: 'Positive prompt' }) as HTMLTextAreaElement).readOnly).toBe(true);
        expect((screen.getByRole('textbox', { name: 'Negative prompt' }) as HTMLTextAreaElement).readOnly).toBe(true);
    });
});
