import { open } from '@tauri-apps/plugin-shell';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GEMINI_API_KEY_URL, isAllowedExternalUrl, openExternalUrl } from '../externalLinks';

describe('externalLinks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(window, 'open').mockImplementation(() => null);
    });

    it('opens allowlisted HTTPS URLs through Tauri shell first', async () => {
        await openExternalUrl('https://github.com/AsuraAce/ambit/issues');

        expect(open).toHaveBeenCalledWith('https://github.com/AsuraAce/ambit/issues');
        expect(window.open).not.toHaveBeenCalled();
    });

    it('falls back to window.open only for allowlisted URLs after Tauri shell fails', async () => {
        vi.mocked(open).mockRejectedValueOnce(new Error('shell unavailable'));

        const releasesUrl = 'https://github.com/AsuraAce/ambit/releases';

        await openExternalUrl(releasesUrl);

        expect(open).toHaveBeenCalledWith(releasesUrl);
        expect(window.open).toHaveBeenCalledWith(
            releasesUrl,
            '_blank',
            'noopener,noreferrer'
        );
    });

    it('opens the exact Google AI Studio API key page', async () => {
        await openExternalUrl(GEMINI_API_KEY_URL);

        expect(open).toHaveBeenCalledWith('https://aistudio.google.com/apikey');
        expect(isAllowedExternalUrl(GEMINI_API_KEY_URL)).toBe(true);
    });

    it.each([
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///C:/Windows/System32/calc.exe',
        'http://github.com/AsuraAce/ambit',
        'https://evil.example/ambit',
        'https://aistudio.google.com/',
        'https://aistudio.google.com/apikey/extra',
        'https://aistudio.google.com/apikey?project=123',
        'https://user:pass@github.com/AsuraAce/ambit',
        'https://github.com/AsuraAce/ambit?tab=readme',
    ])('rejects disallowed external URL %s', async (url) => {
        await expect(openExternalUrl(url)).rejects.toThrow('External URL is not allowed');

        expect(open).not.toHaveBeenCalled();
        expect(window.open).not.toHaveBeenCalled();
        expect(isAllowedExternalUrl(url)).toBe(false);
    });
});
