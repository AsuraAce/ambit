import { commands, type StartupDiagnosticEvent, type StartupPhase, type StartupPhaseStatus, type StartupCacheAction, type StartupDatabaseRole, type StartupFailureKind } from '../bindings';
import { isTauriRuntime } from '../services/runtime';
import { createStartupHeartbeat, type StartupHeartbeat } from './startupHeartbeat';
import type { StartupRepairDecision } from '../bindings';
import { createStartupRepairCollector } from './startupRepairDiagnostics';
import type { StartupSqlFrontendReport, StartupSqlTraceCapability } from './startupSqlTrace';

type DiagnosticSink = (event: StartupDiagnosticEvent) => void | Promise<unknown>;
type FinishPhase = (status?: StartupPhaseStatus, error?: unknown) => void;
type PendingDiagnosticEvent = Omit<StartupDiagnosticEvent, 'launchId'>;

interface StartupLaunch {
    launchId: string;
    processElapsedMs: number;
    sqlTraceEnabled?: boolean;
}

interface BootstrapDiagnosticEvent {
    phase: StartupPhase;
    status: StartupPhaseStatus;
    elapsedMs: number;
    durationMs: number | null;
    cacheAction: StartupCacheAction | null;
    failureKind?: StartupFailureKind;
}

interface StartupDiagnosticBridgeOptions {
    now: () => number;
    send: DiagnosticSink;
    getLaunch: () => Promise<StartupLaunch>;
    maxBufferedEvents?: number;
    originMs?: number;
    onMark?: (phase: StartupPhase) => void;
    recordSqlFrontend?: (report: StartupSqlFrontendReport) => void | Promise<unknown>;
}

interface StartupBootstrap {
    takeEvents: () => BootstrapDiagnosticEvent[];
    markReactMounted: () => void;
    markReady: () => void;
    showFailure: () => void;
    markTransportUnavailable: () => void;
    setFailureLaunchId: (launchId: string) => void;
}

declare global {
    interface Window {
        __AMBIT_STARTUP_BOOTSTRAP__?: StartupBootstrap;
    }
}

const databaseRoles: Partial<Record<StartupPhase, StartupDatabaseRole>> = {
    'database-pragmas': 'ambit',
    'database-indexes': 'ambit',
    'maintenance-counts': 'ambit',
    'owner-source-open': 'invoke-source',
    'owner-source-schema': 'invoke-source',
    'owner-source-images': 'invoke-source',
    'owner-source-boards': 'invoke-source',
    'gallery-rows': 'ambit',
    'gallery-count': 'ambit',
    'gallery-global-count': 'ambit',
    'statistics-media': 'ambit',
    'statistics-steps': 'ambit',
    'statistics-models': 'ambit',
    'facet-counts': 'ambit',
    'owner-fingerprint': 'invoke-source',
    'owner-source-repair': 'mixed',
    'owner-board-read': 'invoke-source',
    'owner-board-write': 'ambit',
    'owner-visibility': 'ambit',
    'owner-board-verification': 'ambit',
    'owner-preparation': 'mixed',
    'owner-cache': 'ambit',
    'collection-rows': 'ambit',
    'collection-counts': 'ambit',
};

// Classification is for diagnostics only, never authorization to retry a write.
const classifyFailure = (error: unknown): StartupFailureKind => {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    if (/\bSQLITE_LOCKED\b|database (?:table|schema) is locked/i.test(message)) return 'database-locked';
    if (/\bSQLITE_BUSY(?:_[A-Z]+)?\b|database is (?:locked|busy)/i.test(message)) return 'database-busy';
    return 'other';
};

const terminalPhases = new Set<StartupPhase>([
    'ready', 'splash', 'first-page', 'startup-failure', 'react-mount', 'frontend-entry', 'invoke-catch-up', 'renderer-stall',
]);

const removeOldestNonTerminal = (events: PendingDiagnosticEvent[]): boolean => {
    const index = events.findIndex(event => !terminalPhases.has(event.phase));
    if (index < 0) return false;
    events.splice(index, 1);
    return true;
};

const terminalEventKey = (event: PendingDiagnosticEvent): string => `${event.phase}:${event.status}`;

export function createStartupDiagnosticBridge({
    now,
    send,
    getLaunch,
    maxBufferedEvents = 256,
    originMs = 0,
    onMark,
    recordSqlFrontend,
}: StartupDiagnosticBridgeOptions) {
    const buffered: PendingDiagnosticEvent[] = [];
    const marks = new Set<StartupPhase>();
    const launchIdListeners = new Set<(launchId: string) => void>();
    const markListeners = new Set<(phase: StartupPhase) => void>();
    const failureListeners = new Set<(phase: StartupPhase) => void>();
    let launchId: string | null = null;
    let connecting: Promise<void> | null = null;
    let startupFailureObserved = false;
    let sentNonTerminalEvents = 0;
    const terminalEvents = new Set<string>();
    const repairEvents = new Map<string, PendingDiagnosticEvent>();
    const deliveredRepairEvents = new Set<string>();
    let repairClaimed = false;
    let sqlTraceEnabled = false;
    let rendererEntryAt: number | null = null;

    const deliverRepair = (key: string, event: PendingDiagnosticEvent) => {
        if (!launchId || deliveredRepairEvents.has(key)) return;
        deliveredRepairEvents.add(key);
        try { void Promise.resolve(send({ ...event, launchId })).catch(() => undefined); }
        catch { /* Best effort; never retry a failed transport. */ }
    };

    // Seven fixed records have their own allowance; never evict terminal milestones.
    const sendRepair = (key: string, event: PendingDiagnosticEvent) => {
        if (repairEvents.has(key)) return;
        repairEvents.set(key, event);
        deliverRepair(key, event);
    };

    const deliver = (pendingEvent: PendingDiagnosticEvent) => {
        const isTerminal = terminalPhases.has(pendingEvent.phase);
        if (launchId) {
            if (!isTerminal && sentNonTerminalEvents >= maxBufferedEvents) return;
            if (!isTerminal) sentNonTerminalEvents += 1;
            try {
                send({ ...pendingEvent, launchId });
            } catch {
                // Diagnostics must never interrupt startup.
            }
            return;
        }
        if (buffered.length < maxBufferedEvents) {
            buffered.push(pendingEvent);
        } else if (terminalPhases.has(pendingEvent.phase) && removeOldestNonTerminal(buffered)) {
            buffered.push(pendingEvent);
        }
    };

    const admit = (pendingEvent: PendingDiagnosticEvent) => {
        if (terminalPhases.has(pendingEvent.phase)) {
            const key = terminalEventKey(pendingEvent);
            if (terminalEvents.has(key)) return;
            terminalEvents.add(key);
        }
        deliver(pendingEvent);
    };

    const makeEvent = (
        phase: StartupPhase,
        status: StartupPhaseStatus,
        durationMs: number | null,
        cacheAction: StartupCacheAction | null,
        failureKind?: StartupFailureKind,
        elapsedMs = Math.max(0, Math.round(now() - originMs)),
    ): PendingDiagnosticEvent => ({
        phase,
        status,
        elapsedMs,
        durationMs,
        cacheAction,
        ...(failureKind ? { failureKind } : {}),
    });

    const notifyFailure = (phase: StartupPhase) => {
        if (phase !== 'startup-failure') return;
        startupFailureObserved = true;
        failureListeners.forEach(listener => {
            try {
                listener(phase);
            } catch {
                // Diagnostics lifecycle callbacks must not affect startup.
            }
        });
    };

    return {
        async connect(): Promise<void> {
            if (launchId) return;
            if (!connecting) {
                let launchPromise: Promise<StartupLaunch>;
                try {
                    launchPromise = getLaunch();
                } catch {
                    launchPromise = Promise.reject(new Error('Native startup diagnostics are unavailable'));
                }
                connecting = launchPromise.then(launch => {
                    launchId = launch.launchId;
                    sqlTraceEnabled = launch.sqlTraceEnabled === true;
                    launchIdListeners.forEach(listener => {
                        try {
                            listener(launch.launchId);
                        } catch {
                            // A UI listener must not strand buffered diagnostics.
                        }
                    });
                    if (typeof window !== 'undefined') {
                        try {
                            window.__AMBIT_STARTUP_BOOTSTRAP__?.setFailureLaunchId(launch.launchId);
                        } catch {
                            // The fallback UI is optional for diagnostics delivery.
                        }
                    }
                    const queued = buffered.splice(0);
                    queued.forEach(deliver);
                    repairEvents.forEach((event, key) => deliverRepair(key, event));
                }).catch(() => undefined);
            }
            await connecting;
        },
        getLaunchId: () => launchId,
        getSqlTraceCapability(): StartupSqlTraceCapability | undefined {
            if (!launchId || !sqlTraceEnabled || rendererEntryAt === null
                || marks.has('ready') || startupFailureObserved
                || now() - rendererEntryAt >= 180_000) return undefined;
            return { launchId };
        },
        recordSqlFrontend(report: StartupSqlFrontendReport) {
            try {
                void Promise.resolve(recordSqlFrontend?.(report)).catch(() => undefined);
            } catch {
                // Startup tracing is diagnostic-only and must not affect library work.
            }
        },
        repairDecision(decision: StartupRepairDecision) {
            if (marks.has('ready') || startupFailureObserved) return;
            sendRepair('decision', { ...makeEvent('owner-repair-decision', 'completed', null, null), repairDecision: decision });
        },
        claimRepair() {
            if (repairClaimed || marks.has('ready') || startupFailureObserved) return undefined;
            repairClaimed = true;
            return createStartupRepairCollector({
                now,
                stage: repairStage => sendRepair(`stage:${repairStage}`, {
                    ...makeEvent('owner-repair-stage', 'completed', null, null), repairStage,
                }),
                report: repairReport => sendRepair('report', {
                    ...makeEvent('owner-repair-report', repairReport.status, repairReport.durationMs, null), repairReport,
                }),
            });
        },
        subscribe(listener: (resolvedLaunchId: string) => void) {
            launchIdListeners.add(listener);
            if (launchId) {
                try {
                    listener(launchId);
                } catch {
                    // Subscription callbacks are best-effort UI updates.
                }
            }
            return () => launchIdListeners.delete(listener);
        },
        subscribeMarks(listener: (phase: StartupPhase) => void) {
            markListeners.add(listener);
            marks.forEach(phase => {
                try {
                    listener(phase);
                } catch {
                    // Subscription callbacks are best-effort UI updates.
                }
            });
            return () => markListeners.delete(listener);
        },
        subscribeFailures(listener: (phase: StartupPhase) => void) {
            failureListeners.add(listener);
            if (startupFailureObserved) {
                try {
                    listener('startup-failure');
                } catch {
                    // Diagnostics lifecycle callbacks must not affect startup.
                }
            }
            return () => failureListeners.delete(listener);
        },
        start(phase: StartupPhase, cacheAction: StartupCacheAction | null = null, attempt = 1): FinishPhase {
            const startedAt = now();
            let finished = false;
            admit({ ...makeEvent(phase, 'started', null, cacheAction), ...(databaseRoles[phase] ? { databaseRole: databaseRoles[phase], attempt } : {}) });
            return (status = 'completed', error) => {
                if (finished) return;
                finished = true;
                admit({
                    ...makeEvent(phase, status, Math.max(0, Math.round(now() - startedAt)), cacheAction, status === 'failed' ? classifyFailure(error) : undefined),
                    ...(databaseRoles[phase] ? { databaseRole: databaseRoles[phase], attempt } : {}),
                });
            };
        },
        mark(phase: StartupPhase) {
            if (marks.has(phase)) return;
            marks.add(phase);
            if (phase === 'frontend-entry') rendererEntryAt = now();
            admit(makeEvent(phase, 'completed', null, null));
            markListeners.forEach(listener => {
                try {
                    listener(phase);
                } catch {
                    // Diagnostics lifecycle callbacks must not affect startup.
                }
            });
            try {
                onMark?.(phase);
            } catch {
                // Diagnostics lifecycle callbacks must not affect startup.
            }
        },
        fail(phase: StartupPhase, failureKind: StartupFailureKind) {
            admit(makeEvent(phase, 'failed', null, null, failureKind));
            notifyFailure(phase);
        },
        ingestBootstrapEvents(events: readonly BootstrapDiagnosticEvent[]) {
            events.forEach(bootstrapEvent => {
                admit(makeEvent(
                    bootstrapEvent.phase,
                    bootstrapEvent.status,
                    bootstrapEvent.durationMs,
                    bootstrapEvent.cacheAction,
                    bootstrapEvent.failureKind,
                    bootstrapEvent.elapsedMs,
                ));
                if (bootstrapEvent.status === 'failed') notifyFailure(bootstrapEvent.phase);
            });
        },
    };
}

export function createStartupDiagnostics(send: DiagnosticSink, now: () => number, launchId: string) {
    const origin = now();
    let emittedNonTerminal = 0;
    const marks = new Set<StartupPhase>();
    const emit = (phase: StartupPhase, status: StartupPhaseStatus, durationMs: number | null, cacheAction: StartupCacheAction | null, error?: unknown, attempt = 1) => {
        const isTerminal = terminalPhases.has(phase);
        if (!isTerminal && emittedNonTerminal >= 256) return;
        if (!isTerminal) emittedNonTerminal += 1;
        try {
            const databaseRole = databaseRoles[phase];
            send({
                launchId, phase, status, elapsedMs: Math.max(0, Math.round(now() - origin)), durationMs, cacheAction,
                ...(databaseRole ? { databaseRole, attempt } : {}),
                ...(status === 'failed' ? { failureKind: classifyFailure(error) } : {}),
            });
        } catch {
            // Diagnostics must never interrupt library preparation.
        }
    };
    return {
        start(phase: StartupPhase, cacheAction: StartupCacheAction | null = null, attempt = 1): FinishPhase {
            const startedAt = now();
            let finished = false;
            emit(phase, 'started', null, cacheAction, undefined, attempt);
            return (status = 'completed', error) => {
                if (finished) return;
                finished = true;
                emit(phase, status, Math.max(0, Math.round(now() - startedAt)), cacheAction, error, attempt);
            };
        },
        mark(phase: StartupPhase) {
            if (marks.has(phase)) return;
            marks.add(phase);
            emit(phase, 'completed', null, null);
        },
    };
}

export const startupDiagnostics = createStartupDiagnosticBridge({
    send: event => {
        if (!isTauriRuntime()) return;
        void commands.recordStartupDiagnostic(event).catch(() => undefined);
    },
    getLaunch: async () => {
        if (!isTauriRuntime()) throw new Error('Native startup diagnostics are unavailable');
        return await commands.getStartupLaunch();
    },
    now: () => performance.now(),
    originMs: 0,
    onMark: phase => {
        if (phase === 'ready') window.__AMBIT_STARTUP_BOOTSTRAP__?.markReady();
    },
    recordSqlFrontend: report => commands.recordStartupSqlFrontend(report),
});

let startupHeartbeat: StartupHeartbeat | null = null;

export const startStartupHeartbeat = () => {
    if (startupHeartbeat || typeof window === 'undefined' || !isTauriRuntime()) return;

    const heartbeat = createStartupHeartbeat({
        now: () => performance.now(),
        transport: launchId => commands.recordStartupHeartbeat(launchId),
        timers: {
            setTimeout: window.setTimeout.bind(window),
            clearTimeout: window.clearTimeout.bind(window),
        },
    });
    startupHeartbeat = heartbeat;
    startupDiagnostics.subscribe(heartbeat.connect);
    startupDiagnostics.subscribeMarks(phase => {
        if (phase === 'ready') heartbeat.stop();
    });
    startupDiagnostics.subscribeFailures(() => heartbeat.stop());
    window.addEventListener('pagehide', heartbeat.stop, { once: true });
    heartbeat.begin();
};

void startupDiagnostics.connect();

const startupBootstrap = typeof window === 'undefined' ? undefined : window.__AMBIT_STARTUP_BOOTSTRAP__;
if (startupBootstrap) {
    startupDiagnostics.ingestBootstrapEvents(startupBootstrap.takeEvents());
    window.addEventListener('ambit-startup-diagnostic', event => {
        startupDiagnostics.ingestBootstrapEvents([(event as CustomEvent<BootstrapDiagnosticEvent>).detail]);
    });
}

export const markReactMounted = () => {
    startupDiagnostics.mark('react-mount');
    startupBootstrap?.markReactMounted();
};

export async function measureStartupPhase<T>(phase: StartupPhase, work: () => Promise<T>, cacheAction: StartupCacheAction | null = null): Promise<T> {
    const finish = startupDiagnostics.start(phase, cacheAction);
    try {
        const result = await work();
        finish();
        return result;
    } catch (error) {
        finish('failed', error);
        throw error;
    }
}
