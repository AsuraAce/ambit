import * as React from 'react';
import { AlertCircle, Database, Loader2 } from 'lucide-react';
import { getDb, type StartupDbPhase } from '../services/db/connection';
import { isBrowserMockMode } from '../services/runtime';

interface StartupMaintenanceGateProps {
    children: React.ReactNode;
}

const MAINTENANCE_REVEAL_DELAY_MS = 700;

const STARTUP_PHASE_LABELS: Record<StartupDbPhase, string> = {
    'Preparing library database': 'Preparing library database',
    'Updating database schema': 'Preparing database',
    'Optimizing database': 'Optimizing database',
    'Loading library': 'Loading library'
};

const STARTUP_PHASE_COPY: Record<StartupDbPhase, string> = {
    'Preparing library database': 'Checking the local library database before Ambit opens.',
    'Updating database schema': 'Preparing the local database. Startup may take longer than usual this time.',
    'Optimizing database': 'Optimizing the local database for large libraries.',
    'Loading library': 'Loading your library.'
};

const dismissStaticLoader = () => {
    const loader = document.getElementById('static-loading');
    if (!loader) return;

    loader.style.opacity = '0';
    loader.style.pointerEvents = 'none';

    window.setTimeout(() => {
        loader.remove();
    }, 500);
};

export const StartupMaintenanceGate: React.FC<StartupMaintenanceGateProps> = ({ children }) => {
    const [phase, setPhase] = React.useState<StartupDbPhase>('Preparing library database');
    const [isReady, setIsReady] = React.useState(isBrowserMockMode());
    const [isMaintenanceVisible, setIsMaintenanceVisible] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (isReady) return;

        let isMounted = true;
        const revealTimerId = window.setTimeout(() => {
            if (!isMounted) return;

            dismissStaticLoader();
            setIsMaintenanceVisible(true);
        }, MAINTENANCE_REVEAL_DELAY_MS);

        const prepareDatabase = async () => {
            try {
                setPhase('Preparing library database');
                await getDb({
                    onPhase: (nextPhase) => {
                        if (isMounted) setPhase(nextPhase);
                    }
                });
                if (isMounted) {
                    window.clearTimeout(revealTimerId);
                    setIsReady(true);
                }
            } catch (err) {
                console.error('[Startup] Failed to prepare database', err);
                if (isMounted) {
                    window.clearTimeout(revealTimerId);
                    dismissStaticLoader();
                    setError(err instanceof Error ? err.message : String(err));
                    setIsMaintenanceVisible(true);
                }
            }
        };

        void prepareDatabase();

        return () => {
            isMounted = false;
            window.clearTimeout(revealTimerId);
        };
    }, [isReady]);

    if (isReady) {
        return <>{children}</>;
    }

    if (!isMaintenanceVisible) {
        return null;
    }

    return (
        <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6">
            <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-900/80 p-8 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sage-500/10 text-sage-300">
                        {error ? <AlertCircle className="h-6 w-6" /> : <Database className="h-6 w-6" />}
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-gray-500">
                            Startup Maintenance
                        </p>
                        <h1 className="mt-1 text-xl font-black tracking-tight">
                            {error ? 'Database startup failed' : STARTUP_PHASE_LABELS[phase]}
                        </h1>
                    </div>
                </div>

                <p className="mt-6 text-sm leading-6 text-gray-300">
                    {error
                        ? 'Ambit could not prepare the local library database. Restart the app and contact support if this repeats.'
                        : STARTUP_PHASE_COPY[phase]}
                </p>

                {error ? (
                    <pre className="mt-4 max-h-32 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-red-200">
                        {error}
                    </pre>
                ) : (
                    <div className="mt-6 flex items-center gap-3 text-sm font-semibold text-sage-300">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Please keep Ambit open.</span>
                    </div>
                )}
            </section>
        </main>
    );
};
