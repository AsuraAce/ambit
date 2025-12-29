
import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AIImage, AppSettings, Collection, FilterState } from '../types';
import { SettingsModal } from './SettingsModal';
import { ConfirmDialog } from './ConfirmDialog';
import { RenameModal } from './RenameModal';
import { CompareModal } from './CompareModal';
import { ShortcutsModal } from './ShortcutsModal';
import { MetadataRecoveryModal } from './MetadataRecoveryModal';
import { SlideshowModal } from './SlideshowModal';
import { DonationModal } from './DonationModal';
import { ExportModal } from './ExportModal';
import { CommandPalette } from './CommandPalette';
import { AddToCollectionModal } from './AddToCollectionModal';
import { useLibraryContext } from '../hooks/useLibraryContext';
import { useToast } from '../hooks/useToast';

interface GlobalModalsProps {
  // Modal Visibility States
  modals: {
    settings: boolean;
    addToCollection: boolean;
    deleteConfirm: boolean;
    deleteCollection: boolean;
    rename: boolean;
    compare: boolean;
    shortcuts: boolean;
    recovery: boolean;
    slideshow: boolean;
    donation: boolean;
    export: boolean;
    commandPalette: boolean;
  };

  // Setters
  setModals: React.Dispatch<React.SetStateAction<any>>;

  // Local View Data
  selectedIds: Set<string>;
  filteredImages: AIImage[];

  // Actions
  onSettingsSave?: (s: AppSettings) => void;
  onExportConfirm: (filename: string, folder: string) => void;
  onRename: (pattern: string, start: number) => void;
  onDeleteConfirm: () => void;
  onDeleteCollectionConfirm: () => void;
  onRecoverMetadata: (style: any) => void;
  onAddImagesToCollection: (ids: string[], colId: string) => void;

  // Specific Props
  pendingViewerDeleteId: string | null;
  collectionToDeleteId: string | null;
  isRecoveringMetadata: boolean;
  isExporting: boolean;
  slideshowShuffle: boolean;
  initialSettingsTab: 'general' | 'experiments';
  shortcutsModalTab: 'shortcuts' | 'search';

  // Command Palette Specifics
  commandPaletteProps: {
    onNavigate: (mode: any) => void;
    onToggleTheme: () => void;
    onOpenSettings: () => void;
    onImport: () => void;
    onCreateCollection: () => void;
    onToggleAI: () => void;
  }
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
  onAddImagesToCollection,
  pendingViewerDeleteId,
  collectionToDeleteId,
  isRecoveringMetadata,
  isExporting,
  slideshowShuffle,
  initialSettingsTab,
  shortcutsModalTab,
  commandPaletteProps
}) => {
  const { images, collections, settings, setSettings, toggleFavorite } = useLibraryContext();
  const { addToast } = useToast();

  const handleSettingsSave = (s: AppSettings) => {
    setSettings(s);
    addToast('Settings saved', 'success');
  };
  const close = (key: keyof typeof modals) => setModals((p: any) => ({ ...p, [key]: false }));

  const collectionName = collections.find(c => c.id === collectionToDeleteId)?.name || 'Collection';

  return (
    <>
      <SettingsModal
        isOpen={modals.settings}
        onClose={() => close('settings')}
        settings={settings}
        onSave={onSettingsSave}
        initialTab={initialSettingsTab}
      />

      <ConfirmDialog
        isOpen={modals.deleteConfirm}
        title="Move to Trash?"
        message={`This will move ${pendingViewerDeleteId ? '1' : selectedIds.size} image(s) to the Trash bin. You can restore them later.`}
        confirmLabel="Move to Trash"
        isDangerous={true}
        onConfirm={onDeleteConfirm}
        onCancel={() => close('deleteConfirm')}
      />

      <ConfirmDialog
        isOpen={modals.deleteCollection}
        title={`Delete "${collectionName}"?`}
        message="This will delete the collection folder. The images themselves will remain in your library."
        confirmLabel="Delete Collection"
        isDangerous={true}
        onConfirm={onDeleteCollectionConfirm}
        onCancel={() => close('deleteCollection')}
      />

      <RenameModal
        isOpen={modals.rename}
        onClose={() => close('rename')}
        selectedCount={selectedIds.size}
        onRename={onRename}
      />

      {modals.compare && selectedIds.size === 2 && (
        <CompareModal
          imageA={images.find(i => i.id === Array.from(selectedIds)[0])!}
          imageB={images.find(i => i.id === Array.from(selectedIds)[1])!}
          onClose={() => close('compare')}
          onToggleFavorite={toggleFavorite}
        />
      )}

      <ShortcutsModal
        isOpen={modals.shortcuts}
        onClose={() => close('shortcuts')}
        initialTab={shortcutsModalTab}
      />

      <MetadataRecoveryModal
        isOpen={modals.recovery}
        onClose={() => close('recovery')}
        isProcessing={isRecoveringMetadata}
        onConfirm={onRecoverMetadata}
      />

      {modals.slideshow && (
        <SlideshowModal
          isOpen={modals.slideshow}
          images={filteredImages}
          initialIndex={0}
          onClose={() => close('slideshow')}
          isShuffleDefault={slideshowShuffle}
        />
      )}

      <DonationModal
        isOpen={modals.donation}
        onClose={() => close('donation')}
      />

      <ExportModal
        isOpen={modals.export}
        onClose={() => close('export')}
        count={selectedIds.size}
        onConfirm={onExportConfirm}
        isExporting={isExporting}
      />

      <CommandPalette
        isOpen={modals.commandPalette}
        onClose={() => close('commandPalette')}
        settings={settings}
        {...commandPaletteProps}
      />

      <AddToCollectionModal
        isOpen={modals.addToCollection}
        onClose={() => close('addToCollection')}
        collections={collections}
        selectedIds={Array.from(selectedIds)}
        onAddImagesToCollection={(ids, colId) => {
          onAddImagesToCollection(ids, colId);
          close('addToCollection');
        }}
      />
    </>
  );
};
