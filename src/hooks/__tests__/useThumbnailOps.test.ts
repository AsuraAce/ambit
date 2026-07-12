import { act, renderHook } from '../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIImage, GeneratorTool } from '../../types';
import { useLibraryStore } from '../../stores/libraryStore';
import { useThumbnailOps } from '../useThumbnailOps';

const mocks = vi.hoisted(() => ({
    browserMode: false,
    addToast: vi.fn(),
    getImagesByIds: vi.fn(),
    regenerate: vi.fn(),
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => mocks.browserMode,
}));

vi.mock('../useToast', () => ({
    useToast: () => ({ addToast: mocks.addToast }),
}));

vi.mock('../../services/db/imageRepo', () => ({
    getImagesByIds: (...args: unknown[]) => mocks.getImagesByIds(...args),
}));

vi.mock('../../services/thumbnailService', () => ({
    regenerateThumbnailsForImages: (...args: unknown[]) => mocks.regenerate(...args),
}));

const image = (id: string, optimized = false): AIImage => ({
    id,
    url: `C:/${id}.png`,
    thumbnailUrl: optimized ? `C:/thumbs/${id}.webp` : `C:/${id}.png`,
    filename: `${id}.png`,
    fileSize: 1,
    timestamp: 1,
    width: 1,
    height: 1,
    isFavorite: false,
    isPinned: false,
    isDeleted: false,
    isMissing: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        steps: 0,
        cfg: 0,
        sampler: '',
        positivePrompt: '',
        negativePrompt: '',
    },
});

describe('useThumbnailOps', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.browserMode = false;
        mocks.getImagesByIds.mockResolvedValue([]);
        mocks.regenerate.mockResolvedValue([]);
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    });

    const setup = (images: AIImage[] = []) => {
        const setImages = vi.fn();
        const refreshCollectionThumbnails = vi.fn().mockResolvedValue(undefined);
        const hook = renderHook(() => useThumbnailOps({
            images,
            setImages,
            refreshCollectionThumbnails,
        }));
        return { ...hook, setImages, refreshCollectionThumbnails };
    };

    it('rejects regeneration in browser mock mode', async () => {
        mocks.browserMode = true;
        const { result } = setup([image('one')]);

        await act(async () => result.current.regenerateThumbnails());

        expect(mocks.addToast).toHaveBeenCalledWith('Unavailable in browser mock mode.', 'info');
        expect(mocks.regenerate).not.toHaveBeenCalled();
    });

    it('reports when the current library has no unoptimized local images', async () => {
        const { result } = setup([
            image('optimized', true),
            { ...image('blob'), url: 'blob:preview', thumbnailUrl: 'blob:preview' },
            { ...image('data'), url: 'data:image/png;base64,a', thumbnailUrl: 'data:image/png;base64,a' },
        ]);

        await act(async () => result.current.regenerateThumbnails());

        expect(mocks.addToast).toHaveBeenCalledWith('No unoptimized images found correctly.', 'success');
        expect(mocks.regenerate).not.toHaveBeenCalled();
    });

    it('loads targeted candidates and quietly returns when none resolve', async () => {
        const { result } = setup();

        await act(async () => result.current.regenerateThumbnails(['missing']));

        expect(mocks.getImagesByIds).toHaveBeenCalledWith(['missing']);
        expect(mocks.addToast).not.toHaveBeenCalled();
    });

    it('recovers when targeted candidate lookup fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.getImagesByIds.mockRejectedValue(new Error('query failed'));
        const { result } = setup();

        await act(async () => result.current.regenerateThumbnails(['one']));

        expect(error).toHaveBeenCalledWith('Failed to fetch images for regeneration', expect.any(Error));
        expect(mocks.regenerate).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('forwards progress, merges updates, refreshes collections, and clears store state', async () => {
        const candidate = image('one');
        const updated = { ...candidate, thumbnailUrl: 'C:/thumb.webp' };
        mocks.getImagesByIds.mockResolvedValue([candidate]);
        mocks.regenerate.mockImplementation(async (
            _images: AIImage[],
            progress: (current: number, total: number) => void
        ) => {
            progress(1, 1);
            return [updated];
        });
        const onProgress = vi.fn();
        const { result, setImages, refreshCollectionThumbnails } = setup([candidate, image('two', true)]);

        await act(async () => result.current.regenerateThumbnails(['one']));

        expect(mocks.regenerate).toHaveBeenCalledWith([candidate], expect.any(Function), expect.any(AbortSignal));
        expect(setImages).toHaveBeenCalledWith(expect.any(Function));
        const updater = setImages.mock.calls[0][0] as (images: AIImage[]) => AIImage[];
        expect(updater([candidate, image('two', true)])).toEqual([updated, image('two', true)]);
        expect(refreshCollectionThumbnails).toHaveBeenCalledWith(false, true);
        expect(mocks.addToast).toHaveBeenCalledWith('Successfully optimized 1 of 1 thumbnails.', 'success');
        expect(useLibraryStore.getState().isRegeneratingThumbnails).toBe(false);
        expect(useLibraryStore.getState().thumbnailProgress).toBeNull();
        expect(useLibraryStore.getState().thumbnailAbortController).toBeNull();
        expect(onProgress).not.toHaveBeenCalled();
    });

    it('forwards callback progress and reports cancellation after partial updates', async () => {
        const candidate = image('one');
        mocks.regenerate.mockImplementation(async (
            _images: AIImage[],
            progress: (current: number, total: number) => void,
            signal: AbortSignal
        ) => {
            progress(1, 2);
            useLibraryStore.getState().thumbnailAbortController?.abort();
            expect(signal.aborted).toBe(true);
            return [{ ...candidate, thumbnailUrl: 'C:/partial.webp' }];
        });
        const onProgress = vi.fn();
        const { result } = setup([candidate]);

        await act(async () => result.current.regenerateThumbnails(onProgress));

        expect(onProgress).toHaveBeenCalledWith(1, 2);
        expect(mocks.addToast).toHaveBeenCalledWith('Cancelled after optimizing 1 thumbnails.', 'success');
    });

    it('reports service failures and always clears regeneration state', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mocks.regenerate.mockRejectedValue(new Error('generation failed'));
        const { result } = setup([image('one')]);

        await act(async () => result.current.regenerateThumbnails());

        expect(error).toHaveBeenCalledWith('Regeneration error', expect.any(Error));
        expect(mocks.addToast).toHaveBeenCalledWith('Thumbnail optimization failed partway through', 'error');
        expect(useLibraryStore.getState().isRegeneratingThumbnails).toBe(false);
        error.mockRestore();
    });

    it('cleans up without refreshing when regeneration produces no updates', async () => {
        const { result, refreshCollectionThumbnails } = setup([image('one')]);

        await act(async () => result.current.regenerateThumbnails());

        expect(mocks.regenerate).toHaveBeenCalled();
        expect(refreshCollectionThumbnails).not.toHaveBeenCalled();
        expect(mocks.addToast).not.toHaveBeenCalled();
        expect(useLibraryStore.getState().isRegeneratingThumbnails).toBe(false);
    });
});
