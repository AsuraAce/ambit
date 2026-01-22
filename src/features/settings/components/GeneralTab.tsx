import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { LibraryHealth } from '../../maintenance/components/LibraryHealth';
import { useToast } from '../../../hooks/useToast';
import { AppSettings } from '../../../types';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const GeneralTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const { addToast } = useToast();

    const handleThemeToggle = () => {
        const newTheme = settings.theme === 'dark' ? 'light' : 'dark';
        setSettings(prev => ({ ...prev, theme: newTheme }));
        addToast(`Switched to ${newTheme} mode`, 'success');
    };

    const handleConfirmDeleteToggle = () => {
        const newValue = !settings.confirmDelete;
        setSettings(prev => ({ ...prev, confirmDelete: newValue }));
        addToast(newValue ? 'Delete confirmations enabled' : 'Delete confirmations disabled', 'success');
    };

    const handleAutoThumbnailHealingToggle = () => {
        const newValue = !settings.enableAutoThumbnailHealing;
        setSettings(prev => ({ ...prev, enableAutoThumbnailHealing: newValue }));
        addToast(newValue ? 'Smart optimization enabled' : 'Smart optimization disabled', 'success');
    };

    return (
        <div className="space-y-8 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Appearance</h4>
                <div
                    onClick={handleThemeToggle}
                    className="flex items-center justify-between cursor-pointer group"
                >
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
                        className="text-xs font-bold px-4 py-2 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
                    >
                        Switch
                    </button>
                </div>
            </section>

            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6">Library & Files</h4>

                <div
                    onClick={handleAutoThumbnailHealingToggle}
                    className="flex items-center justify-between cursor-pointer group mb-6"
                >
                    <div>
                        <div className="flex items-center gap-2">
                            <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Smart Thumbnail Optimization</div>
                        </div>
                        <div className="text-sm text-gray-500">Automatically optimize thumbnails in the background</div>
                    </div>
                    <button
                        type="button"
                        className={`w-12 h-7 rounded-full relative transition-colors ${settings.enableAutoThumbnailHealing ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}
                    >
                        <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${settings.enableAutoThumbnailHealing ? 'left-6' : 'left-1'}`} />
                    </button>
                </div>

                {
                    settings.enableAutoThumbnailHealing && (
                        <div
                            onClick={() => {
                                const newValue = !settings.enforceHighQualityThumbnails;
                                setSettings(prev => ({ ...prev, enforceHighQualityThumbnails: newValue }));
                                addToast(newValue ? 'High quality enforcement enabled' : 'High quality enforcement disabled', 'success');
                            }}
                            className="flex items-center justify-between cursor-pointer group mb-6 ml-4 pl-4 border-l-2 border-gray-100 dark:border-white/10 animate-in slide-in-from-left-2 fade-in duration-300"
                        >
                            <div>
                                <div className="flex items-center gap-2">
                                    <div className="text-sm font-medium text-gray-800 dark:text-gray-300 group-hover:text-sage-500 transition-colors">Upgrade Existing Thumbnails</div>
                                    <span className="text-[10px] font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-300 px-1.5 py-0.5 rounded">Slow</span>
                                </div>
                                <div className="text-xs text-gray-400 mt-0.5">Re-generate "fast" or external thumbnails with high-quality versions</div>
                            </div>
                            <button
                                type="button"
                                className={`w-10 h-6 rounded-full relative transition-colors ${settings.enforceHighQualityThumbnails ? 'bg-violet-500' : 'bg-gray-200 dark:bg-white/10'}`}
                            >
                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${settings.enforceHighQualityThumbnails ? 'left-5' : 'left-1'}`} />
                            </button>
                        </div>
                    )
                }

                <div className="border-t border-gray-100 dark:border-white/5 pt-6">
                    <div
                        onClick={handleConfirmDeleteToggle}
                        className="flex items-center justify-between cursor-pointer group"
                    >
                        <div>
                            <div className="text-base font-medium text-gray-900 dark:text-gray-200 group-hover:text-sage-500 transition-colors">Confirm Deletions</div>
                            <div className="text-sm text-gray-500">Show a warning before moving files to Trash</div>
                        </div>
                        <button
                            type="button"
                            className={`w-12 h-7 rounded-full relative transition-colors ${settings.confirmDelete ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}
                        >
                            <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${settings.confirmDelete ? 'left-6' : 'left-1'}`} />
                        </button>
                    </div>
                </div>

                <div className="pt-6 border-t border-gray-100 dark:border-white/5 mt-6">
                    {settings.devMode && <LibraryHealth mode="compact" onNavigateToMaintenance={() => window.location.hash = '#maintenance'} />}
                </div>
            </section >
        </div >
    );
});
