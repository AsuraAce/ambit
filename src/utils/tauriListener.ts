import { listen, type Event, type UnlistenFn } from '@tauri-apps/api/event';
import { startBackgroundDiagnostic } from './backgroundDiagnostics';

interface ManagedTauriListener {
    cleanup: UnlistenFn;
    ready: Promise<boolean>;
}

const formatError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

export const listenWithCleanup = <T>(
    eventName: string,
    handler: (event: Event<T>) => void,
    label = eventName
): ManagedTauriListener => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    let finished = false;
    const diagnostic = startBackgroundDiagnostic('listener', label, { eventName });

    const finishDiagnostic = (status: 'finished' | 'cancelled' | 'failed', detail?: Record<string, unknown>) => {
        if (finished) return;
        finished = true;
        diagnostic.finish(status, detail);
    };

    const ready = listen<T>(eventName, handler)
        .then((nextUnlisten) => {
            if (disposed) {
                nextUnlisten();
                finishDiagnostic('cancelled', { disposedBeforeReady: true });
                return false;
            }

            unlisten = nextUnlisten;
            diagnostic.update({ listening: true });
            return true;
        })
        .catch((error: unknown) => {
            console.error(`[TauriListener] Failed to listen for ${eventName}`, error);
            finishDiagnostic('failed', { error: formatError(error) });
            return false;
        });

    const cleanup = () => {
        disposed = true;
        if (!unlisten) return;

        unlisten();
        unlisten = null;
        finishDiagnostic('cancelled');
    };

    return { cleanup, ready };
};
