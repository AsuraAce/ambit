import * as React from 'react';
import { useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Trash2, History as HistoryIcon, Loader2, Database, AlertTriangle, Monitor, RefreshCw, ExternalLink, FolderOpen, Copy } from 'lucide-react';
import { AppSettings, LogLevel } from '../../../types';
import { commands, type DbDiagnostics } from '../../../bindings';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { useLibraryContext } from '../../../hooks/useLibraryContext';
import { useLibraryStore } from '../../../stores/libraryStore';
import { BackupSettings } from './BackupSettings';
import { useToast } from '../../../hooks/useToast';
import { APP_NAME } from '../../../constants/app';
import { AppUpdaterStatus } from '../../../hooks/useAppUpdater';
import { unwrap } from '../../../utils/spectaUtils';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    canCheckForUpdates: boolean;
    hasPendingUpdate: boolean;
    pendingUpdateVersion: string | null;
    updateErrorMessage: string | null;
    updateStatus: AppUpdaterStatus;
    onCheckForUpdates: () => Promise<void>;
    onOpenUpdatePrompt: () => void;
    onNavigateToMaintenance: () => void;
    onClose?: () => void;
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'none'] as const satisfies readonly LogLevel[];
const isLogLevel = (value: string): value is LogLevel => (LOG_LEVELS as readonly string[]).includes(value);

export const AdvancedTab: React.FC<TabProps> = ({
    settings,
    setSettings,
    canCheckForUpdates,
    hasPendingUpdate,
    pendingUpdateVersion,
    updateErrorMessage,
    updateStatus,
    onCheckForUpdates,
    onOpenUpdatePrompt,
    onNavigateToMaintenance,
    onClose,
}) => {
    const { setSettings: updateContextSettings, cleanLibrary } = useLibraryContext();
    const { addToast } = useToast();

    const [isPurging, setIsPurging] = useState(false);
    const [dbDiagnostics, setDbDiagnostics] = useState<DbDiagnostics | null>(null);
    const [dbDiagnosticsError, setDbDiagnosticsError] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<'database' | 'interface' | 'support'>('database');

    // Danger Zone State
    const [confirmAction, setConfirmAction] = useState<{ type: 'purge' | null, isOpen: boolean }>({ type: null, isOpen: false });
    const closeConfirm = () => setConfirmAction({ type: null, isOpen: false });

    const autoUpdateEnabled = settings.autoCheckForUpdates !== false;
    const isCheckingForUpdates = updateStatus === 'checking';
    const isInstallingUpdate = updateStatus === 'downloading' || updateStatus === 'installing';

    const updaterStatusLabel = (() => {
        if (!canCheckForUpdates) {
            return 'Update checks are disabled while running in development.';
        }

        if (updateStatus === 'available') {
            return pendingUpdateVersion
                ? `Version ${pendingUpdateVersion} is ready to install.`
                : 'A new version is ready to install.';
        }

        if (updateStatus === 'downloading') {
            return 'Downloading the selected update package.';
        }

        if (updateStatus === 'installing') {
            return 'Installing update. Ambit may restart or close to finish.';
        }

        if (updateStatus === 'error' && updateErrorMessage) {
            return updateErrorMessage;
        }

        if (updateStatus === 'checking') {
            return 'Checking GitHub Releases for a newer build.';
        }

        return 'Automatically checks GitHub Releases once each time Ambit starts.';
    })();

    const handlePurge = async () => {
        setIsPurging(true);
        // Pause background thumbnail generation to prevent DB locks
        useLibraryStore.getState().setBackgroundHealingPaused(true);

        try {
            await cleanLibrary();
            // In production, the app restarts automatically, so this might not be seen.
            // But in case of delay or dev mode:
            addToast('Purge scheduled. Please restart application manually.', 'success');
            setIsPurging(false);
            useLibraryStore.getState().setBackgroundHealingPaused(false);
            closeConfirm();
        } catch (e) {
            console.error('[Purge] Failed:', e);
            addToast('Failed to purge database', 'error');
            setIsPurging(false);
            useLibraryStore.getState().setBackgroundHealingPaused(false);
            closeConfirm();
        }
    };

    const handleLogLevelChange = (value: string) => {
        if (!isLogLevel(value)) return;
        setSettings(prev => ({ ...prev, logLevel: value }));
        addToast(`Console log level set to ${value.toUpperCase()}`, 'success');
    };

    const handleOpenMaintenance = () => {
        onNavigateToMaintenance();
        onClose?.();
    };

    const handleShowAppLogFolder = async () => {
        try {
            await unwrap(commands.showAppLogFolder());
            addToast('Opened app logs folder', 'success');
        } catch (error) {
            console.error('[Support] Failed to open app logs folder:', error);
            addToast('Failed to open app logs folder', 'error');
        }
    };

    const handleCopyDiagnostics = async () => {
        const diagnostics = dbDiagnostics!;
        try {
            if (!navigator.clipboard?.writeText) {
                throw new Error('Clipboard is not available');
            }

            const version = await getVersion().catch(() => 'unknown');
            const diagnosticsText = [
                `${APP_NAME} Support Diagnostics`,
                `App version: ${version}`,
                `Console log level: ${settings.logLevel || 'info'}`,
                `Active catalog: ${diagnostics.activeDbPath || diagnostics.dbPath}`,
                `Local AppData target: ${diagnostics.localDbPath}`,
                `Legacy Roaming fallback: ${diagnostics.roamingDbPath}`,
                `Using Roaming fallback: ${diagnostics.isUsingRoamingFallback ? 'yes' : 'no'}`,
                `App log folder: ${diagnostics.appLogDir}`,
                `App log file: ${diagnostics.appLogPath}`,
                `Images: ${diagnostics.imageCount}`,
                `Deleted images: ${diagnostics.deletedCount}`,
                `Models: ${diagnostics.modelCount}`,
                `Facet cache rows: ${diagnostics.cacheCount}`,
                `Images missing tool metadata: ${diagnostics.toolNullCount}`,
            ].join('\n');

            await navigator.clipboard.writeText(diagnosticsText);
            addToast('Diagnostics copied to clipboard', 'success');
        } catch (error) {
            console.error('[Support] Failed to copy diagnostics:', error);
            addToast('Failed to copy diagnostics', 'error');
        }
    };

    React.useEffect(() => {
        if (activeTab !== 'support' || dbDiagnostics || dbDiagnosticsError) return;

        let isMounted = true;
        unwrap(commands.getDbDiagnostics())
            .then((diagnostics) => {
                if (isMounted) setDbDiagnostics(diagnostics);
            })
            .catch((error) => {
                if (isMounted) {
                    setDbDiagnosticsError(error instanceof Error ? error.message : String(error));
                }
            });

        return () => {
            isMounted = false;
        };
    }, [activeTab, dbDiagnostics, dbDiagnosticsError]);

    return (
        <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">

            {/* Sub Tabs Navigation */}
            <div className="flex p-1 bg-gray-100 dark:bg-white/5 rounded-xl">
                {(['database', 'interface', 'support'] as const).map((tab) => (
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
                    {/* Database and Backup Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 px-1">
                            <Database className="w-4 h-4 text-sage-500" />
                            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Database & Backups</h4>
                        </div>

                        {/* Backup Settings Component */}
                        <BackupSettings />

                        <div className="flex items-center gap-2 px-1 pt-2">
                            <AlertTriangle className="w-4 h-4 text-rose-500" />
                            <h4 className="text-xs font-bold text-rose-500 uppercase tracking-wider">Danger Zone</h4>
                        </div>

                        {/* Purge Database - Moved here but kept red */}
                        <div className="bg-rose-50/50 dark:bg-rose-900/5 border border-rose-100 dark:border-rose-500/10 rounded-xl overflow-hidden p-6 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-rose-700 dark:text-rose-400">Purge Database</div>
                                <div className="text-xs text-rose-800/60 dark:text-rose-400/60 mt-1">Remove all imported metadata and reset application state.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setConfirmAction({ type: 'purge', isOpen: true })}
                                className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-2 shadow-sm whitespace-nowrap"
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
                        <div className="p-6 space-y-5">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Automatic Updates</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        Check GitHub Releases at startup and install newer public releases only after you confirm the update prompt.
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        const nextValue = !autoUpdateEnabled;
                                        setSettings((prev) => ({ ...prev, autoCheckForUpdates: nextValue }));
                                        addToast(nextValue ? 'Automatic update checks enabled' : 'Automatic update checks disabled', 'success');
                                    }}
                                    className={`w-12 h-7 rounded-full relative transition-colors ${autoUpdateEnabled ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}
                                >
                                    <div className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-sm transition-all ${autoUpdateEnabled ? 'left-6' : 'left-1'}`} />
                                </button>
                            </div>

                            <div className={`rounded-2xl border p-4 text-xs leading-relaxed ${updateStatus === 'error'
                                ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-100'
                                : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-black/20 dark:text-gray-300'
                                }`}>
                                {updaterStatusLabel}
                            </div>

                            <div className="flex flex-col gap-3 sm:flex-row">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (hasPendingUpdate) {
                                            onOpenUpdatePrompt();
                                            return;
                                        }

                                        void onCheckForUpdates();
                                    }}
                                    disabled={!canCheckForUpdates || isCheckingForUpdates || isInstallingUpdate}
                                    className="px-4 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                >
                                    {isCheckingForUpdates || isInstallingUpdate ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                    {hasPendingUpdate ? 'View Update' : 'Check for Updates'}
                                </button>
                            </div>
                        </div>

                        {/* Restart Onboarding */}
                        <div className="p-6 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Restart onboarding</div>
                                <div className="text-xs text-gray-500 mt-1">Close Settings and start the onboarding wizard again.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    updateContextSettings((prev: AppSettings) => ({
                                        ...prev,
                                        hasCompletedOnboarding: false
                                    }));
                                    onClose?.();
                                    addToast('Onboarding restarted.', 'info');
                                }}
                                className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap"
                            >
                                <HistoryIcon className="w-3.5 h-3.5" /> Restart onboarding
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'support' && (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 px-1">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Support Diagnostics</h4>
                    </div>

                    <div className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-white/5">
                        <div className="p-6 flex items-center justify-between gap-4">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Console Log Level</div>
                                <div className="text-xs text-gray-500 mt-1">Choose how much diagnostic detail Ambit writes to the developer console.</div>
                            </div>
                            <select
                                value={settings.logLevel || 'info'}
                                onChange={(e) => handleLogLevelChange(e.target.value)}
                                className="bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-xs font-bold font-mono text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-sage-500/50 cursor-pointer"
                            >
                                <option value="debug">DEBUG</option>
                                <option value="info">INFO</option>
                                <option value="warn">WARN</option>
                                <option value="error">ERROR</option>
                                <option value="none">NONE</option>
                            </select>
                        </div>

                        {settings.logLevel === 'debug' && (
                            <div className="p-4 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs font-medium leading-relaxed">
                                Debug logging can be noisy. Use it when collecting information for an issue, then switch back to Info or Warn.
                            </div>
                        )}

                        <div className="p-6 space-y-3">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Library Database Location</div>
                                <div className="text-xs text-gray-500 mt-1">
                                    Ambit stores the library catalog in Local AppData. This is separate from the folder where the app itself is installed.
                                </div>
                            </div>

                            {dbDiagnostics ? (
                                <div className="space-y-2 text-xs">
                                    {dbDiagnostics.isUsingRoamingFallback && (
                                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 font-medium text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                                            Ambit is using the legacy Roaming AppData database because no Local AppData database is available.
                                        </div>
                                    )}
                                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-black/20">
                                        <div className="font-bold uppercase tracking-wider text-gray-400">Active catalog</div>
                                        <div className="mt-1 break-all font-mono text-gray-700 dark:text-gray-300">
                                            {dbDiagnostics.activeDbPath || dbDiagnostics.dbPath}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-black/20">
                                        <div className="font-bold uppercase tracking-wider text-gray-400">Local AppData target</div>
                                        <div className="mt-1 break-all font-mono text-gray-700 dark:text-gray-300">
                                            {dbDiagnostics.localDbPath}
                                        </div>
                                    </div>
                                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-black/20">
                                        <div className="font-bold uppercase tracking-wider text-gray-400">Legacy Roaming fallback</div>
                                        <div className="mt-1 break-all font-mono text-gray-700 dark:text-gray-300">
                                            {dbDiagnostics.roamingDbPath}
                                        </div>
                                    </div>
                                </div>
                            ) : dbDiagnosticsError ? (
                                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
                                    Could not load database location: {dbDiagnosticsError}
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Loading database location...
                                </div>
                            )}
                        </div>

                        <div className="p-6 space-y-3">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="text-sm font-bold text-gray-900 dark:text-gray-200">App Logs</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        Runtime logs are written to Ambit's app log folder for support investigations.
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <button
                                        type="button"
                                        onClick={() => void handleShowAppLogFolder()}
                                        className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap"
                                    >
                                        <FolderOpen className="w-3.5 h-3.5" /> Show Logs Folder
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleCopyDiagnostics()}
                                        disabled={!dbDiagnostics}
                                        className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                    >
                                        <Copy className="w-3.5 h-3.5" /> Copy Diagnostics
                                    </button>
                                </div>
                            </div>

                            {dbDiagnostics ? (
                                <div className="rounded-lg bg-gray-50 p-3 text-xs dark:bg-black/20">
                                    <div className="font-bold uppercase tracking-wider text-gray-400">App log file</div>
                                    <div className="mt-1 break-all font-mono text-gray-700 dark:text-gray-300">
                                        {dbDiagnostics.appLogPath}
                                    </div>
                                </div>
                            ) : dbDiagnosticsError ? (
                                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-200">
                                    Could not load app log location: {dbDiagnosticsError}
                                </div>
                            ) : (
                                <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Loading app log location...
                                </div>
                            )}
                        </div>

                        <div className="p-6 flex items-center justify-between gap-4">
                            <div>
                                <div className="text-sm font-bold text-gray-900 dark:text-gray-200">Maintenance</div>
                                <div className="text-xs text-gray-500 mt-1">Open library repair tools for missing files, thumbnails, duplicates, and removed items.</div>
                            </div>
                            <button
                                type="button"
                                onClick={handleOpenMaintenance}
                                className="px-3 py-2 bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2 disabled:opacity-50 whitespace-nowrap"
                            >
                                <ExternalLink className="w-3.5 h-3.5" /> Open Maintenance
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmDialog
                isOpen={confirmAction.isOpen && confirmAction.type === 'purge'}
                title="Purge Application Database?"
                message={`DANGER: This will delete ALL images and metadata, AND disconnect all Linked Folders. Your actual image files on disk will NOT be touched, but the application will be reset to a factory-fresh state. Are you sure?`}
                confirmLabel="Purge & Reset"
                isDangerous={true}
                onConfirm={handlePurge}
                isLoading={isPurging}
                onCancel={closeConfirm}
                zIndex={220}
            />
        </div>
    );
};
