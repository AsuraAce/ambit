import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';

describe('Vite development configuration', () => {
    it('does not watch Cargo build output that Windows locks while Tauri links', async () => {
        expect(typeof viteConfig).toBe('function');

        if (typeof viteConfig !== 'function') {
            throw new Error('Expected Vite configuration to be a function');
        }

        const config = await viteConfig({
            command: 'serve',
            mode: 'development',
            isSsrBuild: false,
            isPreview: false,
        });
        const ignored = config.server?.watch?.ignored;

        expect(ignored).toEqual(
            expect.arrayContaining(['**/src-tauri/target/**'])
        );
    });
});
