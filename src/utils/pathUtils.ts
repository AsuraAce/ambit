/**
 * Normalizes a file path to use forward slashes.
 * Replaces backslashes with forward slashes and removes duplicate slashes.
 */
export const normalizePath = (path: string): string => {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/');
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
    if (url.startsWith('http://asset.localhost/') || url.startsWith('asset:')) {
        // Decode both slashes and colons - Tauri's asset protocol needs plain paths
        return url
            .replace(/%2F/gi, '/')
            .replace(/%3A/gi, ':')
            .replace(/%5C/gi, '/');  // Also handle encoded backslashes
    }
    return url;
};
