import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { APP_NAME } from '../../constants/app';

export const LoadingScreen: React.FC = () => {
    return (
        <div className="h-screen w-full bg-gray-50 dark:bg-slate-950 flex flex-col items-center justify-center gap-4 animate-in fade-in duration-700">
            <div className="relative">
                <div className="absolute inset-0 bg-sage-500/20 blur-xl rounded-full animate-pulse" />
                <Loader2 className="w-12 h-12 text-sage-600 dark:text-sage-400 animate-spin relative z-10" />
            </div>
            <div className="flex flex-col items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">{APP_NAME}</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium animate-pulse">Initializing library...</p>
            </div>
        </div>
    );
};
