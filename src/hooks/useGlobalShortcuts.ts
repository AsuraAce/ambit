
import * as React from 'react';
import { useEffect } from 'react';
import { AIImage, ViewMode } from '../types';
import type { VirtualGridHandle } from '../features/library/components/VirtualGrid';

interface GlobalShortcutsProps {
    viewMode: ViewMode;
    selectedIds: Set<string>;
    filteredImages: AIImage[];
    lastSelectedId: string | null;
    isViewerOpen: boolean;
    gridRef: React.RefObject<VirtualGridHandle | null>;
    searchInputRef: React.RefObject<HTMLInputElement | null>;

    // Actions
    setSelectedImageIndex: (index: number | null) => void;
    setSelectedIds: (ids: Set<string>) => void;
    setLastSelectedId: (id: string | null) => void;
    clearSelection: () => void;
    handleBulkDelete: () => void;
    togglePrivacyMode: () => void;
    toggleMasking: () => void;
    toggleFavorite: () => void;
    togglePin: () => void;
    openCollection: () => void;
    openSettings: () => void;
    openImport: () => void;

    // UI Toggles
    isModalOpen: boolean; // General check if any modal is open
    closeAllModals: () => void;
    toggleShortcuts: () => void;
    toggleCommandPalette: () => void;
}

export const useGlobalShortcuts = ({
    viewMode,
    selectedIds,
    filteredImages,
    lastSelectedId,
    isViewerOpen,
    gridRef,
    searchInputRef,
    setSelectedImageIndex,
    setSelectedIds,
    setLastSelectedId,
    clearSelection,
    handleBulkDelete,
    togglePrivacyMode,
    toggleMasking,
    toggleFavorite,
    togglePin,
    openCollection,
    openSettings,
    openImport,
    isModalOpen,
    closeAllModals,
    toggleShortcuts,
    toggleCommandPalette,
}: GlobalShortcutsProps) => {

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // 1. Input Guard: Don't trigger shortcuts when typing
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                if (e.key === 'Escape') (e.target as HTMLElement).blur();
                return;
            }

            const key = e.key.toLowerCase();
            const hasPrimaryModifier = e.ctrlKey || e.metaKey;

            // 2. Global Toggles (work even if modals are open, sometimes)
            if (e.key === '?') {
                toggleShortcuts();
                return;
            }

            if (hasPrimaryModifier && key === 'k') {
                e.preventDefault();
                toggleCommandPalette();
                return;
            }

            // Privacy Toggle (Shift + H)
            if (e.shiftKey && key === 'h') {
                e.preventDefault();
                togglePrivacyMode();
                return;
            }

            // 3. Modal Guard
            // If any modal is open, we generally block standard navigation/actions
            // Exception: Escape (to close modal logic handled by modal) or Enter (handled by modal)
            if (isModalOpen) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeAllModals();
                    return;
                }
                return;
            }

            // Active viewers own all contextual shortcuts.
            if (isViewerOpen) return;

            if (hasPrimaryModifier && key === ',') {
                e.preventDefault();
                openSettings();
                return;
            }

            if (hasPrimaryModifier && key === 'o') {
                e.preventDefault();
                openImport();
                return;
            }

            // 4. Escape Handler
            if (e.key === 'Escape') {
                if (selectedIds.size > 0) {
                    clearSelection();
                }
                return;
            }

            // 5. Open Quick View (Spacebar)
            if (e.key === ' ') {
                e.preventDefault();
                let targetId = lastSelectedId;
                if (!targetId && selectedIds.size > 0) targetId = Array.from(selectedIds)[0];
                if (targetId) {
                    const index = filteredImages.findIndex(img => img.id === targetId);
                    if (index !== -1) setSelectedImageIndex(index);
                }
                return;
            }

            // 6. Action Shortcuts
            if (hasPrimaryModifier && key === 'f') {
                e.preventDefault();
                searchInputRef.current?.focus();
                return;
            }

            if (key === 'f') {
                e.preventDefault();
                toggleFavorite();
                return;
            }

            if (key === 'p') {
                e.preventDefault();
                togglePin();
                return;
            }

            if (key === 'm') {
                e.preventDefault();
                toggleMasking();
                return;
            }

            if (!hasPrimaryModifier && !e.altKey && key === 'c') {
                e.preventDefault();
                openCollection();
                return;
            }



            // 7. Selection Shortcuts
            if (hasPrimaryModifier && key === 'a') {
                e.preventDefault();
                // Prevent bleed into Maintenance Mode or Dashboard which have their own context
                if (viewMode === 'maintenance' || viewMode === 'dashboard') return;

                const allIds = filteredImages.map(img => img.id);
                setSelectedIds(new Set(allIds));
                return;
            }

            // 8. Delete Actions
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedIds.size > 0) handleBulkDelete();
                return;
            }

            // 9. Grid Navigation (Arrow Keys)
            if (viewMode === 'grid' && gridRef.current) {
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
        isViewerOpen,
        lastSelectedId,
        isModalOpen,
        setSelectedImageIndex,
        setSelectedIds,
        setLastSelectedId,
        clearSelection,
        toggleShortcuts,
        toggleCommandPalette,
        handleBulkDelete,
        togglePrivacyMode,
        toggleMasking,
        toggleFavorite,
        togglePin,
        openCollection,
        openSettings,
        openImport,
        closeAllModals
    ]);
};
