import * as React from 'react';
import { RefreshCw, Zap, ZapOff, XCircle } from 'lucide-react';
import { APP_NAME } from '../../../constants/app';
import { AppSettings } from '../../../types';
import { useLibrary } from '../../../contexts/LibraryContext';
import { useToast } from '../../../hooks/useToast';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';


interface SyncSectionProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

type StarredAs = NonNullable<AppSettings['starredAs']>;
const STARRED_AS_VALUES = ['favorite', 'pin', 'both', 'none'] as const satisfies readonly StarredAs[];
const isStarredAs = (value: string): value is StarredAs => (STARRED_AS_VALUES as readonly string[]).includes(value);

export const SyncSection: React.FC<SyncSectionProps> = React.memo(({ settings, setSettings }) => {
    const { syncState, startInvokeSync, cancelSync, isLiveSyncing } = useLibrary();
    const { status } = syncState;
    const { addToast } = useToast();
    const [isFullResyncConfirmOpen, setIsFullResyncConfirmOpen] = React.useState(false);

    const syncFavorites = settings.invokeSyncFavorites !== false;
    const syncBoards = settings.invokeSyncBoards !== false;
    const isInvokeSyncActive = status === 'syncing' || isLiveSyncing;

    const handleStarredAsChange = (value: string) => {
        if (!isStarredAs(value)) return;
        setSettings(prev => ({ ...prev, starredAs: value }));
        addToast(`Starred images mapped to ${value}`, 'success');
    };

    const handleSyncBoardsToggle = (checked: boolean) => {
        setSettings(prev => ({ ...prev, syncBoardsToCollections: checked }));
        addToast(checked ? 'Boards will sync to collections' : 'Board sync disabled', 'success');
    };

    const handleInvokeSyncFavoritesToggle = (checked: boolean) => {
        setSettings(prev => ({ ...prev, invokeSyncFavorites: checked }));
        addToast(checked ? 'Invoke favorites will sync' : 'Invoke favorites sync disabled', 'success');
    };

    const handleInvokeSyncBoardsToggle = (checked: boolean) => {
        setSettings(prev => ({ ...prev, invokeSyncBoards: checked }));
        addToast(checked ? 'Invoke boards will sync' : 'Invoke boards sync disabled', 'success');
    };

    const handleImportIntermediatesToggle = (checked: boolean) => {
        setSettings(prev => ({ ...prev, importIntermediates: checked }));
        addToast(checked ? 'Intermediates import enabled' : 'Intermediates import disabled', 'success');
    };

    const handleImportOrphansToggle = (checked: boolean) => {
        setSettings(prev => ({ ...prev, importOrphans: checked }));
        addToast(checked ? 'Orphan recovery enabled' : 'Orphan recovery disabled', 'success');
    };


    const handleSync = () => {
        addToast('Synchronization started...', 'success');
        startInvokeSync({
            syncFavorites,
            syncBoards,
            importIntermediates: settings.importIntermediates,
            afterTimestamp: settings.lastSyncedAt,
            starredAs: settings.starredAs,
            importOrphans: settings.importOrphans
        });
    };

    const handleForceFullResync = () => {
        if (isInvokeSyncActive) {
            setIsFullResyncConfirmOpen(false);
            addToast('Wait for the current InvokeAI sync to finish before forcing a full resync.', 'warning');
            return;
        }

        setSettings(prev => ({ ...prev, lastSyncedAt: null }));
        setIsFullResyncConfirmOpen(false);
        addToast('InvokeAI full resync queued. Start sync to scan from the beginning.', 'success');
    };

    if (!settings.invokeAiPath) return null;

    return (
        <>
        <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
            <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                <RefreshCw className="w-4 h-4" /> Synchronization
            </h4>

            <div className="mb-8 space-y-6 relative z-10">
                <p className="text-sm text-gray-500 font-medium">
                    Automate the bridge between InvokeAI and your {APP_NAME} library.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Favorites Group */}
                    <div className={`p-4 rounded-xl border transition-all duration-300 ${syncFavorites ? 'bg-sage-50 dark:bg-sage-500/5 border-sage-500/20' : 'bg-transparent border-gray-100 dark:border-white/5 opacity-60'}`}>
                        <label className="flex items-center gap-3 cursor-pointer group/label mb-3">
                            <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative ${syncFavorites ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                                {syncFavorites && <div className="w-2 h-2 bg-white rounded-sm" />}
                                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={syncFavorites} onChange={e => handleInvokeSyncFavoritesToggle(e.target.checked)} />
                            </div>
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Sync Favorites</span>
                        </label>

                        {syncFavorites && (
                            <div className="pl-8 animate-in fade-in slide-in-from-left-2 duration-300">
                                <div className="flex items-center gap-3 p-2 bg-white/50 dark:bg-black/20 rounded-xl border border-black/5 dark:border-white/5">
                                    <span className="text-[10px] uppercase font-black text-gray-400 tracking-tighter">Map to</span>
                                    <select
                                        value={settings.starredAs || 'favorite'}
                                        onChange={(e) => handleStarredAsChange(e.target.value)}
                                        className="flex-1 bg-gray-100 dark:bg-zinc-800 text-xs font-bold outline-none text-sage-600 dark:text-sage-300 cursor-pointer py-1.5 px-2 rounded-lg"
                                    >
                                        <option value="favorite">Favorites</option>
                                        <option value="pin">Pins</option>
                                        <option value="both">Both</option>
                                        <option value="none">None (Ignore)</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Boards Group */}
                    <div className={`p-4 rounded-xl border transition-all duration-300 ${syncBoards ? 'bg-sage-50 dark:bg-sage-500/5 border-sage-500/20' : 'bg-transparent border-gray-100 dark:border-white/5 opacity-60'}`}>
                        <label className="flex items-center gap-3 cursor-pointer group/label mb-3">
                            <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative ${syncBoards ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                                {syncBoards && <div className="w-2 h-2 bg-white rounded-sm" />}
                                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={syncBoards} onChange={e => handleInvokeSyncBoardsToggle(e.target.checked)} />
                            </div>
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Sync Boards</span>
                        </label>

                        {syncBoards && (
                            <div className="pl-8 animate-in fade-in slide-in-from-left-2 duration-300">
                                <label className="flex items-center gap-2 cursor-pointer group/sub">
                                    <div className={`w-8 h-4 rounded-full relative transition-colors ${settings.syncBoardsToCollections ? 'bg-sage-600' : 'bg-gray-300 dark:bg-white/10'}`}>
                                        <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={settings.syncBoardsToCollections || false} onChange={e => handleSyncBoardsToggle(e.target.checked)} />
                                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full pointer-events-none transition-transform ${settings.syncBoardsToCollections ? 'translate-x-4' : 'translate-x-0'}`} />
                                    </div>
                                    <span className="text-[10px] font-bold text-gray-500 group-hover/sub:text-sage-600 transition-colors">Persistent Collections</span>
                                </label>
                            </div>
                        )}
                    </div>
                </div>

                {/* Advanced Options */}
                <div className="p-5 bg-black/[0.03] dark:bg-black/20 rounded-2xl border border-black/5 dark:border-white/5 space-y-4">
                    <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Advanced Control</div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="flex items-start gap-3 cursor-pointer group/toggle">
                            <div className={`mt-1 w-10 h-5 rounded-full relative transition-colors shrink-0 ${settings.importIntermediates ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={settings.importIntermediates || false} onChange={e => handleImportIntermediatesToggle(e.target.checked)} />
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full pointer-events-none transition-transform ${settings.importIntermediates ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                            <div>
                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200 block">Import Intermediates</span>
                                <span className="text-[9px] text-gray-500 leading-tight">Sync background generation steps.</span>
                            </div>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer group/toggle">
                            <div className={`mt-1 w-10 h-5 rounded-full relative transition-colors shrink-0 ${settings.importOrphans === true ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                                <input type="checkbox" className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10" checked={settings.importOrphans === true} onChange={e => handleImportOrphansToggle(e.target.checked)} />
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full pointer-events-none transition-transform ${settings.importOrphans === true ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                            <div>
                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200 block">Orphan Recovery</span>
                                <span className="text-[9px] text-gray-500 leading-tight">Manual full output-folder recovery sweep.</span>
                            </div>
                        </label>
                    </div>

                    <div className="mt-6 pt-5 border-t border-black/10 dark:border-white/10">
                        <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-4">
                            Sync Recovery
                        </div>
                        <div className="flex items-center justify-between gap-6">
                            <div>
                                <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200">Force Full InvokeAI Resync</div>
                                <div className="text-[9px] text-gray-500 leading-tight mt-1">Clear the sync cursor so the next manual sync checks the full InvokeAI database.</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsFullResyncConfirmOpen(true)}
                                disabled={isInvokeSyncActive}
                                title={isInvokeSyncActive ? 'Wait for the current InvokeAI sync to finish' : 'Clear the sync cursor for the next manual sync'}
                                className="px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-lg text-[10px] font-black transition-all flex items-center gap-2 border border-amber-500/20 whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-500/10"
                            >
                                <RefreshCw className="w-3.5 h-3.5" /> Force Full Resync
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-4 relative z-10">
                <div className="flex items-center justify-between">
                    {status === 'idle' || status === 'error' || status === 'complete' ? (
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handleSync}
                                className="px-8 py-3 bg-sage-600 hover:bg-sage-500 text-white rounded-xl text-sm font-black transition-all shadow-xl shadow-sage-500/20 active:scale-95 flex items-center gap-3"
                                title="Start synchronization with InvokeAI"
                            >
                                {status === 'error' ? <ZapOff className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                                {status === 'error' ? 'Retry Sync' : 'Initiate Sync'}
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={cancelSync}
                            className="px-6 py-3 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl text-sm font-black transition-all flex items-center gap-3 active:scale-95"
                            title="Abort the current synchronization"
                        >
                            <XCircle className="w-5 h-5" /> Terminate Sync
                        </button>
                    )}
                </div>



            </div>
        </section>
        <ConfirmDialog
            isOpen={isFullResyncConfirmOpen}
            title="Force Full InvokeAI Resync?"
            message="This clears the InvokeAI sync cursor. The next sync will scan the full InvokeAI database. Existing Ambit records, files, and InvokeAI snapshots stay untouched."
            confirmLabel="Force Full Resync"
            onConfirm={handleForceFullResync}
            onCancel={() => setIsFullResyncConfirmOpen(false)}
            zIndex={220}
        />
        </>
    );
});
