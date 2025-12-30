
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFileOperations } from '../useFileOperations';

// --- Mocks ---

// Mock Tauri Plugins
vi.mock('@tauri-apps/plugin-dialog', () => ({
    open: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
    remove: vi.fn(),
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
    markAsDeleted: vi.fn(),
    deleteImage: vi.fn(),
    updateFavorite: vi.fn(),
    updatePinned: vi.fn(),
    getImagesByIds: vi.fn().mockResolvedValue([]),
}));

describe('useFileOperations', () => {
    const mockSetImages = vi.fn();
    const mockRefreshCollectionThumbnails = vi.fn();

    const mockSettings = {
        hasCompletedOnboarding: true,
        theme: 'dark' as const,
        thumbnailSize: 200,
        confirmDelete: true,
        defaultTheaterMode: false,
        monitoredFolders: [],
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
    });

    it('should initialize correctly', () => {
        const { result } = renderHook(() => useFileOperations({
            images: mockImages,
            setImages: mockSetImages,
            refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
            settings: mockSettings,
        }));

        expect(result.current.isExporting).toBe(false);
        expect(result.current.isRecoveringMetadata).toBe(false);
    });

    describe('deleteImages', () => {
        it('should perform soft delete and update local state', async () => {
            const { markAsDeleted } = await import('../../services/db/imageRepo');
            const { result } = renderHook(() => useFileOperations({
                images: mockImages,
                setImages: mockSetImages,
                refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
                settings: mockSettings,
            }));

            await act(async () => {
                await result.current.deleteImages(['1'], false);
            });

            expect(markAsDeleted).toHaveBeenCalledWith(['1'], true);
            expect(mockSetImages).toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Moved 1 images to Trash'), 'success');
        });

        it('should perform permanent delete and remove from local state', async () => {
            const { deleteImage } = await import('../../services/db/imageRepo');
            const { result } = renderHook(() => useFileOperations({
                images: mockImages,
                setImages: mockSetImages,
                refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
                settings: mockSettings,
            }));

            await act(async () => {
                await result.current.deleteImages(['2'], true);
            });

            expect(deleteImage).toHaveBeenCalledWith('2');
            expect(mockSetImages).toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Permanently deleted 1 images'), 'success');
        });
    });

    describe('exportImages', () => {
        it('should call export service with correct parameters', async () => {
            const { exportImagesToZip } = await import('../../services/exportService');
            const { result } = renderHook(() => useFileOperations({
                images: mockImages,
                setImages: mockSetImages,
                refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
                settings: mockSettings,
            }));

            await act(async () => {
                await result.current.exportImages('test.zip', ['1'], 'C:/dest');
            });

            expect(exportImagesToZip).toHaveBeenCalledWith([mockImages[0]], 'C:/dest', 'test.zip');
            expect(mockAddToast).toHaveBeenCalledWith('Export complete', 'success');
        });

        it('should bail if no images match the IDs', async () => {
            const { result } = renderHook(() => useFileOperations({
                images: mockImages,
                setImages: mockSetImages,
                refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
                settings: mockSettings,
            }));

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

            const { result } = renderHook(() => useFileOperations({
                images: mockImages,
                setImages: mockSetImages,
                refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
                settings: mockSettings,
            }));

            await act(async () => {
                const event = { target: { files: mockFiles } } as any;
                await result.current.importImages(event);
            });

            expect(processWebFiles).toHaveBeenCalled();
            expect(mockSetImages).toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Imported 1 images'), 'success');
        });
    });

    describe('regenerateThumbnails', () => {
        it('should identify unoptimized images and run regeneration', async () => {
            const { regenerateThumbnailsForImages } = await import('../../services/thumbnailService');
            const mockUpdates = [{ ...mockImages[2], thumbnailUrl: 'new-thumb-3' }];
            (regenerateThumbnailsForImages as any).mockResolvedValue(mockUpdates);

            const { result } = renderHook(() => useFileOperations({
                images: mockImages,
                setImages: mockSetImages,
                refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
                settings: mockSettings,
            }));

            await act(async () => {
                await result.current.regenerateThumbnails();
            });

            expect(regenerateThumbnailsForImages).toHaveBeenCalledWith([mockImages[2]], expect.any(Function));
            expect(mocksetIsRegeneratingThumbnails).toHaveBeenCalledWith(true);
            expect(mockSetImages).toHaveBeenCalled();
            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('Successfully optimized 1 of 1 thumbnails'), 'success');
        });

        it('should show success message if no candidates found', async () => {
            const optimizedImages = [mockImages[0], mockImages[1]];
            const { result } = renderHook(() => useFileOperations({
                images: optimizedImages,
                setImages: mockSetImages,
                refreshCollectionThumbnails: mockRefreshCollectionThumbnails,
                settings: mockSettings,
            }));

            await act(async () => {
                await result.current.regenerateThumbnails();
            });

            expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('No unoptimized images found'), 'success');
        });
    });
});
