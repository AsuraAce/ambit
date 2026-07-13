export type BackgroundDiagnosticKind = 'job' | 'listener' | 'timer' | 'worker';
export type BackgroundDiagnosticStatus = 'active' | 'finished' | 'cancelled' | 'failed';

export interface BackgroundDiagnosticEntry {
    id: string;
    kind: BackgroundDiagnosticKind;
    label: string;
    startedAt: number;
    updatedAt: number;
    endedAt?: number;
    status: BackgroundDiagnosticStatus;
    detail?: Record<string, unknown>;
}

export interface BackgroundDiagnosticSnapshot {
    active: BackgroundDiagnosticEntry[];
    history: BackgroundDiagnosticEntry[];
}

export interface BackgroundDiagnosticHandle {
    id: string;
    update: (detail?: Record<string, unknown>) => void;
    finish: (status?: Exclude<BackgroundDiagnosticStatus, 'active'>, detail?: Record<string, unknown>) => void;
}

interface AmbitDiagnosticsWindow extends Window {
    ambitDiagnostics?: {
        background?: {
            snapshot: () => BackgroundDiagnosticSnapshot;
        };
    };
}

const HISTORY_LIMIT = 100;

let sequence = 0;
const activeEntries = new Map<string, BackgroundDiagnosticEntry>();
const historyEntries: BackgroundDiagnosticEntry[] = [];

const cloneEntry = (entry: BackgroundDiagnosticEntry): BackgroundDiagnosticEntry => ({
    ...entry,
    detail: entry.detail ? { ...entry.detail } : undefined
});

const createSnapshot = (): BackgroundDiagnosticSnapshot => ({
    active: Array.from(activeEntries.values()).map(cloneEntry),
    history: historyEntries.map(cloneEntry)
});

const isEnabled = (): boolean =>
    typeof window !== 'undefined' && Boolean(import.meta.env.DEV);

const ensureInstalled = () => {
    const target = window as AmbitDiagnosticsWindow;
    target.ambitDiagnostics = target.ambitDiagnostics ?? {};
    target.ambitDiagnostics.background = {
        snapshot: createSnapshot
    };
};

const recordHistory = (entry: BackgroundDiagnosticEntry) => {
    historyEntries.unshift(cloneEntry(entry));
    if (historyEntries.length > HISTORY_LIMIT) {
        historyEntries.length = HISTORY_LIMIT;
    }
};

export const startBackgroundDiagnostic = (
    kind: BackgroundDiagnosticKind,
    label: string,
    detail?: Record<string, unknown>
): BackgroundDiagnosticHandle => {
    if (!isEnabled()) {
        return {
            id: '',
            update: () => undefined,
            finish: () => undefined
        };
    }

    ensureInstalled();

    const now = Date.now();
    const id = `${kind}:${label}:${now}:${sequence++}`;
    const entry: BackgroundDiagnosticEntry = {
        id,
        kind,
        label,
        startedAt: now,
        updatedAt: now,
        status: 'active',
        detail
    };
    activeEntries.set(id, entry);

    return {
        id,
        update: (nextDetail) => {
            const current = activeEntries.get(id);
            if (!current) return;

            current.updatedAt = Date.now();
            current.detail = {
                ...(current.detail ?? {}),
                ...(nextDetail ?? {})
            };
        },
        finish: (status = 'finished', finalDetail) => {
            const current = activeEntries.get(id);
            if (!current) return;

            activeEntries.delete(id);
            const endedAt = Date.now();
            const completed: BackgroundDiagnosticEntry = {
                ...current,
                updatedAt: endedAt,
                endedAt,
                status,
                detail: {
                    ...(current.detail ?? {}),
                    ...(finalDetail ?? {})
                }
            };
            recordHistory(completed);
        }
    };
};
