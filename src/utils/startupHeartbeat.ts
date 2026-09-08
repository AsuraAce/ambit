export interface StartupHeartbeatTimers {
    setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

interface StartupHeartbeatOptions {
    now: () => number;
    transport: (launchId: string) => Promise<unknown>;
    timers: StartupHeartbeatTimers;
    intervalMs?: number;
    budgetMs?: number;
}

export interface StartupHeartbeat {
    begin: () => void;
    connect: (launchId: string) => void;
    stop: () => void;
}

export const createStartupHeartbeat = ({
    now,
    transport,
    timers,
    intervalMs = 2_000,
    budgetMs = 120_000,
}: StartupHeartbeatOptions): StartupHeartbeat => {
    let startedAt: number | null = null;
    let launchId: string | null = null;
    let stopped = false;
    let outstanding = false;
    let nextTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
        stopped = true;
        if (nextTimer !== null) timers.clearTimeout(nextTimer);
        if (deadlineTimer !== null) timers.clearTimeout(deadlineTimer);
        nextTimer = null;
        deadlineTimer = null;
    };

    const schedule = (delayMs = 0) => {
        if (stopped || outstanding || !launchId || startedAt === null || nextTimer !== null) return;
        const remainingMs = budgetMs - (now() - startedAt);
        if (remainingMs <= 0) {
            stop();
            return;
        }
        nextTimer = timers.setTimeout(() => {
            nextTimer = null;
            if (stopped || outstanding || !launchId || startedAt === null || now() - startedAt >= budgetMs) {
                if (startedAt !== null && now() - startedAt >= budgetMs) stop();
                return;
            }
            outstanding = true;
            const currentLaunchId = launchId;
            let request: Promise<unknown>;
            try {
                request = transport(currentLaunchId);
            } catch {
                outstanding = false;
                schedule(intervalMs);
                return;
            }
            void request.then(
                () => undefined,
                () => undefined,
            ).then(() => {
                outstanding = false;
                schedule(intervalMs);
            });
        }, Math.min(delayMs, remainingMs));
    };

    return {
        begin: () => {
            if (startedAt !== null || stopped) return;
            startedAt = now();
            deadlineTimer = timers.setTimeout(stop, budgetMs);
            schedule();
        },
        connect: (resolvedLaunchId) => {
            if (stopped || !resolvedLaunchId) return;
            launchId = resolvedLaunchId;
            schedule();
        },
        stop,
    };
};
