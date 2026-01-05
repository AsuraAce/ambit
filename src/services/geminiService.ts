

import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { FilterState, RecoveryStyle, ImageMetadata, GeneratorTool } from "../types";
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
 * Analyzes a prompt and suggests improvements using Gemini 2.5 Flash.
 */
export const analyzePromptAndSuggest = async (currentPrompt: string, apiKey: string): Promise<string> => {
    try {
        const ai = getAIClient(apiKey);

        const prompt = `
      You are an expert AI Image Generation Prompt Engineer.
      Analyze the following prompt used for an image generation:
      
      "${currentPrompt}"
      
      Provide 3 specific improvements or variations to enhance the visual quality or change the style slightly.
      Format the output as a simple markdown list.
      Keep it concise.
    `;

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
export const generatePromptVariations = async (currentPrompt: string, apiKey: string): Promise<string[]> => {
    try {
        const ai = getAIClient(apiKey);

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Take the following image generation prompt and create 3 distinct variations of it.
            
            Original Prompt: "${currentPrompt}"
            
            Variation 1: Artistic/Stylized (Change the art medium or style significantly).
            Variation 2: Cinematic/Realistic (Focus on lighting, photography, and realism).
            Variation 3: Creative Twist (Keep the subject but change the setting or mood).
            
            Return ONLY a JSON array of strings. Do not include markdown formatting.`,
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
export const generateTitleFromPrompt = async (promptText: string, apiKey: string): Promise<string> => {
    try {
        const ai = getAIClient(apiKey);
        const response: GenerateContentResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Generate a short, 3-5 word artistic title for an image generated with this prompt: "${promptText}". Return ONLY the title, no quotes.`,
        });
        return response.text?.trim() || "Untitled Creation";
    } catch (error) {
        return "Untitled";
    }
};

/**
 * Converts natural language query into a structured FilterState object.
 */
export const generateFiltersFromQuery = async (query: string, apiKey: string): Promise<Partial<FilterState>> => {
    try {
        const ai = getAIClient(apiKey);

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Translate this user search query into a JSON filter object for an image library: "${query}".
            
            Available tools (enums): ComfyUI, Automatic1111, Midjourney, InvokeAI.
            Available models (strings): SDXL 1.0, Stable Diffusion 1.5, Flux.1, Pony Diffusion V6.
            Date ranges: 'today', 'week', 'month', 'all'.
            
            CRITICAL INSTRUCTIONS:
            1. 'searchQuery': Extract ONLY the key subject matter keywords. Remove conversational phrases like "show me", "find", "images of", "pictures from", "look for". 
               Example: "Show me cyberpunk cities" -> searchQuery: "cyberpunk cities".
               Example: "Find images from yesterday" -> searchQuery: "".
            2. 'dateRange': If the user mentions "yesterday", "last 24 hours", or "today", set dateRange to 'today'. "Last 7 days" -> 'week'.
            3. 'favoritesOnly': Set to true if "favorites", "liked", or "best" is mentioned.
            4. 'tools'/'models': Match loosely.
            `,
            config: {
                responseMimeType: "application/json",
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
    apiKey: string
): Promise<Partial<ImageMetadata>> => {
    const ai = getAIClient(apiKey);

    let systemInstruction = "You are an AI Vision assistant specialized in describing images for Generative AI reproduction.";
    let stylePrompt = "";

    switch (style) {
        case 'midjourney':
            stylePrompt = "Format the output as a Midjourney v6 prompt. Use --v 6 syntax parameters if applicable. Focus on artistic style, lighting, and composition.";
            break;
        case 'sdxl':
            stylePrompt = "Format the output as a Stable Diffusion XL (SDXL) prompt. Use booru tags for key elements if helpful, but prioritize natural language description. Mention art style, artist references, and quality boosters (e.g. 'masterpiece, best quality').";
            break;
        case 'danbooru':
            stylePrompt = "Format the output as a list of comma-separated Danbooru tags. Focus on character traits, clothing, background elements, and framing.";
            break;
        default:
            stylePrompt = "Provide a detailed descriptive prompt that would generate this image. Include subject, medium, style, lighting, and color palette.";
    }

    const prompt = `Analyze this image. ${stylePrompt}
    
    IMPORTANT: 
    1. Do NOT guess technical parameters (CFG, Steps, Seed) as they are impossible to know from visual inspection. Return 0 for them.
    2. Do NOT guess the Model Architecture unless there is clear visual evidence (e.g. text watermark). Default 'model' to "Unknown".
    3. Default 'tool' to "Unknown".
    4. Provide a generic safety 'negativePrompt' (e.g., 'low quality, blurry, watermark').
    
    Return the result as JSON.
    `;

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
                    tool: { type: Type.STRING } // Just a guess
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

        // Map generic tool guess to our strict enums if possible, or default to UNKNOWN
        const tool = isValidGeneratorTool(validated.tool) ? validated.tool : GeneratorTool.UNKNOWN;

        return {
            positivePrompt: validated.positivePrompt,
            negativePrompt: validated.negativePrompt,
            tool,
            model: validated.model === 'Unknown' ? 'Unknown' : (validated.model || 'Unknown'),
            // Enforce strict zeros if Gemini hallucinated them despite instructions
            steps: 0,
            cfg: 0,
            seed: 0
        };
    }

    throw new Error("Failed to generate metadata");
};
