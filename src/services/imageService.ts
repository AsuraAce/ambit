import { readFile } from '@tauri-apps/plugin-fs';

/**
 * Utility to convert an image path or URL to a base64 string.
 * Handles both local filesystem paths (via Tauri) and web URLs.
 */
export const imageToBase64 = async (url: string): Promise<string> => {
    if (!url.startsWith('http') && !url.startsWith('blob:')) {
        // Local path
        const data = await readFile(url);
        // Simple binary to base64 conversion
        const binary = Array.from(data).map(b => String.fromCharCode(b)).join('');
        return `data:image/png;base64,${btoa(binary)}`;
    } else {
        // Web URL or Blob URL
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
        });
    }
};

/**
 * Repairs asset URLs for Tauri compatibility.
 */
export const repairAssetUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:') || url.startsWith('data:')) return url;
    // For Tauri windows, we often need to prepend internal protocol or just return as is if hook handles it
    // In this app, we seem to use raw paths for some components and converted ones for others.
    return url;
};
