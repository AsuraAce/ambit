import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_MODEL, DEFAULT_AI_THINKING_MODE } from '../../constants/aiModels';
import {
    areDeveloperFeaturesEnabled,
    getEffectiveAiModel,
    getEffectiveAiThinkingMode,
    getEffectiveSystemPrompts,
} from '../settingsUtils';
import type { AppSettings } from '../../types';

const createAiSettings = (): Pick<AppSettings, 'aiModel' | 'aiThinkingMode' | 'devMode' | 'systemPrompts'> => ({
    aiModel: 'gemini-3.5-flash',
    aiThinkingMode: 'low',
    devMode: true,
    systemPrompts: {
        analyze: 'custom prompt',
    },
});

describe('settingsUtils', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('disables developer features in production even when persisted devMode is true', () => {
        vi.stubEnv('DEV', false);

        expect(areDeveloperFeaturesEnabled({ devMode: true })).toBe(false);
    });

    it('honors settings.devMode in dev builds', () => {
        vi.stubEnv('DEV', true);

        expect(areDeveloperFeaturesEnabled({ devMode: true })).toBe(true);
        expect(areDeveloperFeaturesEnabled({ devMode: false })).toBe(false);
    });

    it('uses default AI config in production despite persisted overrides', () => {
        vi.stubEnv('DEV', false);
        const settings = createAiSettings();

        expect(getEffectiveAiModel(settings)).toBe(DEFAULT_AI_MODEL);
        expect(getEffectiveAiThinkingMode(settings)).toBe(DEFAULT_AI_THINKING_MODE);
        expect(getEffectiveSystemPrompts(settings)).toBeUndefined();
    });

    it('honors a known persisted AI model in developer mode', () => {
        vi.stubEnv('DEV', true);
        const settings = createAiSettings();

        expect(getEffectiveAiModel(settings)).toBe('gemini-3.5-flash');
        expect(getEffectiveAiThinkingMode(settings)).toBe('low');
        expect(getEffectiveSystemPrompts(settings)).toEqual({ analyze: 'custom prompt' });
    });

    it('falls back to the default model for stale developer model ids', () => {
        vi.stubEnv('DEV', true);
        const settings = {
            ...createAiSettings(),
            aiModel: 'gemini-3-pro-preview',
        };

        expect(getEffectiveAiModel(settings)).toBe(DEFAULT_AI_MODEL);
    });

    it('normalizes an incompatible developer thinking mode to default', () => {
        vi.stubEnv('DEV', true);
        const settings = {
            ...createAiSettings(),
            aiModel: 'gemini-3.1-pro-preview',
            aiThinkingMode: 'minimal' as const,
        };

        expect(getEffectiveAiThinkingMode(settings)).toBe(DEFAULT_AI_THINKING_MODE);
    });
});
