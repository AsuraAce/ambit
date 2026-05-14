import * as React from 'react';
import { Database, FolderOpen, RefreshCw, FileClock, AlertCircle } from 'lucide-react';
import { commands, BackupInfo } from '../../../bindings';
import { useToast } from '../../../hooks/useToast';
import { isOsOpenUnavailable, showPathInFolder } from '../../../services/osOpen';

export const BackupSettings: React.FC = () => {
    const [backups, setBackups] = React.useState<BackupInfo[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [isCreating, setIsCreating] = React.useState(false);
    const { addToast } = useToast();

    const loadBackups = React.useCallback(async () => {
        setIsLoading(true);
        const result = await commands.getBackups();
        if (result.status === 'ok') {
            setBackups(result.data);
        } else {
            console.error(result.error);
            addToast('Failed to load backups', 'error');
        }
        setIsLoading(false);
    }, [addToast]);

    React.useEffect(() => {
        loadBackups();
    }, [loadBackups]);

    const handleCreateBackup = async () => {
        setIsCreating(true);
        const result = await commands.backupDatabase();
        if (result.status === 'ok') {
            addToast('Backup created successfully', 'success');
            loadBackups();
        } else {
            console.error(result.error);
            addToast(`Backup failed: ${result.error}`, 'error');
        }
        setIsCreating(false);
    };

    const handleOpenFolder = async () => {
        if (backups.length > 0) {
            const result = await showPathInFolder(backups[0].path);
            if (result.status === 'ok') {
                addToast('Opening backup folder...', 'info');
            } else {
                addToast(result.error, isOsOpenUnavailable(result.error) ? 'info' : 'error');
            }
        } else {
            addToast('No backups exist yet to show folder', 'info');
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleString();
        } catch {
            return dateStr;
        }
    };

    return (
        <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Database & Backups</h4>
                    <p className="text-sm text-gray-500">Manage snapshots of your library database</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={loadBackups}
                        disabled={isLoading}
                        className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                        title="Refresh List"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                    </button>
                    {backups.length > 0 && (
                        <button
                            onClick={handleOpenFolder}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/10 rounded-lg hover:bg-gray-200 dark:hover:bg-white/20 transition-colors"
                        >
                            <FolderOpen className="w-4 h-4" />
                            Folder
                        </button>
                    )}
                    <button
                        onClick={handleCreateBackup}
                        disabled={isCreating}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-sage-600 rounded-lg hover:bg-sage-500 transition-colors disabled:opacity-50"
                    >
                        <Database className="w-4 h-4" />
                        {isCreating ? 'Creating...' : 'Backup Now'}
                    </button>
                </div>
            </div>

            <div className="space-y-3">
                {backups.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 border border-dashed border-gray-200 dark:border-white/10 rounded-lg">
                        <Database className="w-8 h-8 mx-auto mb-2 opacity-20" />
                        <p>No backups found</p>
                    </div>
                ) : (
                    backups.slice(0, 3).map((backup) => (
                        <div key={backup.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-black/20 rounded-lg border border-transparent hover:border-gray-200 dark:hover:border-white/10 transition-colors group">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white dark:bg-white/5 rounded-md text-sage-600 dark:text-sage-400">
                                    <FileClock className="w-4 h-4" />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-gray-900 dark:text-gray-200">{backup.name}</div>
                                    <div className="text-xs text-gray-500">{formatDate(backup.createdAt)}</div>
                                </div>
                            </div>
                            <div className="text-sm text-gray-500 font-mono">
                                {formatSize(backup.sizeBytes)}
                            </div>
                        </div>
                    ))
                )}
                {backups.length > 3 && (
                    <div className="text-center text-xs text-gray-500 pt-2">
                        + {backups.length - 3} more archived backups
                    </div>
                )}
            </div>

            <div className="mt-4 flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-300 rounded-lg text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                    Production builds create backups automatically once every 24 hours. The newest 3 backups are kept.
                    Development builds only create backups when you use Backup Now. To restore, please manually replace the <code>images.db</code> file.
                </p>
            </div>
        </section>
    );
};
