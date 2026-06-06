import { describe, expect, it } from 'vitest';
import {
    AI_MODELS,
    DEFAULT_AI_MODEL,
    getSupportedThinkingModes,
    normalizeAiThinkingMode,
} from '../aiModels';

describe('AI model constants', () => {
    it('keeps the production default in the selectable model list', () => {
        expect(DEFAULT_AI_MODEL).toBe('gemini-3.1-flash-lite');
        expect(AI_MODELS.some(model => model.id === DEFAULT_AI_MODEL)).toBe(true);
    });

    it('offers current Gemini 3 models and legacy 2.5 fallbacks', () => {
        const modelIds = AI_MODELS.map(model => model.id);

        expect(modelIds).toContain('gemini-3.1-flash-lite');
        expect(modelIds).toContain('gemini-3.5-flash');
        expect(modelIds).toContain('gemini-3.1-pro-preview');
        expect(modelIds).toContain('gemini-2.5-pro');
        expect(modelIds).toContain('gemini-2.5-flash');
        expect(modelIds).toContain('gemini-2.5-flash-lite');
        expect(AI_MODELS.filter(model => model.id.startsWith('gemini-2.5')).every(model => model.isLegacy)).toBe(true);
    });

    it('does not offer superseded Gemini 3 preview ids', () => {
        const modelIds = AI_MODELS.map(model => model.id);

        expect(modelIds).not.toContain('gemini-3-flash-preview');
        expect(modelIds).not.toContain('gemini-3-pro-preview');
    });

    it('normalizes thinking modes against model capabilities', () => {
        expect(getSupportedThinkingModes('gemini-3.5-flash')).toEqual([
            'default',
            'minimal',
            'low',
            'medium',
            'high',
        ]);
        expect(getSupportedThinkingModes('gemini-3.1-pro-preview')).not.toContain('minimal');
        expect(getSupportedThinkingModes('gemini-2.5-flash')).toEqual(['default', 'off', 'dynamic']);
        expect(getSupportedThinkingModes('gemini-2.5-pro')).toEqual(['default']);
        expect(normalizeAiThinkingMode('gemini-3.1-pro-preview', 'minimal')).toBe('default');
    });
});
