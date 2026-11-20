import { commands } from '../bindings';
import { useSettingsStore } from '../stores/settingsStore';
import { LogLevel } from '../types';

const LOG_LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4,
};

let originalConsole: {
    log: typeof console.log;
    debug: typeof console.debug;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
} | null = null;

const describeRejectionReason = (reason: unknown): string => {
    if (reason instanceof Error) {
        const header = `${reason.name}: ${reason.message}`;
        // WebKit stacks omit the message, so prefix it when the stack lacks it.
        if (!reason.stack) return header;
        return reason.stack.includes(reason.message) ? reason.stack : `${header}\n${reason.stack}`;
    }
    if (typeof reason === 'string') return reason;
    try {
        return JSON.stringify(reason) ?? String(reason);
    } catch {
        try {
            return String(reason);
        } catch {
            return '[unserializable rejection reason]';
        }
    }
};

// A rejected promise nobody caught (e.g. an async JSX handler) would otherwise vanish.
const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const text = describeRejectionReason(event.reason);
    console.error('Unhandled promise rejection:', text);
    // Bridge to the Rust log file. Must never reject or throw: it runs inside the rejection handler,
    // and outside Tauri (plain web dev) the invoke fails.
    try {
        commands.logFrontendError(text).catch(() => undefined);
    } catch {
        // ignore
    }
};

export const setupGlobalLogging = () => {
    if (originalConsole) return; // already set up

    originalConsole = {
        log: console.log,
        debug: console.debug,
        info: console.info,
        warn: console.warn,
        error: console.error,
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

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
};

export const resetGlobalLoggingForTests = () => {
    if (!originalConsole) return;

    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    console.log = originalConsole.log;
    console.debug = originalConsole.debug;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    originalConsole = null;
};
