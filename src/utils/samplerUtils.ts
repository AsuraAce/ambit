/**
 * Utility to normalize sampler names from various generators (A1111, InvokeAI, etc.)
 * into a canonical display name.
 */

// Mapping of specific raw names to canonical names
const SAMPLER_MAP: Record<string, string> = {
    'euler_a': 'Euler a',
    'euler-a': 'Euler a',
    'euler a': 'Euler a',
    'euler': 'Euler',
    'heun': 'Heun',
    'lms': 'LMS',
    'lms_k': 'LMS Karras',
    'dpm2': 'DPM2',
    'dpm2_a': 'DPM2 a',
    'dpm++ 2s a': 'DPM++ 2S a',
    'dpm++ 2m': 'DPM++ 2M',
    'dpm++ 2m sde': 'DPM++ 2M SDE',
    'dpm++ 2m sde karras': 'DPM++ 2M SDE Karras',
    'dpm++ sde': 'DPM++ SDE',
    'dpm++ sde karras': 'DPM++ SDE Karras',
    'dpm fast': 'DPM Fast',
    'dpm adaptive': 'DPM Adaptive',
    'ddim': 'DDIM',
    'plms': 'PLMS',
    'unipc': 'UniPC',
};

/**
 * Normalizes a sampler name for display.
 * Handles casing, underscores, and specific generator naming conventions.
 */
export function normalizeSampler(name: string): string {
    if (!name) return 'Unknown';

    const lower = name.toLowerCase().trim();

    // Check direct map first
    if (SAMPLER_MAP[lower]) return SAMPLER_MAP[lower];

    // Fallback: Title case and replace underscores/hyphens
    return name
        .replace(/[_-]/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

/**
 * Given a list of all raw sampler names in the DB and a list of selected canonical names,
 * returns all raw names that match the selections.
 */
export function expandSamplerVariants(selectedCanonical: string[], allRawSamplers: string[]): string[] {
    if (!selectedCanonical.length) return [];

    return allRawSamplers.filter(raw => {
        const canonical = normalizeSampler(raw);
        return selectedCanonical.includes(canonical);
    });
}
