import * as React from 'react';
import { ContextMenu } from './ContextMenu';
import { useToast } from '../../hooks/useToast';
import { isImageMasked } from '../../utils/maskingUtils';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { useSearchStore } from '../../stores/searchStore';
import { AIImage, ContextMenuState } from '../../types';
import { useQueryClient } from '@tanstack/react-query';

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
    filters
}) => {
    const { addToast } = useToast();
    const settings = useSettingsStore(s => s.settings);
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    const allCollections = useCollectionStore(s => s.collections);
    const libraryToggleFavorite = useSearchStore(s => s.toggleFavorite);
    const queryClient = useQueryClient();

    const collections = React.useMemo(() => allCollections.filter(c => !c.filters), [allCollections]);
    const smartCollections = React.useMemo(() => allCollections.filter(c => !!c.filters), [allCollections]);


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
            onUnsetThumbnail={() => {
                if (filters.collectionId) {
                    colOps.resetCollectionThumbnail(filters.collectionId);
                }
                onClose();
            }}
            modelsForThumbnail={(() => {
                if (!activeImage?.metadata) return [];
                const res = [];
                const m = activeImage.metadata;

                // Checkpoint
                // Modified to allow name-based fallback if hash is missing
                const modelName = typeof m.model === 'string' ? m.model : (m.model as any)?.name;
                if (m.modelHash || modelName) {
                    const name = modelName || 'Checkpoint';
                    const hash = m.modelHash || `checkpoint_${name}`; // Fallback hash for name-based lookup
                    res.push({ name, hash, type: 'checkpoint' });
                }

                // LoRAs
                if (m.loras && Array.isArray(m.loras)) {
                    m.loras.forEach(l => {
                        // l is "lora_name (hash)" or "lora:name:1" depending on parser
                        // Simple extraction
                        const clean = l.split('(')[0].trim().replace('lora:', '').split(':')[0];
                        // We use a pseudo-hash for LoRAs if real hash isn't available, but usually harvest uses consistent naming
                        // For manual set, we rely on the name matching logic in backend or just hash if available
                        // Actually, backend `set_model_thumbnail` takes a hash.
                        // Implication: We need the HASH. 
                        // Most parsers don't give lora HASH unless it's in the string.
                        // Let's rely on backend logic: `set_model_thumbnail` takes `model_hash`.
                        // If we don't have a hash, we can't reliably set it unless we use the name as hash (like harvest does).
                        // Harvest uses: 'lora_' || clean_name
                        res.push({ name: clean, hash: `lora_${clean}`, type: 'lora' });
                    });
                }

                return res;
            })()}
            onSetModelThumbnail={async (model) => {
                if (contextMenu.imageId && activeImage?.id) {
                    const { invoke } = await import('@tauri-apps/api/core');

                    // Map frontend type (singular) to backend type (plural for some)
                    let resourceType = 'checkpoint';
                    if (model.type === 'lora') resourceType = 'loras';
                    if (model.type === 'embedding') resourceType = 'embeddings';
                    if (model.type === 'hypernetwork') resourceType = 'hypernetworks';
                    if (model.type === 'checkpoint') resourceType = 'checkpoint';

                    await invoke('set_model_thumbnail', {
                        modelHash: model.hash,
                        modelName: model.name,
                        imagePath: activeImage.id,
                        resourceType: resourceType
                    });

                    // Invalidate stats query to refresh thumbnails in FilterPanel
                    await queryClient.invalidateQueries({ queryKey: ['libraryStats'] });

                    addToast(`Thumbnail set for ${model.name}`, 'success');
                }
                onClose();
            }}
        />
    );
};
