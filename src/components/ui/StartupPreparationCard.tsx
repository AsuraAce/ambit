import * as React from 'react';
import { LoaderCircle } from 'lucide-react';

interface StartupPreparationProgress {
    current: number;
    total: number;
}

interface StartupPreparationCardProps {
    phaseLabel: string;
    title?: string;
    icon: React.ReactNode;
    description: string;
    statusMessage: string;
    reassurance?: string;
    progress?: StartupPreparationProgress;
}

export const StartupPreparationCard: React.FC<StartupPreparationCardProps> = ({
    phaseLabel,
    title = 'Preparing Ambit',
    icon,
    description,
    statusMessage,
    reassurance,
    progress,
}) => {
    const isDeterminate = (progress?.total ?? 0) > 0;
    const current = Math.min(progress?.current ?? 0, progress?.total ?? 0);
    const percentage = isDeterminate
        ? Math.min(100, (current / progress!.total) * 100)
        : 0;

    return (
        <section className="w-full max-w-lg rounded-3xl border border-gray-200 bg-white/85 p-6 shadow-2xl shadow-black/10 backdrop-blur-xl dark:border-white/10 dark:bg-zinc-900/85 sm:p-8">
            <div className="flex items-center gap-4">
                <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sage-500/15 text-sage-600 dark:text-sage-400"
                    aria-hidden="true"
                >
                    {icon}
                </div>
                <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-gray-500">
                        {phaseLabel}
                    </p>
                    <h1 className="mt-1 text-xl font-black tracking-tight text-gray-900 dark:text-white">
                        {title}
                    </h1>
                </div>
            </div>

            <p className="mt-6 text-sm leading-6 text-gray-600 dark:text-gray-300">
                {description}
            </p>
            {reassurance ? (
                <p className="mt-3 text-sm font-semibold text-sage-700 dark:text-sage-300">
                    {reassurance}
                </p>
            ) : null}

            <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3 dark:border-white/10 dark:bg-black/20">
                <div className="flex items-start justify-between gap-4 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    <span role="status" aria-live="polite" aria-atomic="true">{statusMessage}</span>
                    {isDeterminate ? (
                        <span className="shrink-0 font-mono text-gray-500" aria-hidden="true">
                            {current.toLocaleString()} / {progress!.total.toLocaleString()}
                        </span>
                    ) : null}
                </div>
                {isDeterminate ? (
                    <div
                        className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
                        role="progressbar"
                        aria-label={statusMessage}
                        aria-valuemin={0}
                        aria-valuemax={progress!.total}
                        aria-valuenow={current}
                    >
                        <div
                            className="h-full rounded-full bg-sage-500 transition-[width] duration-300 motion-reduce:transition-none"
                            style={{ width: `${percentage}%` }}
                        />
                    </div>
                ) : (
                    <LoaderCircle
                        className="mt-3 h-4 w-4 animate-spin text-sage-600 motion-reduce:animate-none dark:text-sage-400"
                        aria-hidden="true"
                    />
                )}
            </div>
        </section>
    );
};
