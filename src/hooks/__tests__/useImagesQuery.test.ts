import { renderHook } from '../../test/testUtils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIImage, AppSettings, Collection, PaginationCursor, SortOption } from '../../types';
import { createDefaultFilters } from '../../utils/filterState';
import { useImagesQuery, type ImagesQueryKey } from '../useImagesQuery';

type QueryPage = { images: AIImage[]; totalCount: number; globalCount: number };
type InfiniteQueryConfig = {
    queryKey: ImagesQueryKey;
    queryFn: (context: { pageParam: PaginationCursor | undefined }) => Promise<QueryPage>;
    getNextPageParam: (lastPage: QueryPage) => PaginationCursor | undefined;
    placeholderData: (
        previousData?: { pages: QueryPage[] },
        previousQuery?: { queryKey: readonly unknown[] }
    ) => { pages: QueryPage[] } | undefined;
    enabled: boolean;
};

const mocks = vi.hoisted(() => ({
    config: undefined as unknown,
    browserMockMode: false,
    searchBrowserMockImages: vi.fn(),
    buildSqlWhereClause: vi.fn(),
    searchImages: vi.fn(),
    countImages: vi.fn(),
    countGlobalImages: vi.fn()
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
    ...await importOriginal<typeof import('@tanstack/react-query')>(),
    useInfiniteQuery: (config: unknown) => {
        mocks.config = config;
        return { status: 'success', data: undefined };
    }
}));

vi.mock('../../services/runtime', () => ({
    isBrowserMockMode: () => mocks.browserMockMode
}));

vi.mock('../../services/browserMockData', () => ({
    searchBrowserMockImages: mocks.searchBrowserMockImages
}));

vi.mock('../../utils/sqlHelpers', () => ({
    buildSqlWhereClause: mocks.buildSqlWhereClause
}));

vi.mock('../../services/db/searchRepo', () => ({
    searchImages: mocks.searchImages,
    countImages: mocks.countImages,
    countGlobalImages: mocks.countGlobalImages
}));

const settings: AppSettings = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 200,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    maskedKeywords: ['secret'],
    maskingMode: 'blur',
    enableAI: false
};

const image = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'image-1',
    path: 'C:/images/image.png',
    filename: 'image.png',
    timestamp: 100,
    fileSize: 50,
    isPinned: false,
    ...overrides
} as AIImage);

const renderImagesHook = (
    sortOption: SortOption = 'date_desc',
    collections: Collection[] = [],
    settingsLoaded = true
) => renderHook(() => useImagesQuery({
    filters: createDefaultFilters({ collectionId: collections[0]?.id ?? null }),
    sortOption,
    settings,
    privacyEnabled: true,
    allCollections: collections,
    settingsLoaded
}));

const config = (): InfiniteQueryConfig => mocks.config as InfiniteQueryConfig;

describe('useImagesQuery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.browserMockMode = false;
        mocks.buildSqlWhereClause.mockReturnValue({
            where: 'WHERE hidden = ?',
            params: [0],
            collectionId: 'collection-1',
            loraName: 'detail'
        });
        mocks.searchImages.mockResolvedValue([]);
        mocks.countImages.mockResolvedValue(7);
        mocks.countGlobalImages.mockResolvedValue(20);
        mocks.searchBrowserMockImages.mockReturnValue({ images: [], totalCount: 0, globalCount: 0 });
    });

    it('builds a smart-collection-aware query key and honors the settings gate', () => {
        const filters = createDefaultFilters({ searchQuery: 'portrait' });
        const collections = [{
            id: 'smart',
            name: 'Smart',
            imageIds: [],
            createdAt: 1,
            filters
        } satisfies Collection];

        const { result } = renderImagesHook('date_desc', collections, false);

        expect(result.current.queryKey).toEqual([
            'images',
            expect.objectContaining({ collectionId: 'smart' }),
            'date_desc',
            true,
            'blur',
            ['secret'],
            JSON.stringify(filters)
        ]);
        expect(config().enabled).toBe(false);
    });

    it('uses a null smart-filter fingerprint for regular and missing collections', () => {
        renderImagesHook('date_desc', [{ id: 'regular', name: 'Regular', imageIds: [], createdAt: 1 }]);
        expect(config().queryKey.at(-1)).toBeNull();

        renderImagesHook();
        expect(config().queryKey.at(-1)).toBeNull();
        expect(config().enabled).toBe(true);
    });

    it('enables fetching when settingsLoaded is omitted', () => {
        renderHook(() => useImagesQuery({
            filters: createDefaultFilters(),
            sortOption: 'date_desc',
            settings,
            privacyEnabled: false,
            allCollections: []
        }));

        expect(config().enabled).toBe(true);
    });

    it('delegates browser pages using the optional cursor id', async () => {
        mocks.browserMockMode = true;
        const browserPage = { images: [image()], totalCount: 1, globalCount: 1 };
        mocks.searchBrowserMockImages.mockReturnValue(browserPage);
        renderImagesHook('name_asc');

        await expect(config().queryFn({ pageParam: undefined })).resolves.toBe(browserPage);
        await expect(config().queryFn({ pageParam: { val: 'image.png', id: 'cursor', isPinned: 0 } })).resolves.toBe(browserPage);
        expect(mocks.searchBrowserMockImages).toHaveBeenNthCalledWith(1, expect.any(Object), 'name_asc', 1000, undefined);
        expect(mocks.searchBrowserMockImages).toHaveBeenNthCalledWith(2, expect.any(Object), 'name_asc', 1000, 'cursor');
        expect(mocks.buildSqlWhereClause).not.toHaveBeenCalled();
    });

    it.each([
        ['date_asc', 'timestamp', 'ASC'],
        ['name_asc', 'path', 'ASC'],
        ['name_desc', 'path', 'DESC'],
        ['size_desc', 'file_size', 'DESC'],
        ['size_asc', 'file_size', 'ASC'],
        ['date_desc', 'timestamp', 'DESC']
    ] as const)('maps %s to the expected database ordering', async (sortOption, field, order) => {
        const firstPageImages = [image()];
        mocks.searchImages.mockResolvedValue(firstPageImages);
        renderImagesHook(sortOption);

        await expect(config().queryFn({ pageParam: undefined })).resolves.toEqual({
            images: firstPageImages,
            totalCount: 7,
            globalCount: 20
        });
        expect(mocks.buildSqlWhereClause).toHaveBeenCalledWith(
            expect.any(Object), true, 'blur', ['secret'], []
        );
        expect(mocks.searchImages).toHaveBeenCalledWith(
            'WHERE hidden = ?', [0], 1000, field, order, false, 'collection-1', 'detail', undefined
        );
        expect(mocks.countImages).toHaveBeenCalledWith('WHERE hidden = ?', [0], 'collection-1', 'detail');
        expect(mocks.countGlobalImages).toHaveBeenCalled();
    });

    it('loads cursor pages without rerunning counts and prioritizes collection pins', async () => {
        const collection: Collection = { id: 'collection-1', name: 'Pinned', imageIds: [], createdAt: 1 };
        const cursor = { val: 100, id: 'cursor', isPinned: 1 } satisfies PaginationCursor;
        const nextImages = [image({ id: 'next' })];
        mocks.searchImages.mockResolvedValue(nextImages);
        renderImagesHook('date_desc', [collection]);

        await expect(config().queryFn({ pageParam: cursor })).resolves.toEqual({
            images: nextImages,
            totalCount: -1,
            globalCount: -1
        });
        expect(mocks.searchImages).toHaveBeenCalledWith(
            'WHERE hidden = ?', [0], 1000, 'timestamp', 'DESC', true, 'collection-1', 'detail', cursor
        );
        expect(mocks.countImages).not.toHaveBeenCalled();
        expect(mocks.countGlobalImages).not.toHaveBeenCalled();
    });

    it('creates sort-aware next-page cursors only for full pages', () => {
        renderImagesHook('date_desc');
        expect(config().getNextPageParam({ images: [image()], totalCount: 1, globalCount: 1 })).toBeUndefined();

        const page = (lastImage: AIImage): QueryPage => ({
            images: [...Array.from({ length: 999 }, (_, index) => image({ id: `filler-${index}` })), lastImage],
            totalCount: 2000,
            globalCount: 2000
        });

        renderImagesHook('name_desc');
        expect(config().getNextPageParam(page(image({ id: 'name', filename: 'z.png', isPinned: true })))).toEqual({
            val: 'z.png', id: 'name', isPinned: 1
        });

        renderImagesHook('size_asc');
        expect(config().getNextPageParam(page(image({ id: 'size', fileSize: undefined })))).toEqual({
            val: 0, id: 'size', isPinned: 0
        });

        renderImagesHook('date_asc');
        expect(config().getNextPageParam(page(image({ id: 'date', timestamp: 321 })))).toEqual({
            val: 321, id: 'date', isPinned: 0
        });
    });

    it('retains privacy-compatible placeholder data even when the previous result is empty', () => {
        renderImagesHook();
        const populated = { pages: [{ images: [image()], totalCount: 1, globalCount: 1 }] };
        const empty = { pages: [{ images: [], totalCount: 0, globalCount: 20 }] };
        const previousSearchKey: ImagesQueryKey = [
            'images',
            createDefaultFilters({ searchQuery: 'previous' }),
            'date_desc',
            true,
            'blur',
            ['secret'],
            null
        ];
        const previousQuery = { queryKey: previousSearchKey };

        expect(config().placeholderData(populated, previousQuery)).toBe(populated);
        expect(config().placeholderData(empty, previousQuery)).toBe(empty);
        expect(config().placeholderData()).toBeUndefined();
    });

    it('rejects placeholder data when the privacy query scope changed or cannot be verified', () => {
        renderImagesHook();
        const previousData = { pages: [{ images: [image()], totalCount: 1, globalCount: 20 }] };
        const key = config().queryKey;

        expect(config().placeholderData(previousData, {
            queryKey: [...key.slice(0, 3), false, ...key.slice(4)]
        })).toBeUndefined();
        expect(config().placeholderData(previousData, {
            queryKey: [...key.slice(0, 4), 'hide', ...key.slice(5)]
        })).toBeUndefined();
        expect(config().placeholderData(previousData, {
            queryKey: [...key.slice(0, 5), ['different'], ...key.slice(6)]
        })).toBeUndefined();
        expect(config().placeholderData(previousData)).toBeUndefined();
    });
});
