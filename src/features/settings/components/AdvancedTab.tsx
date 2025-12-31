import * as React from 'react';
import { useState } from 'react';
import { Shield, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { AppSettings } from '../../../types';
import { useLibrary } from '../../../contexts/LibraryContext';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const AdvancedTab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const { cleanLibrary } = useLibrary();
    const [isPurging, setIsPurging] = useState(false);
    const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);

    const handlePurge = async () => {
        setIsPurging(true);
        try {
            await cleanLibrary();
            // No need to set settings here as cleanLibrary should handle the backend/context side
        } catch (e) {
            console.error(e);
        } finally {
            setIsPurging(false);
            setShowPurgeConfirm(false);
        }
    };

    return (
        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-6 flex items-center gap-2">
                    <Shield className="w-4 h-4" /> Danger Zone
                </h4>

                <div className="p-4 bg-rose-500/5 border border-rose-500/10 rounded-xl space-y-4">
                    <div className="flex items-start gap-4">
                        <div className="p-2 bg-rose-500/20 rounded-lg text-rose-600 dark:text-rose-400">
                            <Trash2 className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="text-sm font-bold text-gray-900 dark:text-white">Purge Library Database</p>
                            <p className="text-xs text-gray-500 mt-1">
                                Deletes all image references, collections, and metadata from the local database.
                                Your files on disk are safe.
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => setShowPurgeConfirm(true)}
                        disabled={isPurging}
                        className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 disabled:bg-gray-300 dark:disabled:bg-white/5 text-white rounded-lg transition-all font-bold text-sm"
                    >
                        {isPurging ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Purge All Data'}
                    </button>
                </div>
            </section>

            <ConfirmDialog
                isOpen={showPurgeConfirm}
                title="Purge Application Database?"
                message="DANGER: This will delete ALL images and metadata from your Ambit library. Your actual image files on disk will NOT be touched. This cannot be undone. Are you sure?"
                confirmLabel="Purge Database"
                isDangerous={true}
                onConfirm={handlePurge}
                onCancel={() => setShowPurgeConfirm(false)}
            />
        </div>
    );
});
