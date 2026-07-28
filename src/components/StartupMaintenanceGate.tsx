import * as React from 'react';
import { AlertCircle, Database } from 'lucide-react';
import { getDb, type StartupDbPhase } from '../services/db/connection';
import { isBrowserMockMode } from '../services/runtime';
import { StartupPreparationCard } from './ui/StartupPreparationCard';

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

    if (!error) {
        return (
            <main
                className="flex min-h-screen items-center justify-center bg-gray-50 p-4 text-gray-900 dark:bg-zinc-950 dark:text-white sm:p-8"
                data-testid="startup-maintenance-gate"
            >
                <StartupPreparationCard
                    phaseLabel="Local database"
                    icon={<Database className="h-7 w-7" />}
                    description={STARTUP_PHASE_COPY[phase]}
                    statusMessage={STARTUP_PHASE_LABELS[phase]}
                    reassurance="Please keep Ambit open."
                />
            </main>
        );
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4 text-gray-900 dark:bg-zinc-950 dark:text-white sm:p-8">
            <section className="w-full max-w-lg rounded-3xl border border-rose-200 bg-white/85 p-6 shadow-2xl shadow-black/10 backdrop-blur-xl dark:border-rose-500/20 dark:bg-zinc-900/85 sm:p-8">
                <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-300">
                        <AlertCircle className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-gray-500">
                            Local database
                        </p>
                        <h1 className="mt-1 text-xl font-black tracking-tight">
                            Database startup failed
                        </h1>
                    </div>
                </div>

                <p className="mt-6 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Ambit could not prepare the local library database. Restart the app and contact support if this repeats.
                </p>

                <pre className="mt-4 max-h-32 overflow-auto rounded-xl bg-black/30 p-3 text-xs text-red-200">
                    {error}
                </pre>
            </section>
        </main>
    );
};
