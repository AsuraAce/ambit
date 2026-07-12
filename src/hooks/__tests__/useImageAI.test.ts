
import { renderHook, act, waitFor } from '../../test/testUtils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useImageAI } from '../useImageAI';

// --- Mocks ---
const mockAnalyze = vi.fn().mockResolvedValue('Suggested prompt');
const mockVariations = vi.fn().mockResolvedValue(['Var 1', 'Var 2']);

vi.mock('../../services/geminiService', () => ({
    analyzePromptAndSuggest: (...args: unknown[]) => mockAnalyze(...args),
    generatePromptVariations: (...args: unknown[]) => mockVariations(...args),
}));

// Mock useSettingsStore
const mockGetState = vi.fn().mockReturnValue({ geminiApiKey: 'key123' });
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: Object.assign(vi.fn(), {
        getState: () => mockGetState()
    })
}));

describe('useImageAI', () => {
    const mockOnOpenSettings = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetState.mockReturnValue({ geminiApiKey: 'key123' });
    });

    it('should call analyzePromptAndSuggest when enabled and apiKey provided via store', async () => {
        const { result } = renderHook(() => useImageAI({ enableAI: true }));

        await act(async () => {
            await result.current.analyzePrompt('a cat', mockOnOpenSettings);
        });

        expect(mockAnalyze).toHaveBeenCalledWith('a cat', 'key123', undefined, undefined, undefined);
        expect(result.current.result).toBe('Suggested prompt');
        expect(result.current.modalOpen).toBe(true);
        expect(result.current.modalType).toBe('analysis');
    });

    it('should open settings if disabled or apiKey missing', async () => {
        mockGetState.mockReturnValue({ geminiApiKey: null });

        const { result } = renderHook(() => useImageAI({ enableAI: true }));

        await act(async () => {
            await result.current.analyzePrompt('a cat', mockOnOpenSettings);
        });

        expect(mockOnOpenSettings).toHaveBeenCalled();
        expect(mockAnalyze).not.toHaveBeenCalled();
    });

    it('should handle variations correctly', async () => {
        const { result } = renderHook(() => useImageAI({ enableAI: true }));

        await act(async () => {
            await result.current.generateVariations('a cat', mockOnOpenSettings);
        });

        expect(mockVariations).toHaveBeenCalledWith('a cat', 'key123', undefined, undefined, undefined);
        expect(result.current.result).toEqual(['Var 1', 'Var 2']);
        expect(result.current.modalType).toBe('variations');
    });

    it('forwards the effective thinking mode to image AI requests', async () => {
        const { result } = renderHook(() => useImageAI({
            enableAI: true,
            aiModel: 'gemini-3.5-flash',
            aiThinkingMode: 'low',
        }));

        await act(async () => {
            await result.current.analyzePrompt('a cat', mockOnOpenSettings);
        });

        expect(mockAnalyze).toHaveBeenCalledWith(
            'a cat',
            'key123',
            'gemini-3.5-flash',
            undefined,
            'low'
        );
    });

    it('should handle loading state', async () => {
        let resolvePromise: (val: string) => void;
        mockAnalyze.mockReturnValue(new Promise(resolve => { resolvePromise = resolve; }));

        const { result } = renderHook(() => useImageAI({ enableAI: true }));

        act(() => {
            result.current.analyzePrompt('a cat', mockOnOpenSettings);
        });

        expect(result.current.isAnalyzing).toBe(true);

        await act(async () => {
            resolvePromise!('done');
        });

        expect(result.current.isAnalyzing).toBe(false);
    });

    it('opens settings when AI is disabled even when a key exists', async () => {
        const { result } = renderHook(() => useImageAI({ enableAI: false }));

        await act(async () => result.current.analyzePrompt('a cat', mockOnOpenSettings));

        expect(mockOnOpenSettings).toHaveBeenCalled();
        expect(mockAnalyze).not.toHaveBeenCalled();
    });

    it('opens settings before generating variations when a key is missing', async () => {
        mockGetState.mockReturnValue({ geminiApiKey: null });
        const { result } = renderHook(() => useImageAI({ enableAI: true }));

        await act(async () => result.current.generateVariations('a cat', mockOnOpenSettings));

        expect(mockOnOpenSettings).toHaveBeenCalled();
        expect(mockVariations).not.toHaveBeenCalled();
    });

    it.each([
        ['quota depleted', 'AI quota exceeded. Please try again later.'],
        ['resource exhausted', 'AI quota exceeded. Please try again later.'],
        ['status 429', 'AI quota exceeded. Please try again later.'],
        ['rate limited', 'Too many requests. Please wait a moment.'],
        ['too many requests', 'Too many requests. Please wait a moment.'],
        ['no api key configured', 'API key is missing. Add it in Settings > Experiments.'],
        ['credential missing', 'API key is missing. Add it in Settings > Experiments.'],
        ['bad api key', 'Invalid API key. Check your settings.'],
        ['invalid credential', 'Invalid API key. Check your settings.'],
        ['status 401', 'Invalid API key. Check your settings.'],
        ['status 403', 'Invalid API key. Check your settings.'],
        ['network unavailable', 'Network error. Check your connection.'],
        ['fetch rejected', 'Network error. Check your connection.'],
        ['unexpected failure', 'AI request failed. Please try again.']
    ])('maps analysis error %s to a useful message', async (message, expected) => {
        const onError = vi.fn();
        mockAnalyze.mockRejectedValueOnce(new Error(message));
        const { result } = renderHook(() => useImageAI({ enableAI: true, onError }));

        await act(async () => result.current.analyzePrompt('a cat', mockOnOpenSettings));

        expect(onError).toHaveBeenCalledWith(expected);
        expect(result.current.isAnalyzing).toBe(false);
        expect(result.current.modalOpen).toBe(false);
    });

    it('stringifies non-Error failures and tolerates an omitted error callback', async () => {
        mockAnalyze.mockRejectedValueOnce('network unavailable');
        const onError = vi.fn();
        const first = renderHook(() => useImageAI({ enableAI: true, onError }));
        await act(async () => first.result.current.analyzePrompt('a cat', mockOnOpenSettings));
        expect(onError).toHaveBeenCalledWith('Network error. Check your connection.');
        first.unmount();

        mockAnalyze.mockRejectedValueOnce(new Error('unknown'));
        const second = renderHook(() => useImageAI({ enableAI: true }));
        await act(async () => second.result.current.analyzePrompt('a cat', mockOnOpenSettings));
        expect(second.result.current.isAnalyzing).toBe(false);
    });

    it('reports variation failures and resets their loading state', async () => {
        const onError = vi.fn();
        mockVariations.mockRejectedValueOnce(new Error('too many requests'));
        const { result } = renderHook(() => useImageAI({ enableAI: true, onError }));

        await act(async () => result.current.generateVariations('a cat', mockOnOpenSettings));

        expect(onError).toHaveBeenCalledWith('Too many requests. Please wait a moment.');
        expect(result.current.isAnalyzing).toBe(false);
    });

    it('closes and reopens a populated modal but does not open an empty modal', async () => {
        const empty = renderHook(() => useImageAI({ enableAI: true }));
        act(() => empty.result.current.openModal());
        expect(empty.result.current.modalOpen).toBe(false);
        empty.unmount();

        const populated = renderHook(() => useImageAI({ enableAI: true }));
        await act(async () => populated.result.current.analyzePrompt('a cat', mockOnOpenSettings));
        act(() => populated.result.current.closeModal());
        expect(populated.result.current.modalOpen).toBe(false);
        act(() => populated.result.current.openModal());
        expect(populated.result.current.modalOpen).toBe(true);
    });
});
