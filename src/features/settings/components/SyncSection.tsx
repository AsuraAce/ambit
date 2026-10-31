import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { APP_NAME } from '../../../constants/app';
import type { AppSettings, InvokeOwnerDiscovery } from '../../../types';
import { useLibrary } from '../../../contexts/LibraryContext';
import { useToast } from '../../../hooks/useToast';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { upsertInvokeDbSnapshot } from '../../../services/invoke/dbSnapshot';
import { isSameInvokePath } from '../../../services/invoke/pathIdentity';
import type { InvokeConnectionDraftSession } from '../hooks/useInvokeConnectionDraft';


interface SyncSectionProps {
    draftSession: InvokeConnectionDraftSession;
    ownerDiscovery?: InvokeOwnerDiscovery;
    isApplying?: boolean;
}

type StarredAs = NonNullable<AppSettings['starredAs']>;
const STARRED_AS_VALUES = ['favorite', 'pin', 'both', 'none'] as const satisfies readonly StarredAs[];
const isStarredAs = (value: string): value is StarredAs => (STARRED_AS_VALUES as readonly string[]).includes(value);

export const SyncSection: React.FC<SyncSectionProps> = React.memo(({
    draftSession,
    ownerDiscovery,
    isApplying = false,
}) => {
    const { draft, update } = draftSession;

    const syncFavorites = draft.invokeSyncFavorites;
    const syncBoards = draft.invokeSyncBoards;
    const selectedOwnerMode = ownerDiscovery?.schemaMode === 'multi_user'
        && draft.invokeOwnerSelection
        && isSameInvokePath(draft.invokeOwnerSelection.dbPath, ownerDiscovery.dbPath)
        && draft.invokeOwnerSelection.mode === 'owner';
    const orphanRecoveryEnabled = !selectedOwnerMode && draft.importOrphans;
    const controlsDisabled = isApplying;

    const handleStarredAsChange = (value: string) => {
        if (!isStarredAs(value)) return;
        update({ starredAs: value });
    };

    const handleInvokeSyncFavoritesToggle = (checked: boolean) => {
        update({ invokeSyncFavorites: checked });
    };

    const handleInvokeSyncBoardsToggle = (checked: boolean) => {
        update({ invokeSyncBoards: checked });
    };

    const handleImportIntermediatesToggle = (checked: boolean) => {
        update({ importIntermediates: checked });
    };

    const handleImportOrphansToggle = (checked: boolean) => {
        update({ importOrphans: checked });
    };

    if (!draft.invokeAiPath) return null;

    return (
        <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
            <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                <RefreshCw className="w-4 h-4" /> Import options
            </h4>

            <div className="mb-8 space-y-6 relative z-10">
                <p className="text-sm text-gray-500 font-medium">
                    Choose what the next InvokeAI connection action imports into your {APP_NAME} library.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Favorites Group */}
                    <div className={`p-4 rounded-xl border transition-all duration-300 ${syncFavorites ? 'bg-sage-50 dark:bg-sage-500/5 border-sage-500/20' : 'bg-transparent border-gray-100 dark:border-white/5 opacity-60'}`}>
                        <label className="flex items-center gap-3 cursor-pointer group/label mb-3">
                            <input type="checkbox" role="switch" aria-label="Sync Favorites" aria-checked={syncFavorites} className="peer sr-only" checked={syncFavorites} disabled={controlsDisabled} onChange={e => handleInvokeSyncFavoritesToggle(e.target.checked)} />
                            <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-sage-500/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-slate-950 ${syncFavorites ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                                {syncFavorites && <div className="w-2 h-2 bg-white rounded-sm" />}
                            </div>
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Sync Favorites</span>
                        </label>

                        {syncFavorites && (
                            <div className="pl-8 animate-in fade-in duration-150 motion-reduce:animate-none">
                                <div className="flex items-center gap-3 p-2 bg-white/50 dark:bg-black/20 rounded-xl border border-black/5 dark:border-white/5">
                                    <span className="text-[10px] uppercase font-black text-gray-400 tracking-tighter">Map to</span>
                                    <select
                                        value={draft.starredAs}
                                        disabled={controlsDisabled}
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
                            <input type="checkbox" role="switch" aria-label="Sync boards as collections" aria-checked={syncBoards} className="peer sr-only" checked={syncBoards} disabled={controlsDisabled} onChange={e => handleInvokeSyncBoardsToggle(e.target.checked)} />
                            <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all relative peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-sage-500/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-slate-950 ${syncBoards ? 'bg-sage-600 border-sage-600 shadow-lg shadow-sage-500/30' : 'border-gray-300 dark:border-white/20 bg-white/5'}`}>
                                {syncBoards && <div className="w-2 h-2 bg-white rounded-sm" />}
                            </div>
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-200">Sync boards as collections</span>
                        </label>
                        <p className="mb-3 pl-8 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                            Keep board names and image membership up to date while preserving your local names and membership edits. Ambit never changes InvokeAI.
                        </p>
                        <p className="pl-8 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
                            Turning this off keeps existing collections and your edits. Owner visibility is still verified when needed.
                        </p>
                    </div>
                </div>

                {/* Advanced Options */}
                <div className="p-5 bg-black/[0.03] dark:bg-black/20 rounded-2xl border border-black/5 dark:border-white/5 space-y-4">
                    <div className="text-[9px] font-black text-gray-400 uppercase tracking-widest px-1">Advanced Control</div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <label className="flex items-start gap-3 cursor-pointer group/toggle">
                            <input type="checkbox" role="switch" aria-label="Import Intermediates" aria-checked={draft.importIntermediates} className="peer sr-only" checked={draft.importIntermediates} disabled={controlsDisabled} onChange={e => handleImportIntermediatesToggle(e.target.checked)} />
                            <div className={`mt-1 w-10 h-5 rounded-full relative transition-colors shrink-0 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-sage-500/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-slate-950 ${draft.importIntermediates ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full pointer-events-none transition-transform ${draft.importIntermediates ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                            <div>
                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200 block">Import Intermediates</span>
                                <span className="text-[9px] text-gray-500 leading-tight">Sync background generation steps.</span>
                            </div>
                        </label>

                        <label className={`flex items-start gap-3 group/toggle ${selectedOwnerMode ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                            <input type="checkbox" role="switch" aria-label="Orphan Recovery" aria-checked={orphanRecoveryEnabled} className="peer sr-only" checked={orphanRecoveryEnabled} disabled={selectedOwnerMode || controlsDisabled} onChange={e => handleImportOrphansToggle(e.target.checked)} />
                            <div className={`mt-1 w-10 h-5 rounded-full relative transition-colors shrink-0 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-sage-500/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-slate-950 ${orphanRecoveryEnabled ? 'bg-sage-600' : 'bg-gray-200 dark:bg-white/10'}`}>
                                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full pointer-events-none transition-transform ${orphanRecoveryEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
                            </div>
                            <div>
                                <span className="text-[11px] font-bold text-gray-700 dark:text-gray-200 block">Orphan Recovery</span>
                                <span className="text-[9px] text-gray-500 leading-tight">
                                    {selectedOwnerMode
                                        ? 'Unavailable for one owner because output files do not carry reliable ownership. Your saved preference is preserved.'
                                        : 'Manual full output-folder recovery sweep.'}
                                </span>
                            </div>
                        </label>
                    </div>

                </div>
            </div>

        </section>
    );
});

interface InvokeRecoverySectionProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
    hasPendingDraft: boolean;
    isApplying?: boolean;
}

export const InvokeRecoverySection: React.FC<InvokeRecoverySectionProps> = React.memo(({
    settings,
    setSettings,
    hasPendingDraft,
    isApplying = false,
}) => {
    const { isInvokeSyncActive, isLiveSyncing } = useLibrary();
    const { addToast } = useToast();
    const [isFullResyncConfirmOpen, setIsFullResyncConfirmOpen] = React.useState(false);
    const anyInvokeSyncActive = isInvokeSyncActive || isLiveSyncing;
    const disabled = anyInvokeSyncActive || hasPendingDraft || isApplying;

    const handleForceFullResync = () => {
        if (disabled) {
            setIsFullResyncConfirmOpen(false);
            return;
        }
        setSettings(prev => {
            const invokeDbSnapshot = prev.invokeDbSnapshot
                ? { ...prev.invokeDbSnapshot, lastSyncedAt: null }
                : undefined;
            return {
                ...prev,
                lastSyncedAt: null,
                invokeDbSnapshot,
                invokeDbSnapshots: invokeDbSnapshot
                    ? upsertInvokeDbSnapshot(prev.invokeDbSnapshots, invokeDbSnapshot)
                    : prev.invokeDbSnapshots,
            };
        });
        setIsFullResyncConfirmOpen(false);
        addToast('InvokeAI full resync queued. Start sync to scan from the beginning.', 'success');
    };

    if (!settings.invokeAiPath) return null;
    return (
        <>
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
                <h4 className="mb-4 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] text-sage-600 dark:text-sage-300">
                    <RefreshCw className="h-4 w-4" /> Sync recovery
                </h4>
                <div className="flex items-center justify-between gap-6">
                    <div>
                        <div className="text-[11px] font-bold text-gray-700 dark:text-gray-200">Force Full InvokeAI Resync</div>
                        <div className="mt-1 text-[9px] leading-tight text-gray-500">Clear the applied sync cursor so the next manual sync checks the full InvokeAI database.</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            if (disabled) return;
                            setIsFullResyncConfirmOpen(true);
                        }}
                        disabled={disabled}
                        title={hasPendingDraft ? 'Apply or discard draft changes before clearing the sync cursor' : (anyInvokeSyncActive || isApplying ? 'Wait for the current InvokeAI sync to finish' : 'Clear the sync cursor for the next manual sync')}
                        className="shrink-0 whitespace-nowrap rounded-lg border border-ember-500/20 bg-ember-500/10 px-3 py-2 text-[10px] font-black text-ember-600 transition-all hover:bg-ember-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-ember-300"
                    >
                        Force Full Resync
                    </button>
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
