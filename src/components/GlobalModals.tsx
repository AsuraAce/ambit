import * as React from 'react';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { AIImage, AppSettings, AppSettingsUpdate, Collection, FilterState, RecoveryStyle, ViewMode, isVideoAsset } from '../types';
import { AppUpdaterStatus } from '../hooks/useAppUpdater';
import type { ImportResult } from '../services/importService';
import { createDefaultFilters } from '../utils/filterState';

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
    onDeleteConfirm: () => void | Promise<void>;
    onDeleteCollectionConfirm: () => void | Promise<void>;
    onRecoverMetadata: (style: RecoveryStyle) => void;
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
    initialSettingsTab: 'general' | 'folders' | 'resources' | 'privacy' | 'experiments' | 'intelligence' | 'invokeai' | 'a1111' | 'comfyui' | 'dev';
    shortcutsModalTab: 'shortcuts' | 'search' | 'setup';
    onOpenSetupGuide?: () => void;
    onResetFirstRunOnboarding?: () => void;
    commandPaletteProps: {
        onNavigate: (mode: ViewMode) => void;
        onToggleTheme: () => void;
        onOpenSettings: () => void;
        onImport: () => void;
        onCreateCollection: () => void;
        onToggleAI: () => void;
        settings: AppSettings;
    };
    collections: Collection[];
    smartCollections?: Collection[];
    toggleFavorite: (id: string) => void;
    togglePin?: (id: string, isPinned: boolean) => void;
    settings: AppSettings;
    filters?: FilterState;
    collectionToEditId?: string | null;
    onSaveCollectionFilters?: (id: string, filters: FilterState | undefined) => void | Promise<void>;
    onScanFolder?: (folders: { path: string, variant?: string }[]) => Promise<ImportResult | void>;
    onInvokeSync?: () => Promise<void>; // Trigger InvokeAI database sync
    hasPendingUpdate: boolean;
    pendingUpdateVersion: string | null;
    updateErrorMessage: string | null;
    updateStatus: AppUpdaterStatus;
    onCheckForUpdates: () => Promise<void>;
    onOpenUpdatePrompt: () => void;
    onNavigateToMaintenance: () => void;
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
    onOpenSetupGuide,
    onResetFirstRunOnboarding,
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
    onOpenUpdatePrompt,
    onNavigateToMaintenance
}) => {
    const deletePendingRef = React.useRef(false);
    const collectionDeletePendingRef = React.useRef(false);
    const [isDeletePending, setIsDeletePending] = React.useState(false);
    const [isCollectionDeletePending, setIsCollectionDeletePending] = React.useState(false);
    const closeModal = (name: string) => setModals(p => ({ ...p, [name]: false }));
    const imageOnlyResults = filteredImages.filter(image => !isVideoAsset(image));
    const deleteTargetCount = pendingViewerDeleteId ? 1 : selectedIds.size;
    const collectionToDelete = [...collections, ...smartCollections]
        .find(collection => collection.id === collectionToDeleteId);
    const handleDeleteConfirm = async () => {
        if (deletePendingRef.current) return;

        deletePendingRef.current = true;
        setIsDeletePending(true);
        try {
            await onDeleteConfirm();
        } finally {
            deletePendingRef.current = false;
            setIsDeletePending(false);
        }
    };
    const handleCollectionDeleteConfirm = async () => {
        if (collectionDeletePendingRef.current) return;

        collectionDeletePendingRef.current = true;
        setIsCollectionDeletePending(true);
        try {
            await onDeleteCollectionConfirm();
        } finally {
            collectionDeletePendingRef.current = false;
            setIsCollectionDeletePending(false);
        }
    };

    return (
        <>
            <React.Suspense fallback={null}>
                {modals.settings && (
                    <SettingsModal
                        isOpen={modals.settings}
                        onClose={() => closeModal('settings')}
                        onSave={onSettingsSave}
                        // Onboarding retains the sole backdrop during this Settings handoff.
                        hasExternalBackdrop={!settings.hasCompletedOnboarding}
                        settings={settings}
                        canCheckForUpdates={canCheckForUpdates}
                        initialTab={initialSettingsTab}
                        onScanFolder={onScanFolder}
                        onInvokeSync={onInvokeSync}
                        hasPendingUpdate={hasPendingUpdate}
                        pendingUpdateVersion={pendingUpdateVersion}
                        updateErrorMessage={updateErrorMessage}
                        updateStatus={updateStatus}
                        onCheckForUpdates={onCheckForUpdates}
                        onOpenUpdatePrompt={onOpenUpdatePrompt}
                        onNavigateToMaintenance={onNavigateToMaintenance}
                        onResetFirstRunOnboarding={onResetFirstRunOnboarding}
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
                onConfirm={handleDeleteConfirm}
                title="Remove from Library?"
                message={`Remove ${deleteTargetCount} ${deleteTargetCount === 1 ? 'item' : 'items'} from Ambit while keeping the original ${deleteTargetCount === 1 ? 'file' : 'files'} on disk? You can restore them later from Maintenance > Removed.`}
                isDangerous={true}
                isLoading={isDeletePending}
            />

            <ConfirmDialog
                isOpen={modals.deleteCollection}
                onCancel={() => closeModal('deleteCollection')}
                onConfirm={handleCollectionDeleteConfirm}
                title="Delete Collection"
                message={`Delete collection "${collectionToDelete?.name ?? 'Unknown collection'}"? Images will remain in your library.`}
                confirmLabel="Delete Collection"
                isDangerous={true}
                isLoading={isCollectionDeletePending}
            />

            <React.Suspense fallback={null}>
                {modals.slideshow && (
                    <SlideshowModal
                        isOpen={modals.slideshow}
                        onClose={() => closeModal('slideshow')}
                        images={imageOnlyResults}
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
                        initialTab={shortcutsModalTab}
                        onOpenSetupGuide={onOpenSetupGuide}
                    />
                )}

                {modals.compare && imageOnlyResults.length >= 2 && Array.from(selectedIds).length >= 2 && (
                    <CompareModal
                        imageA={imageOnlyResults.find(i => i.id === Array.from(selectedIds)[0]) || imageOnlyResults[0]}
                        imageB={imageOnlyResults.find(i => i.id === Array.from(selectedIds)[1]) || imageOnlyResults[1]}
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
                        filters={filters ?? createDefaultFilters()}
                        onSave={onSaveCollectionFilters || (() => { })}
                    />
                )}
            </React.Suspense>
        </>
    );
};
