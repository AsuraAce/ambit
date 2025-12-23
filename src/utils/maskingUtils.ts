import { AIImage } from '../types';

/**
 * Determines if an image should be masked (blurred/hidden) based on:
 * 1. Global Privacy Switch
 * 2. Explicit User Mask (Persistent)
 * 3. Keyword Matching in Positive Prompt
 */
export const isImageMasked = (
    image: AIImage,
    privacyEnabled: boolean,
    maskedKeywords: string[]
): boolean => {
    // 0. Global Safety Switch - If off, nothing is masked (except maybe explicit hidden logic if we separate them later, but for now strict)
    if (!privacyEnabled) return false;

    // 1. Manual User Mask (Highest Priority)
    // If explicitly set to TRUE, it is masked.
    // If explicitly set to FALSE, it is UNMASKED (Override).
    // If UNDEFINED/NULL, we fall back to keyword matching.
    if (image.userMasked === true) return true;
    if (image.userMasked === false) return false;

    // 2. Keyword Matching (Only if keywords exist)
    if (maskedKeywords.length === 0) return false;

    // 3. Scan POSITIVE PROMPT Only (User Requirement for precision)
    // We avoid scanning negative prompts or model names to prevent false positives.
    const prompt = typeof image.metadata.positivePrompt === 'string'
        ? image.metadata.positivePrompt.toLowerCase()
        : '';

    // Quick return if empty
    if (!prompt) return false;

    return maskedKeywords.some(kw => prompt.includes(kw.toLowerCase()));
};
