
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
import { useLibraryContext } from '../hooks/useLibraryContext';

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
  onSettingsSave: (s: AppSettings) => void;
  onExportConfirm: (filename: string) => void;
  onRename: (pattern: string, start: number) => void;
  onDeleteConfirm: () => void;
  onDeleteCollectionConfirm: () => void;
  onToggleFavorite: (id: string) => void;
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
  onToggleFavorite,
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
  const { images, collections, settings } = useLibraryContext();
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
          onToggleFavorite={onToggleFavorite}
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

      {/* Add to Collection Modal (Simple Inline Implementation) */}
      <AnimatePresence>
        {modals.addToCollection && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]"
            onClick={() => close('addToCollection')}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 350, damping: 25 }}
              className="absolute bottom-20 left-1/2 -translate-x-1/2 w-64 bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl p-2 backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs font-bold text-gray-500 dark:text-gray-500 px-2 py-1 mb-1 uppercase tracking-wider">Select Collection</div>
              <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
                {collections.map(col => (
                  <button
                    key={col.id}
                    onClick={() => {
                      onAddImagesToCollection(Array.from(selectedIds), col.id);
                      close('addToCollection');
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-3 h-3 text-sage-600 dark:text-sage-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    {col.name}
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-200 dark:border-white/10 mt-2 pt-2">
                <button onClick={() => close('addToCollection')} className="w-full text-center text-xs text-gray-500 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 py-1 transition-colors">Cancel</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
