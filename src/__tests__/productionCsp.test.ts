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
    // Without these sources WebView2 blocks Tauri's custom-protocol IPC. Tauri then answers every
    // invoke through webview.eval, and WebView2 retains each evaluated response: release-build gallery
    // refreshes and InvokeAI imports grew the renderer by the size of every SQL result (R18).
    it('lets invoke use Tauri custom-protocol IPC instead of the eval fallback', () => {
        const connectSources = directive(productionConfig.app.security.csp, 'connect-src');

        expect(connectSources).toContain('ipc:');
        expect(connectSources).toContain('http://ipc.localhost');
    });

    it('keeps the only documented external connection unchanged', () => {
        const connectSources = directive(productionConfig.app.security.csp, 'connect-src');
        const external = connectSources.filter(source => /^https?:\/\//.test(source) && source !== 'http://ipc.localhost');

        expect(external).toEqual(['https://generativelanguage.googleapis.com']);
    });
});
