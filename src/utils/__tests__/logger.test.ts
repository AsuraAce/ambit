import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { createDefaultAppSettings } from '../../constants/defaultSettings';
import type { LogLevel } from '../../types';
import { useSettingsStore } from '../../stores/settingsStore';
import { resetGlobalLoggingForTests, setupGlobalLogging } from '../logger';

const hostConsole = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error
};

type ConsoleMethod = keyof typeof hostConsole;
type ConsoleSpy = MockInstance<typeof console.log>;
let consoleSpies: Record<ConsoleMethod, ConsoleSpy>;

const installConsoleSpies = () => {
    consoleSpies = {
        log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
        debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
        info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
        warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
        error: vi.spyOn(console, 'error').mockImplementation(() => undefined)
    };
};

const restoreHostConsole = () => {
    console.log = hostConsole.log;
    console.debug = hostConsole.debug;
    console.info = hostConsole.info;
    console.warn = hostConsole.warn;
    console.error = hostConsole.error;
};

const setLogLevel = (logLevel?: LogLevel) => {
    useSettingsStore.setState({
        settings: createDefaultAppSettings({ logLevel })
    });
};

describe('setupGlobalLogging', () => {
    beforeEach(() => {
        resetGlobalLoggingForTests();
        restoreHostConsole();
        installConsoleSpies();
        setLogLevel('info');
    });

    afterEach(() => {
        resetGlobalLoggingForTests();
        restoreHostConsole();
        vi.restoreAllMocks();
    });

    it('keeps info-level operational logs while suppressing debug noise by default', () => {
        setupGlobalLogging();

        console.debug('[diagnostics] hidden');
        console.log('[startup] visible');
        console.info('[startup] visible');
        console.warn('[startup] warning');
        console.error('[startup] failure');

        expect(consoleSpies.debug).not.toHaveBeenCalled();
        expect(consoleSpies.log).toHaveBeenCalledWith('[startup] visible');
        expect(consoleSpies.info).toHaveBeenCalledWith('[startup] visible');
        expect(consoleSpies.warn).toHaveBeenCalledWith('[startup] warning');
        expect(consoleSpies.error).toHaveBeenCalledWith('[startup] failure');
    });

    it.each([
        ['debug', ['debug', 'log', 'info', 'warn', 'error']],
        ['warn', ['warn', 'error']],
        ['error', ['error']],
        ['none', []]
    ] as const)('routes only useful %s-level logs through the original console', (level, expectedMethods) => {
        setLogLevel(level);
        setupGlobalLogging();

        console.debug('debug message');
        console.log('log message');
        console.info('info message');
        console.warn('warn message');
        console.error('error message');

        const methods = ['debug', 'log', 'info', 'warn', 'error'] as const;
        const expected = new Set<ConsoleMethod>(expectedMethods);
        methods.forEach((method) => {
            const assertion = expect(consoleSpies[method]);
            if (expected.has(method)) {
                assertion.toHaveBeenCalledTimes(1);
            } else {
                assertion.not.toHaveBeenCalled();
            }
        });
    });

    it('responds to log-level changes after setup so support diagnostics can be enabled live', () => {
        setupGlobalLogging();

        console.debug('[before] hidden');
        setLogLevel('debug');
        console.debug('[after] visible');

        expect(consoleSpies.debug).toHaveBeenCalledTimes(1);
        expect(consoleSpies.debug).toHaveBeenCalledWith('[after] visible');
    });

    it('falls back to info when persisted settings contain an unknown log level', () => {
        setLogLevel('verbose' as unknown as LogLevel);
        setupGlobalLogging();

        console.debug('[diagnostics] hidden');
        console.info('[startup] visible');

        expect(consoleSpies.debug).not.toHaveBeenCalled();
        expect(consoleSpies.info).toHaveBeenCalledWith('[startup] visible');
    });

    it('is idempotent so repeated app layout renders do not wrap console methods again', () => {
        setupGlobalLogging();
        setupGlobalLogging();

        console.error('[startup] failure');

        expect(consoleSpies.error).toHaveBeenCalledTimes(1);
        expect(consoleSpies.error).toHaveBeenCalledWith('[startup] failure');
    });
});
