import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIImage, Collection, GeneratorTool } from '../../../../../types';
import { createDefaultFilters } from '../../../../../utils/filterState';
import { MetadataEditTab } from '../MetadataEditTab';

const collectionRepoMocks = vi.hoisted(() => ({ getCollectionsForImage: vi.fn() }));

vi.mock('../../../../../services/db/collectionRepo', () => collectionRepoMocks);
vi.mock('../../../../../components/ui/PrivacyAwareThumbnail', () => ({
    PrivacyAwareThumbnail: ({ src }: { src?: string | null }) => (
        <div data-testid="privacy-aware-thumbnail" data-src={src || ''} />
    ),
}));

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
    collectionItems?: Collection[];
    availableTags?: string[];
    onSetCollectionMembership?: (imageId: string, collectionId: string, shouldBelong: boolean) => Promise<boolean>;
    onUpdatePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNegativePrompt?: (imageId: string, prompt: string) => void;
    onUpdateNotes?: (imageId: string, notes: string) => void;
}

const EditorHarness = ({
    image = createImage(),
    collectionItems = collections,
    availableTags = ['cat', 'castle', 'camera', 'candle', 'cape', 'canyon', 'dog'],
    onSetCollectionMembership = async () => true,
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
            collections={collectionItems}
            availableTags={availableTags}
            notes={notes}
            setNotes={setNotes}
            promptValue={promptValue}
            setPromptValue={setPromptValue}
            negativePromptValue={negativePromptValue}
            setNegativePromptValue={setNegativePromptValue}
            onSetCollectionMembership={onSetCollectionMembership}
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

    it('loads membership, filters collections, and persists the requested membership state', async () => {
        const onSetCollectionMembership = vi.fn().mockResolvedValue(true);
        const { container } = render(<EditorHarness onSetCollectionMembership={onSetCollectionMembership} />);

        expect(container.querySelector('.animate-spin')).toBeTruthy();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).toContain('bg-sage-100'));
        expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalledWith('image-1');

        const searchToggle = screen.getByRole('button', { name: 'Search Collections' });
        expect(searchToggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByPlaceholderText('Find collection...')).toBeNull();
        fireEvent.click(searchToggle);
        const search = screen.getByPlaceholderText('Find collection...');
        expect(searchToggle.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(search);
        fireEvent.change(search, { target: { value: 'LAND' } });
        expect(screen.getByRole('button', { name: 'Landscapes' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Portraits' })).toBeNull();

        fireEvent.change(search, { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Portraits' }));
        expect(screen.getByRole('button', { name: 'Portraits' }).className).not.toContain('bg-sage-100');
        expect(screen.getByRole('button', { name: 'Portraits' }).getAttribute('aria-pressed')).toBe('false');
        expect(onSetCollectionMembership).toHaveBeenCalledWith('image-1', 'one', false);

        fireEvent.click(screen.getByRole('button', { name: 'Landscapes' }));
        expect(screen.getByRole('button', { name: 'Landscapes' }).className).toContain('bg-sage-100');
        expect(screen.getByRole('button', { name: 'Landscapes' }).getAttribute('aria-pressed')).toBe('true');
        expect(onSetCollectionMembership).toHaveBeenCalledWith('image-1', 'two', true);
    });

    it('puts current memberships first and keeps the selected state visible without color alone', async () => {
        collectionRepoMocks.getCollectionsForImage.mockResolvedValueOnce(['three']);
        render(<EditorHarness />);

        await waitFor(() => expect(screen.getByRole('button', { name: 'Archived Ideas' }).getAttribute('aria-pressed')).toBe('true'));
        expect(screen.getByText('In this image (1)')).toBeTruthy();
        expect(screen.getByText('Other collections')).toBeTruthy();

        const selected = screen.getByRole('button', { name: 'Archived Ideas' });
        const firstOther = screen.getByRole('button', { name: 'Portraits' });
        expect(selected.compareDocumentPosition(firstOther) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(selected.className).toContain('dark:bg-sage-500/15');
        expect(selected.querySelector('[data-membership-indicator="selected"]')).toBeTruthy();
    });

    it('explains an empty membership while still offering other collections', async () => {
        collectionRepoMocks.getCollectionsForImage.mockResolvedValueOnce([]);
        render(<EditorHarness />);

        await waitFor(() => expect((screen.getByRole('button', { name: 'Portraits' }) as HTMLButtonElement).disabled).toBe(false));
        expect(screen.getByText('Not in any collection')).toBeTruthy();
        expect(screen.getByText('Other collections')).toBeTruthy();
    });

    it('filters both membership groups and resets the result list scroll position', async () => {
        collectionRepoMocks.getCollectionsForImage.mockResolvedValueOnce(['one']);
        render(<EditorHarness />);
        await waitFor(() => expect((screen.getByRole('button', { name: 'Portraits' }) as HTMLButtonElement).disabled).toBe(false));

        const list = screen.getByTestId('collection-membership-list');
        list.scrollTop = 80;
        fireEvent.click(screen.getByRole('button', { name: 'Search Collections' }));
        expect(list.scrollTop).toBe(0);

        list.scrollTop = 60;
        fireEvent.change(screen.getByRole('searchbox', { name: 'Find collection' }), { target: { value: 'port' } });
        expect(list.scrollTop).toBe(0);
        expect(screen.getByText('In this image (1)')).toBeTruthy();
        expect(screen.queryByText('Other collections')).toBeNull();
    });

    it('clears a collapsed collection search and keeps its open state across asset navigation', async () => {
        collectionRepoMocks.getCollectionsForImage
            .mockResolvedValueOnce(['one'])
            .mockResolvedValueOnce([]);
        const { rerender } = render(<EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-1')} />);
        await waitFor(() => expect((screen.getByRole('button', { name: 'Portraits' }) as HTMLButtonElement).disabled).toBe(false));

        const searchToggle = screen.getByRole('button', { name: 'Search Collections' });
        fireEvent.click(searchToggle);
        const search = screen.getByRole('searchbox', { name: 'Find collection' });
        fireEvent.change(search, { target: { value: 'land' } });

        rerender(<EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-2')} />);
        await waitFor(() => expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalledWith('image-2'));
        expect(screen.getByRole('searchbox', { name: 'Find collection' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Portraits' })).toBeNull();

        fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Find collection' }), { key: 'Escape' });
        expect(screen.queryByRole('searchbox', { name: 'Find collection' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Search Collections' }).getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(screen.getByRole('button', { name: 'Search Collections' }));
        expect((screen.getByRole('searchbox', { name: 'Find collection' }) as HTMLInputElement).value).toBe('');
        expect(screen.getByRole('button', { name: 'Portraits' })).toBeTruthy();
    });

    it('does not offer smart collections as manual assignment targets', async () => {
        const smartCollection: Collection = {
            id: 'smart',
            name: 'Favorite Images',
            imageIds: [],
            createdAt: 4,
            filters: createDefaultFilters({ favoritesOnly: true })
        };
        render(<EditorHarness collectionItems={[...collections, smartCollection]} />);

        await waitFor(() => expect((screen.getByRole('button', { name: 'Portraits' }) as HTMLButtonElement).disabled).toBe(false));
        expect(screen.queryByRole('button', { name: 'Favorite Images' })).toBeNull();
    });

    it('shows collection thumbnails, folder fallbacks, and a clear empty search state', async () => {
        render(<EditorHarness collectionItems={[
            { ...collections[0], thumbnail: 'asset://portrait.webp', safeThumbnail: 'asset://portrait-safe.webp' },
            collections[1],
        ]} />);

        await waitFor(() => expect((screen.getByRole('button', { name: 'Portraits' }) as HTMLButtonElement).disabled).toBe(false));
        expect(screen.getByTestId('privacy-aware-thumbnail').getAttribute('data-src')).toBe('asset://portrait.webp');
        expect(screen.getByTestId('collection-thumbnail-fallback')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Search Collections' }));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Find collection' }), { target: { value: 'missing' } });
        expect(screen.getByText('No collections found.')).toBeTruthy();
    });

    it('rolls collection membership back when persistence reports failure', async () => {
        const onSetCollectionMembership = vi.fn().mockResolvedValue(false);
        render(<EditorHarness onSetCollectionMembership={onSetCollectionMembership} />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).toContain('bg-sage-100'));

        fireEvent.click(screen.getByRole('button', { name: 'Portraits' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).toContain('bg-sage-100'));

        fireEvent.click(screen.getByRole('button', { name: 'Landscapes' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Landscapes' }).className).not.toContain('bg-sage-100'));
    });

    it('rolls collection membership back when persistence rejects unexpectedly', async () => {
        const onSetCollectionMembership = vi.fn().mockRejectedValue(new Error('write failed'));
        render(<EditorHarness onSetCollectionMembership={onSetCollectionMembership} />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Landscapes' })).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Landscapes' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Landscapes' }).className).not.toContain('bg-sage-100'));
    });

    it('disables a pending membership row and ignores duplicate clicks', async () => {
        const pending = deferred<boolean>();
        const onSetCollectionMembership = vi.fn().mockReturnValue(pending.promise);
        render(<EditorHarness onSetCollectionMembership={onSetCollectionMembership} />);
        await waitFor(() => expect((screen.getByRole('button', { name: 'Landscapes' }) as HTMLButtonElement).disabled).toBe(false));

        fireEvent.click(screen.getByRole('button', { name: 'Landscapes' }));
        const pendingLandscapes = screen.getByRole('button', { name: 'Landscapes' });
        expect((pendingLandscapes as HTMLButtonElement).disabled).toBe(true);
        expect(pendingLandscapes.getAttribute('aria-busy')).toBe('true');
        fireEvent.click(pendingLandscapes);
        expect(onSetCollectionMembership).toHaveBeenCalledTimes(1);

        await act(async () => pending.resolve(true));
        await waitFor(() => expect((screen.getByRole('button', { name: 'Landscapes' }) as HTMLButtonElement).disabled).toBe(false));
    });

    it('does not apply a late rollback to a different image', async () => {
        const pending = deferred<boolean>();
        const onSetCollectionMembership = vi.fn().mockReturnValue(pending.promise);
        collectionRepoMocks.getCollectionsForImage
            .mockResolvedValueOnce(['one'])
            .mockResolvedValueOnce([]);
        const { rerender } = render(
            <EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-1')} onSetCollectionMembership={onSetCollectionMembership} />,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).toContain('bg-sage-100'));
        fireEvent.click(screen.getByRole('button', { name: 'Portraits' }));

        rerender(
            <EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-2')} onSetCollectionMembership={onSetCollectionMembership} />,
        );
        await waitFor(() => expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalledWith('image-2'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).not.toContain('bg-sage-100'));

        await act(async () => pending.resolve(false));
        expect(screen.getByRole('button', { name: 'Portraits' }).className).not.toContain('bg-sage-100');
    });

    it('preserves a successful membership change across navigation and a stale refetch', async () => {
        const pendingMembership = deferred<boolean>();
        const staleRefetch = deferred<string[]>();
        const onSetCollectionMembership = vi.fn().mockReturnValue(pendingMembership.promise);
        collectionRepoMocks.getCollectionsForImage
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([])
            .mockReturnValueOnce(staleRefetch.promise);
        const { rerender } = render(
            <EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-1')} onSetCollectionMembership={onSetCollectionMembership} />,
        );
        await waitFor(() => expect((screen.getByRole('button', { name: 'Landscapes' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Landscapes' }));

        rerender(
            <EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-2')} onSetCollectionMembership={onSetCollectionMembership} />,
        );
        await waitFor(() => expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalledWith('image-2'));
        rerender(
            <EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-1')} onSetCollectionMembership={onSetCollectionMembership} />,
        );
        await waitFor(() => expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalledTimes(3));
        expect(screen.getByRole('button', { name: 'Landscapes' }).className).toContain('bg-sage-100');

        await act(async () => pendingMembership.resolve(true));
        expect(screen.getByRole('button', { name: 'Landscapes' }).className).toContain('bg-sage-100');

        await act(async () => staleRefetch.resolve([]));
        expect(screen.getByRole('button', { name: 'Landscapes' }).className).toContain('bg-sage-100');
    });

    it('merges opposite membership outcomes by row across navigation', async () => {
        const failedAdd = deferred<boolean>();
        const successfulRemoval = deferred<boolean>();
        const staleRefetch = deferred<string[]>();
        const onSetCollectionMembership = vi.fn((_: string, collectionId: string) => (
            collectionId === 'two' ? failedAdd.promise : successfulRemoval.promise
        ));
        collectionRepoMocks.getCollectionsForImage
            .mockResolvedValueOnce(['one'])
            .mockResolvedValueOnce([])
            .mockReturnValueOnce(staleRefetch.promise);
        const { rerender } = render(
            <EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-1')} onSetCollectionMembership={onSetCollectionMembership} />,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).toContain('bg-sage-100'));

        fireEvent.click(screen.getByRole('button', { name: 'Landscapes' }));
        fireEvent.click(screen.getByRole('button', { name: 'Portraits' }));
        rerender(
            <EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-2')} onSetCollectionMembership={onSetCollectionMembership} />,
        );
        await waitFor(() => expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalledWith('image-2'));
        await act(async () => failedAdd.resolve(false));

        rerender(
            <EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-1')} onSetCollectionMembership={onSetCollectionMembership} />,
        );
        await waitFor(() => expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenCalledTimes(3));
        await act(async () => successfulRemoval.resolve(true));
        await act(async () => staleRefetch.resolve(['one']));

        expect(screen.getByRole('button', { name: 'Portraits' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Landscapes' }).getAttribute('aria-pressed')).toBe('false');
    });

    it('evicts inactive membership snapshots while retaining only active or pending images', async () => {
        const reloadedMembership = deferred<string[]>();
        collectionRepoMocks.getCollectionsForImage
            .mockResolvedValueOnce(['one'])
            .mockResolvedValueOnce([])
            .mockReturnValueOnce(reloadedMembership.promise);
        const { rerender } = render(
            <EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-1')} />,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).getAttribute('aria-pressed')).toBe('true'));

        rerender(<EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-2')} />);
        await waitFor(() => expect((screen.getByRole('button', { name: 'Portraits' }) as HTMLButtonElement).disabled).toBe(false));
        rerender(<EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-1')} />);

        expect(screen.getByRole('button', { name: 'Portraits' }).getAttribute('aria-pressed')).toBe('false');
        await act(async () => reloadedMembership.resolve(['one']));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).getAttribute('aria-pressed')).toBe('true'));
    });

    it('shows a retryable error when membership loading fails after navigation', async () => {
        const rejectedMembership = deferred<string[]>();
        collectionRepoMocks.getCollectionsForImage
            .mockResolvedValueOnce(['one'])
            .mockReturnValueOnce(rejectedMembership.promise)
            .mockResolvedValueOnce([]);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { rerender } = render(<EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-1')} />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Portraits' }).className).toContain('bg-sage-100'));

        rerender(<EditorHarness image={createImage(GeneratorTool.AUTOMATIC1111, 'image-2')} />);
        await act(async () => rejectedMembership.reject(new Error('read failed')));

        expect(screen.getByRole('alert').textContent).toContain('Could not load collection membership.');
        expect((screen.getByRole('button', { name: 'Portraits' }) as HTMLButtonElement).disabled).toBe(true);
        expect(document.querySelector('.animate-spin')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect((screen.getByRole('button', { name: 'Portraits' }) as HTMLButtonElement).disabled).toBe(false));
        expect(collectionRepoMocks.getCollectionsForImage).toHaveBeenLastCalledWith('image-2');
        consoleError.mockRestore();
    });

    it('handles membership fetch failures and ignores completion after unmount', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        collectionRepoMocks.getCollectionsForImage.mockRejectedValueOnce(new Error('read failed'));
        const first = render(<EditorHarness />);
        await waitFor(() => expect(consoleError).toHaveBeenCalledWith('[CollectionMembershipPicker] Failed to load collection membership', expect.any(Error)));
        expect(first.container.querySelector('.animate-spin')).toBeNull();
        expect(screen.getByRole('alert').textContent).toContain('Could not load collection membership.');
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
