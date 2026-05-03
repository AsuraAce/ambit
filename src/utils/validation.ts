/**
 * Zod validation schemas for external data sources.
 * 
 * These schemas validate data entering the application from:
 * - Gemini AI API responses
 * - CivitAI API responses  
 * - External file metadata
 */

import { z } from 'zod';
import { GeneratorTool } from '../types';
import { isValidDateInput } from './dateFilters';

// ============================================================================
// Gemini API Schemas
// ============================================================================

/**
 * Schema for Gemini's generateFiltersFromQuery response
 */
const OptionalDateInputSchema = z.preprocess(
    value => value === '' ? undefined : value,
    z.string().refine(isValidDateInput, 'Expected a real YYYY-MM-DD date').optional()
);

export const GeminiFilterResponseSchema = z.object({
    searchQuery: z.string().optional().default(''),
    models: z.array(z.string()).optional().default([]),
    tools: z.array(z.string()).optional().default([]),
    dateRange: z.enum(['today', 'week', 'month', 'custom', 'all']).optional(),
    dateFrom: OptionalDateInputSchema,
    dateTo: OptionalDateInputSchema,
    favoritesOnly: z.boolean().optional(),
    minSteps: z.number().optional(),
    minCfg: z.number().optional(),
});

export type GeminiFilterResponse = z.infer<typeof GeminiFilterResponseSchema>;

/**
 * Schema for Gemini's recoverImageMetadata response
 */
export const GeminiMetadataResponseSchema = z.object({
    positivePrompt: z.string(),
    negativePrompt: z.string().optional().default(''),
    cfg: z.number().optional().default(0),
    steps: z.number().optional().default(0),
    seed: z.number().optional().default(0),
    model: z.string().optional().default('Unknown'),
    tool: z.string().optional().default('Unknown'),
});

export type GeminiMetadataResponse = z.infer<typeof GeminiMetadataResponseSchema>;

/**
 * Schema for prompt variations response (array of strings)
 */
export const PromptVariationsSchema = z.array(z.string()).max(10);

// ============================================================================
// CivitAI API Schemas (for model resolution)
// ============================================================================

/**
 * Schema for CivitAI model lookup by hash
 */
export const CivitAIModelSchema = z.object({
    id: z.number(),
    modelId: z.number().optional(),
    name: z.string(),
    model: z.object({
        name: z.string(),
        type: z.string().optional(),
    }).optional(),
    images: z.array(z.object({
        url: z.string().url(),
        width: z.number().optional(),
        height: z.number().optional(),
    })).optional().default([]),
});

export type CivitAIModel = z.infer<typeof CivitAIModelSchema>;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Safely parse and validate data with Zod schema.
 * Returns the parsed data or null if validation fails.
 * 
 * @example
 * const filters = safeParse(GeminiFilterResponseSchema, apiResponse);
 * if (filters) {
 *   // Use validated filters
 * }
 */
export function safeParse<T>(schema: z.ZodSchema<T>, data: unknown): T | null {
    const result = schema.safeParse(data);
    if (result.success) {
        return result.data;
    }
    console.warn('[Validation] Schema validation failed:', result.error.format());
    return null;
}

/**
 * Parse and validate data, throwing an error if validation fails.
 * Use when you want to catch and handle validation errors explicitly.
 * 
 * @throws {z.ZodError} If validation fails
 */
export function parseOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
    return schema.parse(data);
}

/**
 * Validates that a string is a valid GeneratorTool enum value.
 */
export function isValidGeneratorTool(value: string): value is GeneratorTool {
    return Object.values(GeneratorTool).includes(value as GeneratorTool);
}
