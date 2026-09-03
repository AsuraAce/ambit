import { commands, type StartupDiagnosticEvent, type StartupPhase, type StartupPhaseStatus, type StartupCacheAction } from '../bindings';
import { isTauriRuntime } from '../services/runtime';

type DiagnosticSink = (event: StartupDiagnosticEvent) => void;
type FinishPhase = (status?: StartupPhaseStatus) => void;

export function createStartupDiagnostics(send: DiagnosticSink, now: () => number, launchId: string) {
    const origin = now();
    let emitted = 0;
    const marks = new Set<StartupPhase>();
    const emit = (phase: StartupPhase, status: StartupPhaseStatus, durationMs: number | null, cacheAction: StartupCacheAction | null) => {
        if (emitted >= 256) return;
        emitted += 1;
        try {
            send({ launchId, phase, status, elapsedMs: Math.max(0, Math.round(now() - origin)), durationMs, cacheAction });
        } catch {
            // Diagnostics must never interrupt library preparation.
        }
    };
    return {
        start(phase: StartupPhase, cacheAction: StartupCacheAction | null = null): FinishPhase {
            const startedAt = now();
            let finished = false;
            emit(phase, 'started', null, cacheAction);
            return (status = 'completed') => {
                if (finished) return;
                finished = true;
                emit(phase, status, Math.max(0, Math.round(now() - startedAt)), cacheAction);
            };
        },
        mark(phase: StartupPhase) {
            if (marks.has(phase)) return;
            marks.add(phase);
            emit(phase, 'completed', null, null);
        },
    };
}

export const startupDiagnostics = createStartupDiagnostics(event => {
    if (!isTauriRuntime()) return;
    void commands.recordStartupDiagnostic(event).catch(() => undefined);
}, () => performance.now(), crypto.randomUUID());

export async function measureStartupPhase<T>(phase: StartupPhase, work: () => Promise<T>, cacheAction: StartupCacheAction | null = null): Promise<T> {
    const finish = startupDiagnostics.start(phase, cacheAction);
    try {
        const result = await work();
        finish();
        return result;
    } catch (error) {
        finish('failed');
        throw error;
    }
}
