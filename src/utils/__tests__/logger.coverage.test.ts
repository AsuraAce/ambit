import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogLevel } from '../../types';

const state = vi.hoisted(() => ({ logLevel: 'info' as LogLevel | undefined }));
vi.mock('../../stores/settingsStore', () => ({
    useSettingsStore: { getState: () => ({ settings: { logLevel: state.logLevel } }) },
}));

const nativeConsole = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
};

describe('setupGlobalLogging', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.assign(console, nativeConsole);
        state.logLevel = 'info';
    });

    afterEach(() => Object.assign(console, nativeConsole));

    it('routes messages at or above the configured threshold', async () => {
        const calls = {
            log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
            debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
            info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
            error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
        };
        const { setupGlobalLogging } = await import('../logger');
        setupGlobalLogging();
        setupGlobalLogging();
        console.debug('debug');
        console.log('log');
        console.info('info');
        console.warn('warn');
        console.error('error');
        expect(calls.debug).not.toHaveBeenCalled();
        expect(calls.log).toHaveBeenCalledWith('log');
        expect(calls.info).toHaveBeenCalledWith('info');
        expect(calls.warn).toHaveBeenCalledWith('warn');
        expect(calls.error).toHaveBeenCalledWith('error');
    });

    it.each([
        ['debug', true, true, true, true],
        ['warn', false, false, true, true],
        ['error', false, false, false, true],
        ['none', false, false, false, false],
        [undefined, false, true, true, true],
        ['invalid' as LogLevel, false, true, true, true],
    ] as const)('honors %s level', async (level, debugAllowed, infoAllowed, warnAllowed, errorAllowed) => {
        const originals = {
            log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
            debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
            info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
            warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
            error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
        };
        state.logLevel = level;
        const { setupGlobalLogging } = await import('../logger');
        setupGlobalLogging();
        console.debug('d'); console.log('l'); console.info('i'); console.warn('w'); console.error('e');
        expect(originals.debug.mock.calls.length > 0).toBe(debugAllowed);
        expect(originals.log.mock.calls.length > 0).toBe(infoAllowed);
        expect(originals.info.mock.calls.length > 0).toBe(infoAllowed);
        expect(originals.warn.mock.calls.length > 0).toBe(warnAllowed);
        expect(originals.error.mock.calls.length > 0).toBe(errorAllowed);
    });
});
