import { useState } from 'react';

export type ModalKey =
    | 'settings'
    | 'addToCollection'
    | 'deleteConfirm'
    | 'deleteCollection'
    | 'rename'
    | 'compare'
    | 'shortcuts'
    | 'recovery'
    | 'slideshow'
    | 'donation'
    | 'export'
    | 'commandPalette';

export const useModalManager = () => {
    const [modals, setModals] = useState<Record<ModalKey, boolean>>({
        settings: false,
        addToCollection: false,
        deleteConfirm: false,
        deleteCollection: false,
        rename: false,
        compare: false,
        shortcuts: false,
        recovery: false,
        slideshow: false,
        donation: false,
        export: false,
        commandPalette: false
    });

    const [pendingViewerDeleteId, setPendingViewerDeleteId] = useState<string | null>(null);
    const [collectionToDelete, setCollectionToDelete] = useState<string | null>(null);
    const [initialSettingsTab, setInitialSettingsTab] = useState<'general' | 'experiments'>('general');
    const [shortcutsModalTab, setShortcutsModalTab] = useState<'shortcuts' | 'search'>('shortcuts');
    const [slideshowShuffle, setSlideshowShuffle] = useState(false);
    const [isPinnedShelfCollapsed, setIsPinnedShelfCollapsed] = useState(true);

    const openModal = (key: ModalKey) => setModals(p => ({ ...p, [key]: true }));
    const closeModal = (key: ModalKey) => setModals(p => ({ ...p, [key]: false }));

    const isAnyModalOpen = Object.values(modals).some(v => v);

    return {
        modals,
        setModals,
        openModal,
        closeModal,
        isAnyModalOpen,
        pendingViewerDeleteId,
        setPendingViewerDeleteId,
        collectionToDelete,
        setCollectionToDelete,
        initialSettingsTab,
        setInitialSettingsTab,
        shortcutsModalTab,
        setShortcutsModalTab,
        slideshowShuffle,
        setSlideshowShuffle,
        isPinnedShelfCollapsed,
        setIsPinnedShelfCollapsed
    };
};
