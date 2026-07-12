import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIImage, Collection, GeneratorTool } from '../../../../../types';
import { MetadataEditTab } from '../MetadataEditTab';

const collectionRepoMocks = vi.hoisted(() => ({ getCollectionsForImage: vi.fn() }));

vi.mock('../../../../../services/db/collectionRepo', () => collectionRepoMocks);

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const clipboardReadText = vi.fn();

const createImage = (tool = GeneratorTool.AUTOMATIC1111, id = 'image-1'): AIImage => ({
    id,
    url: `asset://${id}.png`,
    thumbnailUrl: `asset://${id}-thumb.png`,
    filename: `${id}.png`,
    timestamp: 1,
    width: 1024,
    height: 768,
    isFavorite: false,
    metadata: {
        tool,
        model: 'Model',
        steps: 20,
        cfg: 7,
        sampler: 'Euler',
        positivePrompt: 'initial prompt',
        negativePrompt: 'initial negative',
    },
});

const collections: Collection[] = [
    { id: 'one', name: 'Portraits', imageIds: [], createdAt: 1 },
    { id: 'two', name: 'Landscapes', imageIds: [], createdAt: 2 },
    { id: 'three', name: 'Archived Ideas', imageIds: [], createdAt: 3 },
];

interface HarnessProps {
    image?: AIImage;
    availableTags?: string[];
    onAddToCollection?: (imageId: string, collectionId: string) => void;
    onUpdatePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNegativePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNotes?: (imageId: string, notes: string) => void;
}

const EditorHarness = ({
    image = createImage(),
    availableTags = ['cat', 'castle', 'camera', 'candle', 'cape', 'canyon', 'dog'],
    onAddToCollection = () => undefined,
    onUpdatePrompt,
    onUpdateNegativePrompt,
    onUpdateNotes,
}: HarnessProps) => {
    const [notes, setNotes] = React.useState('initial notes');
    const [promptValue, setPromptValue] = React.useState('initial prompt');
    const [negativePromptValue, setNegativePromptValue] = React.useState('initial negative');

    return (
        <MetadataEditTab
            image={image}
            collections={collections}
            availableTags={availableTags}
            notes={notes}
            setNotes={setNotes}
            promptValue={promptValue}
            setPromptValue={setPromptValue}
            negativePromptValue={negativePromptValue}
            setNegativePromptValue={setNegativePromptValue}
            onAddToCollection={onAddToCollection}
            onUpdatePrompt={onUpdatePrompt}
            onUpdateNegativePrompt={onUpdateNegativePrompt}
            onUpdateNotes={onUpdateNotes}
        />
    );
};

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

describe('MetadataEditTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        collectionRepoMocks.getCollectionsForImage.mockResolvedValue(['one']);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { readText: clipboardReadText },
        });
    });

    afterAll(() => {
        if (clipboardDescriptor) {
            Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
        } else {
            Reflect.deleteProperty(navigator, 'clipboard');
        }
    });

    it('loads membership, filters collections, and toggles membership optimistically', async () => {
        const onAddToCollection = vi.fn().mockResolvedValue(undefined);
        const { container } = render(<EditorHarness onAddToCollection={onAddToCollection} />);

        expect(container.querySelector('.animate-spin')).toBeTruthy();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).toContain('bg-sage-100'));
        expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalledWith('image-1');

        const search = screen.getByPlaceholderText('Find collection...');
        fireEvent.change(search, { target: { value: 'LAND' } });
        expect(screen.getByRole('button', { name: 'Landscapes' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Portraits' })).toBeNull();

        fireEvent.change(search, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Portraits' }));
        expect(screen.getByRole('button', { name: 'Portraits' }).className).not.toContain('bg-sage-100');
        expect(onAddToCollection).toHaveBeenCalledWith('image-1', 'one');

        fireEvent.click(screen.getByRole('button', { name: 'Landscapes' }));
        expect(screen.getByRole('button', { name: 'Landscapes' }).className).toContain('bg-sage-100');
        expect(onAddToCollection).toHaveBeenCalledWith('image-1', 'two');
    });

    it('rolls collection membership back when persistence rejects', async () => {
        const onAddToCollection = vi.fn().mockRejectedValue(new Error('write failed'));
        render(<EditorHarness onAddToCollection={onAddToCollection} />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).toContain('bg-sage-100'));

        fireEvent.click(screen.getByRole('button', { name: 'Portraits' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).toContain('bg-sage-100'));

        fireEvent.click(screen.getByRole('button', { name: 'Landscapes' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Landscapes' }).className).not.toContain('bg-sage-100'));
    });

    it('handles membership fetch failures and ignores completion after unmount', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        collectionRepoMocks.getCollectionsForImage.mockRejectedValueOnce(new Error('read failed'));
        const first = render(<EditorHarness />);
        await waitFor(() => expect(consoleError).toHaveBeenCalledWith('Failed to fetch image collections', expect.any(Error)));
        expect(first.container.querySelector('.animate-spin')).toBeNull();
        first.unmount();

        const pending = deferred<string[]>();
        collectionRepoMocks.getCollectionsForImage.mockReturnValueOnce(pending.promise);
        const second = render(<EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-2')} />);
        second.unmount();
        await act(async () => pending.resolve(['two']));

        consoleError.mockRestore();
    });

    it('suggests matching tags, applies a suggestion, and saves both dirty prompts', async () => {
        const onUpdatePrompt = vi.fn();
        const onUpdateNegativePrompt = vi.fn();
        render(
            <EditorHarness
                onUpdatePrompt={onUpdatePrompt}
                onUpdateNegativePrompt={onUpdateNegativePrompt}
            />,
        );
        await waitFor(() => expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalled());
        const positive = screen.getByPlaceholderText('Enter positive prompt...');
        const negative = screen.getByPlaceholderText('Enter negative prompt...');

        fireEvent.change(positive, { target: { value: 'portrait, ca' } });
        expect(screen.getByText('castle')).toBeTruthy();
        expect(screen.getByText('camera')).toBeTruthy();
        expect(screen.queryByText('canyon')).toBeNull();
        fireEvent.click(screen.getByText('castle'));
        expect((positive as HTMLTextAreaElement).value).toBe('portrait, castle, ');

        fireEvent.change(positive, { target: { value: 'final prompt' } });
        fireEvent.change(negative, { target: { value: 'final negative' } });
        expect(screen.getAllByText('Unsaved')).toHaveLength(2);
        fireEvent.blur(positive);

        expect(onUpdatePrompt).toHaveBeenCalledWith('image-1', 'final prompt');
        expect(onUpdateNegativePrompt).toHaveBeenCalledWith('image-1', 'final negative');
        expect(screen.queryByText('Unsaved')).toBeNull();
    });

    it('clears prompt suggestions for short or exact tokens and tolerates absent update callbacks', async () => {
        render(<EditorHarness availableTags={['cat', 'castle']} />);
        await waitFor(() => expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalled());
        const positive = screen.getByPlaceholderText('Enter positive prompt...');
        const negative = screen.getByPlaceholderText('Enter negative prompt...');

        fireEvent.change(positive, { target: { value: 'ca' } });
        expect(screen.getByText('castle')).toBeTruthy();
        fireEvent.change(positive, { target: { value: 'c' } });
        expect(screen.queryByText('castle')).toBeNull();
        fireEvent.change(positive, { target: { value: 'cat' } });
        expect(screen.queryByRole('button', { name: 'cat' })).toBeNull();

        fireEvent.change(negative, { target: { value: 'changed' } });
        fireEvent.blur(negative);
        expect(screen.getAllByText('Unsaved')).toHaveLength(2);
    });

    it('parses multiline Automatic1111 generation text from the clipboard', async () => {
        const onUpdatePrompt = vi.fn();
        const onUpdateNegativePrompt = vi.fn();
        clipboardReadText.mockResolvedValueOnce([
            'first positive line',
            '',
            'second positive line',
            'Negative prompt: first negative',
            'second negative',
            'Steps: 30, Sampler: Euler',
            'ignored parameter continuation',
        ].join('\n'));
        render(
            <EditorHarness
                onUpdatePrompt={onUpdatePrompt}
                onUpdateNegativePrompt={onUpdateNegativePrompt}
            />,
        );

        fireEvent.click(screen.getByTitle('Paste & Parse from Clipboard (Auto1111 format)'));

        await waitFor(() => expect(onUpdatePrompt).toHaveBeenCalledWith(
            'image-1',
            'first positive line\nsecond positive line',
        ));
        expect(onUpdateNegativePrompt).toHaveBeenCalledWith(
            'image-1',
            'first negative\nsecond negative',
        );
        expect((screen.getByPlaceholderText('Enter positive prompt...') as HTMLTextAreaElement).value)
            .toBe('first positive line\nsecond positive line');
    });

    it('ignores invalid clipboard text and reports clipboard read failures', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const onUpdatePrompt = vi.fn();
        clipboardReadText.mockResolvedValueOnce('plain prompt without parameters');
        const { rerender } = render(<EditorHarness onUpdatePrompt={onUpdatePrompt} />);

        fireEvent.click(screen.getByTitle('Paste & Parse from Clipboard (Auto1111 format)'));
        await act(async () => undefined);
        expect(onUpdatePrompt).not.toHaveBeenCalled();

        clipboardReadText.mockRejectedValueOnce(new Error('clipboard denied'));
        fireEvent.click(screen.getByTitle('Paste & Parse from Clipboard (Auto1111 format)'));
        await waitFor(() => expect(consoleError).toHaveBeenCalledWith('Clipboard paste failed', expect.any(Error)));

        rerender(<EditorHarness image={createImage(GeneratorTool.COMFYUI)} />);
        expect(screen.queryByTitle('Paste & Parse from Clipboard (Auto1111 format)')).toBeNull();
        consoleError.mockRestore();
    });

    it('parses valid clipboard payloads when only one prompt side is present', async () => {
        const onUpdatePrompt = vi.fn();
        const onUpdateNegativePrompt = vi.fn();
        clipboardReadText.mockResolvedValueOnce([
            'Negative prompt:',
            'negative only',
            'Steps: 20',
        ].join('\n'));
        render(
            <EditorHarness
                onUpdatePrompt={onUpdatePrompt}
                onUpdateNegativePrompt={onUpdateNegativePrompt}
            />,
        );
        const pasteButton = screen.getByTitle('Paste & Parse from Clipboard (Auto1111 format)');

        fireEvent.click(pasteButton);
        await waitFor(() => expect(onUpdateNegativePrompt).toHaveBeenCalledWith('image-1', 'negative only'));
        expect(onUpdatePrompt).not.toHaveBeenCalled();

        vi.clearAllMocks();
        clipboardReadText.mockResolvedValueOnce('positive only\nSteps: 20');
        fireEvent.click(pasteButton);
        await waitFor(() => expect(onUpdatePrompt).toHaveBeenCalledWith('image-1', 'positive only'));
        expect(onUpdateNegativePrompt).not.toHaveBeenCalled();
    });

    it('shows paste support for every compatible fallback tool', async () => {
        const { rerender } = render(<EditorHarness image={createImage(GeneratorTool.FORGE)} />);
        await waitFor(() => expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalled());
        expect(screen.getByTitle('Paste & Parse from Clipboard (Auto1111 format)')).toBeTruthy();

        rerender(<EditorHarness image={createImage(GeneratorTool.UNKNOWN)} />);
        expect(screen.getByTitle('Paste & Parse from Clipboard (Auto1111 format)')).toBeTruthy();
    });

    it('saves dirty notes from the explicit save control and on blur', async () => {
        vi.useFakeTimers();
        const onUpdateNotes = vi.fn();
        render(<EditorHarness onUpdateNotes={onUpdateNotes} />);
        await act(async () => undefined);
        const notes = screen.getByPlaceholderText('Add your notes here...');

        fireEvent.blur(notes);
        fireEvent.change(notes, { target: { value: 'review #favorite' } });
        const saveIcon = document.querySelector('.lucide-save');
        const saveButton = saveIcon?.closest('button');
        if (!(saveButton instanceof HTMLButtonElement)) throw new Error('Missing notes save button');
        fireEvent.click(saveButton);
        expect(onUpdateNotes).toHaveBeenCalledWith('image-1', 'review #favorite');

        fireEvent.change(notes, { target: { value: 'plain notes' } });
        fireEvent.blur(notes);
        expect(onUpdateNotes).toHaveBeenCalledWith('image-1', 'plain notes');
        act(() => vi.advanceTimersByTime(200));
        vi.useRealTimers();
    });

    it('clears dirty notes without persistence when no notes callback is supplied', async () => {
        vi.useFakeTimers();
        render(<EditorHarness />);
        await act(async () => undefined);
        const notes = screen.getByPlaceholderText('Add your notes here...');

        fireEvent.change(notes, { target: { value: 'x' } });
        fireEvent.blur(notes);
        expect(screen.queryByText('Unsaved')).toBeNull();
        act(() => vi.runOnlyPendingTimers());
        vi.useRealTimers();
    });
});
