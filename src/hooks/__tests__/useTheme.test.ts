
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTheme } from '../useTheme';

describe('useTheme', () => {
    beforeEach(() => {
        document.documentElement.classList.remove('dark');
    });

    it('should add dark class when theme is dark', () => {
        renderHook(() => useTheme('dark', vi.fn()));
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('should remove dark class when theme is light', () => {
        document.documentElement.classList.add('dark');
        renderHook(() => useTheme('light', vi.fn()));
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('should toggle theme when toggleTheme is called', () => {
        const mockSetSettings = vi.fn();
        const { result } = renderHook(() => useTheme('light', mockSetSettings));

        act(() => {
            result.current.toggleTheme();
        });

        expect(mockSetSettings).toHaveBeenCalled();
        const updater = mockSetSettings.mock.calls[0][0];
        expect(updater({ theme: 'light' })).toEqual({ theme: 'dark' });
        expect(updater({ theme: 'dark' })).toEqual({ theme: 'light' });
    });
});
