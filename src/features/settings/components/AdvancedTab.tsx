import * as React from 'react';
import { useState } from 'react';
import { Shield, Trash2, History as HistoryIcon, ImageOff, Loader2, Database, AlertTriangle, Monitor, RefreshCw } from 'lucide-react';
import { AppSettings } from '../../../types';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useLibraryContext } from '../../../hooks/useLibraryContext';
import { useLibraryStore } from '../../../stores/libraryStore';
import { clearAllThumbnailPaths, rebuildFacetCache } from '../../../services/db/imageRepo';
import { BackupSettings } from './BackupSettings';
import { commands } from '../../../bindings';
import { useToast } from '../../../hooks/useToast';
import { APP_NAME } from '../../../constants/app';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const AdvancedTab: React.FC<TabProps> = ({ settings, setSettings }) => {
    const { fetchData, setSettings: updateContextSettings, cleanLibrary } = useLibraryContext();
    const { addToast } = useToast();

    const [isPurging, setIsPurging] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [isRebuilding, setIsRebuilding] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);

    const [activeTab, setActiveTab] = useState<'database' | 'interface' | 'troubleshooting'>('database');

    // Danger Zone State
    const [confirmAction, setConfirmAction] = useState<{ type: 'reset' | 'purge' | null, isOpen: boolean }>({ type: null, isOpen: false });
    const closeConfirm = () => setConfirmAction({ type: null, isOpen: false });

    const handlePurge = async () => {
        setIsPurging(true);
        // Pause background thumbnail generation to prevent DB locks
        useLibraryStore.getState().setBackgroundHealingPaused(true);

        try {
            await cleanLibrary();
            addToast('Database purged successfully', 'success');
        } catch (e) {
            console.error('[Purge] Failed:', e);
            addToast('Failed to purge database', 'error');
        } finally {
            setIsPurging(false);
            useLibraryStore.getState().setBackgroundHealingPaused(false);
            closeConfirm();
        }
    };

    const handleOptimize = async () => {
        setIsOptimizing(true);
        try {
            const result = await commands.optimizeDatabase();
            if (result.status === 'ok') {
                addToast(result.data, 'success');
            } else {
                console.error(result.error);
                addToast('Failed to optimize database', 'error');
            }
        } catch (e) {
            addToast('Error communicating with backend', 'error');
        } finally {
            setIsOptimizing(false);
        }
    };

    const handleRebuildCache = async () => {
        setIsRebuilding(true);
        try {
            await rebuildFacetCache();
            addToast('Facet cache rebuilt successfully', 'success');
        } catch (e) {
            console.error(e);
            addToast('Failed to rebuild facet cache', 'error');
        } finally {
            setIsRebuilding(false);
        }
    };

    return (
        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">

            {/* Sub Tabs Navigation */}
            <div className="flex p-1 bg-gray-100 dark:bg-white/5 rounded-xl">
                {(['database', 'interface', 'troubleshooting'] as const).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all capitalize ${activeTab === tab
                            ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            {activeTab === 'database' && (
                <div className="space-y-8">
                    {/* Database Maintenance Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                            <Database className="w-4 h-4 text-sage-500" />
                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Database Maintenance</h4>
                        </div>

                        {/* Backup Settings Component */}
                        <BackupSettings />

                        {/* Optimization */}
                        <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Optimize Database</div>
                                    <div className="text-xs text-gray-500 mt-1 max-w-sm">
                                        Runs <code>VACUUM</code> and <code>ANALYZE</code> to reclaim unused space and update query statistics. Recommended after deleting large amounts of data.
                                    </div>
                                </div>
                                <button
                                    onClick={handleOptimize}
                                    disabled={isOptimizing}
                                    className="px-4 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isOptimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                                    {isOptimizing ? 'Optimizing...' : 'Optimize Now'}
                                </button>
                            </div>
                        </section>

                        {/* Rebuild Facet Cache */}
                        <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Rebuild Facet Cache</div>
                                    <div className="text-xs text-gray-500 mt-1 max-w-sm">
                                        Re-calculates all metadata facets (tags, older/newer, etc). Run this if filtering seems incorrect or after bulk external changes.
                                    </div>
                                </div>
                                <button
                                    onClick={handleRebuildCache}
                                    disabled={isRebuilding}
                                    className="px-4 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isRebuilding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                    {isRebuilding ? 'Rebuilding...' : 'Rebuild Cache'}
                                </button>
                            </div>
                        </section>

                        {/* Purge Database - Moved here but kept red */}
                        <div className="bg-rose-50/50 dark:bg-rose-900/5 border border-rose-100 dark:border-rose-500/10 rounded-xl overflow-hidden p-6 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-rose-700 dark:text-rose-400">Purge Database</div>
                                <div className="text-xs text-rose-800/60 dark:text-rose-400/60 mt-1">Remove all imported metadata and reset application state.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setConfirmAction({ type: 'purge', isOpen: true })}
                                className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-sm"
                            >
                                <Trash2 className="w-3.5 h-3.5" /> Purge Database
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'interface' && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <Monitor className="w-4 h-4 text-blue-500" />
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Interface Settings</h4>
                    </div>

                    <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-white/5">
                        {/* Reset Onboarding */}
                        <div className="p-6 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Reset Onboarding</div>
                                <div className="text-xs text-gray-500 mt-1">Show the onboarding wizard again on next reload.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    updateContextSettings((p: any) => ({
                                        ...p,
                                        hasCompletedOnboarding: false,
                                        hideImportModal: false
                                    }));
                                    addToast('Onboarding reset. Reload to see wizard.', 'info');
                                }}
                                className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2"
                            >
                                <HistoryIcon className="w-3.5 h-3.5" /> Reset Wizard
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'troubleshooting' && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <Shield className="w-4 h-4 text-amber-500" />
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Troubleshooting</h4>
                    </div>

                    <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-white/5">
                        {/* Reset Sync Cursor */}
                        <div className="p-6 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Reset Sync Cursor</div>
                                <div className="text-xs text-gray-500 mt-1">Force a full re-scan of external libraries on next sync.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setConfirmAction({ type: 'reset', isOpen: true })}
                                className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2"
                            >
                                <HistoryIcon className="w-3.5 h-3.5" /> Reset Cursor
                            </button>
                        </div>

                        {/* Clear Thumbnails */}
                        <div className="p-6 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Clear Broken Thumbnails</div>
                                <div className="text-xs text-gray-500 mt-1">Fix 500 errors by clearing stale thumbnail paths. Images will use source files.</div>
                            </div>
                            <button
                                type="button"
                                disabled={isClearing}
                                onClick={async () => {
                                    setIsClearing(true);
                                    try {
                                        const count = await clearAllThumbnailPaths();
                                        addToast(`Cleared ${count} thumbnail paths.`, 'success');
                                        await fetchData(false);
                                    } finally {
                                        setIsClearing(false);
                                    }
                                }}
                                className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-amber-600 dark:text-amber-400 rounded-lg text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {isClearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageOff className="w-3.5 h-3.5" />}
                                {isClearing ? 'Clearing...' : 'Clear Thumbnails'}
                            </button>
                        </div>

                        {/* Verify Thumbnails */}
                        <div className="p-6 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Verify Thumbnails</div>
                                <div className="text-xs text-gray-500 mt-1">Scan all images to check if thumbnail files actually exist. Regenerates missing ones.</div>
                            </div>
                            <button
                                type="button"
                                disabled={isVerifying}
                                onClick={async () => {
                                    setIsVerifying(true);
                                    try {
                                        // Cast to any because bindings.ts isn't regenerated yet
                                        const count = await (commands as any).verifyThumbnailFiles();
                                        if (count > 0) {
                                            addToast(`Found ${count} missing thumbnails. Regeneration queued.`, 'success');
                                        } else {
                                            addToast('All thumbnails verified. None missing.', 'success');
                                        }
                                    } catch (e) {
                                        console.error(e);
                                        addToast('Failed to verify thumbnails', 'error');
                                    } finally {
                                        setIsVerifying(false);
                                    }
                                }}
                                className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {isVerifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
                                {isVerifying ? 'Verifying...' : 'Verify Files'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                isOpen={confirmAction.isOpen && confirmAction.type === 'reset'}
                title="Reset Sync Cursor?"
                message={`This will reset the "Last Synced" timestamp. The next sync operation will scan your ENTIRE external library from the beginning. This process may take some time.`}
                confirmLabel="Reset Cursor"
                onConfirm={() => {
                    updateContextSettings((p: any) => ({ ...p, lastSyncedAt: null }));
                    closeConfirm();
                    addToast('Sync cursor reset', 'success');
                }}
                onCancel={closeConfirm}
                zIndex={220}
            />

            <ConfirmDialog
                isOpen={confirmAction.isOpen && confirmAction.type === 'purge'}
                title="Purge Application Database?"
                message={`DANGER: This will delete ALL images and metadata from your ${APP_NAME} library. Your actual image files on disk will NOT be touched, but you will lose all ${APP_NAME}-specific data (collections, tags, favorites). Are you sure?`}
                confirmLabel="Purge Database"
                isDangerous={true}
                onConfirm={handlePurge}
                isLoading={isPurging}
                onCancel={closeConfirm}
                zIndex={220}
            />
        </div>
    );
};
