
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useImageAI } from '../useImageAI';

// --- Mocks ---
const mockAnalyze = vi.fn().mockResolvedValue('Suggested prompt');
const mockVariations = vi.fn().mockResolvedValue(['Var 1', 'Var 2']);

vi.mock('../../services/geminiService', () => ({
    analyzePromptAndSuggest: (...args: any[]) => mockAnalyze(...args),
    generatePromptVariations: (...args: any[]) => mockVariations(...args),
}));

describe('useImageAI', () => {
    const mockOnOpenSettings = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should call analyzePromptAndSuggest when enabled and apiKey provided', async () => {
        const { result } = renderHook(() => useImageAI('key123', true));

        await act(async () => {
            await result.current.analyzePrompt('a cat', mockOnOpenSettings);
        });

        expect(mockAnalyze).toHaveBeenCalledWith('a cat', 'key123');
        expect(result.current.result).toBe('Suggested prompt');
        expect(result.current.modalOpen).toBe(true);
        expect(result.current.modalType).toBe('analysis');
    });

    it('should open settings if disabled or apiKey missing', async () => {
        const { result } = renderHook(() => useImageAI(undefined, true));

        await act(async () => {
            await result.current.analyzePrompt('a cat', mockOnOpenSettings);
        });

        expect(mockOnOpenSettings).toHaveBeenCalled();
        expect(mockAnalyze).not.toHaveBeenCalled();
    });

    it('should handle variations correctly', async () => {
        const { result } = renderHook(() => useImageAI('key123', true));

        await act(async () => {
            await result.current.generateVariations('a cat', mockOnOpenSettings);
        });

        expect(mockVariations).toHaveBeenCalledWith('a cat', 'key123');
        expect(result.current.result).toEqual(['Var 1', 'Var 2']);
        expect(result.current.modalType).toBe('variations');
    });

    it('should handle loading state', async () => {
        let resolvePromise: (val: string) => void;
        mockAnalyze.mockReturnValue(new Promise(resolve => { resolvePromise = resolve; }));

        const { result } = renderHook(() => useImageAI('key123', true));

        act(() => {
            result.current.analyzePrompt('a cat', mockOnOpenSettings);
        });

        expect(result.current.isAnalyzing).toBe(true);

        await act(async () => {
            resolvePromise!('done');
        });

        expect(result.current.isAnalyzing).toBe(false);
    });
});
