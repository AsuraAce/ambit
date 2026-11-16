import type { AppSettings } from '../types';
import { resolveInvokePaths } from '../services/invoke/connection';
import { getInvokeConnectionDraft, type InvokeConnectionDraft } from '../services/invoke/connectionDraft';
import type { PerfHarnessScenario, PerfHarnessStep } from './scenario';

type Outcome = { status: string; message?: string; viewCommitted?: boolean };

export interface PerfHarnessDeps {
    getSettings: () => AppSettings;
    applyInvokeConnection: (draft: InvokeConnectionDraft) => Promise<Outcome>;
    startInvokeSync: (options: Record<string, unknown>) => Promise<Outcome>;
    /** Resolves once the startup catch-up has run (or was never seen) and the app is idle. */
    waitForStartup: () => Promise<{ startupObserved: boolean }>;
    waitForIdle: () => Promise<void>;
    /** Latest completed sync trace, or null when none exists yet. */
    readTrace: () => Promise<TraceFile | null>;
    /** When this app launch began (page time origin). A trace that started earlier is left over from a previous launch. */
    launchedAtEpochMs: number;
    writeResult: (json: string) => Promise<void>;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
}

interface TraceFile {
    runId?: string;
    wallStartedAtEpochMs?: number;
}

interface StepRecord {
    kind: PerfHarnessStep['kind'];
    startedAtEpochMs: number;
    endedAtEpochMs: number;
    wallMs: number;
    outcome: Outcome | null;
    trace: unknown;
    traceFresh: boolean;
}

/** The trace writer flushes every 2 s; wait past one flush before reading the completed file. */
const TRACE_FLUSH_WAIT_MS = 2_500;

export const runPerfHarnessScenario = async (scenario: PerfHarnessScenario, deps: PerfHarnessDeps): Promise<void> => {
    const startedAtEpochMs = deps.now();
    const steps: StepRecord[] = [];
    let startup: { startupObserved: boolean; trace: unknown } | null = null;
    let lastRunId: string | undefined;
    let state: 'running' | 'done' | 'failed' = 'running';
    let error: string | undefined;

    const write = () =>
        deps.writeResult(JSON.stringify({ version: 1, label: scenario.label, state, error, startedAtEpochMs, startup, steps }, null, 2));

    const captureTrace = async (): Promise<{ trace: TraceFile | null; fresh: boolean }> => {
        await deps.sleep(TRACE_FLUSH_WAIT_MS);
        const trace = await deps.readTrace();
        // A trace file restored with a golden profile has an older start time and must never count as this run's.
        const fresh =
            trace !== null &&
            trace.runId !== lastRunId &&
            typeof trace.wallStartedAtEpochMs === 'number' &&
            trace.wallStartedAtEpochMs >= deps.launchedAtEpochMs;
        if (trace?.runId) lastRunId = trace.runId;
        return { trace, fresh };
    };

    try {
        await write();
        const { startupObserved } = await deps.waitForStartup();
        await deps.waitForIdle();
        const startupTrace = await captureTrace();
        startup = { startupObserved, trace: startupTrace.fresh ? startupTrace.trace : null };
        await write();

        for (const step of scenario.steps) {
            const settings = deps.getSettings();
            const draft = getInvokeConnectionDraft(settings);
            const stepStartedAt = deps.now();
            let outcome: Outcome | null = null;
            switch (step.kind) {
                case 'sync-now':
                    outcome = await deps.applyInvokeConnection(draft);
                    break;
                case 'switch-owner':
                    outcome = await deps.applyInvokeConnection({
                        ...draft,
                        invokeOwnerSelection: {
                            dbPath: draft.invokeOwnerSelection?.dbPath ?? resolveInvokePaths(draft.invokeAiPath).dbPath,
                            mode: 'owner',
                            ownerId: step.ownerId,
                        },
                    });
                    break;
                case 'manual-sync':
                    // The pre-explicit-setup Sync button: manual mode from the stored cursor.
                    outcome = await deps.startInvokeSync({
                        mode: 'manual',
                        afterTimestamp: settings.lastSyncedAt ?? null,
                        syncFavorites: draft.invokeSyncFavorites,
                        syncBoards: draft.invokeSyncBoards,
                        starredAs: draft.starredAs,
                        importIntermediates: draft.importIntermediates,
                        importOrphans: draft.importOrphans,
                    });
                    break;
                case 'none':
                    break;
            }
            const endedAt = deps.now();
            await deps.waitForIdle();
            const { trace, fresh } = await captureTrace();
            steps.push({
                kind: step.kind,
                startedAtEpochMs: stepStartedAt,
                endedAtEpochMs: endedAt,
                wallMs: endedAt - stepStartedAt,
                outcome,
                trace: fresh ? trace : null,
                traceFresh: fresh,
            });
            await write();
            if (outcome && outcome.status !== 'completed') {
                throw new Error(`Step ${step.kind} ended ${outcome.status}${outcome.message ? `: ${outcome.message}` : ''}`);
            }
        }
        state = 'done';
    } catch (caught) {
        state = 'failed';
        error = caught instanceof Error ? caught.message : String(caught);
    }
    await write();
};
