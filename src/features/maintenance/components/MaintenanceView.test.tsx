import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '../../../test/testUtils';
import { type AIImage, GeneratorTool } from '../../../types';
import { useLibraryStore } from '../../../stores/libraryStore';
import { MaintenanceView } from './MaintenanceView';

const maintenanceDataMock = vi.hoisted(() => ({
    refreshData: vi.fn().mockResolvedValue(undefined),
    setLocalMissingImages: vi.fn(),
    localMissingImages: [] as AIImage[]
}));

const imageRepoMock = vi.hoisted(() => ({
    getImagesByIds: vi.fn().mockResolvedValue([])
}));

const createImage = (overrides: Partial<AIImage> = {}): AIImage => ({
    id: 'image-1',
    url: 'file:///image-1.png',
    thumbnailUrl: 'file:///thumb-1.png',
    filename: 'image-1.png',
    timestamp: 1,
    width: 512,
    height: 512,
    isFavorite: false,
    metadata: {
        tool: GeneratorTool.UNKNOWN,
        model: '',
        seed: 0,
        steps: 0,
        cfg: 0,
        sampler: '',
        positivePrompt: '',
        negativePrompt: ''
    },
    ...overrides
});

vi.mock('../../../hooks/useMaintenanceData', () => ({
    useMaintenanceData: () => ({
        isLoading: false,
        initializedTabs: new Set(['missing']),
        localDeletedImages: [],
        localUntaggedImages: [],
        localUnoptimizedImages: [],
        localDuplicateCandidates: [],
        localMissingImages: maintenanceDataMock.localMissingImages,
        localIntermediateImages: [],
        unoptimizedTotalCount: 0,
        refreshData: maintenanceDataMock.refreshData,
        setLocalMissingImages: maintenanceDataMock.setLocalMissingImages
    })
}));

vi.mock('../../../contexts/LibraryContext', () => ({
    useLibraryContext: () => ({
        activeSqlWhere: '',
        activeSqlParams: []
    })
}));

vi.mock('./MaintenanceTabs', () => ({
    MaintenanceTabs: () => <div data-testid="maintenance-tabs" />
}));

vi.mock('./LibraryHealth', () => ({
    LibraryHealth: () => <div data-testid="library-health" />
}));

vi.mock('./MissingTab', () => ({
    MissingTab: ({ images, onViewImage }: { images: AIImage[]; onViewImage: (id: string) => void }) => (
        <div>
            <div data-testid="missing-count">{images.length}</div>
            {images[0] && <button onClick={() => onViewImage(images[0].id)}>Open Missing Viewer</button>}
        </div>
    )
}));

vi.mock('../../../features/viewer/components/ImageViewer', () => ({
    ImageViewer: ({ onDelete }: { onDelete?: () => void }) => (
        <div data-testid="maintenance-viewer">
            {onDelete && <button onClick={onDelete}>Viewer Cleanup</button>}
        </div>
    )
}));

vi.mock('../../../features/viewer/components/CompareModal', () => ({
    CompareModal: () => null
}));

vi.mock('../../../services/db/imageRepo', () => ({
    getImagesByIds: imageRepoMock.getImagesByIds
}));

describe('MaintenanceView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        maintenanceDataMock.localMissingImages = [];
        imageRepoMock.getImagesByIds.mockResolvedValue([]);
        useLibraryStore.setState(useLibraryStore.getInitialState(), true);
    });

    it('does not derive Missing tab results from gallery search images', () => {
        const galleryMissingImage = createImage({ id: 'gallery-missing', isMissing: true });

        render(
            <MaintenanceView
                images={[galleryMissingImage]}
                onResolveDuplicate={vi.fn()}
                onRestoreImages={vi.fn()}
                onRemoveFromLibrary={vi.fn()}
                onDeleteFile={vi.fn()}
                onEmptyTrash={vi.fn().mockResolvedValue(undefined)}
                onViewImage={vi.fn()}
                maskedKeywords={[]}
            />
        );

        expect(screen.getByTestId('missing-count').textContent).toBe('0');
    });

    it('uses remove-from-library cleanup from the Maintenance viewer', async () => {
        const missingImage = createImage({ id: 'missing-1', isMissing: true });
        maintenanceDataMock.localMissingImages = [missingImage];
        const onRemoveFromLibrary = vi.fn().mockResolvedValue(undefined);
        const onDeleteFile = vi.fn();

        render(
            <MaintenanceView
                images={[]}
                onResolveDuplicate={vi.fn()}
                onRestoreImages={vi.fn()}
                onRemoveFromLibrary={onRemoveFromLibrary}
                onDeleteFile={onDeleteFile}
                onEmptyTrash={vi.fn().mockResolvedValue(undefined)}
                onViewImage={vi.fn()}
                maskedKeywords={[]}
            />
        );

        fireEvent.click(screen.getByText('Open Missing Viewer'));
        fireEvent.click(screen.getByText('Viewer Cleanup'));

        await waitFor(() => {
            expect(onRemoveFromLibrary).toHaveBeenCalledWith(['missing-1']);
        });
        expect(onDeleteFile).not.toHaveBeenCalled();
    });

    it('fetches missing audit result images once from the store result', async () => {
        const fetchedImage = createImage({ id: 'missing-1', isMissing: true });
        imageRepoMock.getImagesByIds.mockResolvedValueOnce([fetchedImage]);

        render(
            <MaintenanceView
                images={[]}
                onResolveDuplicate={vi.fn()}
                onRestoreImages={vi.fn()}
                onRemoveFromLibrary={vi.fn()}
                onDeleteFile={vi.fn()}
                onEmptyTrash={vi.fn().mockResolvedValue(undefined)}
                onViewImage={vi.fn()}
                maskedKeywords={[]}
            />
        );

        act(() => {
            useLibraryStore.getState().setLastMissingScanResult({
                scanned: 10,
                total: 10,
                missingIds: ['missing-1'],
                sampleMissingPaths: ['missing-1.png'],
                wasCancelled: false
            });
        });

        await waitFor(() => {
            expect(imageRepoMock.getImagesByIds).toHaveBeenCalledWith(['missing-1']);
        });
        expect(imageRepoMock.getImagesByIds).toHaveBeenCalledTimes(1);
    });
});
