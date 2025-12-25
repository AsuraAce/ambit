
import * as React from 'react';
import { useEffect } from 'react';
import { AIImage, FilterState, ViewMode } from '../types';

interface GlobalShortcutsProps {
    viewMode: ViewMode;
    selectedIds: Set<string>;
    filteredImages: AIImage[];
    lastSelectedId: string | null;
    selectedImageIndex: number | null;
    gridRef: React.RefObject<any>;
    searchInputRef: React.RefObject<HTMLInputElement>;

    // Actions
    setSelectedImageIndex: (index: number | null) => void;
    setSelectedIds: (ids: Set<string>) => void;
    setLastSelectedId: (id: string | null) => void;
    clearSelection: () => void;
    handleDeleteViewerImage: (id: string) => void;
    handleBulkDelete: () => void;
    togglePrivacyMode: () => void;
    toggleMasking: () => void;
    toggleFavorite: () => void;
    togglePin: () => void;
    openRename: () => void;
    openCollection: () => void;

    // UI Toggles
    isModalOpen: boolean; // General check if any modal is open
    toggleShortcuts: () => void;
    toggleCommandPalette: () => void;
    onCloseViewer: () => void;
}

export const useGlobalShortcuts = ({
    viewMode,
    selectedIds,
    filteredImages,
    lastSelectedId,
    selectedImageIndex,
    gridRef,
    searchInputRef,
    setSelectedImageIndex,
    setSelectedIds,
    setLastSelectedId,
    clearSelection,
    handleDeleteViewerImage,
    handleBulkDelete,
    togglePrivacyMode,
    toggleMasking,
    toggleFavorite,
    togglePin,
    openRename,
    openCollection,
    isModalOpen,
    toggleShortcuts,
    toggleCommandPalette,
    onCloseViewer,
}: GlobalShortcutsProps) => {

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // 1. Input Guard: Don't trigger shortcuts when typing
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                if (e.key === 'Escape') (e.target as HTMLElement).blur();
                return;
            }

            // 2. Global Toggles (work even if modals are open, sometimes)
            if (e.key === '?') {
                toggleShortcuts();
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                toggleCommandPalette();
                return;
            }

            // Privacy Toggle (Shift + H)
            if (e.shiftKey && (e.key === 'H' || e.key === 'h')) {
                e.preventDefault();
                togglePrivacyMode();
                return;
            }

            // Masking (M)
            if (e.key === 'm' || e.key === 'M') {
                e.preventDefault();
                toggleMasking();
                return;
            }

            // 3. Modal Guard
            // If any modal is open, we generally block standard navigation/actions
            // Exception: Escape (to close modal logic handled by modal) or Enter (handled by modal)
            if (isModalOpen) {
                // We explicitly allow Escape to bubble or be handled, but block 'Delete', 'Space', 'Arrows'
                if (['Delete', 'Backspace', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'f'].includes(e.key)) {
                    return;
                }
                return;
            }

            // 4. Escape Handler (Priority: Viewer -> Selection)
            if (e.key === 'Escape') {
                if (selectedImageIndex !== null) {
                    onCloseViewer();
                } else if (selectedIds.size > 0) {
                    clearSelection();
                }
                return;
            }

            // 5. Viewer Navigation (Spacebar)
            if (e.key === ' ') {
                e.preventDefault();
                if (selectedImageIndex !== null) {
                    onCloseViewer();
                } else {
                    let targetId = lastSelectedId;
                    if (!targetId && selectedIds.size > 0) targetId = Array.from(selectedIds)[0];
                    if (targetId) {
                        const index = filteredImages.findIndex(img => img.id === targetId);
                        if (index !== -1) setSelectedImageIndex(index);
                    }
                }
                return;
            }

            // 6. Action Shortcuts
            if (e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                toggleFavorite();
                return;
            }

            if (e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                togglePin();
                return;
            }

            if (e.key === 'c' || e.key === 'C') {
                e.preventDefault();
                openCollection();
                return;
            }

            if (e.key === 'F2') {
                e.preventDefault();
                openRename();
                return;
            }

            // 7. Selection Shortcuts
            if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                e.preventDefault();
                // Prevent bleed into Maintenance Mode or Dashboard which have their own context
                if (viewMode === 'maintenance' || viewMode === 'dashboard') return;

                const allIds = filteredImages.map(img => img.id);
                setSelectedIds(new Set(allIds));
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                searchInputRef.current?.focus();
                return;
            }

            // 8. Delete Actions
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedImageIndex !== null) {
                    if (filteredImages[selectedImageIndex]) {
                        handleDeleteViewerImage(filteredImages[selectedImageIndex].id);
                    }
                } else if (selectedIds.size > 0) {
                    handleBulkDelete();
                }
                return;
            }

            // 9. Grid Navigation (Arrow Keys)
            if (viewMode === 'grid' && selectedImageIndex === null && gridRef.current) {
                const isArrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key);
                if (isArrow || e.key === 'Enter') {
                    let activeIndex = -1;
                    if (lastSelectedId) activeIndex = filteredImages.findIndex(img => img.id === lastSelectedId);
                    else if (selectedIds.size > 0) activeIndex = filteredImages.findIndex(img => selectedIds.has(img.id));

                    if (e.key === 'Enter') {
                        if (activeIndex !== -1) {
                            e.preventDefault();
                            setSelectedImageIndex(activeIndex);
                        }
                        return;
                    }

                    e.preventDefault();

                    // If nothing selected, select first
                    if (activeIndex === -1 && filteredImages.length > 0) {
                        const firstId = filteredImages[0].id;
                        setSelectedIds(new Set([firstId]));
                        setLastSelectedId(firstId);
                        gridRef.current.scrollToItem(0);
                        return;
                    }

                    // Calculate next index via Grid Logic
                    const nextIndex = gridRef.current.navigate(activeIndex, e.key);
                    if (nextIndex !== undefined && nextIndex !== -1 && nextIndex !== activeIndex) {
                        const newId = filteredImages[nextIndex].id;
                        setSelectedIds(new Set([newId]));
                        setLastSelectedId(newId);
                        gridRef.current.scrollToItem(nextIndex);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [
        filteredImages,
        selectedIds,
        viewMode,
        selectedImageIndex,
        lastSelectedId,
        isModalOpen,
        toggleShortcuts,
        toggleCommandPalette,
        handleDeleteViewerImage,
        handleBulkDelete,
        togglePrivacyMode,
        toggleMasking,
        toggleFavorite,
        togglePin,
        openRename,
        openCollection
    ]);
};
