import { AlertTriangle, RotateCw } from 'lucide-react';

interface LibraryLoadErrorProps {
    onRetry: () => void;
}

/** Shown in the grid area when a view's first page fails to load (#483). */
export default function LibraryLoadError({ onRetry }: LibraryLoadErrorProps) {
    return (
        <div role="alert" className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center max-w-md mx-auto">
            <div className="p-6 bg-red-50 dark:bg-red-500/10 rounded-full mb-6 border border-red-200 dark:border-red-500/20 animate-in zoom-in duration-500">
                <AlertTriangle className="w-12 h-12 text-red-600 dark:text-red-300 opacity-70" aria-hidden="true" />
            </div>
            <h3 className="text-2xl font-bold mb-3 text-gray-800 dark:text-gray-100">Images could not load</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
                Something went wrong while loading this view. Your images and files are not changed.
            </p>
            <button
                onClick={onRetry}
                className="px-8 py-3.5 bg-zinc-800 dark:bg-white/10 hover:bg-zinc-700 dark:hover:bg-white/20 text-white rounded-2xl font-bold transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
            >
                <RotateCw className="w-5 h-5" aria-hidden="true" />
                Retry
            </button>
        </div>
    );
}
