import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyApiKey } from '../geminiService';
import { GoogleGenAI } from '@google/genai';

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
        }
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
        // Verify we are calling with the correct model
        expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gemini-2.5-flash'
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
