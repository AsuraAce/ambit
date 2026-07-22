
import { renderHook, act } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFileOperations } from '../useFileOperations';

// --- Mocks ---

// Mock Tauri Plugins
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    remove: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn(),
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    BaseDirectory: {
        AppLocalData: 0,
        Resource: 1,
    }
}));

// Shared Mock Functions
const mockAddToast = vi.fn();
const mocksetIsRegeneratingThumbnails = vi.fn();
const mocksetThumbnailProgress = vi.fn();

// Mock Contexts and Hooks
vi.mock('../../contexts/SearchContext', () => ({
    useSearch: () => ({
        isImporting: false,
        setIsImporting: vi.fn(),
        setImportProgress: vi.fn(),
        isRegeneratingThumbnails: false,
        setIsRegeneratingThumbnails: mocksetIsRegeneratingThumbnails,
        thumbnailProgress: null,
        setThumbnailProgress: mocksetThumbnailProgress,
    }),
}));

vi.mock('../useToast', () => ({
    useToast: () => ({
        addToast: mockAddToast,
    }),
}));

// Mock Services
vi.mock('../../services/exportService', () => ({
    exportImagesToZip: vi.fn(),
}));

vi.mock('../../services/importService', () => ({
    processWebFiles: vi.fn(),
    processNativePaths: vi.fn(),
}));

vi.mock('../../services/thumbnailService', () => ({
    regenerateThumbnailsForImages: vi.fn(),
    getThumbnailDir: vi.fn().mockResolvedValue('C:/mock/thumbs'),
}));

// Mock Repositories
vi.mock('../../services/db/imageRepo', () => ({
    removeImagesFromLibrary: vi.fn(),
    deleteImageFromDisk: vi.fn(),
    updateFavorite: vi.fn(),
    updatePinned: vi.fn(),
    getImagesByIds: vi.fn().mockResolvedValue([]),
    rebuildFacetCache: vi.fn().mockResolvedValue(0),
}));

describe('useFileOperations', () => {
    const mockSetImages = vi.fn();
    const mockRefreshCollections = vi.fn();
    const mockRefreshCollectionThumbnails = vi.fn();

    const mockSettings = {
        hasCompletedOnboarding: true,
        theme: 'dark' as const,
        thumbnailSize: 200,
        confirmDelete: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
        promptMaskingEnabled: true,
        maskedKeywords: [],
        maskingMode: 'blur' as const,
        enableAI: false,
    };

    const mockImages = [
        { id: '1', url: 'url1', thumbnailUrl: 'thumb1', isFavorite: false, filename: 'f1.png', timestamp: 123, width: 100, height: 100, metadata: {} as any },
        { id: '2', url: 'url2', thumbnailUrl: 'thumb2', isFavorite: true, filename: 'f2.png', timestamp: 124, width: 100, height: 100, metadata: {} as any },
        { id: '3', url: 'url3', thumbnailUrl: 'url3', isFavorite: false, filename: 'unoptimized.png', timestamp: 125, width: 100, height: 100, metadata: {} as any },
    ];

    beforeEach(() => {
        vi.clearAllMocks();
        mockRefreshCollections.mockResolvedValue(undefined);
        mockRefreshCollectionThumbnails.mockResolvedValue(undefined);
    });

    const renderFileOperations = (images = mockImages) => renderHook(() => useFileOperations({
        images,
        setImages: mockSetImages,
        refreshCollections: mockRefreshCollections,
        refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
        settings: mockSettings,
    }));

    it('should initialize correctly', () => {
        const { result } = renderFileOperations();

        expect(result.current.isExporting).toBe(false);
        expect(result.current.isRecoveringMetadata).toBe(false);
    });

    describe('deleteImages', () => {
        it('should perform soft delete and update local state', async () => {
            const { removeImagesFromLibrary } = await import('../../services/db/imageRepo');
            const { result } = renderFileOperations();

            await act(async () => {
                await result.current.deleteImages(['1'], false);
            });

            expect(removeImagesFromLibrary).toHaveBeenCalledWith(['1']);
            expect(mockSetImages).toHaveBeenCalled();
            const updateImages = mockSetImages.mock.calls[0][0] as (images: typeof mockImages) => typeof mockImages;
            expect(updateImages(mockImages).map(image => image.id)).toEqual(['2', '3']);
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Removed 1 image from the library'), 'success');
            expect(mockRefreshCollections).toHaveBeenCalledTimes(1);
            expect(mockRefreshCollectionThumbnails).not.toHaveBeenCalled();
        });

        it('should keep delete success even if collection refresh fails', async () => {
            const { removeImagesFromLibrary } = await import('../../services/db/imageRepo');
            mockRefreshCollections.mockRejectedValueOnce(new Error('collection refresh failed'));
            const { result } = renderFileOperations();

            await act(async () => {
                await result.current.deleteImages(['1'], false);
            });

            expect(removeImagesFromLibrary).toHaveBeenCalledWith(['1']);
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Removed 1 image from the library'), 'success');
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('collections may need a refresh'), 'warning');
            expect(mockAddToast).not.toHaveBeenCalledWith('Failed to update library state', 'error');
            expect(mockRefreshCollections).toHaveBeenCalledTimes(1);
            expect(mockRefreshCollectionThumbnails).not.toHaveBeenCalled();
        });

        it('should perform permanent delete and remove from local state', async () => {
            const { deleteImageFromDisk, getImagesByIds } = await import('../../services/db/imageRepo');
            (getImagesByIds as any).mockResolvedValue([mockImages[1]]);
            const { result } = renderFileOperations();

            await act(async () => {
                await result.current.deleteImages(['2'], true);
            });

            expect(deleteImageFromDisk).toHaveBeenCalledWith('2', '2', 'thumb2');
            expect(mockSetImages).toHaveBeenCalled();
            const updateImages = mockSetImages.mock.calls[0][0] as (images: typeof mockImages) => typeof mockImages;
            expect(updateImages(mockImages).map(image => image.id)).toEqual(['1', '3']);
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Moved 1 file to OS trash'), 'success');
        });

        it('keeps the delete successful when facet cache rebuilding fails', async () => {
            const { rebuildFacetCache } = await import('../../services/db/imageRepo');
            vi.mocked(rebuildFacetCache).mockRejectedValueOnce(new Error('cache failed'));
            const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const { result } = renderFileOperations();

            await act(async () => result.current.deleteImages(['1'], false));

            expect(mockAddToast).toHaveBeenCalledWith(
                'Library update succeeded, but filters may take a moment to refresh.',
                'info'
            );
            expect(error).toHaveBeenCalledWith(
                '[MaintenanceOps] removeFromLibrary: facet rebuild failed',
                expect.any(Error)
            );
            error.mockRestore();
        });

        it('reports primary delete mutation failures without changing local images', async () => {
            const { removeImagesFromLibrary } = await import('../../services/db/imageRepo');
            vi.mocked(removeImagesFromLibrary).mockRejectedValueOnce(new Error('delete failed'));
            const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const { result } = renderFileOperations();

            await act(async () => result.current.deleteImages(['1'], false));

            expect(mockSetImages).not.toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith('Failed to update library state', 'error');
            expect(error).toHaveBeenCalledWith(
                '[MaintenanceOps] removeFromLibrary: mutation failed',
                expect.any(Error)
            );
            error.mockRestore();
        });
    });

    describe('exportImages', () => {
        it('should call export service with correct parameters', async () => {
            const { exportImagesToZip } = await import('../../services/exportService');
            const { result } = renderFileOperations();

            await act(async () => {
                await result.current.exportImages('test.zip', ['1'], 'C:/dest');
            });

            expect(exportImagesToZip).toHaveBeenCalledWith([mockImages[0]], 'C:/dest', 'test.zip');
            expect(mockAddToast).toHaveBeenCalledWith('Export complete', 'success');
        });

        it('should bail if no images match the IDs', async () => {
            const { getImagesByIds } = await import('../../services/db/imageRepo');
            (getImagesByIds as any).mockResolvedValue([]);
            const { result } = renderFileOperations();

            await act(async () => {
                await result.current.exportImages('test.zip', ['non-existent'], 'C:/dest');
            });

            expect(mockAddToast).toHaveBeenCalledWith('No valid images found to export', 'error');
        });
    });

    describe('importImages', () => {
        it('should process web files and update state', async () => {
            const { processWebFiles } = await import('../../services/importService');
            const mockFiles = [new File([''], 'test.png', { type: 'image/png' })];
            const mockImportResult = {
                images: [{ id: 'new-1', filename: 'test.png', url: 'new1', thumbnailUrl: 'nt1', timestamp: 456, width: 200, height: 200, isFavorite: false, metadata: {} as any }],
                stats: { skipped: 0, errors: 0 }
            };
            (processWebFiles as any).mockResolvedValue(mockImportResult);

            const { result } = renderFileOperations();

            await act(async () => {
                const event = { target: { files: mockFiles } } as any;
                await result.current.importImages(event);
            });

            expect(processWebFiles).toHaveBeenCalled();
            expect(mockSetImages).toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Imported 1 images'), 'success');
            expect(mockRefreshCollections).toHaveBeenCalledTimes(1);
            expect(mockRefreshCollectionThumbnails).not.toHaveBeenCalled();
        });
    });

    describe('regenerateThumbnails', () => {
        it('should identify unoptimized images and run regeneration', async () => {
            const { regenerateThumbnailsForImages } = await import('../../services/thumbnailService');
            const mockUpdates = [{ ...mockImages[2], thumbnailUrl: 'new-thumb-3' }];
            (regenerateThumbnailsForImages as any).mockResolvedValue(mockUpdates);

            const { result } = renderFileOperations();

            await act(async () => {
                await result.current.regenerateThumbnails();
            });

            expect(regenerateThumbnailsForImages).toHaveBeenCalledWith([mockImages[2]], expect.any(Function), expect.anything());

            expect(mockSetImages).toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Successfully optimized 1 of 1 thumbnails'), 'success');
            expect(mockRefreshCollectionThumbnails).toHaveBeenCalledTimes(1);
            expect(mockRefreshCollections).not.toHaveBeenCalled();
        });

        it('should show success message if no candidates found', async () => {
            const optimizedImages = [mockImages[0], mockImages[1]];
            const { result } = renderFileOperations(optimizedImages);

            await act(async () => {
                await result.current.regenerateThumbnails();
            });

            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('No unoptimized images found'), 'success');
        });
    });
});
