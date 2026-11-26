import { AI_MODELS, DEFAULT_AI_MODEL, DEFAULT_AI_THINKING_MODE, normalizeAiThinkingMode } from '../constants/aiModels';
import type { AiThinkingMode, AppSettings, ViewerTab, WorkflowGraphPrefs } from '../types';

export const normalizeViewerPreferredTab = (value: unknown): ViewerTab =>
    value === 'metadata' || value === 'workflow' ? value : 'details';

export const DEFAULT_WORKFLOW_GRAPH_PREFS: WorkflowGraphPrefs = {
    palette: 'quiet',
    wireShape: 'bundled',
    wireWidth: 'normal',
    movingDots: true,
    showMap: true,
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** The graph's saved view preferences; a missing or unknown value falls back to its default, field by field. */
export const normalizeWorkflowGraphPrefs = (value: unknown): WorkflowGraphPrefs => {
    const stored: Partial<Record<keyof WorkflowGraphPrefs, unknown>> = typeof value === 'object' && value !== null ? value : {};
    const fallback = DEFAULT_WORKFLOW_GRAPH_PREFS;
    return {
        palette: oneOf(stored.palette, ['quiet', 'familiar'], fallback.palette),
        wireShape: oneOf(stored.wireShape, ['curved', 'straight', 'angled', 'hidden', 'bundled'], fallback.wireShape),
        wireWidth: oneOf(stored.wireWidth, ['thin', 'normal', 'thick'], fallback.wireWidth),
        movingDots: typeof stored.movingDots === 'boolean' ? stored.movingDots : fallback.movingDots,
        showMap: typeof stored.showMap === 'boolean' ? stored.showMap : fallback.showMap,
    };
};

type DeveloperSettings = Pick<AppSettings, 'devMode'>;
type AiSettings = Pick<AppSettings, 'aiModel' | 'aiThinkingMode' | 'devMode' | 'systemPrompts'>;

export const isDevelopmentBuild = (): boolean => Boolean(import.meta.env.DEV);

export const areDeveloperFeaturesEnabled = (settings: DeveloperSettings): boolean => isDevelopmentBuild() && settings.devMode === true;

const isKnownAiModel = (modelId: string | undefined): modelId is string =>
    Boolean(modelId && AI_MODELS.some((model) => model.id === modelId));

export const getEffectiveAiModel = (settings: AiSettings): string =>
    areDeveloperFeaturesEnabled(settings) && isKnownAiModel(settings.aiModel) ? settings.aiModel : DEFAULT_AI_MODEL;

export const getEffectiveAiThinkingMode = (settings: AiSettings): AiThinkingMode =>
    areDeveloperFeaturesEnabled(settings)
        ? normalizeAiThinkingMode(getEffectiveAiModel(settings), settings.aiThinkingMode)
        : DEFAULT_AI_THINKING_MODE;

export const getEffectiveSystemPrompts = (settings: AiSettings): Record<string, string> | undefined =>
    areDeveloperFeaturesEnabled(settings) ? settings.systemPrompts : undefined;
