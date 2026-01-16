

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

const getAIClient = (apiKey: string) => {
    const key = apiKey || process.env.API_KEY;
    if (!key) throw new Error("API Key is missing. Please add it in Settings > Experiments.");
    return new GoogleGenAI({ apiKey: key });
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
    prompts?: Record<string, string>
): Promise<string> => {
    try {
        const ai = getAIClient(apiKey);
        const template = resolvePrompt('ANALYSIS', prompts);
        const prompt = template.replace('{{prompt}}', currentPrompt);

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
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
    prompts?: Record<string, string>
): Promise<string[]> => {
    try {
        const ai = getAIClient(apiKey);
        const template = resolvePrompt('VARIATIONS', prompts);
        const prompt = template.replace('{{prompt}}', currentPrompt);

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
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
    prompts?: Record<string, string>
): Promise<string> => {
    try {
        const ai = getAIClient(apiKey);
        const template = resolvePrompt('TITLE', prompts);
        const prompt = template.replace('{{prompt}}', promptText);

        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
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
    prompts?: Record<string, string>
): Promise<Partial<FilterState>> => {
    try {
        const ai = getAIClient(apiKey);

        const template = resolvePrompt('FILTERS', prompts);
        const prompt = template.replace('{{query}}', query);

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
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
                        dateRange: { type: Type.STRING, enum: ['today', 'week', 'month', 'all'] },
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
        model: 'gemini-2.5-flash',
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
