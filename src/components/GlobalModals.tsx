import * as React from 'react';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { AIImage, AppSettings, AppSettingsUpdate } from '../types';
import { AppUpdaterStatus } from '../hooks/useAppUpdater';
import type { ImportResult } from '../services/importService';

const SettingsModal = React.lazy(() => import('../features/settings/components/SettingsModal').then(module => ({ default: module.SettingsModal })));
const ExportModal = React.lazy(() => import('../features/library/components/ExportModal').then(module => ({ default: module.ExportModal })));
const SlideshowModal = React.lazy(() => import('../features/viewer/components/SlideshowModal').then(module => ({ default: module.SlideshowModal })));
const MetadataRecoveryModal = React.lazy(() => import('../features/library/components/MetadataRecoveryModal').then(module => ({ default: module.MetadataRecoveryModal })));
const AddToCollectionModal = React.lazy(() => import('../features/collections/components/AddToCollectionModal').then(module => ({ default: module.AddToCollectionModal })));
const CommandPalette = React.lazy(() => import('./ui/CommandPalette').then(module => ({ default: module.CommandPalette })));
const ShortcutsModal = React.lazy(() => import('./ui/ShortcutsModal').then(module => ({ default: module.ShortcutsModal })));
const CompareModal = React.lazy(() => import('../features/viewer/components/CompareModal').then(module => ({ default: module.CompareModal })));
const DonationModal = React.lazy(() => import('./ui/DonationModal').then(module => ({ default: module.DonationModal })));
const CollectionEditorModal = React.lazy(() => import('../features/collections/components/CollectionEditorModal').then(module => ({ default: module.CollectionEditorModal })));

interface GlobalModalsProps {
    modals: Record<string, boolean>;
    setModals: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    selectedIds: Set<string>;
    filteredImages: AIImage[];
    canCheckForUpdates: boolean;
    onSettingsSave: (settings: AppSettingsUpdate) => void;
    onExportConfirm: (name: string, folder: string) => void;
    onDeleteConfirm: () => void;
    onDeleteCollectionConfirm: () => void;
    onRecoverMetadata: (options: any) => void;
    onCollectionAction: (ids: string[], targetId: string, mode: 'add' | 'move', sourceId?: string) => void;
    onCloseExport: () => void;
    exportIds: Set<string>;
    pendingViewerDeleteId: string | null;
    collectionToDeleteId: string | null;
    addToCollectionMode: 'add' | 'move';
    sourceCollectionId: string | null;
    isRecoveringMetadata: boolean;
    isExporting: boolean;
    slideshowShuffle: boolean;
    initialSettingsTab: string;
    shortcutsModalTab: string;
    commandPaletteProps: {
        onNavigate: (mode: any) => void;
        onToggleTheme: () => void;
        onOpenSettings: () => void;
        onImport: () => void;
        onCreateCollection: () => void;
        onToggleAI: () => void;
        settings: AppSettings;
    };
    collections: any[];
    smartCollections?: any[];
    toggleFavorite: (id: string) => void;
    togglePin?: (id: string, isPinned: boolean) => void;
    settings: AppSettings;
    filters?: any;
    collectionToEditId?: string | null;
    onSaveCollectionFilters?: (id: string, filters: any) => void;
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<ImportResult | void>;
    onInvokeSync?: () => Promise<void>; // Trigger InvokeAI database sync
    hasPendingUpdate: boolean;
    pendingUpdateVersion: string | null;
    updateErrorMessage: string | null;
    updateStatus: AppUpdaterStatus;
    onCheckForUpdates: () => Promise<void>;
    onOpenUpdatePrompt: () => void;
}

export const GlobalModals: React.FC<GlobalModalsProps> = ({
    modals,
    setModals,
    selectedIds,
    filteredImages,
    canCheckForUpdates,
    onSettingsSave,
    onExportConfirm,
    onDeleteConfirm,
    onDeleteCollectionConfirm,
    onRecoverMetadata,
    onCollectionAction,
    onCloseExport,
    exportIds,
    pendingViewerDeleteId,
    collectionToDeleteId,
    addToCollectionMode,
    sourceCollectionId,
    isRecoveringMetadata,
    isExporting,
    slideshowShuffle,
    initialSettingsTab,
    shortcutsModalTab,
    commandPaletteProps,
    collections,
    smartCollections = [],
    toggleFavorite,
    togglePin,
    settings,
    filters,
    collectionToEditId,
    onSaveCollectionFilters,
    onScanFolder, // Added
    onInvokeSync, // Added for managed InvokeAI sync
    hasPendingUpdate,
    pendingUpdateVersion,
    updateErrorMessage,
    updateStatus,
    onCheckForUpdates,
    onOpenUpdatePrompt
}) => {
    const closeModal = (name: string) => setModals(p => ({ ...p, [name]: false }));

    return (
        <>
            <React.Suspense fallback={null}>
                {modals.settings && (
                    <SettingsModal
                        isOpen={modals.settings}
                        onClose={() => closeModal('settings')}
                        onSave={onSettingsSave}
                        settings={settings}
                        canCheckForUpdates={canCheckForUpdates}
                        initialTab={initialSettingsTab as any}
                        onScanFolder={onScanFolder}
                        onInvokeSync={onInvokeSync}
                        hasPendingUpdate={hasPendingUpdate}
                        pendingUpdateVersion={pendingUpdateVersion}
                        updateErrorMessage={updateErrorMessage}
                        updateStatus={updateStatus}
                        onCheckForUpdates={onCheckForUpdates}
                        onOpenUpdatePrompt={onOpenUpdatePrompt}
                    />
                )}

                {modals.export && (
                    <ExportModal
                        isOpen={modals.export}
                        onClose={() => { closeModal('export'); onCloseExport(); }}
                        count={exportIds.size > 0 ? exportIds.size : selectedIds.size}
                        onConfirm={onExportConfirm}
                        isExporting={isExporting}
                    />
                )}
            </React.Suspense>

            <ConfirmDialog
                isOpen={modals.deleteConfirm}
                onCancel={() => closeModal('deleteConfirm')}
                onConfirm={() => onDeleteConfirm()}
                title="Remove from Library?"
                message={`Remove ${pendingViewerDeleteId ? 1 : selectedIds.size} image(s) from Ambit while keeping the original file(s) on disk? You can restore them later from Maintenance > Removed.`}
                isDangerous={true}
            />

            <ConfirmDialog
                isOpen={modals.deleteCollection}
                onCancel={() => closeModal('deleteCollection')}
                onConfirm={() => onDeleteCollectionConfirm()}
                title="Delete Collection"
                message="Are you sure you want to delete this collection? Images will not be deleted from your library."
                isDangerous={true}
            />

            <React.Suspense fallback={null}>
                {modals.slideshow && (
                    <SlideshowModal
                        isOpen={modals.slideshow}
                        onClose={() => closeModal('slideshow')}
                        images={filteredImages}
                        initialIndex={0}
                        isShuffleDefault={slideshowShuffle}
                    />
                )}

                {modals.recovery && (
                    <MetadataRecoveryModal
                        isOpen={modals.recovery}
                        onClose={() => closeModal('recovery')}
                        onConfirm={onRecoverMetadata}
                        isProcessing={isRecoveringMetadata}
                    />
                )}

                {modals.addToCollection && (
                    <AddToCollectionModal
                        isOpen={modals.addToCollection}
                        onClose={() => closeModal('addToCollection')}
                        collections={collections}
                        smartCollections={smartCollections}
                        selectedIds={Array.from(selectedIds)}
                        onConfirm={onCollectionAction}
                        mode={addToCollectionMode}
                        sourceCollectionId={sourceCollectionId ?? undefined}
                    />
                )}

                {modals.commandPalette && (
                    <CommandPalette
                        isOpen={modals.commandPalette}
                        onClose={() => closeModal('commandPalette')}
                        {...commandPaletteProps}
                    />
                )}

                {modals.shortcuts && (
                    <ShortcutsModal
                        isOpen={modals.shortcuts}
                        onClose={() => closeModal('shortcuts')}
                        initialTab={shortcutsModalTab as any}
                    />
                )}

                {modals.compare && filteredImages.length >= 2 && Array.from(selectedIds).length >= 2 && (
                    <CompareModal
                        imageA={filteredImages.find(i => i.id === Array.from(selectedIds)[0]) || filteredImages[0]}
                        imageB={filteredImages.find(i => i.id === Array.from(selectedIds)[1]) || filteredImages[1]}
                        onClose={() => closeModal('compare')}
                        onToggleFavorite={toggleFavorite}
                        onTogglePin={togglePin}
                    />
                )}

                {modals.donation && (
                    <DonationModal
                        isOpen={modals.donation}
                        onClose={() => closeModal('donation')}
                    />
                )}

                {modals.collectionEditor && (
                    <CollectionEditorModal
                        isOpen={modals.collectionEditor}
                        onClose={() => closeModal('collectionEditor')}
                        collection={[...collections, ...smartCollections].find(c => c.id === collectionToEditId) || null}
                        filters={filters}
                        onSave={onSaveCollectionFilters || (() => { })}
                    />
                )}
            </React.Suspense>
        </>
    );
};
