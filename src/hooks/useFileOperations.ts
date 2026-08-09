import { useRef } from 'react';
import { AIImage, AppSettings } from '../types';
import { useLibraryStore } from '../stores/libraryStore';
import { useImportOps } from './useImportOps';
import { useExportOps } from './useExportOps';
import { useThumbnailOps } from './useThumbnailOps';
import { useMaintenanceOps } from './useMaintenanceOps';
import type { ActiveImageStateAdapter } from './activeImageState';

interface UseFileOperationsProps {
    images: AIImage[];
    setImages: React.Dispatch<React.SetStateAction<AIImage[]>>;
    refreshCollections: () => Promise<void>;
    refreshCollectionThumbnails: () => Promise<void>;
    settings: AppSettings;
    activeImageState?: ActiveImageStateAdapter;
}

export const useFileOperations = ({
    images,
    setImages,
    refreshCollections,
    refreshCollectionThumbnails,
    settings,
    activeImageState
}: UseFileOperationsProps) => {
    const { isImporting, isRegeneratingThumbnails } = useLibraryStore();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const importOps = useImportOps({
        images,
        setImages,
        refreshCollections,
        settings
    });

    const exportOps = useExportOps({ images });

    const thumbnailOps = useThumbnailOps({
        images,
        setImages,
        refreshCollectionThumbnails
    });

    const maintenanceOps = useMaintenanceOps({
        images,
        setImages,
        refreshCollections,
        settings,
        activeImageState
    });

    return {
        // State
        isImporting,
        isExporting: exportOps.isExporting,
        isRecoveringMetadata: maintenanceOps.isRecoveringMetadata,
        isRegeneratingThumbnails,
        fileInputRef,

        // Import Actions
        importImages: importOps.importImages,
        handleImportPaths: importOps.handleImportPaths,
        handleImportFolders: importOps.handleImportFolders,
        handleImportFiles: importOps.handleWebFiles,
        scanDirectory: importOps.scanDirectory,
        resyncFolder: importOps.resyncFolder,

        // Other Actions
        exportImages: exportOps.exportImages,
        deleteImages: maintenanceOps.deleteImages,
        recoverMetadata: maintenanceOps.recoverMetadata,
        regenerateThumbnails: thumbnailOps.regenerateThumbnails,
    };
};
