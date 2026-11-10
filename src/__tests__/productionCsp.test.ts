import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface TauriConfig {
    app: { security: { csp: string } };
}

const productionConfig = JSON.parse(
    readFileSync(resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8')
) as TauriConfig;

const directive = (csp: string, name: string): string[] => {
    const entry = csp.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `));
    return entry ? entry.split(/\s+/).slice(1) : [];
};

describe('production content security policy', () => {
    // `ipc:` and `http://ipc.localhost` let invoke use Tauri's custom-protocol IPC. Without them
    // WebView2 blocks it, Tauri answers every invoke through webview.eval, and the renderer retains
    // each evaluated response, so release builds grew by the size of every SQL result.
    // Gemini stays the only external origin, so the list is exact: a wildcard such as `*`,
    // `https:` or `data:` would widen the product's network paths and must fail here.
    it('allows only self, Tauri IPC and the documented Gemini origin for connections', () => {
        expect(directive(productionConfig.app.security.csp, 'connect-src')).toEqual([
            "'self'",
            'ipc:',
            'http://ipc.localhost',
            'https://generativelanguage.googleapis.com',
        ]);
    });
});
