import * as React from 'react';
import { SettingsModal } from '../features/settings/components/SettingsModal';
import { ExportModal } from '../features/library/components/ExportModal';
import { RenameModal } from '../features/library/components/RenameModal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { SlideshowModal } from '../features/viewer/components/SlideshowModal';
import { MetadataRecoveryModal } from '../features/library/components/MetadataRecoveryModal';
import { AddToCollectionModal } from '../features/collections/components/AddToCollectionModal';
import { CommandPalette } from './ui/CommandPalette';
import { ShortcutsModal } from './ui/ShortcutsModal';
import { CompareModal } from '../features/viewer/components/CompareModal';
import { DonationModal } from './ui/DonationModal';
import { CollectionEditorModal } from '../features/collections/components/CollectionEditorModal';
import { AIImage, AppSettings } from '../types';

interface GlobalModalsProps {
    modals: Record<string, boolean>;
    setModals: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    selectedIds: Set<string>;
    filteredImages: AIImage[];
    onSettingsSave: (settings: AppSettings) => void;
    onExportConfirm: (name: string, folder: string) => void;
    onRename: (pattern: string, startNum: number) => void;
    onDeleteConfirm: () => void;
    onDeleteCollectionConfirm: () => void;
    onRecoverMetadata: (options: any) => void;
    onCollectionAction: (ids: string[], targetId: string, mode: 'add' | 'move', sourceId: string | null) => void;
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
    settings: AppSettings;
    filters?: any;
    collectionToEditId?: string | null;
    onSaveCollectionFilters?: (id: string, filters: any) => void;
}

export const GlobalModals: React.FC<GlobalModalsProps> = ({
    modals,
    setModals,
    selectedIds,
    filteredImages,
    onSettingsSave,
    onExportConfirm,
    onRename,
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
    settings,
    filters,
    collectionToEditId,
    onSaveCollectionFilters
}) => {
    const closeModal = (name: string) => setModals(p => ({ ...p, [name]: false }));

    return (
        <>
            <SettingsModal
                isOpen={modals.settings}
                onClose={() => closeModal('settings')}
                onSave={onSettingsSave}
                settings={settings}
                initialTab={initialSettingsTab as any}
            />

            <ExportModal
                isOpen={modals.export}
                onClose={() => { closeModal('export'); onCloseExport(); }}
                count={exportIds.size > 0 ? exportIds.size : selectedIds.size}
                onConfirm={onExportConfirm}
                isExporting={isExporting}
            />

            <RenameModal
                isOpen={modals.rename}
                onClose={() => closeModal('rename')}
                onRename={(pattern, startNum) => onRename(pattern, startNum)}
                selectedCount={selectedIds.size}
            />

            <ConfirmDialog
                isOpen={modals.deleteConfirm}
                onCancel={() => closeModal('deleteConfirm')}
                onConfirm={onDeleteConfirm}
                title="Delete Images"
                message={`Are you sure you want to delete ${pendingViewerDeleteId ? 1 : selectedIds.size} image(s)? This action cannot be undone.`}
                isDangerous={true}
            />

            <ConfirmDialog
                isOpen={modals.deleteCollection}
                onCancel={() => closeModal('deleteCollection')}
                onConfirm={onDeleteCollectionConfirm}
                title="Delete Collection"
                message="Are you sure you want to delete this collection? Images will not be deleted from your library."
                isDangerous={true}
            />

            <SlideshowModal
                isOpen={modals.slideshow}
                onClose={() => closeModal('slideshow')}
                images={filteredImages}
                initialIndex={0}
                isShuffleDefault={slideshowShuffle}
            />

            <MetadataRecoveryModal
                isOpen={modals.recovery}
                onClose={() => closeModal('recovery')}
                onConfirm={onRecoverMetadata}
                isProcessing={isRecoveringMetadata}
            />

            <AddToCollectionModal
                isOpen={modals.addToCollection}
                onClose={() => closeModal('addToCollection')}
                collections={collections}
                smartCollections={smartCollections}
                selectedIds={Array.from(selectedIds)}
                onConfirm={onCollectionAction}
                mode={addToCollectionMode}
                sourceCollectionId={sourceCollectionId}
            />

            <CommandPalette
                isOpen={modals.commandPalette}
                onClose={() => closeModal('commandPalette')}
                {...commandPaletteProps}
            />

            <ShortcutsModal
                isOpen={modals.shortcuts}
                onClose={() => closeModal('shortcuts')}
                initialTab={shortcutsModalTab as any}
            />

            {filteredImages.length >= 2 && Array.from(selectedIds).length >= 2 && (
                <CompareModal
                    imageA={filteredImages.find(i => i.id === Array.from(selectedIds)[0]) || filteredImages[0]}
                    imageB={filteredImages.find(i => i.id === Array.from(selectedIds)[1]) || filteredImages[1]}
                    onClose={() => closeModal('compare')}
                    onToggleFavorite={toggleFavorite}
                />
            )}

            <DonationModal
                isOpen={modals.donation}
                onClose={() => closeModal('donation')}
            />

            <CollectionEditorModal
                isOpen={modals.collectionEditor}
                onClose={() => closeModal('collectionEditor')}
                collection={[...collections, ...smartCollections].find(c => c.id === collectionToEditId) || null}
                filters={filters}
                onSave={onSaveCollectionFilters || (() => { })}
            />
        </>
    );
};
