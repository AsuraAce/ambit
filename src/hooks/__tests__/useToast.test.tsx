import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useToast } from '../useToast';
import { ToastContext } from '../../contexts/ToastContext';

describe('useToast', () => {
    it('should throw an error when used outside of a ToastProvider', () => {
        // Suppress console.error for this test as it's expected
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

        expect(() => renderHook(() => useToast())).toThrow('useToast must be used within a ToastProvider');

        consoleSpy.mockRestore();
    });

    it('should return the toast context when used within a ToastProvider', () => {
        const mockContextValue = {
            addToast: vi.fn(),
            removeToast: vi.fn(),
        };

        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <ToastContext.Provider value= { mockContextValue as any } >
            { children }
            </ToastContext.Provider>
    );

    const { result } = renderHook(() => useToast(), { wrapper });

    expect(result.current).toBe(mockContextValue);
});
});
