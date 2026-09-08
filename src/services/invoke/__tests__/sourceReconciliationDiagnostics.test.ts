import { describe, expect, it, vi } from 'vitest';
import { createStartupRepairCollector } from '../../../utils/startupRepairDiagnostics';
import { createInvokeImagePathResolver } from '../pathResolver';
import { reconcileInvokeSourceFacts } from '../sourceReconciliation';

const mocks = vi.hoisted(() => ({
    reconcileInvokeOwnerInventory: vi.fn(),
    reconcileInvokeImageSources: vi.fn(),
    replaceInvokeImageReferences: vi.fn(),
    verifyImagePaths: vi.fn(),
}));

vi.mock('../../../bindings', () => ({ commands: mocks }));

const root = 'D:/InvokeAI';
const dbPath = `${root}/databases/invokeai.db`;
const batchSize = 500;

interface SourceRow {
    source_rowid: number;
    image_name: string;
    image_subfolder: string;
    image_category: string;
    image_origin: string;
    user_id: string;
    metadata_blob: Record<string, never>;
}

interface TraceEvent {
    kind: string;
    args: unknown[];
    result?: unknown;
}

type DiagnosticMode = 'absent' | 'enabled' | 'throwing';
type TerminalStatus = 'completed' | 'failed' | 'cancelled';

const makeRows = (): SourceRow[] => Array.from({ length: 501 }, (_, index) => {
    const ordinal = index + 1;
    const imageName = ordinal === 1 ? 'legacy-safe.png'
        : ordinal === 2 || ordinal === 3 ? 'ambiguous.png'
            : `image-${ordinal}.png`;
    const subfolder = ordinal === 2 ? 'first'
        : ordinal === 3 ? 'second'
            : 'nested';
    return {
        source_rowid: ordinal,
        image_name: imageName,
        image_subfolder: subfolder,
        image_category: ordinal % 2 === 0 ? 'control' : 'general',
        image_origin: ordinal % 2 === 0 ? 'external' : 'internal',
        user_id: ordinal % 2 === 0 ? 'owner-b' : 'owner-a',
        metadata_blob: {},
    };
});

const compactSql = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const createDatabase = (rows: readonly SourceRow[], rowIdSupported: boolean, trace: TraceEvent[]) => ({
    select: vi.fn(async (sql: string, params: unknown[] = []) => {
        trace.push({ kind: 'select', args: [compactSql(sql), params] });
        if (sql.startsWith('SELECT rowid AS source_rowid')) {
            if (!rowIdSupported) throw new Error('no such column: rowid');
            return [{ source_rowid: 1 }];
        }
        if (sql.includes('SELECT count(*) as count FROM images')) {
            const selected = sql.includes('i.user_id = ?')
                ? rows.filter(row => row.user_id === params[0])
                : rows;
            return [{ count: selected.length }];
        }
        if (!sql.includes('FROM images i')) return [];

        const selected = sql.includes('i.user_id = ?')
            ? rows.filter(row => row.user_id === params[0])
            : rows;
        if (rowIdSupported) {
            const cursor = Number(params.at(-1) ?? 0);
            return selected.filter(row => row.source_rowid > cursor).slice(0, batchSize);
        }
        const offset = Number(sql.match(/OFFSET (\d+)/)?.[1] ?? 0);
        return selected.slice(offset, offset + batchSize);
    }),
});

const configureBusinessSeams = (trace: TraceEvent[], failWrites: boolean) => {
    mocks.reconcileInvokeOwnerInventory.mockImplementation(async (input: unknown) => {
        const result = { status: 'ok' as const, data: { activeUpdated: 3, removedUpdated: 2 } };
        trace.push({ kind: 'inventory', args: [input], result });
        return result;
    });
    mocks.verifyImagePaths.mockImplementation(async (paths: string[]) => {
        const result = {
            status: 'ok' as const,
            data: paths.filter(path => path === `${root}/outputs/images/legacy-safe.png`),
        };
        trace.push({ kind: 'verify-paths', args: [paths], result });
        return result;
    });
    mocks.reconcileInvokeImageSources.mockImplementation(async (updates: unknown[]) => {
        const result = failWrites
            ? { status: 'error' as const, error: 'source write unavailable' }
            : { status: 'ok' as const, data: { activeUpdated: updates.length, removedUpdated: 1 } };
        trace.push({ kind: 'source-write', args: [updates], result });
        return result;
    });
    mocks.replaceInvokeImageReferences.mockImplementation(async (references: unknown[]) => {
        const result = {
            status: 'ok' as const,
            data: { sourcesReplaced: references.length, referencesWritten: 0, skippedMissingSources: 0 },
        };
        trace.push({ kind: 'reference-write', args: [references], result });
        return result;
    });
};

const createDiagnostics = (mode: DiagnosticMode) => {
    if (mode === 'absent') return { collector: undefined, report: undefined };
    let now = 0;
    const report = vi.fn();
    const stage = mode === 'throwing'
        ? vi.fn(() => { throw new Error('diagnostic stage unavailable'); })
        : vi.fn();
    const collector = createStartupRepairCollector({
        now: () => ++now,
        stage,
        report: mode === 'throwing'
            ? () => { throw new Error('diagnostic report unavailable'); }
            : report,
    });
    return { collector, report };
};

const runScenario = async ({
    mode,
    rowIdSupported,
    scopeMode = 'owner',
    failWrites = false,
    cancelled = false,
}: {
    mode: DiagnosticMode;
    rowIdSupported: boolean;
    scopeMode?: 'owner' | 'all';
    failWrites?: boolean;
    cancelled?: boolean;
}) => {
    const trace: TraceEvent[] = [];
    const rows = makeRows();
    const database = createDatabase(rows, rowIdSupported, trace);
    configureBusinessSeams(trace, failWrites);
    const diagnostics = createDiagnostics(mode);
    const controller = new AbortController();
    if (cancelled) controller.abort();
    const scope = scopeMode === 'owner'
        ? { mode: 'owner' as const, ownerId: 'owner-a', dbPath, imagesRoot: root }
        : { mode: 'all' as const, dbPath, imagesRoot: root };

    try {
        const value = await reconcileInvokeSourceFacts({
            db: database as never,
            columns: new Set(['image_subfolder', 'image_category', 'image_origin', 'user_id', 'metadata_json']),
            pathResolver: createInvokeImagePathResolver(root, async () => rows.map(row => (
                `outputs/images/${row.image_subfolder}/${row.image_name}`
            ))),
            scope,
            onProgress: vi.fn(),
            signal: controller.signal,
            diagnostics: diagnostics.collector,
        });
        diagnostics.collector?.finish('completed');
        return { trace, outcome: { status: 'completed' as const, value }, report: diagnostics.report };
    } catch (error) {
        const status: TerminalStatus = cancelled ? 'cancelled' : 'failed';
        diagnostics.collector?.finish(status);
        return {
            trace,
            outcome: { status, message: error instanceof Error ? error.message : String(error) },
            report: diagnostics.report,
        };
    }
};

describe('source reconciliation diagnostics parity', () => {
    it('preserves selected-owner rowid reconciliation calls, results, aliases, and bounded evidence', async () => {
        const absent = await runScenario({ mode: 'absent', rowIdSupported: true });
        const enabled = await runScenario({ mode: 'enabled', rowIdSupported: true });
        const throwing = await runScenario({ mode: 'throwing', rowIdSupported: true });

        expect(enabled.outcome).toEqual(absent.outcome);
        expect(throwing.outcome).toEqual(absent.outcome);
        expect(enabled.trace).toEqual(absent.trace);
        expect(throwing.trace).toEqual(absent.trace);
        expect(absent.outcome).toEqual({ status: 'completed', value: 258 });

        const rowIdBatches = absent.trace
            .filter(event => event.kind === 'select' && String(event.args[0]).includes('ORDER BY i.rowid ASC'));
        expect(rowIdBatches.map(event => event.args[1])).toEqual([
            [0], [500], ['owner-a', 0],
        ]);

        const inventory = absent.trace.find(event => event.kind === 'inventory')?.args[0] as {
            images: Array<{ id: string; invokeOwnerId: string }>;
        };
        expect(inventory.images).toEqual(expect.arrayContaining([
            { id: `${root}/outputs/images/nested/legacy-safe.png`, invokeOwnerId: 'owner-a' },
            { id: `${root}/outputs/images/legacy-safe.png`, invokeOwnerId: 'owner-a' },
            { id: `${root}/outputs/images/first/ambiguous.png`, invokeOwnerId: 'owner-b' },
            { id: `${root}/outputs/images/second/ambiguous.png`, invokeOwnerId: 'owner-a' },
        ]));
        expect(inventory.images.map(image => image.id)).not.toContain(`${root}/outputs/images/ambiguous.png`);
        const sourceWrites = absent.trace.filter(event => event.kind === 'source-write');
        expect(sourceWrites.flatMap(event => event.args[0] as Array<{ id: string; invokeOwnerId: string }>))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ id: `${root}/outputs/images/legacy-safe.png`, invokeOwnerId: 'owner-a' }),
            ]));
        expect(sourceWrites.flatMap(event => event.args[0] as Array<{ invokeOwnerId: string }>))
            .toEqual(expect.arrayContaining([expect.objectContaining({ invokeOwnerId: 'owner-a' })]));
        expect(sourceWrites.flatMap(event => event.args[0] as Array<{ invokeOwnerId: string }>))
            .not.toEqual(expect.arrayContaining([expect.objectContaining({ invokeOwnerId: 'owner-b' })]));

        const report = enabled.report?.mock.calls[0]?.[0];
        expect(report).toMatchObject({
            status: 'completed',
            counters: { identityRows: 501, factRows: 251 },
        });
        expect(report?.metrics).toHaveLength(14);
        expect(Object.keys(report?.counters ?? {})).toHaveLength(9);
    });

    it('preserves ordered compatibility-offset reconciliation calls and results', async () => {
        const absent = await runScenario({ mode: 'absent', rowIdSupported: false, scopeMode: 'all' });
        const enabled = await runScenario({ mode: 'enabled', rowIdSupported: false, scopeMode: 'all' });
        const throwing = await runScenario({ mode: 'throwing', rowIdSupported: false, scopeMode: 'all' });

        expect(enabled.outcome).toEqual(absent.outcome);
        expect(throwing.outcome).toEqual(absent.outcome);
        expect(enabled.trace).toEqual(absent.trace);
        expect(throwing.trace).toEqual(absent.trace);
        const offsetBatches = absent.trace
            .filter(event => event.kind === 'select' && String(event.args[0]).includes('OFFSET'));
        expect(offsetBatches).toHaveLength(4);
        expect(offsetBatches.map(event => String(event.args[0]).match(/OFFSET \d+/)?.[0]))
            .toEqual(['OFFSET 0', 'OFFSET 500', 'OFFSET 0', 'OFFSET 500']);
        offsetBatches.forEach(event => expect(event.args[0]).not.toContain('i.rowid > ?'));
    });

    it('preserves failed and cancelled business outcomes when diagnostic collection is enabled', async () => {
        const absentFailure = await runScenario({ mode: 'absent', rowIdSupported: true, failWrites: true });
        const enabledFailure = await runScenario({ mode: 'enabled', rowIdSupported: true, failWrites: true });
        const throwingFailure = await runScenario({ mode: 'throwing', rowIdSupported: true, failWrites: true });
        expect(enabledFailure.outcome).toEqual(absentFailure.outcome);
        expect(throwingFailure.outcome).toEqual(absentFailure.outcome);
        expect(enabledFailure.trace).toEqual(absentFailure.trace);
        expect(throwingFailure.trace).toEqual(absentFailure.trace);
        expect(absentFailure.outcome).toEqual({ status: 'failed', message: 'source write unavailable' });
        expect(enabledFailure.report?.mock.calls[0]?.[0]).toMatchObject({ status: 'failed' });

        const absentCancellation = await runScenario({ mode: 'absent', rowIdSupported: true, cancelled: true });
        const enabledCancellation = await runScenario({ mode: 'enabled', rowIdSupported: true, cancelled: true });
        const throwingCancellation = await runScenario({ mode: 'throwing', rowIdSupported: true, cancelled: true });
        expect(enabledCancellation.outcome).toEqual(absentCancellation.outcome);
        expect(throwingCancellation.outcome).toEqual(absentCancellation.outcome);
        expect(enabledCancellation.trace).toEqual(absentCancellation.trace);
        expect(throwingCancellation.trace).toEqual(absentCancellation.trace);
        expect(absentCancellation.outcome).toEqual({ status: 'cancelled', message: 'Aborted' });
        expect(enabledCancellation.report?.mock.calls[0]?.[0]).toMatchObject({ status: 'cancelled' });
    });
});
