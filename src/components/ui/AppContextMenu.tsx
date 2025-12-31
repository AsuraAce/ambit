import * as React from 'react';
import { ContextMenu } from './ContextMenu';
import { useLibraryContext } from '../../hooks/useLibraryContext';
import { useToast } from '../../hooks/useToast';
import { isImageMasked } from '../../utils/maskingUtils';
import { AIImage, ContextMenuState } from '../../types';

interface AppContextMenuProps {
    contextMenu: ContextMenuState | null;
    onClose: () => void;
    images: AIImage[];
    actions: any;
    fileOps: any;
    colOps: any;
    onMoveToCollection: () => void;
    modals: any;
    filters: any;
    privacyEnabled: boolean;
    refreshCollectionThumbnails: () => void;
    setCollections: React.Dispatch<React.SetStateAction<any[]>>;
}

export const AppContextMenu: React.FC<AppContextMenuProps> = ({
    contextMenu,
    onClose,
    images,
    actions,
    fileOps,
    colOps,
    onMoveToCollection,
    modals,
    filters,
    privacyEnabled,
    refreshCollectionThumbnails,
    setCollections
}) => {
    const { addToast } = useToast();
    const { collections, smartCollections, settings, toggleFavorite: libraryToggleFavorite } = useLibraryContext();

    if (!contextMenu) return null;

    const activeImage = images.find(i => i.id === contextMenu.imageId);
    const activeCollection = filters.collectionId
        ? (collections.find((c: any) => c.id === filters.collectionId) || smartCollections.find((c: any) => c.id === filters.collectionId))
        : undefined;

    return (
        <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            isPinned={activeImage?.isPinned}
            isFavorite={activeImage?.isFavorite}
            isMasked={activeImage ? isImageMasked(activeImage, privacyEnabled, settings.maskedKeywords) : false}
            userMasked={activeImage?.userMasked}
            isIntermediate={activeImage?.metadata?.isIntermediate}
            enableAI={settings.enableAI}
            activeCollectionName={activeCollection?.name}
            onClose={onClose}
            onCopyPrompt={() => {
                if (activeImage?.metadata.positivePrompt) {
                    navigator.clipboard.writeText(activeImage.metadata.positivePrompt);
                    addToast('Prompt copied', 'success');
                }
                onClose();
            }}
            onCopySeed={() => {
                if (activeImage?.metadata.seed !== undefined) {
                    navigator.clipboard.writeText(String(activeImage.metadata.seed));
                    addToast('Seed copied', 'success');
                }
                onClose();
            }}
            onCopyGenerationInfo={() => {
                const meta = activeImage?.metadata;
                if (!meta) return;

                // Construct a robust generation info string if rawParameters is missing
                const infoLines = [
                    meta.positivePrompt ? `Prompt: ${meta.positivePrompt}` : '',
                    meta.negativePrompt ? `Negative Prompt: ${meta.negativePrompt}` : '',
                    `Steps: ${meta.steps || '?'}, Sampler: ${meta.sampler || '?'}, CFG scale: ${meta.cfg || '?'}, Seed: ${meta.seed || '?'}, Size: ${activeImage?.width}x${activeImage?.height}, Model: ${meta.model || '?'}${meta.tool ? `, Tool: ${meta.tool}` : ''}`,
                    meta.rawParameters ? `\nRaw Parameters:\n${meta.rawParameters}` : ''
                ].filter(Boolean);

                const text = infoLines.join('\n');
                navigator.clipboard.writeText(text);
                addToast('Generation info copied', 'success');
                onClose();
            }}
            onCopyImage={async () => {
                if (activeImage?.url) {
                    try {
                        const response = await fetch(activeImage.url);
                        const blob = await response.blob();
                        await navigator.clipboard.write([
                            new ClipboardItem({ [blob.type]: blob })
                        ]);
                        addToast('Image copied to clipboard', 'success');
                    } catch (e) {
                        // Fallback to path if blob copy fails (e.g. browser security)
                        navigator.clipboard.writeText(activeImage.url);
                        addToast('Image path copied (fallback)', 'info');
                    }
                }
                onClose();
            }}
            onCopyFilePath={() => {
                if (activeImage?.id) {
                    navigator.clipboard.writeText(activeImage.id);
                    addToast('File path copied', 'success');
                }
                onClose();
            }}
            onAddToCollection={() => {
                modals.setAddToCollectionMode('add');
                modals.setSourceCollectionId(null);
                modals.openModal('addToCollection');
                onClose();
            }}
            onMoveToCollection={onMoveToCollection}
            onRemoveFromCollection={() => {
                if (filters.collectionId && contextMenu.imageId) {
                    colOps.removeImagesFromCollection([contextMenu.imageId], filters.collectionId);
                    onClose();
                }
            }}
            onToggleFavorite={() => {
                if (contextMenu.imageId) {
                    // Use toggleFavorite from actions if available, else from library
                    const toggle = actions.toggleFavorite || libraryToggleFavorite;
                    toggle(contextMenu.imageId);
                    onClose();
                }
            }}
            onTogglePin={async () => {
                const id = contextMenu.imageId;
                const img = images.find(i => i.id === id);
                if (img) {
                    await actions.handlePinImage(id, !img.isPinned);
                }
                onClose();
            }}
            onToggleMask={(val) => {
                actions.handleBulkMask(contextMenu.imageId, val);
                onClose();
            }}
            onToggleIntermediate={async () => {
                if (contextMenu.imageId) {
                    const { toggleImageIntermediate } = await import('../../services/db/imageRepo');
                    await toggleImageIntermediate(contextMenu.imageId, !activeImage?.metadata?.isIntermediate);
                    // We might need to refresh state here, but let's assume watchers handle it
                    addToast(activeImage?.metadata?.isIntermediate ? "Unmarked as intermediate" : "Marked as intermediate", "info");
                }
                onClose();
            }}
            onDelete={() => {
                settings.confirmDelete ? modals.openModal('deleteConfirm') : actions.executeDelete();
                onClose();
            }}
            onShowInFolder={async () => {
                const id = contextMenu.imageId;
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('show_in_folder', { path: id });
                addToast('Opening folder...', 'info');
                onClose();
            }}
            onOpenInDefaultApp={async () => {
                const id = contextMenu.imageId;
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('open_file', { path: id });
                onClose();
            }}
            onSetThumbnail={() => {
                if (filters.collectionId && contextMenu.imageId) {
                    colOps.setCollectionThumbnail(filters.collectionId, contextMenu.imageId);
                }
                onClose();
            }}
            onUnsetThumbnail={() => {
                if (filters.collectionId) {
                    colOps.resetCollectionThumbnail(filters.collectionId);
                }
                onClose();
            }}
        />
    );
};
