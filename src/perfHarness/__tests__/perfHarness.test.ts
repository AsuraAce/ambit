import { describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../../types';
import { runPerfHarnessScenario, type PerfHarnessDeps } from '../driver';
import { parsePerfHarnessScenario } from '../scenario';

const settings = {
    invokeAiPath: 'D:/ambit-378/invoke-root',
    invokeOwnerSelection: { dbPath: 'D:/ambit-378/invoke-root/databases/invokeai.db', mode: 'owner', ownerId: 'system' },
    lastSyncedAt: 1234,
} as AppSettings;

const makeDeps = (overrides: Partial<PerfHarnessDeps> = {}) => {
    const results: Array<Record<string, unknown>> = [];
    let traceCounter = 0;
    const deps: PerfHarnessDeps = {
        getSettings: () => settings,
        applyInvokeConnection: vi.fn().mockResolvedValue({ status: 'completed', viewCommitted: true }),
        startInvokeSync: vi.fn().mockResolvedValue({ status: 'completed' }),
        waitForStartup: vi.fn().mockResolvedValue({ startupObserved: true }),
        waitForIdle: vi.fn().mockResolvedValue(undefined),
        readTrace: vi.fn().mockImplementation(async () => ({ runId: `run-${traceCounter++}`, wallStartedAtEpochMs: 5000 })),
        writeResult: vi.fn().mockImplementation(async (json: string) => {
            results.push(JSON.parse(json) as Record<string, unknown>);
        }),
        launchedAtEpochMs: 4000,
        now: () => 1000,
        sleep: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
    return { deps, last: () => results[results.length - 1] };
};

describe('parsePerfHarnessScenario', () => {
    it('accepts a positive idle timeout and refuses anything else', () => {
        const text = (idleTimeoutMin: unknown) => JSON.stringify({ label: 'x', steps: [], idleTimeoutMin });
        expect(parsePerfHarnessScenario(text(45)).idleTimeoutMin).toBe(45);
        expect(() => parsePerfHarnessScenario(text(0))).toThrow(/idleTimeoutMin/);
        expect(() => parsePerfHarnessScenario(text('45'))).toThrow(/idleTimeoutMin/);
    });

    it('refuses an unknown step so a typo cannot silently measure nothing', () => {
        expect(() => parsePerfHarnessScenario(JSON.stringify({ label: 'x', steps: [{ kind: 'sync-nwo' }] }))).toThrow(
            /Unknown scenario step/
        );
    });

    it('needs an owner id to switch owners', () => {
        expect(() => parsePerfHarnessScenario(JSON.stringify({ label: 'x', steps: [{ kind: 'switch-owner' }] }))).toThrow(/ownerId/);
    });

    it('parses every supported step', () => {
        const scenario = parsePerfHarnessScenario(
            JSON.stringify({
                label: 'x',
                steps: [{ kind: 'none' }, { kind: 'sync-now' }, { kind: 'manual-sync' }, { kind: 'switch-owner', ownerId: 'o' }],
            })
        );
        expect(scenario.steps.map((step) => step.kind)).toEqual(['none', 'sync-now', 'manual-sync', 'switch-owner']);
    });
});

describe('runPerfHarnessScenario', () => {
    it('runs sync-now through the connection apply the Settings button uses', async () => {
        const { deps, last } = makeDeps();
        await runPerfHarnessScenario({ label: 'c1', steps: [{ kind: 'sync-now' }] }, deps);
        expect(deps.applyInvokeConnection).toHaveBeenCalledWith(expect.objectContaining({ invokeAiPath: settings.invokeAiPath }));
        expect(last().state).toBe('done');
    });

    it('switches owner by replacing only the owner selection', async () => {
        const { deps } = makeDeps();
        await runPerfHarnessScenario({ label: 'c3', steps: [{ kind: 'switch-owner', ownerId: 'oscar' }] }, deps);
        expect(deps.applyInvokeConnection).toHaveBeenCalledWith(
            expect.objectContaining({
                invokeOwnerSelection: { dbPath: settings.invokeOwnerSelection?.dbPath, mode: 'owner', ownerId: 'oscar' },
            })
        );
    });

    it('runs manual sync from the stored cursor, not a full resync', async () => {
        const { deps } = makeDeps();
        await runPerfHarnessScenario({ label: 'c6', steps: [{ kind: 'manual-sync' }, { kind: 'manual-sync' }] }, deps);
        expect(deps.startInvokeSync).toHaveBeenCalledTimes(2);
        expect(deps.startInvokeSync).toHaveBeenCalledWith(expect.objectContaining({ mode: 'manual', afterTimestamp: 1234 }));
    });

    it('records a failure and stops when a step is not completed', async () => {
        const { deps, last } = makeDeps({ applyInvokeConnection: vi.fn().mockResolvedValue({ status: 'busy', viewCommitted: false }) });
        await runPerfHarnessScenario({ label: 'c1', steps: [{ kind: 'sync-now' }, { kind: 'sync-now' }] }, deps);
        expect(last().state).toBe('failed');
        expect(String(last().error)).toMatch(/busy/);
        expect(deps.applyInvokeConnection).toHaveBeenCalledTimes(1);
    });

    it('keeps a trace for a step only when it is new, so a skipped sync is not credited with the last one', async () => {
        const { deps, last } = makeDeps({ readTrace: vi.fn().mockResolvedValue({ runId: 'same-run', wallStartedAtEpochMs: 5000 }) });
        await runPerfHarnessScenario({ label: 'c1', steps: [{ kind: 'sync-now' }] }, deps);
        const [step] = last().steps as Array<{ traceFresh: boolean; trace: unknown }>;
        expect(step?.traceFresh).toBe(false);
        expect(step?.trace).toBeNull();
        expect((last().startup as { trace: unknown }).trace).toEqual({ runId: 'same-run', wallStartedAtEpochMs: 5000 });
    });

    it('ignores a trace that started before this launch, such as one restored with a golden profile', async () => {
        const { deps, last } = makeDeps({
            readTrace: vi.fn().mockResolvedValue({ runId: 'stale-run', wallStartedAtEpochMs: 3999 }),
        });
        await runPerfHarnessScenario({ label: 'c1', steps: [{ kind: 'sync-now' }] }, deps);
        expect((last().startup as { trace: unknown }).trace).toBeNull();
        const [step] = last().steps as Array<{ traceFresh: boolean }>;
        expect(step?.traceFresh).toBe(false);
    });
});
