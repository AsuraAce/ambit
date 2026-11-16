import { useEffect, useRef } from 'react';
import { useSync } from '../contexts/SyncContext';
import { useInvokeOwnerScopeStore } from '../stores/invokeOwnerScopeStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { runPerfHarnessScenario, type PerfHarnessDeps } from './driver';
import { PERF_HARNESS_RESULT_PATH, PERF_HARNESS_SCENARIO_PATH, parsePerfHarnessScenario } from './scenario';

const POLL_MS = 500;
const STABLE_MS = 3_000;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60_000;
/** A startup catch-up that never shows up (nothing configured) must not stall the run forever. */
const STARTUP_GIVE_UP_MS = 90_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const readAppLocal = async (path: string): Promise<string | null> => {
    const { BaseDirectory, exists, readTextFile } = await import('@tauri-apps/plugin-fs');
    if (!(await exists(path, { baseDir: BaseDirectory.AppLocalData }))) return null;
    return readTextFile(path, { baseDir: BaseDirectory.AppLocalData });
};

const writeAppLocal = async (path: string, content: string): Promise<void> => {
    const { BaseDirectory, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
    await mkdir('perf-harness', { baseDir: BaseDirectory.AppLocalData, recursive: true });
    await writeTextFile(path, content, { baseDir: BaseDirectory.AppLocalData });
};

let started = false;

/**
 * Release-gate harness (#378): runs the scenario in AppLocalData/perf-harness/scenario.json through the
 * same sync calls the UI uses, then writes result.json. Mounted only when VITE_AMBIT_PERF_HARNESS is set;
 * without a scenario file it does nothing.
 */
export function PerfHarnessDriver() {
    const sync = useSync();
    const syncRef = useRef(sync);
    syncRef.current = sync;

    useEffect(() => {
        if (started) return;
        started = true;

        let sawStartupPending = useLibraryStore.getState().isStartupCatchupPending;
        const unsubscribe = useLibraryStore.subscribe((state) => {
            if (state.isStartupCatchupPending) sawStartupPending = true;
        });

        const isIdleNow = (): boolean => {
            const library = useLibraryStore.getState();
            const owner = useInvokeOwnerScopeStore.getState();
            const phase = owner.operation?.phase;
            return (
                useSettingsStore.getState().isLoaded &&
                !library.isStartupCatchupPending &&
                !library.isImporting &&
                !syncRef.current.isInvokeSyncActive &&
                (phase === undefined || phase === 'completed' || phase === 'cancelled' || phase === 'failed') &&
                (owner.ownerScopeState.status === 'ready' || owner.ownerScopeState.status === 'offline_ready')
            );
        };

        let idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS;
        const deps: PerfHarnessDeps = {
            getSettings: () => useSettingsStore.getState().settings,
            applyInvokeConnection: (draft) => syncRef.current.applyInvokeConnection(draft),
            startInvokeSync: (options) => syncRef.current.startInvokeSync(options),
            waitForStartup: async () => {
                const startedAt = Date.now();
                while (!sawStartupPending && Date.now() - startedAt < STARTUP_GIVE_UP_MS) await sleep(POLL_MS);
                return { startupObserved: sawStartupPending };
            },
            waitForIdle: async () => {
                const startedAt = Date.now();
                let idleSince: number | null = null;
                for (;;) {
                    const now = Date.now();
                    if (isIdleNow()) {
                        idleSince ??= now;
                        if (now - idleSince >= STABLE_MS) return;
                    } else {
                        idleSince = null;
                    }
                    if (now - startedAt > idleTimeoutMs) throw new Error('Timed out waiting for the app to become idle.');
                    await sleep(POLL_MS);
                }
            },
            readTrace: async () => {
                const text = await readAppLocal('invoke-sync-trace/invoke-sync-trace-last-completed.json');
                return text ? (JSON.parse(text) as { runId?: string; wallStartedAtEpochMs?: number }) : null;
            },
            writeResult: (json) => writeAppLocal(PERF_HARNESS_RESULT_PATH, json),
            launchedAtEpochMs: performance.timeOrigin,
            now: () => Date.now(),
            sleep,
        };

        void (async () => {
            try {
                const text = await readAppLocal(PERF_HARNESS_SCENARIO_PATH);
                if (!text) return;
                const scenario = parsePerfHarnessScenario(text);
                if (scenario.idleTimeoutMin) idleTimeoutMs = scenario.idleTimeoutMin * 60_000;
                await runPerfHarnessScenario(scenario, deps);
            } catch (error) {
                await writeAppLocal(
                    PERF_HARNESS_RESULT_PATH,
                    JSON.stringify({ version: 1, state: 'failed', error: error instanceof Error ? error.message : String(error) })
                ).catch(() => undefined);
            }
        })();

        return () => unsubscribe();
    }, []);

    return null;
}

export default PerfHarnessDriver;
