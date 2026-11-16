/** Scenario file for the release-gate performance harness (#378), read from AppLocalData. */
export type PerfHarnessStep = { kind: 'sync-now' } | { kind: 'switch-owner'; ownerId: string } | { kind: 'manual-sync' } | { kind: 'none' };

export interface PerfHarnessScenario {
    label: string;
    steps: PerfHarnessStep[];
}

export const PERF_HARNESS_SCENARIO_PATH = 'perf-harness/scenario.json';
export const PERF_HARNESS_RESULT_PATH = 'perf-harness/result.json';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Throws on anything it does not know: a typo must fail the run, not silently measure nothing. */
export const parsePerfHarnessScenario = (text: string): PerfHarnessScenario => {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || typeof raw.label !== 'string' || !raw.label || !Array.isArray(raw.steps)) {
        throw new Error('Scenario needs a label and a steps array.');
    }
    const steps = raw.steps.map((step: unknown): PerfHarnessStep => {
        if (!isRecord(step)) throw new Error('Scenario step must be an object.');
        switch (step.kind) {
            case 'sync-now':
            case 'manual-sync':
            case 'none':
                return { kind: step.kind };
            case 'switch-owner':
                if (typeof step.ownerId !== 'string' || !step.ownerId) throw new Error('switch-owner needs an ownerId.');
                return { kind: 'switch-owner', ownerId: step.ownerId };
            default:
                throw new Error(`Unknown scenario step: ${String(step.kind)}`);
        }
    });
    return { label: raw.label, steps };
};
