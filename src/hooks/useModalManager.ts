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
    | 'commandPalette'
    | 'collectionEditor';

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
        commandPalette: false,
        collectionEditor: false
    });

    const [pendingViewerDeleteId, setPendingViewerDeleteId] = useState<string | null>(null);
    const [collectionToDelete, setCollectionToDelete] = useState<string | null>(null);
    const [initialSettingsTab, setInitialSettingsTab] = useState<'general' | 'experiments' | 'intelligence' | 'invokeai' | 'comfyui' | 'a1111' | 'folders' | 'dev'>('general');
    const [shortcutsModalTab, setShortcutsModalTab] = useState<'shortcuts' | 'search'>('shortcuts');
    const [slideshowShuffle, setSlideshowShuffle] = useState(false);
    const [isPinnedShelfCollapsed, setIsPinnedShelfCollapsed] = useState(true);
    const [addToCollectionMode, setAddToCollectionMode] = useState<'add' | 'move'>('add');
    const [sourceCollectionId, setSourceCollectionId] = useState<string | null>(null);
    const [collectionToEditId, setCollectionToEditId] = useState<string | null>(null);

    const openModal = (key: ModalKey) => setModals(p => ({ ...p, [key]: true }));
    const closeModal = (key: ModalKey) => setModals(p => ({ ...p, [key]: false }));
    const closeAllModals = () => setModals({
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
        commandPalette: false,
        collectionEditor: false
    });

    const isAnyModalOpen = Object.values(modals).some(v => v);

    return {
        modals,
        setModals,
        openModal,
        closeModal,
        closeAllModals,
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
        setIsPinnedShelfCollapsed,
        addToCollectionMode,
        setAddToCollectionMode,
        sourceCollectionId,
        setSourceCollectionId,
        collectionToEditId,
        setCollectionToEditId
    };
};
