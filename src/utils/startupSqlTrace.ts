import type Database from '@tauri-apps/plugin-sql';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { startupDiagnostics } from './startupDiagnostics';

export const STARTUP_SQL_TRACE_LIMIT = 32;

export type StartupSqlTraceLabel = 'collection' | 'maintenance' | 'gallery' | 'global-gallery';

export interface StartupSqlTraceCapability {
    launchId: string;
}

export interface StartupSqlFrontendReport {
    launchId: string;
    callId: number;
    label: StartupSqlTraceLabel;
    durationMs: number;
    status: 'completed' | 'failed';
}

type SqlDatabase = Pick<Database, 'path' | 'select'>;
type SqlInvoke = <T>(command: string, args: {
    db: string;
    query: string;
    values: unknown[];
    startupTrace: { launchId: string; callId: number; label: StartupSqlTraceLabel };
}) => Promise<T>;

interface StartupSqlTraceOptions {
    getCapability: () => unknown;
    invoke: SqlInvoke;
    now: () => number;
    report: (report: StartupSqlFrontendReport) => void | Promise<unknown>;
}

const isCapability = (value: unknown): value is StartupSqlTraceCapability => (
    typeof value === 'object'
    && value !== null
    && 'launchId' in value
    && typeof value.launchId === 'string'
    && value.launchId.length > 0
);

const timestamp = (now: () => number): number | undefined => {
    try {
        const value = now();
        return Number.isFinite(value) ? value : undefined;
    } catch {
        return undefined;
    }
};

const duration = (startedAt: number | undefined, endedAt: number | undefined): number | undefined => {
    if (startedAt === undefined || endedAt === undefined) return undefined;
    const value = Math.max(0, Math.round(endedAt - startedAt));
    return Number.isFinite(value) ? value : undefined;
};

const reportSettlement = (
    report: StartupSqlTraceOptions['report'],
    settlement: StartupSqlFrontendReport,
): void => {
    try {
        void Promise.resolve(report(settlement)).catch(() => undefined);
    } catch {
        // Startup tracing is best-effort and must not affect the SQL result.
    }
};

/**
 * Runs an opted-in startup count through the SQL plugin's normal select route,
 * adding only native-consumed trace metadata. The fallback deliberately calls
 * the database object's original select method with the unchanged arguments.
 */
export function createStartupTracedSelect(options: StartupSqlTraceOptions) {
    let nextCallId = 0;

    return async function startupTracedSelect<T>(
        db: SqlDatabase,
        label: StartupSqlTraceLabel,
        query: string,
        values?: unknown[],
    ): Promise<T> {
        let capability: unknown;
        try {
            capability = options.getCapability();
        } catch {
            return values === undefined ? db.select<T>(query) : db.select<T>(query, values);
        }
        if (!isCapability(capability) || nextCallId >= STARTUP_SQL_TRACE_LIMIT) {
            return values === undefined ? db.select<T>(query) : db.select<T>(query, values);
        }

        const callId = ++nextCallId;
        const startedAt = timestamp(options.now);
        const trace = { launchId: capability.launchId, callId, label };
        try {
            const result = await options.invoke<T>('plugin:sql|select', {
                db: db.path,
                query,
                values: values ?? [],
                startupTrace: trace,
            });
            const durationMs = duration(startedAt, timestamp(options.now));
            if (durationMs !== undefined) reportSettlement(options.report, {
                ...trace, durationMs, status: 'completed',
            });
            return result;
        } catch (error) {
            const durationMs = duration(startedAt, timestamp(options.now));
            if (durationMs !== undefined) reportSettlement(options.report, {
                ...trace, durationMs, status: 'failed',
            });
            throw error;
        }
    };
}

const invokeSql: SqlInvoke = (command, args) => tauriInvoke(command, args);

export const startupTracedSelect = createStartupTracedSelect({
    getCapability: () => startupDiagnostics.getSqlTraceCapability(),
    invoke: invokeSql,
    now: () => performance.now(),
    report: report => startupDiagnostics.recordSqlFrontend(report),
});
