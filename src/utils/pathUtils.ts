/**
 * Normalizes a file path to use forward slashes.
 * Replaces backslashes with forward slashes and removes duplicate slashes.
 */
export const normalizePath = (path: string): string => {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/');
};

const trimTrailingSlash = (path: string): string => {
    if (/^[A-Za-z]:\/$/.test(path)) {
        return path;
    }

    return path.replace(/\/+$/, '');
};

/**
 * Forces backslashes for Windows path compatibility.
 * Useful for APIs that strictly require OS-native paths (like some Tauri asset protocols).
 */
export const toWindowsPath = (path: string): string => {
    return path.replace(/\//g, '\\');
};

/**
 * Extracts the filename from a path (handles both / and \).
 */
export const getFilename = (path: string): string => {
    if (!path) return '';
    return path.split(/[\\/]/).pop() || path;
};

/**
 * Tauri's convertFileSrc on Windows can sometimes double-encode or use %2F 
 * which the internal asset handler might fail to parse (500 error).
 * This repairs it by ensuring standard slashes and colons.
 */
export const repairAssetUrl = (url: string): string => {
    if (!url) return '';
    if (
        url.startsWith('http://asset.localhost/') ||
        url.startsWith('https://asset.localhost/') ||
        url.startsWith('http://localhost/_up_/') ||
        url.startsWith('https://localhost/_up_/') ||
        url.startsWith('asset:')
    ) {
        // Decode both slashes and colons - Tauri's asset protocol needs plain paths
        return url
            .replace(/%2F/gi, '/')
            .replace(/%3A/gi, ':')
            .replace(/%5C/gi, '/');  // Also handle encoded backslashes
    }
    return url;
};

/**
 * Converts a Tauri asset URL back to a local file path.
 * Strips protocol prefixes and decodes URI components.
 */
export const urlToPath = (url: string | undefined): string => {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;

    // Strip common Tauri asset prefixes
    // Supports: https://asset.localhost/, http://asset.localhost/, tauri://localhost/, asset://localhost/, asset://
    let path = url.replace(
        /^(https?:\/\/(?:asset|tauri)\.localhost(?::\d+)?\/|https?:\/\/localhost(?::\d+)?\/_up_\/|asset:\/\/(?:localhost\/)?|tauri:\/\/localhost\/)/i,
        ''
    );

    // Decode URI components (fixes %3A -> :, %20 -> space etc)
    try {
        path = decodeURIComponent(path);
    } catch (e) {
        // Fallback if malformed
    }

    if (/^\/[A-Za-z]:\//.test(path)) {
        path = path.slice(1);
    }

    return normalizePath(path);
};

/**
 * Returns the parent directory for a normalized file path.
 * If the path is already a directory root, the same root is returned.
 */
export const getDirectoryPath = (path: string): string => {
    const normalized = trimTrailingSlash(normalizePath(path));
    const lastSlash = normalized.lastIndexOf('/');

    if (lastSlash < 0) {
        return normalized;
    }

    if (lastSlash <= 2 && /^[A-Za-z]:/.test(normalized)) {
        return `${normalized.slice(0, 2)}/`;
    }

    return normalized.slice(0, lastSlash);
};

/**
 * Case-insensitive path containment check for normalized local file paths.
 */
export const isPathWithinDirectory = (path: string, directory: string): boolean => {
    const normalizedPath = trimTrailingSlash(normalizePath(path)).toLowerCase();
    const normalizedDirectory = trimTrailingSlash(normalizePath(directory)).toLowerCase();

    return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`);
};

/**
 * Normalizes an InvokeAI path string by stripping .db filenames
 * and appending standard /databases to the root.
 */
export const normalizeInvokeRoot = (rawPath: string | null | undefined): string | null => {
    if (!rawPath) return null;
    let root = rawPath.replace(/\\/g, '/').replace(/\/$/, '');
    
    if (root.toLowerCase().endsWith('.db')) {
        root = root.replace(/\/[\w-]+\.db$/i, '');
        root = root.replace(/\/databases$/i, '');
    } else if (root.toLowerCase().endsWith('/databases')) {
        root = root.replace(/\/databases$/i, '');
    }
    
    return root;
};
