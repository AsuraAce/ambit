import { commands, type InvokeSourceValue } from '../../bindings';
import { unwrap } from '../../utils/spectaUtils';

/**
 * Read-only access to InvokeAI's own database. Every query runs through the
 * `select_invoke_source` command, which never writes InvokeAI's files (#364).
 */
export interface InvokeSourceDatabase {
    select<T>(query: string, bindValues?: unknown[]): Promise<T>;
}

const toSourceParam = (value: unknown): InvokeSourceValue | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    throw new Error(`Unsupported InvokeAI query parameter type: ${typeof value}`);
};

export const openInvokeSourceDatabase = async (dbPath: string): Promise<InvokeSourceDatabase> => {
    const db: InvokeSourceDatabase = {
        select: async <T>(query: string, bindValues: unknown[] = []): Promise<T> => {
            const result = await unwrap(commands.selectInvokeSource(dbPath, query, bindValues.map(toSourceParam)));
            return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index] ?? null]))) as T;
        },
    };
    // Fail at open time, as the SQL plugin did, when the path is out of scope or unreadable.
    await db.select('SELECT 1');
    return db;
};
