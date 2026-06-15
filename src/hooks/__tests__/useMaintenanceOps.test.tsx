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
    deleteImageFromDisk: vi.fn(),
    getImagesByIds: vi.fn(),
    rebuildFacetCache: vi.fn(),
    removeImagesFromLibrary: vi.fn(),
    updateImageMetadataFields: (...args: unknown[]) => mockUpdateImageMetadataFields(...args),
}));

vi.mock('../../stores/libraryStore', () => ({
    useLibraryStore: (selector: (state: { incrementFacetCacheVersion: () => void }) => unknown) => (
        selector({ incrementFacetCacheVersion: mockIncrementFacetCacheVersion })
    ),
}));

vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: {
        getState: () => ({ geminiApiKey: 'test-key' }),
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
    });

    it('reads the local path and persists the recovered prompt in store and query caches', async () => {
        const queryClient = new QueryClient();
        const queryKey = ['images', { scope: 'library' }] as const;
        queryClient.setQueryData(queryKey, {
            pages: [{ images: [image], totalCount: 1, globalCount: 1 }],
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

        await act(async () => {
            await result.current.recoverMetadata(image.id, 'generic', vi.fn());
        });

        expect(mockImageToBase64).toHaveBeenCalledWith(image.id);
        expect(mockUpdateImageMetadataFields).toHaveBeenCalledWith(image.id, {
            positivePrompt: 'Recovered prompt',
        });

        const storeUpdater = setImages.mock.calls[0][0] as (images: AIImage[]) => AIImage[];
        expect(storeUpdater([image])[0].metadata.positivePrompt).toBe('Recovered prompt');

        const cached = queryClient.getQueryData<{
            pages: Array<{ images: AIImage[] }>;
        }>(queryKey);
        expect(cached?.pages[0].images[0].metadata.positivePrompt).toBe('Recovered prompt');
        expect(mockAddToast).toHaveBeenCalledWith('Metadata recovered successfully!', 'success');
    });
});
