

import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { FilterState, RecoveryStyle, ImageMetadata, GeneratorTool } from "../types";
import { AI_PROMPTS, AIPromptKey, RECOVERY_STYLES } from "../constants/aiPrompts";
import {
    GeminiFilterResponseSchema,
    GeminiMetadataResponseSchema,
    PromptVariationsSchema,
    safeParse,
    isValidGeneratorTool
} from "../utils/validation";

import { DEFAULT_AI_MODEL } from "../constants/aiModels";
import { formatDateInputValue } from "../utils/dateFilters";

const getAIClient = (apiKey: string) => {
    const key = apiKey || process.env.API_KEY;
    if (!key) throw new Error("API Key is missing. Please add it in Settings > Intelligence.");
    return new GoogleGenAI({ apiKey: key });
};

/**
 * Verifies the validity of an API key by attempting a minimal operation.
 */
export const verifyApiKey = async (apiKey: string, modelId: string = DEFAULT_AI_MODEL): Promise<{ valid: boolean; error?: string }> => {
    try {
        if (!apiKey) return { valid: false, error: "API Key is required" };
        const ai = new GoogleGenAI({ apiKey });

        // Minimal operation: generate content with 1 token output
        // We use a very simple prompt to minimize cost/tokens
        const result = await ai.models.generateContent({
            model: modelId,
            contents: 'ping',
            config: {
                maxOutputTokens: 1
            }
        });

        if (result) {
            return { valid: true };
        }
        return { valid: false, error: "Invalid response from Gemini API" };
    } catch (error: any) {
        // Log error but be selective about what we expose to UI
        console.error("Gemini Verification Error:", error);

        let message = "Verification failed";
        const errorStr = String(error).toLowerCase();

        if (errorStr.includes("api_key_invalid") || errorStr.includes("invalid api key")) {
            message = "Invalid API Key";
        } else if (errorStr.includes("quota") || errorStr.includes("rate limit")) {
            message = "Quota exceeded";
        } else if (errorStr.includes("network") || errorStr.includes("fetch")) {
            message = "Network error";
        } else if (errorStr.includes("permission") || errorStr.includes("not found")) {
            message = "Model not found or access denied";
        } else {
            message = error.message || "Unknown error";
        }

        return { valid: false, error: message };
    }
};

/**
 * Helper to resolve prompt (user override vs default)
 */
const resolvePrompt = (key: AIPromptKey, overrides?: Record<string, string>): string => {
    return overrides?.[key] || AI_PROMPTS[key];
};

/**
 * Analyzes a prompt and suggests improvements using Gemini 2.5 Flash.
 */
export const analyzePromptAndSuggest = async (
    currentPrompt: string,
    apiKey: string,
    modelId: string = DEFAULT_AI_MODEL,
    prompts?: Record<string, string>
): Promise<string> => {
    try {
        const ai = getAIClient(apiKey);
        const template = resolvePrompt('ANALYSIS', prompts);
        const prompt = template.replace('{{prompt}}', currentPrompt);

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: {
                thinkingConfig: { thinkingBudget: 0 }
            }
        });

        return response.text || "No suggestions available.";
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
};

/**
 * Generates 3 distinct variations of a prompt.
 */
export const generatePromptVariations = async (
    currentPrompt: string,
    apiKey: string,
    modelId: string = DEFAULT_AI_MODEL,
    prompts?: Record<string, string>
): Promise<string[]> => {
    try {
        const ai = getAIClient(apiKey);
        const template = resolvePrompt('VARIATIONS', prompts);
        const prompt = template.replace('{{prompt}}', currentPrompt);

        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                }
            }
        });

        if (response.text) {
            const parsed = safeParse(PromptVariationsSchema, JSON.parse(response.text));
            return parsed || [];
        }
        return [];
    } catch (error) {
        console.error("Variation Error:", error);
        throw error;
    }
};

/**
 * Generates a creative title for an image based on its prompt.
 */
export const generateTitleFromPrompt = async (
    promptText: string,
    apiKey: string,
    modelId: string = DEFAULT_AI_MODEL,
    prompts?: Record<string, string>
): Promise<string> => {
    try {
        const ai = getAIClient(apiKey);
        const template = resolvePrompt('TITLE', prompts);
        const prompt = template.replace('{{prompt}}', promptText);

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
        });
        return response.text?.trim() || "Untitled Creation";
    } catch (error) {
        return "Untitled";
    }
};

/**
 * Converts natural language query into a structured FilterState object.
 */
export const generateFiltersFromQuery = async (
    query: string,
    apiKey: string,
    modelId: string = DEFAULT_AI_MODEL,
    prompts?: Record<string, string>
): Promise<Partial<FilterState>> => {
    try {
        const ai = getAIClient(apiKey);

        const template = resolvePrompt('FILTERS', prompts);
        const prompt = template
            .replace('{{query}}', query)
            .replace('{{today}}', formatDateInputValue(new Date()));

        const response = await ai.models.generateContent({
            model: modelId,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                // Schema remains hardcoded as it defines internal logic
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        searchQuery: { type: Type.STRING },
                        models: { type: Type.ARRAY, items: { type: Type.STRING } },
                        tools: { type: Type.ARRAY, items: { type: Type.STRING } },
                        dateRange: { type: Type.STRING, enum: ['today', 'week', 'month', 'custom', 'all'] },
                        dateFrom: { type: Type.STRING },
                        dateTo: { type: Type.STRING },
                        favoritesOnly: { type: Type.BOOLEAN },
                        minSteps: { type: Type.NUMBER },
                        minCfg: { type: Type.NUMBER }
                    }
                }
            }
        });

        if (response.text) {
            const parsed = safeParse(GeminiFilterResponseSchema, JSON.parse(response.text));
            if (parsed) {
                return parsed as Partial<FilterState>;
            }
        }
        return { searchQuery: query };
    } catch (error) {
        console.error("NL Search Error:", error);
        return { searchQuery: query }; // Fallback to raw text search
    }
};

/**
 * Reverse engineers a prompt from an image using Gemini Vision.
 */
export const recoverImageMetadata = async (
    base64Image: string,
    style: RecoveryStyle,
    apiKey: string,
    modelId: string = DEFAULT_AI_MODEL,
    prompts?: Record<string, string>
): Promise<Partial<ImageMetadata>> => {
    const ai = getAIClient(apiKey);

    const stylePrompt = RECOVERY_STYLES[style] || RECOVERY_STYLES.generic;
    const template = resolvePrompt('RECOVERY_GENERIC', prompts); // Use generic template key, could make specific keys if needed
    // NOTE: For recovery, we are only templating the wrapping instruction. 
    // The specific style instructions are still hardcoded in RECOVERY_STYLES for simplicity, 
    // unless we want to explode that into multiple full prompt templates. 
    // For now, let's keep it simple: The "Master Template" is exposed.

    // We might need a slightly different template handling for recovery since it inserts `stylePrompt` mid-string.
    // Let's use {{stylePrompt}} in the constant.
    const prompt = template.replace('{{stylePrompt}}', stylePrompt);

    // Remove data:image/png;base64, prefix if present
    const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");

    const response = await ai.models.generateContent({
        model: modelId,
        contents: {
            parts: [
                { inlineData: { mimeType: 'image/png', data: cleanBase64 } },
                { text: prompt }
            ]
        },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    positivePrompt: { type: Type.STRING },
                    negativePrompt: { type: Type.STRING },
                    cfg: { type: Type.NUMBER },
                    steps: { type: Type.NUMBER },
                    seed: { type: Type.NUMBER },
                    model: { type: Type.STRING },
                    tool: { type: Type.STRING }
                },
                required: ["positivePrompt"]
            }
        }
    });

    if (response.text) {
        const rawData = JSON.parse(response.text);
        const validated = safeParse(GeminiMetadataResponseSchema, rawData);

        if (!validated) {
            throw new Error("Failed to validate Gemini response");
        }

        // SCOPE REDUCTION: Only return positivePrompt.
        return {
            positivePrompt: validated.positivePrompt
        };
    }

    throw new Error("Failed to generate metadata");
};
