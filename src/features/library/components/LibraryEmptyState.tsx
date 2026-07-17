import { Import, Loader2 } from 'lucide-react';
import { APP_NAME } from '../../../constants/app';

interface LibraryEmptyStateProps {
    isImporting: boolean;
    importMessage?: string;
    onImport: () => void;
}

export default function LibraryEmptyState({ isImporting, importMessage, onImport }: LibraryEmptyStateProps) {
    if (isImporting) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center max-w-md mx-auto">
                <div className="p-6 bg-sage-100 dark:bg-sage-500/10 rounded-full mb-6 border border-sage-200 dark:border-sage-500/20 animate-in zoom-in duration-500">
                    <Loader2 className="w-12 h-12 text-sage-600 dark:text-sage-400 opacity-70 animate-spin" aria-hidden="true" />
                </div>
                <h3 className="text-2xl font-bold mb-3 text-gray-800 dark:text-gray-100">Building your library…</h3>
                <p role="status" aria-live="polite" className="text-gray-500 dark:text-gray-400 leading-relaxed">
                    {importMessage || 'Your first images will appear here as they are imported.'}
                </p>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col items-center justify-center text-gray-500 p-8 text-center max-w-md mx-auto">
            <div className="p-6 bg-sage-100 dark:bg-sage-500/10 rounded-full mb-6 border border-sage-200 dark:border-sage-500/20 animate-in zoom-in duration-500">
                <Import className="w-12 h-12 text-sage-600 dark:text-sage-400 opacity-70" aria-hidden="true" />
            </div>
            <h3 className="text-2xl font-bold mb-3 text-gray-800 dark:text-gray-100">Your Library is Empty</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
                Import your images to start organizing, searching, and exploring your AI creations with {APP_NAME}.
            </p>
            <button
                onClick={onImport}
                className="px-8 py-3.5 bg-sage-600 hover:bg-sage-500 text-white rounded-2xl font-bold shadow-xl shadow-sage-500/20 transition-all hover:scale-105 active:scale-95 flex items-center gap-2"
            >
                <Import className="w-5 h-5" aria-hidden="true" />
                Import Images
            </button>
        </div>
    );
}
