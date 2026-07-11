import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage } from '../../types';
import { updateFavorite, updatePinned } from '../../services/db/imageRepo';
import { useSearchStore } from '../searchStore';

vi.mock('../../services/db/imageRepo', () => ({ updateFavorite: vi.fn(), updatePinned: vi.fn() }));

const mockedUpdateFavorite = vi.mocked(updateFavorite);
const mockedUpdatePinned = vi.mocked(updatePinned);

const image = (id: string, overrides: Partial<AIImage> = {}): AIImage => ({
    id,
    url: `asset://${id}`,
    thumbnailUrl: `asset://${id}-thumb`,
    filename: `${id}.png`,
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    isPinned: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: '',
        steps: 20,
        cfg: 7,
        sampler: '',
        positivePrompt: '',
        negativePrompt: '',
    },
    ...overrides,
});

describe('searchStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUpdateFavorite.mockResolvedValue(undefined);
        mockedUpdatePinned.mockResolvedValue(undefined);
        const state = useSearchStore.getState();
        state.setImages([]);
        state.setRecentSearches([]);
        state.clearAllFilters();
        state.setSortOption('date_desc');
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('supports direct and functional state setters', () => {
        const state = useSearchStore.getState();
        state.setImages([image('one')]);
        state.setImages(previous => [...previous, image('two')]);
        state.setRecentSearches(['first']);
        state.setRecentSearches(previous => [...previous, 'second']);
        state.setFilters({ searchQuery: 'portrait', favoritesOnly: true });
        state.setFilters(previous => ({ searchQuery: `${previous.searchQuery} refined`, pinnedOnly: true }));
        state.setSortOption('name_asc');

        const next = useSearchStore.getState();
        expect(next.images.map(item => item.id)).toEqual(['one', 'two']);
        expect(next.recentSearches).toEqual(['first', 'second']);
        expect(next.filters).toMatchObject({ searchQuery: 'portrait refined', favoritesOnly: true, pinnedOnly: true });
        expect(next.sortOption).toBe('name_asc');

        next.clearAllFilters();
        expect(useSearchStore.getState().filters).toMatchObject({ searchQuery: '', favoritesOnly: false, collectionId: null });
    });

    it('keeps the deprecated fetch action as a resolved no-op', async () => {
        await expect(useSearchStore.getState().fetchData(true, ['dependency'])).resolves.toBeUndefined();
    });

    it('optimistically toggles favorites and persists the change', async () => {
        useSearchStore.getState().setImages([image('one'), image('two', { isFavorite: true })]);
        await useSearchStore.getState().toggleFavorite('one');
        expect(useSearchStore.getState().images.map(item => item.isFavorite)).toEqual([true, true]);
        expect(mockedUpdateFavorite).toHaveBeenCalledWith('one', true);

        await useSearchStore.getState().toggleFavorite('two');
        expect(mockedUpdateFavorite).toHaveBeenLastCalledWith('two', false);
        await useSearchStore.getState().toggleFavorite('missing');
        expect(mockedUpdateFavorite).toHaveBeenCalledTimes(2);
    });

    it('rolls favorites back when persistence fails', async () => {
        const original = [image('one'), image('two')];
        useSearchStore.getState().setImages(original);
        mockedUpdateFavorite.mockRejectedValueOnce(new Error('database locked'));
        await useSearchStore.getState().toggleFavorite('one');
        expect(useSearchStore.getState().images).toEqual(original);
        expect(console.error).toHaveBeenCalledWith('Toggle favorite failed', expect.any(Error));
    });

    it('optimistically toggles pins, handles missing IDs, and rolls back failures', async () => {
        const original = [image('one'), image('two', { isPinned: true })];
        useSearchStore.getState().setImages(original);
        await useSearchStore.getState().togglePin('one');
        expect(useSearchStore.getState().images.map(item => item.isPinned)).toEqual([true, true]);
        expect(mockedUpdatePinned).toHaveBeenCalledWith('one', true);

        await useSearchStore.getState().togglePin('missing');
        expect(mockedUpdatePinned).toHaveBeenCalledOnce();
        mockedUpdatePinned.mockRejectedValueOnce(new Error('disk full'));
        await useSearchStore.getState().togglePin('two');
        expect(useSearchStore.getState().images.map(item => item.isPinned)).toEqual([true, true]);
        expect(console.error).toHaveBeenCalledWith('Toggle pin failed', expect.any(Error));
    });
});
