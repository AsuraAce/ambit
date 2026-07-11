import {
    GITHUB_SPONSORS_URL,
    ISSUES_URL,
    KO_FI_URL,
    RELEASES_URL,
    REPOSITORY_URL,
} from '../constants/support';

export const GEMINI_API_KEY_URL = 'https://aistudio.google.com/apikey';

const normalizeAllowedExternalUrl = (value: string): string | null => {
    try {
        const parsed = new URL(value);

        if (parsed.protocol !== 'https:') return null;
        if (parsed.username || parsed.password) return null;
        if (parsed.search || parsed.hash) return null;

        return parsed.href.replace(/\/$/, '');
    } catch {
        return null;
    }
};

const allowedExternalUrls = new Set(
    [
        REPOSITORY_URL,
        ISSUES_URL,
        RELEASES_URL,
        GITHUB_SPONSORS_URL,
        KO_FI_URL,
        GEMINI_API_KEY_URL,
    ].map((url) => normalizeAllowedExternalUrl(url)).filter((url): url is string => !!url)
);

export const isAllowedExternalUrl = (url: string): boolean => {
    const normalized = normalizeAllowedExternalUrl(url);
    return !!normalized && allowedExternalUrls.has(normalized);
};

export const openExternalUrl = async (url: string): Promise<void> => {
    const normalizedUrl = normalizeAllowedExternalUrl(url);
    if (!normalizedUrl || !allowedExternalUrls.has(normalizedUrl)) {
        throw new Error(`External URL is not allowed: ${url}`);
    }

    try {
        const { open } = await import('@tauri-apps/plugin-shell');
        await open(normalizedUrl);
        return;
    } catch {
        // Browser mock mode has no Tauri shell bridge; fall back only after allowlist validation.
    }

    window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
};
