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
