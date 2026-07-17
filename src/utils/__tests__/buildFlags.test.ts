import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCaptureMode } from '../buildFlags';

describe('isCaptureMode', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('enables presentation-only UI hiding when explicitly requested', () => {
        vi.stubEnv('VITE_CAPTURE_MODE', 'true');

        expect(isCaptureMode()).toBe(true);
    });

    it('keeps development UI visible by default', () => {
        vi.stubEnv('VITE_CAPTURE_MODE', undefined);

        expect(isCaptureMode()).toBe(false);
    });
});
