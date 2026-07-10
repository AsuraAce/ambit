import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBrowserMockMode, isTauriRuntime } from '../runtime';

type RuntimeWindow = Window & {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
};

const getRuntimeWindow = (): RuntimeWindow => window as RuntimeWindow;

describe('runtime detection', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        delete getRuntimeWindow().__TAURI_INTERNALS__;
        delete getRuntimeWindow().__TAURI__;
    });

    it('treats non-window environments as non-Tauri', () => {
        vi.stubGlobal('window', undefined);

        expect(isTauriRuntime()).toBe(false);
    });

    it('detects either Tauri runtime marker', () => {
        const runtimeWindow = getRuntimeWindow();

        expect(isTauriRuntime()).toBe(false);

        runtimeWindow.__TAURI_INTERNALS__ = {};
        expect(isTauriRuntime()).toBe(true);

        delete runtimeWindow.__TAURI_INTERNALS__;
        runtimeWindow.__TAURI__ = {};
        expect(isTauriRuntime()).toBe(true);
    });

    it('keeps browser mock mode disabled under the Vitest test mode', () => {
        expect(isBrowserMockMode()).toBe(false);
    });
});
