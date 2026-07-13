import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type ImageMetadata } from '../../../../../types';
import { MetadataInfoTab } from '../MetadataInfoTab';
import type { ComponentProps } from 'react';

vi.mock('../ParamItem', () => ({
    ParamItem: ({ label, value, isModified }: { label: string; value: string; isModified?: boolean }) => (
        <div><span>{label}</span><span>{value}</span>{isModified && <span title="Modified from original">modified</span>}</div>
    ),
}));

vi.mock('../ResourceSection', () => ({
    ResourceSection: ({ title, items, onSearch, onClose }: { title: string; items: Array<{ name?: string } | string>; onSearch: (term: string) => void; onClose: () => void }) => (
        <section aria-label={title}>{items.map((item, index) => {
            const value = typeof item === 'string' ? item : item.name ?? '';
            return <button key={index} onClick={() => { onSearch(value); onClose(); }}>{value}</button>;
        })}</section>
    ),
}));

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

const renderTab = (value: AIImage, overrides: Partial<ComponentProps<typeof MetadataInfoTab>> = {}) => {
    const props: ComponentProps<typeof MetadataInfoTab> = {
        image: value,
        promptValue: value.metadata.positivePrompt,
        setPromptValue: vi.fn(),
        negativePromptValue: value.metadata.negativePrompt,
        palette: [],
        isPaletteLoading: false,
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

describe('MetadataInfoTab prompt revert control', () => {
    beforeEach(() => {
        localStorage.removeItem('aigallery_gendata_open');
        vi.clearAllMocks();
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
    });

    it('does not show revert when only imported technical metadata differs', () => {
        renderTab(image(
            metadata({ steps: 0, cfg: 0 }),
            metadata({ steps: 20, cfg: 7 }),
        ));

        expect(screen.queryByRole('button', { name: 'Revert All Metadata to Original' })).toBeNull();
    });

    it('shows revert after the prompt has actually changed', () => {
        renderTab(image(
            metadata({ positivePrompt: 'Recovered prompt' }),
            metadata({ positivePrompt: 'Original prompt' }),
        ));

        expect(screen.getByRole('button', { name: 'Revert All Metadata to Original' })).not.toBeNull();
        expect(screen.getByText('Generation Data').closest('.border')?.className).not.toContain('border-amber');
    });

    it('renders an explicit zero seed instead of hiding it', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        renderTab(image(
            metadata({ seed: 0 }),
            metadata({ seed: 0 }),
        ));

        const seedItem = screen.getByText('Seed').parentElement?.parentElement;
        expect(seedItem?.textContent).toContain('0');
        expect(seedItem?.querySelector('[title="Modified from original"]')).toBeNull();
    });

    it('renders an unavailable seed as unknown', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        renderTab(image(
            metadata({ seed: undefined }),
            metadata({ seed: undefined }),
        ));

        const seedItem = screen.getByText('Seed').parentElement?.parentElement;
        expect(seedItem?.textContent).toContain('Unknown');
    });

    it('switches between current and original prompts and exposes recovery and revert actions', () => {
        const current = metadata({ positivePrompt: 'Current prompt' });
        const original = metadata({ positivePrompt: 'Original prompt' });
        const { props } = renderTab(image(current, original));

        fireEvent.click(screen.getByTitle('Show the original imported prompt'));
        fireEvent.click(screen.getByTitle('Show the current saved prompt'));
        fireEvent.click(screen.getByRole('button', { name: 'Recover Prompt with AI' }));
        fireEvent.click(screen.getByRole('button', { name: 'Revert All Metadata to Original' }));

        expect(props.setPromptValue).toHaveBeenNthCalledWith(1, 'Original prompt');
        expect(props.setPromptValue).toHaveBeenNthCalledWith(2, 'Current prompt');
        expect(props.onRecoverMetadata).toHaveBeenCalledTimes(1);
        expect(props.onRevertMetadata).toHaveBeenCalledWith('C:/library/image.png');
    });

    it('copies prompt text and clears feedback after two seconds', () => {
        vi.useFakeTimers();
        renderTab(image(metadata(), metadata()));
        fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Original prompt');
        expect(screen.getByText('Copied')).toBeTruthy();
        act(() => vi.advanceTimersByTime(2000));
        expect(screen.getByText('Copy')).toBeTruthy();
        vi.useRealTimers();
    });

    it('renders empty prompt guidance and suppresses original controls while loading', () => {
        renderTab(image(metadata({ positivePrompt: '' }), metadata({ positivePrompt: 'Original' })), {
            promptValue: '',
            isLoading: true,
            onRecoverMetadata: undefined,
            onRevertMetadata: undefined,
        });
        expect(screen.getByText(/no prompt data found/i)).toBeTruthy();
        expect(screen.queryByTitle('Show the original imported prompt')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Recover Prompt with AI' })).toBeNull();
    });

    it('treats empty, numeric, and trimmed metadata equivalents as unmodified', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        renderTab(image(
            metadata({ model: 'Unknown', sampler: ' Euler ', cfg: 7.00001, vae: '' }),
            metadata({ model: '', sampler: 'Euler', cfg: 7, vae: undefined }),
        ));
        expect(screen.queryAllByTitle('Modified from original')).toHaveLength(0);
        expect(screen.getByText('Generation Data').closest('.border')?.className).not.toContain('border-amber');
    });

    it('marks genuinely changed generation values', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        renderTab(image(metadata({ cfg: 8, sampler: 'DDIM' }), metadata({ cfg: 7, sampler: 'Euler' })));
        expect(screen.getAllByTitle('Modified from original').length).toBeGreaterThan(0);
        expect(screen.getByText('Generation Data').closest('.border')?.className).toContain('border-amber');
    });

    it('renders palette loading, empty, and copyable color states', () => {
        const value = image(metadata(), metadata());
        const loading = renderTab(value, { isPaletteLoading: true });
        expect(document.querySelectorAll('.animate-pulse > div')).toHaveLength(5);
        loading.unmount();

        const empty = renderTab(value);
        expect(screen.getByText('No palette extracted')).toBeTruthy();
        empty.unmount();

        vi.useFakeTimers();
        renderTab(value, { palette: ['#112233'] });
        const swatch = Array.from(document.querySelectorAll('button')).find(button => button.style.backgroundColor) as HTMLButtonElement;
        fireEvent.click(swatch);
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('#112233');
        expect(swatch.querySelector('svg')).toBeTruthy();
        act(() => vi.advanceTimersByTime(1500));
        expect(swatch.querySelector('svg')).toBeNull();
        vi.useRealTimers();
    });

    it('persists generation-data expansion and copies workflow and raw A1111 parameters', () => {
        vi.useFakeTimers();
        const value = image(metadata({
            tool: GeneratorTool.AUTOMATIC1111,
            rawParameters: 'raw generation parameters',
            workflowJson: '{"workflow":true}',
        }), metadata());
        renderTab(value);
        fireEvent.click(screen.getByText('Generation Data'));
        expect(localStorage.getItem('aigallery_gendata_open')).toBe('true');
        fireEvent.click(screen.getByRole('button', { name: /copy workflow/i }));
        fireEvent.click(screen.getByRole('button', { name: /copy params/i }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{"workflow":true}');
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('raw generation parameters');
        expect(screen.getByRole('button', { name: /copy workflow/i }).querySelector('svg')).toBeTruthy();
        act(() => vi.advanceTimersByTime(2000));
        fireEvent.click(screen.getByText('Generation Data'));
        expect(localStorage.getItem('aigallery_gendata_open')).toBe('false');
        vi.useRealTimers();
    });

    it('formats generated parameter text with optional metadata and defaults', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        renderTab(image(metadata({
            positivePrompt: 'A castle', negativePrompt: 'fog', steps: 0, sampler: '', cfg: 8,
            seed: 0, modelHash: 'abc', model: 'Model X', tool: GeneratorTool.COMFYUI,
        }), metadata()), { negativePromptValue: 'fog' });
        fireEvent.click(screen.getByRole('button', { name: /copy params/i }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
            'A castle\nNegative prompt: fog\nSteps: 0, Sampler: Euler a, CFG scale: 8, Seed: 0, Size: 100x100, Model hash: abc, Model: Model X'
        );
    });

    it('edits generator software and supports cancel and save', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        const { props } = renderTab(image(metadata({ tool: GeneratorTool.COMFYUI }), metadata()));
        const softwareRow = screen.getByText('Generator Software').parentElement?.parentElement as HTMLElement;
        fireEvent.click(softwareRow.querySelector('button')!);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: GeneratorTool.INVOKEAI } });
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
        fireEvent.click(softwareRow.querySelector('button')!);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: GeneratorTool.INVOKEAI } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(props.onUpdateTool).toHaveBeenCalledWith('C:/library/image.png', GeneratorTool.INVOKEAI);
    });

    it('edits predefined and custom model values', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        const value = image(metadata({ model: 'Unknown', overrideModel: 'Custom Existing' }), metadata());
        const { props } = renderTab(value);
        expect(screen.getByText('Override')).toBeTruthy();
        const modelLabel = screen.getByText('Model');
        const modelRow = modelLabel.parentElement?.parentElement as HTMLElement;
        fireEvent.click(modelRow.querySelector('button')!);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'custom' } });
        fireEvent.change(screen.getByPlaceholderText('Enter model name...'), { target: { value: 'My Model' } });
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(props.onUpdateModel).toHaveBeenCalledWith('C:/library/image.png', 'My Model');

        fireEvent.click(modelRow.querySelector('button')!);
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SDXL 1.0' } });
        fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });

    it('renders hires fields, model hash, smart tags, and resource routing', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        const value = image(metadata({
            positivePrompt: 'portrait, score_9, x, a very useful tag, this tag is far too long to be accepted here',
            hiresUpscale: 2, hiresSteps: 10, hiresUpscaler: 'Latent', modelHash: 'hash',
            loras: ['detail-lora'],
        }), metadata());
        const { props } = renderTab(value);
        expect(screen.getByText('Hires Upscale')).toBeTruthy();
        expect(screen.getByText('Model Hash')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'portrait' }));
        expect(props.onSearch).toHaveBeenCalledWith('portrait');
        expect(props.onClose).toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'detail-lora' }));
        expect(props.onSearch).toHaveBeenCalledWith('detail-lora');
    });

    it('renders highlighted negative prompts and wires creative assistant controls', () => {
        const value = image(metadata({ negativePrompt: 'bad anatomy' }), metadata());
        const { props } = renderTab(value, {
            searchHighlights: { positivePrompt: ['Original'], negativePrompt: ['anatomy'] },
            onOpenAIResult: vi.fn(),
        });
        expect(document.querySelector('[data-terms="Original"]')?.textContent).toBe('Original prompt');
        expect(screen.getByText('bad anatomy').dataset.terms).toBe('anatomy');
        fireEvent.click(screen.getByRole('button', { name: /prompt analysis/i }));
        fireEvent.click(screen.getByRole('button', { name: /variations/i }));
        fireEvent.click(screen.getByRole('button', { name: /view last result/i }));
        expect(props.onAIAnalysis).toHaveBeenCalledTimes(1);
        expect(props.onGenerateVariations).toHaveBeenCalledTimes(1);
        expect(props.onOpenAIResult).toHaveBeenCalledTimes(1);
    });

    it('disables creative actions and shows busy labels while analyzing', () => {
        renderTab(image(metadata(), metadata()), { isAnalyzing: true });
        expect(screen.getByText('Analyzing...')).toBeTruthy();
        expect(screen.getByText('Creating...')).toBeTruthy();
        expect((screen.getByRole('button', { name: /prompt analysis/i }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: /variations/i }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('renders safely without original metadata or a string prompt', () => {
        const value = {
            ...image(metadata(), metadata()),
            metadata: metadata({ positivePrompt: 42 as unknown as string }),
            originalMetadata: undefined,
        };
        renderTab(value, { promptValue: '' });
        expect(screen.queryByText('Smart Tags')).toBeNull();
        expect(screen.getByText('Generation Data').closest('.border')?.className).not.toContain('border-amber');
        expect(screen.queryByRole('button', { name: 'Revert All Metadata to Original' })).toBeNull();
    });

    it('copies default generated params when optional metadata is absent', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        renderTab(image(metadata({
            positivePrompt: '', negativePrompt: '', steps: undefined, sampler: '', cfg: undefined,
            seed: undefined, modelHash: undefined, model: 'Unknown', tool: GeneratorTool.COMFYUI,
        }), metadata()), { negativePromptValue: '' });
        fireEvent.click(screen.getByRole('button', { name: /copy params/i }));
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('\nSteps: 0, Sampler: Euler a, Size: 100x100');
    });

    it('styles alternate prompt selections, transient edits, and unchanged negative prompts', () => {
        const value = image(
            metadata({ positivePrompt: 'Current', negativePrompt: 'same negative' }),
            metadata({ positivePrompt: 'Original', negativePrompt: 'same negative' }),
        );
        renderTab(value, { promptValue: 'Original' });
        expect(screen.getByTitle('Show the original imported prompt').className).toContain('bg-sage');
        expect(screen.getByTitle('Show the current saved prompt').className).not.toContain('bg-amethyst');
        expect(screen.getByText('same negative').parentElement?.className).toContain('border-gray');

        const promptPanel = screen.getAllByText('Original').find(element => element.tagName === 'SPAN')?.parentElement;
        expect(promptPanel?.className).toContain('border-gray');
    });

    it('covers sparse advanced metadata, model fallback editing, and embeddings-only resources', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        const value = image(metadata({
            model: 'SDXL 1.0', overrideModel: undefined,
            hiresUpscale: 2, hiresSteps: undefined, hiresUpscaler: undefined,
            embeddings: ['embedding-one'],
        }), metadata());
        const { props } = renderTab(value);
        expect(screen.getByText('Hires Steps').parentElement?.textContent).toBe('Hires Steps');
        expect(screen.getByText('Hires Upscaler').parentElement?.textContent).toBe('Hires Upscaler');
        const modelRow = screen.getByText('Model').parentElement?.parentElement as HTMLElement;
        fireEvent.click(modelRow.querySelector('button')!);
        fireEvent.click(screen.getByRole('button', { name: /save/i }));
        expect(props.onUpdateModel).toHaveBeenCalledWith('C:/library/image.png', 'SDXL 1.0');
        fireEvent.click(screen.getByRole('button', { name: 'embedding-one' }));
        expect(props.onSearch).toHaveBeenCalledWith('embedding-one');
    });

    it('uses empty prompt fallbacks in both comparison controls', () => {
        const currentEmpty = renderTab(image(
            metadata({ positivePrompt: '' }),
            metadata({ positivePrompt: 'Original' }),
        ));
        fireEvent.click(screen.getByTitle('Show the current saved prompt'));
        expect(currentEmpty.props.setPromptValue).toHaveBeenCalledWith('');
        currentEmpty.unmount();

        const originalEmpty = renderTab(image(
            metadata({ positivePrompt: 'Current' }),
            metadata({ positivePrompt: '' }),
        ));
        fireEvent.click(screen.getByTitle('Show the original imported prompt'));
        expect(originalEmpty.props.setPromptValue).toHaveBeenCalledWith('');
    });

    it('renders an empty hires upscale when another hires field opens the section', () => {
        localStorage.setItem('aigallery_gendata_open', 'true');
        renderTab(image(
            metadata({ hiresUpscale: undefined, hiresSteps: 10, hiresUpscaler: undefined }),
            metadata(),
        ));
        expect(screen.getByText('Hires Upscale').parentElement?.textContent).toBe('Hires Upscale');
    });
});
