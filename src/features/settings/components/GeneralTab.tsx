import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { AppSettings } from '../../../types';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

const LibraryHealthLazy = React.lazy(() => import('../../maintenance/components/LibraryHealth').then(m => ({ default: m.LibraryHealth })));

export const GeneralTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => (
    <div className="space-y-8 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
        <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Appearance</h4>
            <label className="flex items-center justify-between cursor-pointer group">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl transition-colors ${settings.theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700'}`}>
                        {settings.theme === 'dark' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
                    </div>
                    <div>
                        <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Theme Mode</div>
                        <div className="text-sm text-gray-500">{settings.theme === 'dark' ? 'Dark Mode Active' : 'Light Mode Active'}</div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setSettings(prev => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }))}
                    className="text-xs font-bold px-4 py-2 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
                >
                    Switch
                </button>
            </label>
        </section>

        <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">File Operations</h4>
            <label className="flex items-center justify-between cursor-pointer group">
                <div>
                    <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Confirm Deletions</div>
                    <div className="text-sm text-gray-500">Show a warning before moving files to Trash</div>
                </div>
                <div className={`w-12 h-7 rounded-full relative transition-colors ${settings.confirmDelete ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                    <input
                        type="checkbox"
                        className="hidden"
                        checked={settings.confirmDelete}
                        onChange={() => setSettings(prev => ({ ...prev, confirmDelete: !prev.confirmDelete }))}
                    />
                    <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${settings.confirmDelete ? 'left-6' : 'left-1'}`} />
                </div>
            </label>

            <div className="pt-6 border-t border-gray-100 dark:border-white/5">
                <React.Suspense fallback={<div className="h-20 bg-gray-100 dark:bg-white/5 rounded-xl animate-pulse" />}>
                    <LibraryHealthLazy mode="compact" onNavigateToMaintenance={() => window.location.hash = '#maintenance'} />
                </React.Suspense>
            </div>
        </section>
    </div>
));
