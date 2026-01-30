
import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AIImage, AppSettings, Collection, FilterState } from '../../types';
import { SettingsModal } from '../../features/settings/components/SettingsModal';
import { ConfirmDialog } from './ConfirmDialog';
import { CompareModal } from '../../features/viewer/components/CompareModal';
import { ShortcutsModal } from './ShortcutsModal';
import { MetadataRecoveryModal } from '../../features/library/components/MetadataRecoveryModal';
import { SlideshowModal } from '../../features/viewer/components/SlideshowModal';
import { DonationModal } from './DonationModal';
import { ExportModal } from '../../features/library/components/ExportModal';
import { CommandPalette } from './CommandPalette';
import { AddToCollectionModal } from '../../features/collections/components/AddToCollectionModal';
import { useLibraryContext } from '../../hooks/useLibraryContext';

interface GlobalModalsProps {
  // Modal Visibility States
  modals: {
    settings: boolean;
    addToCollection: boolean;
    deleteConfirm: boolean;
    deleteCollection: boolean;
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
  onDeleteConfirm: () => void;
  onDeleteCollectionConfirm: () => void;
  onRecoverMetadata: (style: any) => void;
  onCollectionAction: (ids: string[], targetColId: string, mode: 'add' | 'move', sourceColId?: string) => void;
  onCloseExport?: () => void;
  exportIds?: Set<string>;

  // Specific Props
  pendingViewerDeleteId: string | null;
  collectionToDeleteId: string | null;
  addToCollectionMode: 'add' | 'move';
  sourceCollectionId: string | null;
  isRecoveringMetadata: boolean;
  isExporting: boolean;
  slideshowShuffle: boolean;
  initialSettingsTab: 'general' | 'experiments' | 'intelligence';
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

import { useSettings } from '../../contexts/SettingsContext';
import { useCollections } from '../../contexts/CollectionContext';
import { useSearch } from '../../contexts/SearchContext';

export const GlobalModals: React.FC<GlobalModalsProps> = ({
  modals,
  setModals,
  selectedIds,
  filteredImages,
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
  commandPaletteProps
}) => {
  const { settings, setSettings } = useSettings();
  const { collections, smartCollections } = useCollections();
  const { images, toggleFavorite } = useSearch();

  // Individual tabs now handle their own toast notifications
  const close = (key: keyof typeof modals) => setModals((p: any) => ({ ...p, [key]: false }));

  const collectionName = collections.find(c => c.id === collectionToDeleteId)?.name || 'Collection';

  return (
    <>
      <SettingsModal
        isOpen={modals.settings}
        onClose={() => close('settings')}
        settings={settings}
        onSave={onSettingsSave || setSettings}
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
        onClose={() => { close('export'); onCloseExport?.(); }}
        count={exportIds?.size || selectedIds.size}
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
        smartCollections={smartCollections}
        selectedIds={Array.from(selectedIds)}
        mode={addToCollectionMode}
        sourceCollectionId={sourceCollectionId || undefined}
        onConfirm={(ids, colId, mode, sourceId) => {
          onCollectionAction(ids, colId, mode, sourceId);
          close('addToCollection');
        }}
      />
    </>
  );
};
