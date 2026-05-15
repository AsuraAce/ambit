import * as React from 'react';
import { ContextMenu } from './ContextMenu';
import { useToast } from '../../hooks/useToast';
import { isImageMasked } from '../../utils/maskingUtils';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCollectionStore } from '../../stores/collectionStore';
import { useSearchStore } from '../../stores/searchStore';
import { AIImage, ContextMenuState, FilterState } from '../../types';
import { useQueryClient } from '@tanstack/react-query';
import { isBrowserMockMode } from '../../services/runtime';
import { isOsOpenUnavailable, openFileInDefaultApp, showPathInFolder } from '../../services/osOpen';
import { toggleImageIntermediate } from '../../services/db/imageRepo';
import { invoke } from '@tauri-apps/api/core';
import type { useAppActions } from '../../hooks/useAppActions';
import type { useCollectionOperations } from '../../hooks/useCollectionOperations';
import type { useModalManager } from '../../hooks/useModalManager';

interface AppContextMenuProps {
    contextMenu: ContextMenuState | null;
    onClose: () => void;
    images: AIImage[];
    actions: ReturnType<typeof useAppActions>;
    fileOps: unknown;
    colOps: ReturnType<typeof useCollectionOperations>;
    onMoveToCollection: () => void;
    modals: ReturnType<typeof useModalManager>;
    filters: FilterState;
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
    const browserMockMode = isBrowserMockMode();
    const settings = useSettingsStore(s => s.settings);
    const privacyEnabled = useSettingsStore(s => s.privacyEnabled);
    const allCollections = useCollectionStore(s => s.collections);
    const libraryToggleFavorite = useSearchStore(s => s.toggleFavorite);
    const queryClient = useQueryClient();

    const collections = React.useMemo(() => allCollections.filter(c => !c.filters), [allCollections]);
    const smartCollections = React.useMemo(() => allCollections.filter(c => !!c.filters), [allCollections]);


    if (!contextMenu) return null;

    const activeImage = images.find(i => i.id === contextMenu.imageId);
    const collectionId = filters.collectionId;
    const activeCollection = collectionId
        ? (collections.find((c) => c.id === collectionId) || smartCollections.find((c) => c.id === collectionId))
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
            onTogglePin={() => {
                const id = contextMenu.imageId;
                const img = images.find(i => i.id === id);
                if (img) {
                    actions.handlePinImage(id, !img.isPinned);
                }
                onClose();
            }}
            onToggleMask={(val) => {
                actions.handleBulkMask(contextMenu.imageId, val);
                onClose();
            }}
            onToggleIntermediate={async () => {
                if (contextMenu.imageId) {
                    await toggleImageIntermediate(contextMenu.imageId, !activeImage?.metadata?.isIntermediate);
                    // We might need to refresh state here, but let's assume watchers handle it
                    addToast(activeImage?.metadata?.isIntermediate ? "Unmarked as intermediate" : "Marked as intermediate", "info");
                }
                onClose();
            }}
            onDelete={() => {
                if (contextMenu.imageId) {
                    actions.requestDeleteForId(contextMenu.imageId);
                }
                onClose();
            }}
            onShowInFolder={async () => {
                const id = contextMenu.imageId;
                if (id) {
                    const result = await showPathInFolder(id);
                    if (result.status === 'ok') {
                        addToast('Opening folder...', 'info');
                    } else {
                        addToast(result.error, isOsOpenUnavailable(result.error) ? 'info' : 'error');
                    }
                }
                onClose();
            }}
            onOpenInDefaultApp={async () => {
                const id = contextMenu.imageId;
                if (id) {
                    const result = await openFileInDefaultApp(id);
                    if (result.status === 'error') {
                        addToast(result.error, isOsOpenUnavailable(result.error) ? 'info' : 'error');
                    }
                }
                onClose();
            }}
            onSetThumbnail={collectionId && activeImage ? async () => {
                try {
                    await colOps.setCollectionThumbnail(collectionId, activeImage);
                } catch (error) {
                    console.error('[ContextMenu] Failed to set collection thumbnail', error);
                    addToast('Failed to update thumbnail', 'error');
                } finally {
                    onClose();
                }
            } : undefined}
            onUnsetThumbnail={collectionId && activeCollection?.customThumbnail ? async () => {
                try {
                    await colOps.resetCollectionThumbnail(collectionId);
                } catch (error) {
                    console.error('[ContextMenu] Failed to reset collection thumbnail', error);
                    addToast('Failed to reset thumbnail', 'error');
                } finally {
                    onClose();
                }
            } : undefined}
            modelsForThumbnail={(() => {
                if (!activeImage?.metadata) return [];
                const res: { name: string; hash: string; type: string }[] = [];
                const m = activeImage.metadata;
                const cleanResourceName = (value: string) =>
                    value
                        .split('(')[0]
                        .trim()
                        .replace(/^lora:/i, '')
                        .split(':')[0]
                        .trim();
                const pushResources = (values: string[] | undefined, hashPrefix: string, resourceType: string) => {
                    values?.forEach(value => {
                        const clean = cleanResourceName(value);
                        if (clean) res.push({ name: clean, hash: `${hashPrefix}${clean}`, type: resourceType });
                    });
                };

                // Checkpoint
                const modelValue = m.model as unknown;
                const modelName = typeof modelValue === 'string'
                    ? modelValue
                    : modelValue && typeof modelValue === 'object' && 'name' in modelValue
                        ? String((modelValue as { name?: unknown }).name || '')
                        : '';
                if (m.modelHash || modelName) {
                    const name = modelName || 'Checkpoint';
                    const hash = m.modelHash || `name:${name}`;
                    res.push({ name, hash, type: 'checkpoint' });
                }

                pushResources(m.loras, 'lora_', 'loras');
                pushResources(m.embeddings, 'emb_', 'embeddings');
                pushResources(m.hypernetworks, 'hyper_', 'hypernetworks');
                pushResources(m.controlNets, 'cnet_', 'control_nets');
                pushResources(m.ipAdapters, 'ipad_', 'ip_adapters');

                return res;
            })()}
            onSetModelThumbnail={async (model) => {
                if (browserMockMode) {
                    addToast('Unavailable in browser mock mode.', 'info');
                    onClose();
                    return;
                }
                if (contextMenu.imageId && activeImage?.id) {
                    await invoke('set_model_thumbnail', {
                        modelHash: model.hash,
                        modelName: model.name,
                        imagePath: activeImage.id,
                        resourceType: model.type
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
