import { commands, type SqlValue } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';
import { getDb } from './connection';

const toSqlValue = (value: unknown): SqlValue => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    // The plugin sent values as JSON, where NaN and Infinity become NULL. The search parser
    // relies on that: "steps:abc" binds Number('abc') and must match nothing, not fail.
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    throw new TypeError(`A read-only select cannot bind a ${typeof value} parameter.`);
};

/**
 * Runs one long read on its own read-only connection instead of the plugin pool, so a
 * reload or exit stops it within milliseconds rather than waiting for it to finish.
 * A stopped read rejects; that only happens while the page is going away.
 */
export const selectReadonly = async <T>(sql: string, params: readonly unknown[] = []): Promise<T> => {
    // The plugin opens and migrates the library first; this connection never creates it.
    await getDb();
    const rows = await unwrap(commands.selectReadonly(sql, params.map(toSqlValue)));
    return rows as T;
};
