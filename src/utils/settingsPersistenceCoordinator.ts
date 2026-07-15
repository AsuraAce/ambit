export class SettingsPersistenceClosingError extends Error {
    constructor() {
        super('Privacy and onboarding settings cannot change while Ambit is closing.');
        this.name = 'SettingsPersistenceClosingError';
    }
}

export class SettingsPersistencePausedError extends Error {
    constructor() {
        super('Settings cannot change while exclusive persistence work is in progress.');
        this.name = 'SettingsPersistencePausedError';
    }
}

declare const settingsPersistencePermitBrand: unique symbol;
export type SettingsPersistencePermit = {
    readonly [settingsPersistencePermitBrand]: true;
};

export interface SettingsCloseAdmissionLease {
    drain(): Promise<void>;
    restore(): void;
}

type AdmissionBlocker = 'closing' | 'exclusive';

const admissionBlockers = new Map<symbol, AdmissionBlocker>();
const activeTransactions = new Set<Promise<unknown>>();
const activePermits = new WeakSet<object>();

const register = <T>(transaction: Promise<T>): Promise<T> => {
    activeTransactions.add(transaction);
    void transaction.then(
        () => activeTransactions.delete(transaction),
        () => activeTransactions.delete(transaction)
    );
    return transaction;
};

const admissionError = (): Error => (
    Array.from(admissionBlockers.values()).includes('closing')
        ? new SettingsPersistenceClosingError()
        : new SettingsPersistencePausedError()
);

const executeWithPermit = async <T>(
    work: (permit: SettingsPersistencePermit) => Promise<T>
): Promise<T> => {
    const permit = {} as SettingsPersistencePermit;
    activePermits.add(permit);
    try {
        return await work(permit);
    } finally {
        activePermits.delete(permit);
    }
};

const run = <T>(work: (permit: SettingsPersistencePermit) => Promise<T>): Promise<T> => {
    if (admissionBlockers.size > 0) return Promise.reject(admissionError());

    let resolveTransaction!: (value: T | PromiseLike<T>) => void;
    let rejectTransaction!: (reason?: unknown) => void;
    const transaction = new Promise<T>((resolve, reject) => {
        resolveTransaction = resolve;
        rejectTransaction = reject;
    });
    register(transaction);

    void executeWithPermit(work).then(resolveTransaction, rejectTransaction);
    return transaction;
};

const runExclusive = <T>(work: (permit: SettingsPersistencePermit) => Promise<T>): Promise<T> => {
    if (admissionBlockers.size > 0) return Promise.reject(admissionError());

    const blocker = Symbol('exclusive-settings-persistence');
    admissionBlockers.set(blocker, 'exclusive');
    const precedingTransactions = Array.from(activeTransactions);
    const transaction = (async () => {
        const settled = await Promise.allSettled(precedingTransactions);
        const failures = settled
            .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            .map(result => result.reason);
        if (failures.length > 0) {
            throw new AggregateError(failures, 'One or more settings transactions failed before exclusive work.');
        }
        return executeWithPermit(work);
    })();

    register(transaction);
    void transaction.catch(() => {
        admissionBlockers.delete(blocker);
    });
    return transaction;
};

const drainActiveTransactions = async (): Promise<void> => {
    const failures: unknown[] = [];
    while (activeTransactions.size > 0) {
        const settled = await Promise.allSettled(Array.from(activeTransactions));
        settled.forEach(result => {
            if (result.status === 'rejected') failures.push(result.reason);
        });
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more settings transactions failed while closing.');
    }
};

const closeAdmission = (): SettingsCloseAdmissionLease => {
    const blocker = Symbol('closing-settings-persistence');
    let active = true;
    admissionBlockers.set(blocker, 'closing');

    return {
        drain: drainActiveTransactions,
        restore: () => {
            if (!active) return;
            active = false;
            admissionBlockers.delete(blocker);
        },
    };
};

const closeAdmissionAndDrain = async (): Promise<SettingsCloseAdmissionLease> => {
    const lease = closeAdmission();
    await lease.drain();
    return lease;
};

const isAccepting = (): boolean => admissionBlockers.size === 0;
const ownsPermit = (permit: SettingsPersistencePermit): boolean => activePermits.has(permit);

const reopenAdmission = (): void => {
    admissionBlockers.clear();
};

export const settingsPersistenceCoordinator = {
    run,
    runExclusive,
    closeAdmission,
    closeAdmissionAndDrain,
    isAccepting,
    ownsPermit,
    reopenAdmission,
};
