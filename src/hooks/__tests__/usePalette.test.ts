
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { usePalette } from '../usePalette';

describe('usePalette', () => {
    it('should initialize in loading state and eventually return a palette', async () => {
        const { result } = renderHook(() => usePalette('test.jpg'));

        expect(result.current.isLoading).toBe(true);

        await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 1000 });

        expect(result.current.palette).toBeInstanceOf(Array);
        expect(result.current.palette.length).toBeLessThanOrEqual(5);
    });

    it('should handle image error gracefully', async () => {
        const { result } = renderHook(() => usePalette('broken.jpg'));

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.palette).toEqual([]);
    });
});
