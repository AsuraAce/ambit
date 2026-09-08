import { commands, type StartupLifecycleStage } from '../bindings';
import { startupDiagnostics } from './startupDiagnostics';

interface StartupLifecycleDiagnosticsOptions {
    subscribe: (listener: (launchId: string) => void) => () => void;
    transport: (launchId: string, stage: StartupLifecycleStage) => Promise<unknown>;
}

export interface StartupLifecycleDiagnostics {
    record: (stage: StartupLifecycleStage) => void;
}

const MAX_LIFECYCLE_STAGES = 9;

export const createStartupLifecycleDiagnostics = ({
    subscribe,
    transport,
}: StartupLifecycleDiagnosticsOptions): StartupLifecycleDiagnostics => {
    let launchId: string | null = null;
    const recordedStages = new Set<StartupLifecycleStage>();

    try {
        subscribe(resolvedLaunchId => {
            launchId = resolvedLaunchId;
        });
    } catch {
        // Diagnostics transport setup must not interrupt application close.
    }

    return {
        record: stage => {
            if (!launchId || recordedStages.has(stage) || recordedStages.size >= MAX_LIFECYCLE_STAGES) return;
            recordedStages.add(stage);
            try {
                void transport(launchId, stage).catch(() => undefined);
            } catch {
                // Diagnostics must not delay or interrupt application close.
            }
        },
    };
};

export const startupLifecycle = createStartupLifecycleDiagnostics({
    subscribe: startupDiagnostics.subscribe,
    transport: (launchId, stage) => commands.recordStartupLifecycle(launchId, stage),
});
