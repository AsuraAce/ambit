
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useModalManager } from '../useModalManager';

describe('useModalManager', () => {
    it('should initialize with all modals closed', () => {
        const { result } = renderHook(() => useModalManager());
        expect(result.current.isAnyModalOpen).toBe(false);
        expect(result.current.modals.settings).toBe(false);
    });

    it('should open and close a specific modal', () => {
        const { result } = renderHook(() => useModalManager());

        act(() => {
            result.current.openModal('settings');
        });
        expect(result.current.modals.settings).toBe(true);
        expect(result.current.isAnyModalOpen).toBe(true);

        act(() => {
            result.current.closeModal('settings');
        });
        expect(result.current.modals.settings).toBe(false);
    });

    it('should handle pending state for deletes and collections', () => {
        const { result } = renderHook(() => useModalManager());

        act(() => {
            result.current.setPendingViewerDeleteId('img123');
            result.current.setAddToCollectionMode('move');
        });

        expect(result.current.pendingViewerDeleteId).toBe('img123');
        expect(result.current.addToCollectionMode).toBe('move');
    });

    it('should close all modals at once', () => {
        const { result } = renderHook(() => useModalManager());

        act(() => {
            result.current.openModal('settings');
            result.current.openModal('export');
        });
        expect(result.current.isAnyModalOpen).toBe(true);

        act(() => {
            result.current.closeAllModals();
        });
        expect(result.current.isAnyModalOpen).toBe(false);
    });
});
