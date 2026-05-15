import { useSettingsStore } from '../stores/settingsStore';
import { LogLevel } from '../types';

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4
};

let originalConsole: {
    log: typeof console.log,
    debug: typeof console.debug,
    info: typeof console.info,
    warn: typeof console.warn,
    error: typeof console.error
} | null = null;

export const setupGlobalLogging = () => {
    if (originalConsole) return; // already set up

    originalConsole = {
        log: console.log,
        debug: console.debug,
        info: console.info,
        warn: console.warn,
        error: console.error
    };

    const getLevelValue = (): number => {
        const level = useSettingsStore.getState().settings.logLevel || 'info';
        return LOG_LEVELS[level] ?? LOG_LEVELS.info;
    };

    console.debug = (...args: unknown[]) => {
        if (getLevelValue() <= LOG_LEVELS.debug) originalConsole!.debug(...args);
    };

    console.log = (...args: unknown[]) => {
        // Treat generic console.log as info
        if (getLevelValue() <= LOG_LEVELS.info) originalConsole!.log(...args);
    };

    console.info = (...args: unknown[]) => {
        if (getLevelValue() <= LOG_LEVELS.info) originalConsole!.info(...args);
    };

    console.warn = (...args: unknown[]) => {
        if (getLevelValue() <= LOG_LEVELS.warn) originalConsole!.warn(...args);
    };

    console.error = (...args: unknown[]) => {
        if (getLevelValue() <= LOG_LEVELS.error) originalConsole!.error(...args);
    };
};
