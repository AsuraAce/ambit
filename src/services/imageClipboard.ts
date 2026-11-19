import { commands, type Result } from '../bindings';
import { isBrowserMockMode } from './runtime';

export const COPY_IMAGE_BROWSER_UNAVAILABLE_MESSAGE = 'Copy image is unavailable in browser mock mode.';

/** `ignored`: another copy is still running, so this request did nothing and needs no toast. */
export type CopyImageResult = Result<null, string> | { status: 'ignored' };

let copyInFlight = false;

/**
 * Puts the pixels of a library image on the OS clipboard. The backend decodes the
 * original and refuses files the library does not track; it never copies a path.
 * Repeat requests while a copy runs are ignored, so a large image is decoded once.
 */
export const copyImageToClipboard = async (path: string): Promise<CopyImageResult> => {
    if (isBrowserMockMode()) {
        return { status: 'error', error: COPY_IMAGE_BROWSER_UNAVAILABLE_MESSAGE };
    }
    if (copyInFlight) return { status: 'ignored' };

    copyInFlight = true;
    try {
        return await commands.copyImageToClipboard(path);
    } catch (error) {
        return { status: 'error', error: error instanceof Error ? error.message : String(error) };
    } finally {
        copyInFlight = false;
    }
};
