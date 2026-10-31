import type { InvokeOperationState } from '../stores/invokeOwnerScopeStore';
import type { StartupRepairReport } from '../bindings';
import { createStartupRepairCollector, type StartupRepairCollector } from './startupRepairDiagnostics';

export type InvokeTraceStage =
    | 'preparation' | 'scope-apply' | 'scope-cache' | 'image-sync'
    | 'batch-gallery' | 'gallery' | 'cache-claim' | 'facet-cache'
    | 'collections' | 'previews' | 'checkpoint' | 'partial-recovery'
    | 'orphan-recovery' | 'filesystem' | 'references' | 'cache-commit'
    | 'source-reconciliation' | 'visibility';

type TracePhase = InvokeOperationState['phase'];
type TraceOrigin = InvokeOperationState['origin'];
type Terminal = Extract<TracePhase, 'completed' | 'cancelled' | 'failed'> | 'detached';
type TraceKind = 'operation' | 'service-progress' | 'coordinator-progress' | 'committed-batch'
    | 'dock-committed' | 'presentation-committed' | 'stage' | 'heartbeat' | 'visibility'
    | 'suspected-display-stall' | 'repair-report';
type ProgressCategory = 'connection' | 'schema' | 'library-scan' | 'source-reconciliation'
    | 'owner-preparation' | 'visibility' | 'scope-cache' | 'update-check'
    | 'locations' | 'references' | 'boards' | 'images' | 'gallery'
    | 'filters' | 'collections' | 'previews';

export interface InvokeTraceHealthSample {
    jsHeapUsedMiB?: number;
    jsHeapTotalMiB?: number;
    jsHeapLimitMiB?: number;
    domImageCount?: number;
    domLoadedImageCount?: number;
    decodedImagePixels?: number;
    domNodeCount?: number;
}

interface TraceEvent extends InvokeTraceHealthSample {
    kind: TraceKind;
    elapsedMs: number;
    phase?: TracePhase;
    origin?: TraceOrigin;
    stage?: InvokeTraceStage;
    status?: 'started' | 'completed' | 'failed';
    progressCategory?: ProgressCategory;
    durationMs?: number;
    current?: number;
    total?: number;
    imported?: number;
    updated?: number;
    processed?: number;
    viewCommitted?: boolean;
    dockVisible?: boolean;
    privacyBlocked?: boolean;
    browsingAvailable?: boolean;
    documentVisible?: boolean;
    gapMs?: number;
    displayLagMs?: number;
}

interface StageSummary { started: number; pending: number; count: number; failed: number; totalMs: number; maxMs: number }
interface TraceRun {
    runId: string;
    startedAt: number;
    wallStartedAtEpochMs: number;
    origin: TraceOrigin;
    phase: TracePhase;
    terminal?: Terminal;
    endedElapsedMs?: number;
    events: TraceEvent[];
    droppedEvents: number;
    stages: Partial<Record<InvokeTraceStage, StageSummary>>;
    serviceProgress: number;
    coordinatorProgress: number;
    committedBatches: number;
    committedImages: number;
    imported: number;
    updated: number;
    displayStallSuspected: boolean;
    healthMax: InvokeTraceHealthSample;
    presentationSummary: {
        firstPrivacyBlockedAtMs?: number;
        lastPrivacyUnblockedAtMs?: number;
        firstBrowsingAvailableAtMs?: number;
    };
    repairReport?: StartupRepairReport;
}

interface ClockAndTimers {
    now: () => number;
    setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface InvokeTraceOptions extends Partial<ClockAndTimers> {
    enabled: boolean;
    wallNow?: () => number;
    write?: (fileName: string, content: string) => Promise<void>;
    documentVisible?: () => boolean;
    subscribeVisibility?: (listener: (visible: boolean) => void) => () => void;
    sampleHealth?: () => InvokeTraceHealthSample | undefined;
    runId?: () => string;
}

const EVENT_LIMIT = 512;
const FILE_LIMIT = 256 * 1024;
const HEARTBEAT_MS = 2_000;
const FLUSH_MS = 2_000;
const STALL_MS = 30_000;
const ACTIVE_FILE = 'invoke-sync-trace-active.json';
const COMPLETED_FILE = 'invoke-sync-trace-last-completed.json';
const TERMINAL_PHASES = new Set<TracePhase>(['completed', 'cancelled', 'failed']);
const PHASES = new Set<TracePhase>([
    'validating', 'preparing', 'syncing', 'cancelling', 'settling', 'completed', 'cancelled', 'failed',
]);
const STAGES = new Set<InvokeTraceStage>([
    'preparation', 'scope-apply', 'scope-cache', 'image-sync', 'batch-gallery', 'gallery',
    'cache-claim', 'facet-cache', 'collections', 'previews', 'checkpoint', 'partial-recovery',
    'orphan-recovery', 'filesystem', 'references', 'cache-commit',
    'source-reconciliation', 'visibility',
]);
const REPAIR_OPERATIONS: readonly StartupRepairReport['metrics'][number]['operation'][] = [
    'setup', 'identity-read', 'identity-paths', 'identity-matching', 'legacy-paths',
    'inventory', 'fact-read', 'fact-paths', 'fact-extraction', 'fact-write',
    'reference-write', 'batch-yield', 'filesystem-enumeration', 'inventory-build',
];
const REPAIR_COUNTERS: readonly (keyof StartupRepairReport['counters'])[] = [
    'identityRows', 'factRows', 'pathsChecked', 'inventorySubmitted', 'inventoryApplied',
    'factsSubmitted', 'factsApplied', 'referenceSetsSubmitted', 'referenceSourcesReplaced',
];

const PROGRESS_MESSAGES: Readonly<Record<string, ProgressCategory>> = {
    'Checking connection...': 'connection',
    'Connecting to InvokeAI database...': 'connection',
    'Analyzing database schema...': 'schema',
    'Scanning Ambit library...': 'library-scan',
    'Preparing InvokeAI library upgrade...': 'source-reconciliation',
    'Updating InvokeAI image details...': 'source-reconciliation',
    'Checking your saved InvokeAI view...': 'owner-preparation',
    'Checking InvokeAI owner information...': 'owner-preparation',
    'Preparing view...': 'owner-preparation',
    'Updating InvokeAI board ownership...': 'owner-preparation',
    'Applying InvokeAI visibility...': 'visibility',
    'Restoring cached InvokeAI view...': 'scope-cache',
    'Updating changed InvokeAI filters and collections...': 'scope-cache',
    'Rebuilding InvokeAI filters and collections...': 'scope-cache',
    'Checking for updates...': 'update-check',
    'Checking image locations…': 'locations',
    'Updating image references…': 'references',
    'Fetching board mappings...': 'boards',
    'Updating gallery...': 'gallery',
    'Updating startup filters...': 'filters',
    'Rebuilding filter cache...': 'filters',
    'Updating collections and library details...': 'collections',
    'Updating collection previews...': 'previews',
};

const progressCategory = (message: unknown, phase?: unknown): ProgressCategory | undefined => {
    if (phase === 'checking') return 'locations';
    if (phase === 'repairing') return 'references';
    if (typeof message !== 'string') return undefined;
    if (/^Processing images: \d+ \/ \d+$/.test(message)) return 'images';
    return Object.hasOwn(PROGRESS_MESSAGES, message) ? PROGRESS_MESSAGES[message] : undefined;
};

const finiteCount = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(1_000_000_000, Math.max(0, Math.trunc(value))) : undefined;

const sanitizeRepairReport = (report: StartupRepairReport): StartupRepairReport => {
    const metrics = REPAIR_OPERATIONS.map(operation => {
        const metric = report.metrics.find(item => item.operation === operation);
        return { operation, calls: finiteCount(metric?.calls) ?? 0,
            totalMs: finiteCount(metric?.totalMs) ?? 0, maxMs: finiteCount(metric?.maxMs) ?? 0 };
    });
    const counters = Object.fromEntries(REPAIR_COUNTERS.map(counter =>
        [counter, finiteCount(report.counters[counter]) ?? 0])) as StartupRepairReport['counters'];
    const status = report.status === 'completed' || report.status === 'cancelled' ? report.status : 'failed';
    return { status, durationMs: finiteCount(report.durationMs) ?? 0,
        unattributedMs: finiteCount(report.unattributedMs) ?? 0, metrics, counters };
};

const elapsed = (now: number, started: number): number => finiteCount(now - started) ?? 0;
const wallTime = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
const HEALTH_FIELDS = [
    'jsHeapUsedMiB', 'jsHeapTotalMiB', 'jsHeapLimitMiB', 'domImageCount',
    'domLoadedImageCount', 'decodedImagePixels', 'domNodeCount',
] as const;

const safeHealthNumber = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(1_000_000_000_000_000, Math.max(0, Math.round(value))) : undefined;

const sanitizeHealth = (sample: InvokeTraceHealthSample): InvokeTraceHealthSample => {
    const safe: InvokeTraceHealthSample = {};
    for (const field of HEALTH_FIELDS) {
        const value = safeHealthNumber(sample[field]);
        if (value !== undefined) safe[field] = value;
    }
    return safe;
};

const defaultSampleHealth = (): InvokeTraceHealthSample => {
    const sample: InvokeTraceHealthSample = {};
    if (typeof performance !== 'undefined') {
        const memory = (performance as Performance & { memory?: {
            usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number;
        } }).memory;
        if (memory) {
            if (memory.usedJSHeapSize !== undefined) sample.jsHeapUsedMiB = memory.usedJSHeapSize / 1_048_576;
            if (memory.totalJSHeapSize !== undefined) sample.jsHeapTotalMiB = memory.totalJSHeapSize / 1_048_576;
            if (memory.jsHeapSizeLimit !== undefined) sample.jsHeapLimitMiB = memory.jsHeapSizeLimit / 1_048_576;
        }
    }
    if (typeof document !== 'undefined') {
        const images = document.images;
        sample.domImageCount = images.length;
        let loaded = 0;
        let pixels = 0;
        for (const image of images) {
            if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
                loaded += 1;
                pixels += image.naturalWidth * image.naturalHeight;
            }
        }
        sample.domLoadedImageCount = loaded;
        sample.decodedImagePixels = pixels;
        sample.domNodeCount = document.getElementsByTagName('*').length;
    }
    return sample;
};

const defaultSubscribeVisibility = (listener: (visible: boolean) => void): (() => void) => {
    if (typeof document === 'undefined') return () => undefined;
    const onChange = () => listener(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
};

const defaultWriter = async (fileName: string, content: string): Promise<void> => {
    const { BaseDirectory, mkdir, writeTextFile } = await import('@tauri-apps/plugin-fs');
    await mkdir('invoke-sync-trace', { baseDir: BaseDirectory.AppLocalData, recursive: true });
    await writeTextFile(`invoke-sync-trace/${fileName}`, content, { baseDir: BaseDirectory.AppLocalData });
};

let runSequence = 0;
const defaultRunId = (): string => {
    runSequence += 1;
    try {
        return `${crypto.randomUUID()}-${runSequence}`;
    } catch {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${runSequence}`;
    }
};

/** Best-effort diagnostics. No caller waits for a trace write. */
export const createInvokeSyncTrace = (options: InvokeTraceOptions) => {
    if (!options.enabled) {
        return {
            enabled: false,
            observeOperation: (_operation: InvokeOperationState | null): void => undefined,
            serviceProgress: (_id: symbol | undefined, _current: number, _total: number, _message?: string): void => undefined,
            coordinatorProgress: (_id: symbol | undefined, _current: number, _total: number, _message?: string): void => undefined,
            committedBatch: (_id: symbol | undefined, _processed: number, _imported: number, _updated: number): void => undefined,
            dockCommitted: (_operation: InvokeOperationState | null, _visible: boolean): void => undefined,
            presentationCommitted: (_id: symbol | undefined, _privacyBlocked: boolean, _browsingAvailable: boolean): void => undefined,
            visibilityChanged: (_visible: boolean): void => undefined,
            claimRepair: (_id: symbol | undefined): StartupRepairCollector | undefined => undefined,
            measure: <T>(_id: symbol | undefined, _stage: InvokeTraceStage, work: () => Promise<T>): Promise<T> => work(),
            dispose: (): void => undefined,
        };
    }

    const now = options.now ?? (() => performance.now());
    const wallNow = options.wallNow ?? (() => Date.now());
    const setTimer = options.setTimeout ?? ((callback: () => void, delay: number) => setTimeout(callback, delay));
    const clearTimer = options.clearTimeout ?? ((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer));
    const documentVisible = options.documentVisible ?? (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
    const subscribeVisibility = options.subscribeVisibility ?? defaultSubscribeVisibility;
    const sampleHealth = options.sampleHealth ?? defaultSampleHealth;
    const write = options.write ?? defaultWriter;
    const makeRunId = options.runId ?? defaultRunId;
    let activeId: symbol | undefined;
    let active: TraceRun | undefined;
    let suspended = false;
    let lastCompletedId: symbol | undefined;
    let lastCompleted: TraceRun | undefined;
    let repairCollectorRun: TraceRun | undefined;
    let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let lastHeartbeatAt: number | undefined;
    let lastDisplay: { phase: TracePhase; current?: number; total?: number; category?: ProgressCategory; visible: boolean; at: number } | undefined;
    let lastCompletedDisplay: typeof lastDisplay;
    let lastPresentation: { privacyBlocked: boolean; browsingAvailable: boolean } | undefined;
    let lastCompletedPresentation: typeof lastPresentation;
    let lastOperation: { phase: TracePhase; current?: number; total?: number; category?: ProgressCategory } | undefined;
    let lastCoordinator: { current: number; total: number; category?: ProgressCategory } | undefined;
    let coordinatorEvidenceAt: number | undefined;
    let visibleBaselineAt: number | undefined;
    let lastDocumentVisible: boolean | undefined;
    let unsubscribeVisibility: (() => void) | undefined;
    let writing = false;
    const pending = new Map<string, string>();
    const seenIds = new Set<symbol>();

    const drain = async () => {
        if (writing) return;
        writing = true;
        while (pending.size > 0) {
            const next = pending.entries().next().value as [string, string];
            pending.delete(next[0]);
            try { await write(next[0], next[1]); } catch { /* Diagnostics never affect an operation. */ }
        }
        writing = false;
    };

    const serialize = (run: TraceRun): string => {
        let content = JSON.stringify(run);
        while (content.length > FILE_LIMIT && run.events.length > 0) {
            run.events.shift();
            run.droppedEvents += 1;
            content = JSON.stringify(run);
        }
        return content;
    };

    const enqueue = (fileName: string, run: TraceRun) => {
        pending.set(fileName, serialize(run));
        void drain();
    };

    const flush = () => {
        flushTimer = undefined;
        if (active) enqueue(ACTIVE_FILE, active);
    };

    const scheduleFlush = () => {
        if (flushTimer !== undefined) return;
        flushTimer = setTimer(() => withDiagnostics(flush), FLUSH_MS);
    };

    const append = (run: TraceRun, event: TraceEvent) => {
        if (run.events.length === EVENT_LIMIT) {
            run.events.shift();
            run.droppedEvents += 1;
        }
        run.events.push(event);
        if (run === active && !suspended) scheduleFlush();
    };

    const noteVisibility = (visible: boolean) => {
        const run = active;
        if (!run || lastDocumentVisible === visible) return;
        const time = now();
        lastDocumentVisible = visible;
        visibleBaselineAt = visible ? time : undefined;
        coordinatorEvidenceAt = undefined;
        append(run, { kind: 'visibility', elapsedMs: elapsed(time, run.startedAt), documentVisible: visible });
    };

    const listenForVisibility = (run: TraceRun) => {
        if (unsubscribeVisibility) return;
        unsubscribeVisibility = subscribeVisibility(visible => {
            if (active === run) withDiagnostics(() => noteVisibility(visible === true));
        });
    };

    const stopListeningForVisibility = () => {
        const unsubscribe = unsubscribeVisibility;
        unsubscribeVisibility = undefined;
        try { unsubscribe?.(); } catch { /* A listener cleanup must not affect sync. */ }
    };

    const heartbeat = () => {
        heartbeatTimer = undefined;
        const run = active;
        if (!run || suspended) return;
        const time = now();
        const visible = documentVisible();
        noteVisibility(visible);
        const gapMs = lastHeartbeatAt === undefined ? 0 : elapsed(time, lastHeartbeatAt);
        lastHeartbeatAt = time;
        let health: InvokeTraceHealthSample | undefined;
        try {
            health = sanitizeHealth(sampleHealth() ?? {});
            for (const field of HEALTH_FIELDS) {
                const value = health[field];
                if (value !== undefined) run.healthMax[field] = Math.max(run.healthMax[field] ?? 0, value);
            }
        } catch { /* Health counters are optional and must not stop the heartbeat. */ }
        append(run, { kind: 'heartbeat', elapsedMs: elapsed(time, run.startedAt), documentVisible: visible,
            gapMs, ...health });
        const displayBaseline = lastDisplay
            ? Math.max(lastDisplay.at, visibleBaselineAt ?? lastDisplay.at) : undefined;
        const displayLagMs = displayBaseline === undefined ? 0 : elapsed(time, displayBaseline);
        if (visible && lastDisplay?.visible && displayLagMs > STALL_MS
            && coordinatorEvidenceAt !== undefined && displayBaseline !== undefined
            && coordinatorEvidenceAt > displayBaseline
            && !run.displayStallSuspected) {
            run.displayStallSuspected = true;
            append(run, { kind: 'suspected-display-stall', elapsedMs: elapsed(time, run.startedAt),
                documentVisible: true, dockVisible: true, displayLagMs });
        }
        heartbeatTimer = setTimer(() => withDiagnostics(heartbeat), HEARTBEAT_MS);
    };

    const finish = (run: TraceRun, terminal: Terminal) => {
        if (run !== active) return;
        const time = now();
        run.terminal = terminal;
        run.endedElapsedMs = elapsed(time, run.startedAt);
        if (heartbeatTimer !== undefined) clearTimer(heartbeatTimer);
        if (flushTimer !== undefined) clearTimer(flushTimer);
        stopListeningForVisibility();
        heartbeatTimer = undefined;
        flushTimer = undefined;
        append(run, { kind: 'operation', phase: terminal === 'detached' ? run.phase : terminal,
            elapsedMs: run.endedElapsedMs });
        if (flushTimer !== undefined) clearTimer(flushTimer);
        flushTimer = undefined;
        enqueue(ACTIVE_FILE, run);
        enqueue(COMPLETED_FILE, run);
        lastCompleted = run;
        lastCompletedId = activeId;
        lastCompletedDisplay = undefined;
        lastCompletedPresentation = lastPresentation;
        active = undefined;
        activeId = undefined;
        suspended = false;
        lastDisplay = undefined;
        lastPresentation = undefined;
        lastOperation = undefined;
        lastCoordinator = undefined;
        coordinatorEvidenceAt = undefined;
        lastDocumentVisible = undefined;
        visibleBaselineAt = undefined;
    };

    const withDiagnostics = (record: () => void) => {
        try { record(); } catch { /* A clock, timer, or sink error must not change the task. */ }
    };

    const recordOperation = (operation: InvokeOperationState | null) => {
        if (!operation) {
            if (active) finish(active, 'detached');
            return;
        }
        if (activeId !== operation.id && seenIds.has(operation.id)) return;
        if (activeId !== operation.id) {
            if (active) finish(active, 'detached');
            if (TERMINAL_PHASES.has(operation.phase)) return;
            const time = now();
            activeId = operation.id;
            suspended = false;
            seenIds.add(operation.id);
            if (seenIds.size > 512) seenIds.delete(seenIds.values().next().value as symbol);
            active = {
                runId: makeRunId(), startedAt: time, wallStartedAtEpochMs: wallTime(wallNow()),
                origin: operation.origin === 'startup' ? 'startup' : 'user', phase: operation.phase,
                events: [], droppedEvents: 0, stages: {}, serviceProgress: 0, coordinatorProgress: 0,
                committedBatches: 0, committedImages: 0, imported: 0, updated: 0, displayStallSuspected: false,
                healthMax: {},
                presentationSummary: {},
            };
            lastDocumentVisible = documentVisible();
            visibleBaselineAt = lastDocumentVisible ? time : undefined;
            listenForVisibility(active);
            lastHeartbeatAt = time;
            heartbeatTimer = setTimer(() => withDiagnostics(heartbeat), HEARTBEAT_MS);
        } else if (suspended && active) {
            suspended = false;
            noteVisibility(documentVisible());
            const resumedAt = now();
            visibleBaselineAt = lastDocumentVisible ? resumedAt : undefined;
            coordinatorEvidenceAt = undefined;
            listenForVisibility(active);
            lastHeartbeatAt = resumedAt;
            heartbeatTimer = setTimer(() => withDiagnostics(heartbeat), HEARTBEAT_MS);
            scheduleFlush();
        }
        const run = active;
        if (!run) return;
        const phase = PHASES.has(operation.phase) ? operation.phase : run.phase;
        const current = finiteCount(operation.progress.current);
        const total = finiteCount(operation.progress.total);
        const category = progressCategory(operation.progress.message, operation.progress.phase);
        if (lastOperation && (phase !== lastOperation.phase || current !== lastOperation.current
            || total !== lastOperation.total || category !== lastOperation.category)) coordinatorEvidenceAt = now();
        lastOperation = { phase, current, total, category };
        run.phase = phase;
        run.imported = Math.max(run.imported, finiteCount(operation.imported) ?? 0);
        run.updated = Math.max(run.updated, finiteCount(operation.updated) ?? 0);
        const event: TraceEvent = {
            kind: 'operation', elapsedMs: elapsed(now(), run.startedAt), phase,
            origin: run.origin, viewCommitted: operation.viewCommitted === true,
            current, total, progressCategory: category,
            imported: finiteCount(operation.imported), updated: finiteCount(operation.updated),
        };
        const previous = run.events.at(-1);
        if (previous?.kind !== 'operation' || JSON.stringify({ ...previous, elapsedMs: 0 }) !== JSON.stringify({ ...event, elapsedMs: 0 })) {
            append(run, event);
        }
        if (TERMINAL_PHASES.has(phase)) finish(run, phase as Terminal);
    };

    const recordProgress = (id: symbol | undefined, kind: 'service-progress' | 'coordinator-progress',
        current: number, total: number, message?: string) => {
        if (!active || !id || id !== activeId) return;
        const safeCurrent = finiteCount(current);
        const safeTotal = finiteCount(total);
        if (safeCurrent === undefined || safeTotal === undefined) return;
        const category = progressCategory(message);
        if (kind === 'service-progress') active.serviceProgress += 1;
        else {
            active.coordinatorProgress += 1;
            const previous = lastCoordinator ?? lastOperation;
            if (previous && (previous.current !== safeCurrent || previous.total !== safeTotal
                || previous.category !== category)) coordinatorEvidenceAt = now();
            lastCoordinator = { current: safeCurrent, total: safeTotal, category };
        }
        append(active, { kind, elapsedMs: elapsed(now(), active.startedAt), current: safeCurrent,
            total: safeTotal, progressCategory: category });
    };

    return {
        enabled: true,
        observeOperation(operation: InvokeOperationState | null): void {
            withDiagnostics(() => recordOperation(operation));
        },
        serviceProgress(id: symbol | undefined, current: number, total: number, message?: string): void {
            withDiagnostics(() => recordProgress(id, 'service-progress', current, total, message));
        },
        coordinatorProgress(id: symbol | undefined, current: number, total: number, message?: string): void {
            withDiagnostics(() => recordProgress(id, 'coordinator-progress', current, total, message));
        },
        committedBatch(id: symbol | undefined, processed: number, imported: number, updated: number): void {
            withDiagnostics(() => {
                if (!active || !id || id !== activeId) return;
                const safeProcessed = finiteCount(processed);
                const safeImported = finiteCount(imported);
                const safeUpdated = finiteCount(updated);
                if (safeProcessed === undefined || safeImported === undefined || safeUpdated === undefined) return;
                active.committedBatches += 1;
                active.committedImages = Math.max(active.committedImages, safeProcessed);
                active.imported = Math.max(active.imported, safeImported);
                active.updated = Math.max(active.updated, safeUpdated);
                append(active, { kind: 'committed-batch', elapsedMs: elapsed(now(), active.startedAt),
                    processed: safeProcessed, imported: safeImported, updated: safeUpdated });
            });
        },
        dockCommitted(operation: InvokeOperationState | null, visible: boolean): void {
            withDiagnostics(() => {
                if (!operation) return;
                const currentRun = active && operation.id === activeId ? active : undefined;
                const completedRun = !active && operation.id === lastCompletedId
                    && TERMINAL_PHASES.has(operation.phase) ? lastCompleted : undefined;
                const run = currentRun ?? completedRun;
                if (!run) return;
                const current = finiteCount(operation.progress.current);
                const total = finiteCount(operation.progress.total);
                const category = progressCategory(operation.progress.message, operation.progress.phase);
                const display = { phase: PHASES.has(operation.phase) ? operation.phase : run.phase,
                    current, total, category, visible: visible === true, at: now() };
                const previous = currentRun ? lastDisplay : lastCompletedDisplay;
                if (previous && previous.phase === display.phase && previous.current === current
                    && previous.total === total && previous.category === category
                    && previous.visible === display.visible) return;
                if (currentRun) lastDisplay = display;
                else lastCompletedDisplay = display;
                append(run, { kind: 'dock-committed', elapsedMs: elapsed(display.at, run.startedAt),
                    phase: display.phase, current, total, progressCategory: category, dockVisible: display.visible,
                    documentVisible: documentVisible() });
                if (completedRun) enqueue(COMPLETED_FILE, completedRun);
            });
        },
        presentationCommitted(id: symbol | undefined, privacyBlocked: boolean, browsingAvailable: boolean): void {
            withDiagnostics(() => {
                if (!id) return;
                const currentRun = active && id === activeId ? active : undefined;
                const completedRun = !active && id === lastCompletedId ? lastCompleted : undefined;
                const run = currentRun ?? completedRun;
                if (!run) return;
                const privacy = privacyBlocked === true;
                const browsing = browsingAvailable === true;
                const previous = currentRun ? lastPresentation : lastCompletedPresentation;
                if (previous?.privacyBlocked === privacy && previous.browsingAvailable === browsing) return;
                const time = elapsed(now(), run.startedAt);
                if (privacy && run.presentationSummary.firstPrivacyBlockedAtMs === undefined) {
                    run.presentationSummary.firstPrivacyBlockedAtMs = time;
                }
                if (!privacy && previous?.privacyBlocked === true) {
                    run.presentationSummary.lastPrivacyUnblockedAtMs = time;
                }
                if (browsing && run.presentationSummary.firstBrowsingAvailableAtMs === undefined) {
                    run.presentationSummary.firstBrowsingAvailableAtMs = time;
                }
                const state = { privacyBlocked: privacy, browsingAvailable: browsing };
                if (currentRun) lastPresentation = state;
                else lastCompletedPresentation = state;
                append(run, { kind: 'presentation-committed', elapsedMs: time,
                    privacyBlocked: privacy, browsingAvailable: browsing });
                if (completedRun) enqueue(COMPLETED_FILE, completedRun);
            });
        },
        visibilityChanged(visible: boolean): void {
            withDiagnostics(() => noteVisibility(visible === true));
        },
        claimRepair(id: symbol | undefined): StartupRepairCollector | undefined {
            if (!id || id !== activeId || !active || repairCollectorRun === active) return undefined;
            const run = active;
            try {
                const collector = createStartupRepairCollector({
                    now,
                    stage: () => undefined,
                    report: report => {
                        withDiagnostics(() => {
                            if (run !== active || id !== activeId) return;
                            run.repairReport = sanitizeRepairReport(report);
                            append(run, { kind: 'repair-report', elapsedMs: elapsed(now(), run.startedAt),
                                durationMs: run.repairReport.durationMs });
                        });
                    },
                });
                repairCollectorRun = run;
                return collector;
            } catch { return undefined; }
        },
        async measure<T>(id: symbol | undefined, stage: InvokeTraceStage, work: () => Promise<T>): Promise<T> {
            const run = id && id === activeId && STAGES.has(stage) ? active : undefined;
            let start: number | undefined;
            if (run) withDiagnostics(() => {
                start = now();
                const summary = run.stages[stage] ?? { started: 0, pending: 0, count: 0, failed: 0, totalMs: 0, maxMs: 0 };
                summary.started += 1;
                summary.pending += 1;
                run.stages[stage] = summary;
                append(run, { kind: 'stage', stage, status: 'started', elapsedMs: elapsed(start, run.startedAt) });
            });
            try {
                const result = await work();
                const startedAt = start;
                if (run && run === active && startedAt !== undefined) withDiagnostics(() => {
                    const durationMs = elapsed(now(), startedAt);
                    const summary = run.stages[stage]!;
                    summary.pending = Math.max(0, summary.pending - 1);
                    summary.count += 1;
                    summary.totalMs += durationMs;
                    summary.maxMs = Math.max(summary.maxMs, durationMs);
                    run.stages[stage] = summary;
                    append(run, { kind: 'stage', stage, status: 'completed', durationMs,
                        elapsedMs: elapsed(now(), run.startedAt) });
                });
                return result;
            } catch (error) {
                const startedAt = start;
                if (run && run === active && startedAt !== undefined) withDiagnostics(() => {
                    const durationMs = elapsed(now(), startedAt);
                    const summary = run.stages[stage]!;
                    summary.pending = Math.max(0, summary.pending - 1);
                    summary.count += 1;
                    summary.failed += 1;
                    summary.totalMs += durationMs;
                    summary.maxMs = Math.max(summary.maxMs, durationMs);
                    run.stages[stage] = summary;
                    append(run, { kind: 'stage', stage, status: 'failed', durationMs,
                        elapsedMs: elapsed(now(), run.startedAt) });
                });
                throw error;
            }
        },
        dispose(): void {
            withDiagnostics(() => {
                if (!active || suspended) return;
                suspended = true;
                if (heartbeatTimer !== undefined) clearTimer(heartbeatTimer);
                if (flushTimer !== undefined) clearTimer(flushTimer);
                stopListeningForVisibility();
                heartbeatTimer = undefined;
                flushTimer = undefined;
                enqueue(ACTIVE_FILE, active);
            });
        },
    };
};

export const invokeSyncTrace = createInvokeSyncTrace({
    enabled: import.meta.env.DEV && import.meta.env.VITE_INVOKE_SYNC_TRACE === '1',
});
