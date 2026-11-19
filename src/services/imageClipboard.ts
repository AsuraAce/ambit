import { commands, type Result } from '../bindings';
import { isBrowserMockMode } from './runtime';

export const COPY_IMAGE_BROWSER_UNAVAILABLE_MESSAGE = 'Copy image is unavailable in browser mock mode.';

/**
 * Puts the pixels of a library image on the OS clipboard. The backend decodes the
 * original and refuses files the library does not track; it never copies a path.
 */
export const copyImageToClipboard = async (path: string): Promise<Result<null, string>> => {
    if (isBrowserMockMode()) {
        return { status: 'error', error: COPY_IMAGE_BROWSER_UNAVAILABLE_MESSAGE };
    }

    try {
        return await commands.copyImageToClipboard(path);
    } catch (error) {
        return { status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
};
