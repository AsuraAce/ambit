import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    analyzePromptAndSuggest,
    generateFiltersFromQuery,
    generatePromptVariations,
    generateTitleFromPrompt,
    getGeminiThinkingConfig,
    recoverImageMetadata,
    verifyApiKey,
} from '../geminiService';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
    class MockGoogleGenAI {
        models = {
            generateContent: mockGenerateContent
        };
    }
    return {
        GoogleGenAI: MockGoogleGenAI,
        Type: {
            OBJECT: 'OBJECT',
            STRING: 'STRING',
            ARRAY: 'ARRAY',
            NUMBER: 'NUMBER',
            BOOLEAN: 'BOOLEAN',
        },
        ThinkingLevel: {
            MINIMAL: 'MINIMAL',
            LOW: 'LOW',
            MEDIUM: 'MEDIUM',
            HIGH: 'HIGH',
        },
    };
});

describe('geminiService: verifyApiKey', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return valid: true on successful API call', async () => {
        mockGenerateContent.mockResolvedValue({ text: 'pong' });

        const result = await verifyApiKey('valid-key');

        expect(result.valid).toBe(true);
        // Verify we are calling with the default model
        expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gemini-3.1-flash-lite'
        }));
    });

    it('should use a custom model if provided', async () => {
        mockGenerateContent.mockResolvedValue({ text: 'pong' });

        const result = await verifyApiKey('valid-key', 'gemini-2.0-pro-exp');

        expect(result.valid).toBe(true);
        expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gemini-2.0-pro-exp'
        }));
    });

    it('should return valid: false and error message on invalid key', async () => {
        mockGenerateContent.mockRejectedValue(new Error('API_KEY_INVALID'));

        const result = await verifyApiKey('invalid-key');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Invalid API Key');
    });

    it('should handle quota exceeded errors', async () => {
        mockGenerateContent.mockRejectedValue(new Error('Your quota has been exceeded'));

        const result = await verifyApiKey('quota-key');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Quota exceeded');
    });

    it('should handle network errors', async () => {
        mockGenerateContent.mockRejectedValue(new Error('Failed to fetch (network error)'));

        const result = await verifyApiKey('network-key');

        expect(result.valid).toBe(false);
        expect(result.error).toBe('Network error');
    });

    it('should return error for empty key', async () => {
        const result = await verifyApiKey('');
        expect(result.valid).toBe(false);
        expect(result.error).toBe('API Key is required');
    });
});

describe('geminiService: thinking configuration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('maps Gemini 3 effort levels to thinkingLevel', () => {
        expect(getGeminiThinkingConfig('gemini-3.5-flash', 'minimal')).toEqual({
            thinkingLevel: 'MINIMAL',
        });
        expect(getGeminiThinkingConfig('gemini-3.1-pro-preview', 'high')).toEqual({
            thinkingLevel: 'HIGH',
        });
    });

    it('maps supported Gemini 2.5 presets to thinkingBudget', () => {
        expect(getGeminiThinkingConfig('gemini-2.5-flash', 'off')).toEqual({
            thinkingBudget: 0,
        });
        expect(getGeminiThinkingConfig('gemini-2.5-flash-lite', 'dynamic')).toEqual({
            thinkingBudget: -1,
        });
    });

    it('omits default and incompatible thinking overrides', () => {
        expect(getGeminiThinkingConfig('gemini-3.5-flash', 'default')).toBeUndefined();
        expect(getGeminiThinkingConfig('gemini-3.1-pro-preview', 'minimal')).toBeUndefined();
        expect(getGeminiThinkingConfig('gemini-2.5-pro', 'off')).toBeUndefined();
    });

    it('applies Gemini 3 thinking effort to every Ambit AI workflow', async () => {
        mockGenerateContent
            .mockResolvedValueOnce({ text: 'analysis' })
            .mockResolvedValueOnce({ text: '["variation"]' })
            .mockResolvedValueOnce({ text: 'Title' })
            .mockResolvedValueOnce({ text: '{}' })
            .mockResolvedValueOnce({ text: '{"positivePrompt":"recovered"}' });

        await analyzePromptAndSuggest('prompt', 'key', 'gemini-3.5-flash', undefined, 'low');
        await generatePromptVariations('prompt', 'key', 'gemini-3.5-flash', undefined, 'low');
        await generateTitleFromPrompt('prompt', 'key', 'gemini-3.5-flash', undefined, 'low');
        await generateFiltersFromQuery('query', 'key', 'gemini-3.5-flash', undefined, 'low');
        await recoverImageMetadata('data:image/png;base64,abc', 'generic', 'key', 'gemini-3.5-flash', undefined, 'low');

        expect(mockGenerateContent).toHaveBeenCalledTimes(5);
        for (const [request] of mockGenerateContent.mock.calls) {
            expect(request.config).toEqual(expect.objectContaining({
                thinkingConfig: { thinkingLevel: 'LOW' },
            }));
        }
    });
});

describe('geminiService: image recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('preserves the image MIME type when sending local image data to Gemini', async () => {
        mockGenerateContent.mockResolvedValue({ text: '{"positivePrompt":"recovered"}' });

        await recoverImageMetadata('data:image/jpeg;base64,abc', 'generic', 'key');

        expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
            contents: {
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data: 'abc' } },
                    expect.objectContaining({ text: expect.any(String) })
                ]
            }
        }));
    });
});
