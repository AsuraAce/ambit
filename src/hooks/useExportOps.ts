import { useState, useCallback } from 'react';
import { AIImage } from '../types';
import { useToast } from './useToast';
import { exportImagesToZip } from '../services/exportService';

interface UseExportOpsProps {
    images: AIImage[];
}

export const useExportOps = ({ images }: UseExportOpsProps) => {
    const { addToast } = useToast();
    const [isExporting, setIsExporting] = useState(false);

    const exportImages = useCallback(async (filename: string, ids: Set<string> | string[], destinationFolder: string, onComplete?: () => void) => {
        const idArray = Array.from(ids);
        if (idArray.length === 0 || !destinationFolder) return;

        setIsExporting(true);
        try {
            let targetImages = images.filter(img => idArray.includes(img.id));

            if (targetImages.length < idArray.length) {
                const { getImagesByIds } = await import('../services/db/imageRepo');
                targetImages = await getImagesByIds(idArray);
            }

            if (targetImages.length === 0) {
                addToast("No valid images found to export", "error");
                return;
            }

            await exportImagesToZip(targetImages, destinationFolder, filename);
            addToast(`Export complete`, 'success');
            if (onComplete) onComplete();
        } catch (error) {
            console.error("Export error", error);
            addToast("Export failed", "error");
        } finally {
            setIsExporting(false);
        }
    }, [images, addToast]);

    return {
        isExporting,
        exportImages
    };
};
