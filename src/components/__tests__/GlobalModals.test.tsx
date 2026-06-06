import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../../test/testUtils';
import { GlobalModals } from '../GlobalModals';

vi.mock('../../features/settings/components/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('../../features/library/components/ExportModal', () => ({ ExportModal: () => null }));
vi.mock('../../features/viewer/components/SlideshowModal', () => ({ SlideshowModal: () => null }));
vi.mock('../../features/library/components/MetadataRecoveryModal', () => ({ MetadataRecoveryModal: () => null }));
vi.mock('../../features/collections/components/AddToCollectionModal', () => ({ AddToCollectionModal: () => null }));
vi.mock('../ui/CommandPalette', () => ({ CommandPalette: () => null }));
vi.mock('../ui/ShortcutsModal', () => ({ ShortcutsModal: () => null }));
vi.mock('../../features/viewer/components/CompareModal', () => ({ CompareModal: () => null }));
vi.mock('../ui/DonationModal', () => ({ DonationModal: () => null }));
vi.mock('../../features/collections/components/CollectionEditorModal', () => ({ CollectionEditorModal: () => null }));

describe('GlobalModals', () => {
    it('describes delete confirmation as remove-from-library behavior', () => {
        render(
            <GlobalModals
                modals={{
                    settings: false,
                    export: false,
                    deleteConfirm: true,
                    deleteCollection: false,
                    compare: false,
                    shortcuts: false,
                    recovery: false,
                    slideshow: false,
                    donation: false,
                    commandPalette: false,
                    addToCollection: false,
                    collectionEditor: false
                }}
                setModals={vi.fn()}
                selectedIds={new Set(['img-1'])}
                filteredImages={[]}
                canCheckForUpdates={false}
                onSettingsSave={vi.fn()}
                onExportConfirm={vi.fn()}
                onDeleteConfirm={vi.fn()}
                onDeleteCollectionConfirm={vi.fn()}
                onRecoverMetadata={vi.fn()}
                onCollectionAction={vi.fn()}
                onCloseExport={vi.fn()}
                exportIds={new Set()}
                pendingViewerDeleteId={'img-1'}
                collectionToDeleteId={null}
                addToCollectionMode="add"
                sourceCollectionId={null}
                isRecoveringMetadata={false}
                isExporting={false}
                slideshowShuffle={false}
                initialSettingsTab="general"
                shortcutsModalTab="shortcuts"
                commandPaletteProps={{
                    onNavigate: vi.fn(),
                    onToggleTheme: vi.fn(),
                    onOpenSettings: vi.fn(),
                    onImport: vi.fn(),
                    onCreateCollection: vi.fn(),
                    onToggleAI: vi.fn(),
                    settings: {} as any
                }}
                collections={[]}
                smartCollections={[]}
                toggleFavorite={vi.fn()}
                settings={{} as any}
                hasPendingUpdate={false}
                pendingUpdateVersion={null}
                updateErrorMessage={null}
                updateStatus={'idle' as any}
                onCheckForUpdates={vi.fn()}
                onOpenUpdatePrompt={vi.fn()}
                onNavigateToMaintenance={vi.fn()}
            />
        );

        expect(screen.getByText('Remove from Library?')).toBeTruthy();
        expect(screen.getByText(/keeping the original file/i)).toBeTruthy();
        expect(screen.getByText(/Maintenance > Removed/i)).toBeTruthy();
    });
});
