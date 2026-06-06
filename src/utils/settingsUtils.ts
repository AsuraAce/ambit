import {
  AI_MODELS,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_THINKING_MODE,
  normalizeAiThinkingMode,
} from '../constants/aiModels';
import type { AiThinkingMode, AppSettings } from '../types';

type DeveloperSettings = Pick<AppSettings, 'devMode'>;
type AiSettings = Pick<AppSettings, 'aiModel' | 'aiThinkingMode' | 'devMode' | 'systemPrompts'>;

export const isDevelopmentBuild = (): boolean => Boolean(import.meta.env.DEV);

export const areDeveloperFeaturesEnabled = (
  settings: DeveloperSettings
): boolean => isDevelopmentBuild() && settings.devMode === true;

const isKnownAiModel = (modelId: string | undefined): modelId is string =>
  Boolean(modelId && AI_MODELS.some(model => model.id === modelId));

export const getEffectiveAiModel = (settings: AiSettings): string =>
  areDeveloperFeaturesEnabled(settings) && isKnownAiModel(settings.aiModel)
    ? settings.aiModel
    : DEFAULT_AI_MODEL;

export const getEffectiveAiThinkingMode = (settings: AiSettings): AiThinkingMode =>
  areDeveloperFeaturesEnabled(settings)
    ? normalizeAiThinkingMode(getEffectiveAiModel(settings), settings.aiThinkingMode)
    : DEFAULT_AI_THINKING_MODE;

export const getEffectiveSystemPrompts = (
  settings: AiSettings
): Record<string, string> | undefined =>
  areDeveloperFeaturesEnabled(settings) ? settings.systemPrompts : undefined;
