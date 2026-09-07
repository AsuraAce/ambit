import type { StartupRepairReport, StartupRepairStage } from '../bindings';

type Operation = StartupRepairReport['metrics'][number]['operation'];
type Counter = keyof StartupRepairReport['counters'];
const operations: readonly Operation[] = [
    'setup', 'identity-read', 'identity-paths', 'identity-matching', 'legacy-paths',
    'inventory', 'fact-read', 'fact-paths', 'fact-extraction', 'fact-write',
    'reference-write', 'batch-yield', 'filesystem-enumeration', 'inventory-build',
];

/** One invocation, fixed storage; no per-row or per-batch transport. */
export function createStartupRepairCollector(options: {
    now: () => number;
    stage: (stage: StartupRepairStage) => void | Promise<unknown>;
    report: (report: StartupRepairReport) => void | Promise<unknown>;
}) {
    let lastNow = 0;
    let clockValid = true;
    const now = () => {
        try {
            const value = options.now();
            if (Number.isFinite(value)) lastNow = Math.max(lastNow, value);
            else clockValid = false;
        } catch { clockValid = false; }
        return lastNow;
    };
    const started = now();
    const metrics = operations.map(operation => ({ operation, calls: 0, totalMs: 0, maxMs: 0 }));
    const counters: StartupRepairReport['counters'] = {
        identityRows: 0, factRows: 0, pathsChecked: 0, inventorySubmitted: 0,
        inventoryApplied: 0, factsSubmitted: 0, factsApplied: 0,
        referenceSetsSubmitted: 0, referenceSourcesReplaced: 0,
    };
    const stages = new Set<StartupRepairStage>();
    const active = new Set<() => void>();
    let finished = false;
    return {
        stage(stage: StartupRepairStage) {
            if (finished || stages.has(stage)) return;
            stages.add(stage);
            try { void Promise.resolve(options.stage(stage)).catch(() => undefined); } catch { /* Best effort only. */ }
        },
        start(operation: Operation): () => void {
            if (finished) return () => undefined;
            const metric = metrics.find(item => item.operation === operation)!;
            const start = now();
            metric.calls += 1;
            let stopped = false;
            const stop = () => {
                if (stopped) return;
                stopped = true;
                active.delete(stop);
                const duration = now() - start;
                metric.totalMs += duration;
                metric.maxMs = Math.max(metric.maxMs, duration);
            };
            active.add(stop);
            return stop;
        },
        count(counter: Counter, value: number) {
            if (!finished && Number.isSafeInteger(value) && value >= 0) counters[counter] += value;
        },
        finish(status: StartupRepairReport['status']) {
            if (finished) return;
            finished = true;
            active.forEach(stop => stop());
            const durationMs = Math.floor(now() - started);
            const rounded = metrics.map(metric => ({
                ...metric, totalMs: Math.floor(metric.totalMs), maxMs: Math.floor(metric.maxMs),
            }));
            // Enumeration is nested within path resolution, not additional elapsed time.
            const measured = rounded.reduce((sum, metric) =>
                sum + (metric.operation === 'filesystem-enumeration' ? 0 : metric.totalMs), 0);
            // Do not turn unavailable clocks or overlapping exclusive measurements into evidence.
            if (!clockValid || measured > durationMs) return;
            try {
                void Promise.resolve(options.report({ status, durationMs, unattributedMs: durationMs - measured,
                    metrics: rounded, counters: { ...counters } })).catch(() => undefined);
            } catch { /* Diagnostic transport/storage must not affect the business result. */ }
        },
    };
}

export type StartupRepairCollector = ReturnType<typeof createStartupRepairCollector>;
