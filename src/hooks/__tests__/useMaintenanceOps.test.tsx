import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneratorTool, type AIImage, type AppSettings } from '../../types';
import { useMaintenanceOps } from '../useMaintenanceOps';

const mockAddToast = vi.fn();
const mockImageToBase64 = vi.fn();
const mockRecoverImageMetadata = vi.fn();
const mockUpdateImageMetadataFields = vi.fn();
const mockIncrementFacetCacheVersion = vi.fn();
const mockGetSettingsState = vi.fn();
const imageRepoMocks = vi.hoisted(() => ({
    deleteImageFromDisk: vi.fn(),
    getImagesByIds: vi.fn(),
    rebuildFacetCache: vi.fn(),
    removeImagesFromLibrary: vi.fn(),
}));

vi.mock('../useToast', () => ({
    useToast: () => ({ addToast: mockAddToast }),
}));

vi.mock('../../services/imageService', () => ({
    imageToBase64: (...args: unknown[]) => mockImageToBase64(...args),
}));

vi.mock('../../services/geminiService', () => ({
    recoverImageMetadata: (...args: unknown[]) => mockRecoverImageMetadata(...args),
}));

vi.mock('../../services/db/imageRepo', () => ({
    deleteImageFromDisk: imageRepoMocks.deleteImageFromDisk,
    getImagesByIds: imageRepoMocks.getImagesByIds,
    rebuildFacetCache: imageRepoMocks.rebuildFacetCache,
    removeImagesFromLibrary: imageRepoMocks.removeImagesFromLibrary,
    updateImageMetadataFields: (...args: unknown[]) => mockUpdateImageMetadataFields(...args),
}));

vi.mock('../../stores/libraryStore', () => ({
    useLibraryStore: (selector: (state: { incrementFacetCacheVersion: () => void }) => unknown) => (
        selector({ incrementFacetCacheVersion: mockIncrementFacetCacheVersion })
    ),
}));

vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: {
        getState: () => mockGetSettingsState(),
    },
}));

const image: AIImage = {
    id: 'C:/library/image.jpg',
    url: 'https://asset.localhost/C%3A/library/image.jpg',
    thumbnailUrl: 'thumb',
    filename: 'image.jpg',
    timestamp: 1,
    width: 100,
    height: 100,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: 'Unknown',
        seed: 0,
        steps: 0,
        cfg: 0,
        sampler: 'Unknown',
        positivePrompt: '',
        negativePrompt: '',
    },
};

const settings: AppSettings = {
    hasCompletedOnboarding: true,
    theme: 'dark',
    thumbnailSize: 240,
    confirmDelete: true,
    defaultTheaterMode: false,
    monitoredFolders: [],
    promptMaskingEnabled: true,
    maskedKeywords: [],
    maskingMode: 'blur',
    enableAI: true,
};

describe('useMaintenanceOps metadata recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockImageToBase64.mockResolvedValue('data:image/jpeg;base64,abc');
        mockRecoverImageMetadata.mockResolvedValue({ positivePrompt: 'Recovered prompt' });
        mockUpdateImageMetadataFields.mockResolvedValue(undefined);
        mockGetSettingsState.mockReturnValue({ geminiApiKey: 'test-key' });
        imageRepoMocks.deleteImageFromDisk.mockResolvedValue(undefined);
        imageRepoMocks.getImagesByIds.mockResolvedValue([]);
        imageRepoMocks.rebuildFacetCache.mockResolvedValue(undefined);
        imageRepoMocks.removeImagesFromLibrary.mockResolvedValue(undefined);
    });

    it('reads the local path and persists the recovered prompt in store and query caches', async () => {
        const queryClient = new QueryClient();
        const queryKey = ['images', { scope: 'library' }] as const;
        queryClient.setQueryData(queryKey, {
            pages: [{ images: [image, { ...image, id: 'other' }], totalCount: 2, globalCount: 2 }],
            pageParams: [undefined],
        });
        const setImages = vi.fn();
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result } = renderHook(() => useMaintenanceOps({
            images: [image],
            setImages,
            refreshCollections: vi.fn(),
            settings,
        }), { wrapper });

        const onComplete = vi.fn();
        await act(async () => {
            await result.current.recoverMetadata(image.id, 'generic', onComplete);
        });

        expect(mockImageToBase64).toHaveBeenCalledWith(image.id);
        expect(mockUpdateImageMetadataFields).toHaveBeenCalledWith(image.id, {
            positivePrompt: 'Recovered prompt',
        });

        const storeUpdater = setImages.mock.calls[0][0] as (images: AIImage[]) => AIImage[];
        const updated = storeUpdater([image, { ...image, id: 'other' }]);
        const updatedImage = updated[0];
        expect(updatedImage.metadata.positivePrompt).toBe('Recovered prompt');
        expect(updatedImage.originalMetadata).toBeUndefined();
        expect(updated[1].id).toBe('other');

        const cached = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(queryKey);
        expect(cached?.pages[0].images[0].metadata.positivePrompt).toBe('Recovered prompt');
        expect(cached?.pages[0].images[0].originalMetadata).toBeUndefined();
        expect(mockAddToast).toHaveBeenCalledWith('Metadata recovered successfully!', 'success');
        expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('returns without entering recovery when the target image is absent', async () => {
        const queryClient = new QueryClient();
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result } = renderHook(() => useMaintenanceOps({
            images: [],
            setImages: vi.fn(),
            refreshCollections: vi.fn(),
            settings,
        }), { wrapper });

        await act(async () => result.current.recoverMetadata('missing', 'generic', vi.fn()));

        expect(result.current.isRecoveringMetadata).toBe(false);
        expect(mockImageToBase64).not.toHaveBeenCalled();
    });

    it('reports missing API credentials and releases recovery state', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockGetSettingsState.mockReturnValue({ geminiApiKey: '' });
        const queryClient = new QueryClient();
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result } = renderHook(() => useMaintenanceOps({
            images: [image],
            setImages: vi.fn(),
            refreshCollections: vi.fn(),
            settings,
        }), { wrapper });

        await act(async () => result.current.recoverMetadata(image.id, 'generic', vi.fn()));

        expect(mockRecoverImageMetadata).not.toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith('AI Analysis Failed', 'error');
        expect(result.current.isRecoveringMetadata).toBe(false);
        error.mockRestore();
    });

    it('persists an empty prompt when recovery omits positivePrompt', async () => {
        mockRecoverImageMetadata.mockResolvedValue({});
        const queryClient = new QueryClient();
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result } = renderHook(() => useMaintenanceOps({
            images: [image],
            setImages: vi.fn(),
            refreshCollections: vi.fn(),
            settings,
        }), { wrapper });

        await act(async () => result.current.recoverMetadata(image.id, 'generic', vi.fn()));

        expect(mockUpdateImageMetadataFields).toHaveBeenCalledWith(image.id, { positivePrompt: '' });
    });

    it('reports recovery service failures without calling completion', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        mockRecoverImageMetadata.mockRejectedValue(new Error('provider unavailable'));
        const onComplete = vi.fn();
        const queryClient = new QueryClient();
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result } = renderHook(() => useMaintenanceOps({
            images: [image],
            setImages: vi.fn(),
            refreshCollections: vi.fn(),
            settings,
        }), { wrapper });

        await act(async () => result.current.recoverMetadata(image.id, 'generic', onComplete));

        expect(mockAddToast).toHaveBeenCalledWith('AI Analysis Failed', 'error');
        expect(onComplete).not.toHaveBeenCalled();
        expect(result.current.isRecoveringMetadata).toBe(false);
        error.mockRestore();
    });

    it('tombstones one image by default and reports downstream refresh failures', async () => {
        const refreshCollections = vi.fn().mockRejectedValue(new Error('refresh failed'));
        imageRepoMocks.rebuildFacetCache.mockRejectedValueOnce(new Error('facet failed'));
        const { result } = renderHook(() => useMaintenanceOps({
            images: [image],
            setImages: vi.fn(),
            refreshCollections,
            settings,
        }), { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });

        await act(async () => result.current.deleteImages([image.id]));

        expect(imageRepoMocks.removeImagesFromLibrary).toHaveBeenCalledWith([image.id]);
        expect(mockAddToast).toHaveBeenCalledWith('Removed 1 image from the library', 'success');
        expect(mockAddToast).toHaveBeenCalledWith('Removed from library, but collections may need a refresh.', 'warning');
        expect(mockAddToast).toHaveBeenCalledWith('Library update succeeded, but filters may take a moment to refresh.', 'info');
        expect(mockIncrementFacetCacheVersion).not.toHaveBeenCalled();
    });

    it('permanently deletes multiple files and increments the facet version after rebuild', async () => {
        const withoutThumbnail = { ...image, id: 'C:/library/no-thumb.jpg', thumbnailUrl: '' };
        imageRepoMocks.getImagesByIds.mockResolvedValueOnce([image, withoutThumbnail]);
        const refreshCollections = vi.fn();
        const { result } = renderHook(() => useMaintenanceOps({
            images: [image, withoutThumbnail],
            setImages: vi.fn(),
            refreshCollections,
            settings,
        }), { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });

        await act(async () => result.current.deleteImages([image.id, withoutThumbnail.id], true));

        expect(imageRepoMocks.deleteImageFromDisk).toHaveBeenCalledTimes(2);
        expect(mockAddToast).toHaveBeenCalledWith('Moved 2 files to OS trash', 'success');
        expect(refreshCollections).not.toHaveBeenCalled();
        expect(mockIncrementFacetCacheVersion).toHaveBeenCalledOnce();
    });

    it('reports a failed library mutation', async () => {
        imageRepoMocks.removeImagesFromLibrary.mockRejectedValueOnce(new Error('write failed'));
        const { result } = renderHook(() => useMaintenanceOps({
            images: [image],
            setImages: vi.fn(),
            refreshCollections: vi.fn(),
            settings,
        }), { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });

        await act(async () => result.current.deleteImages([image.id]));

        expect(mockAddToast).toHaveBeenCalledWith('Failed to update library state', 'error');
    });

    it('uses singular permanent and plural library-removal copy', async () => {
        imageRepoMocks.getImagesByIds.mockResolvedValueOnce([image]);
        const other = { ...image, id: 'other' };
        const { result } = renderHook(() => useMaintenanceOps({
            images: [image, other],
            setImages: vi.fn(),
            refreshCollections: vi.fn().mockResolvedValue(undefined),
            settings,
        }), { wrapper: ({ children }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider> });

        await act(async () => result.current.deleteImages([image.id], true));
        await act(async () => result.current.deleteImages([image.id, other.id]));

        expect(mockAddToast).toHaveBeenCalledWith('Moved 1 file to OS trash', 'success');
        expect(mockAddToast).toHaveBeenCalledWith('Removed 2 images from the library', 'success');
    });
});
