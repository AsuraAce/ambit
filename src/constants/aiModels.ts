
import type { AiThinkingMode } from '../types';

export interface AIModel {
    id: string;
    name: string;
    description: string;
    isExperimental?: boolean;
    isLegacy?: boolean;
    thinkingModes: readonly AiThinkingMode[];
}

const GEMINI_3_FLASH_THINKING_MODES = ['default', 'minimal', 'low', 'medium', 'high'] as const;
const GEMINI_3_PRO_THINKING_MODES = ['default', 'low', 'medium', 'high'] as const;
const GEMINI_2_5_FLASH_THINKING_MODES = ['default', 'off', 'dynamic'] as const;
const MODEL_DEFAULT_ONLY = ['default'] as const;

export const AI_MODELS: AIModel[] = [
    {
        id: 'gemini-3.1-flash-lite',
        name: 'Gemini 3.1 Flash-Lite',
        description: 'Stable, low-latency default for high-volume and structured tasks.',
        thinkingModes: GEMINI_3_FLASH_THINKING_MODES
    },
    {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        description: 'Stable quality upgrade for richer analysis and multimodal understanding.',
        thinkingModes: GEMINI_3_FLASH_THINKING_MODES
    },
    {
        id: 'gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro Preview',
        description: 'Preview model for the highest-quality complex reasoning comparisons.',
        isExperimental: true,
        thinkingModes: GEMINI_3_PRO_THINKING_MODES
    },
    {
        id: 'gemini-2.5-pro',
        name: 'Gemini 2.5 Pro',
        description: 'Legacy fallback scheduled for shutdown October 16, 2026.',
        isLegacy: true,
        thinkingModes: MODEL_DEFAULT_ONLY
    },
    {
        id: 'gemini-2.5-flash',
        name: 'Gemini 2.5 Flash',
        description: 'Legacy fallback scheduled for shutdown October 16, 2026.',
        isLegacy: true,
        thinkingModes: GEMINI_2_5_FLASH_THINKING_MODES
    },
    {
        id: 'gemini-2.5-flash-lite',
        name: 'Gemini 2.5 Flash-Lite',
        description: 'Legacy fallback scheduled for shutdown October 16, 2026.',
        isLegacy: true,
        thinkingModes: GEMINI_2_5_FLASH_THINKING_MODES
    }
];

export const DEFAULT_AI_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_AI_THINKING_MODE: AiThinkingMode = 'default';

export const getAiModel = (modelId: string): AIModel | undefined =>
    AI_MODELS.find(model => model.id === modelId);

export const getSupportedThinkingModes = (modelId: string): readonly AiThinkingMode[] =>
    getAiModel(modelId)?.thinkingModes ?? [DEFAULT_AI_THINKING_MODE];

export const normalizeAiThinkingMode = (
    modelId: string,
    thinkingMode: AiThinkingMode | undefined
): AiThinkingMode => {
    const mode = thinkingMode ?? DEFAULT_AI_THINKING_MODE;
    return getSupportedThinkingModes(modelId).includes(mode)
        ? mode
        : DEFAULT_AI_THINKING_MODE;
};
