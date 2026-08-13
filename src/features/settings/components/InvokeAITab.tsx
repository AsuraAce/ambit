import * as React from 'react';
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DatabaseZap, Folder, Info, Globe, Loader2, CheckCircle2, XCircle, Activity, BarChart3, Search, Database, Files, AlertTriangle, FolderOpen, Users } from 'lucide-react';
import { AppSettings } from '../../../types';
import { SyncSection } from './SyncSection';
import { areDeveloperFeaturesEnabled } from '../../../utils/settingsUtils';
import { useLibrary } from '../../../contexts/LibraryContext';
import { InvokeOwnerScopeSelector } from '../../../components/ui/InvokeOwnerScopeSelector';

interface TabProps {
    settings: AppSettings;
    setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

interface InvokeDiagCount {
    count: number;
}

interface InvokeCategoryDiag extends InvokeDiagCount {
    image_category: string;
}

interface InvokeOriginDiag extends InvokeDiagCount {
    image_origin: string;
}

interface InvokeFolderAudit {
    imageFiles: number;
    thumbnailFiles: number;
    subfolders: Record<string, number>;
}

interface InvokeDiagnostics {
    totalInDb: number;
    categories: InvokeCategoryDiag[];
    origins: InvokeOriginDiag[];
    folder: InvokeFolderAudit;
}

export const InvokeAITab: React.FC<TabProps> = React.memo(({ settings, setSettings }) => {
    const {
        invokeOwnerScopeState,
        selectInvokeOwnerScope,
        retryInvokeOwnerScope,
        startInvokeSync,
        isInvokeSyncActive,
        isLiveSyncing,
    } = useLibrary();
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [isTesting, setIsTesting] = useState(false);
    const [diagData, setDiagData] = useState<InvokeDiagnostics | null>(null);
    const [isDiagLoading, setIsDiagLoading] = useState(false);
    const developerFeaturesEnabled = areDeveloperFeaturesEnabled(settings);
    const ownerDiscovery = invokeOwnerScopeState.discovery;
    const ownerSelection = settings.invokeOwnerSelection?.dbPath === ownerDiscovery?.dbPath
        ? settings.invokeOwnerSelection
        : undefined;
    const ownerScopeInProgress = invokeOwnerScopeState.status === 'discovering'
        || invokeOwnerScopeState.status === 'applying';
    const ownerScopeBusy = ownerScopeInProgress || invokeOwnerScopeState.isRetrying === true;
    const foregroundInvokeSyncActive = isInvokeSyncActive && !isLiveSyncing;
    const rootControlsBusy = ownerScopeBusy || foregroundInvokeSyncActive;
    const rootControlsLocked = ownerScopeBusy || isInvokeSyncActive;
    const scopeControlsBusy = ownerScopeBusy || foregroundInvokeSyncActive;
    const singleOwner = ownerDiscovery?.schemaMode === 'multi_user'
        && ownerDiscovery.owners.length === 1
        && ownerDiscovery.unassignedImageCount === 0
        && (ownerDiscovery.unassignedBoardCount ?? 0) === 0
        ? ownerDiscovery.owners[0]
        : undefined;

    const handleOwnerSelection = async (selection: Parameters<typeof selectInvokeOwnerScope>[0]) => {
        await selectInvokeOwnerScope(selection);
    };

    const handleOwnerRetry = async () => {
        if (await retryInvokeOwnerScope()) {
            await startInvokeSync({ mode: 'startup' });
        }
    };

    const runDiagnostics = async () => {
        setIsDiagLoading(true);
        try {
            const { diagnoseInvokeAI } = await import('../../../services/invoke/connection');
            const dbDiag = await diagnoseInvokeAI(settings.invokeAiPath!) as Omit<InvokeDiagnostics, 'folder'>;
            const folderAudit = await invoke<InvokeFolderAudit>('audit_invokeai_folder', { path: settings.invokeAiPath! });

            setDiagData({
                ...dbDiag,
                folder: folderAudit
            });
        } catch (e) {
            console.error(e);
        } finally {
            setIsDiagLoading(false);
        }
    };

    const handleTestConnection = async () => {
        setIsTesting(true);
        setTestResult(null);

        try {
            const { testConnection } = await import('../../../services/invoke/connection');
            const result = await testConnection(settings.invokeAiPath!);
            setTestResult({ success: result.success, message: result.message });
        } catch (e) {
            console.error(e);
            setTestResult({ success: false, message: "Failed to load integration service." });
        } finally {
            setIsTesting(false);
        }
    };

    const handleBrowse = async () => {
        if (rootControlsLocked) return;

        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                directory: true,
                multiple: false,
                title: 'Select InvokeAI Root Folder'
            });

            if (selected && typeof selected === 'string') {
                setSettings(prev => ({ ...prev, invokeAiPath: selected }));
            }
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div className="space-y-8 max-w-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">

            <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
                <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-3">
                    <DatabaseZap className="w-4 h-4" /> InvokeAI Configuration
                </h4>

                <div className="space-y-6">
                    <div className="relative">
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3">
                            Root Installation Path
                        </label>
                        <div className="flex gap-2">
                            <div className="flex-1 relative group">
                                <input
                                    type="text"
                                    value={settings.invokeAiPath || ''}
                                    disabled={rootControlsBusy}
                                    readOnly={isLiveSyncing}
                                    aria-disabled={rootControlsLocked}
                                    title={rootControlsLocked ? 'Wait for the current InvokeAI sync to finish' : undefined}
                                    onChange={(e) => {
                                        if (rootControlsLocked) return;
                                        setSettings(prev => ({ ...prev, invokeAiPath: e.target.value }));
                                    }}
                                    placeholder="e.g. C:\\AI\\invokeai"
                                    className="w-full bg-gray-50 dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:border-sage-500 focus:ring-1 focus:ring-sage-500/50 outline-none text-gray-900 dark:text-white font-mono transition-all"
                                />
                                <Folder className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-sage-500 transition-colors" />
                            </div>
                            <button
                                type="button"
                                onClick={handleBrowse}
                                disabled={rootControlsBusy}
                                aria-disabled={rootControlsLocked}
                                title={rootControlsLocked ? 'Wait for the current InvokeAI sync to finish' : undefined}
                                className="px-4 py-2.5 bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-white/20 active:scale-95 transition-all text-sm font-bold"
                            >
                                Browse
                            </button>
                        </div>
                        <p className="text-[10px] text-gray-500 mt-3 flex items-center gap-1.5 opacity-80">
                            <Info className="w-3 h-3" /> Select the folder containing <code>databases/invokeai.db</code>.
                        </p>
                        {foregroundInvokeSyncActive && (
                            <p className="text-[10px] text-amber-700 dark:text-amber-300 mt-2">
                                The InvokeAI path and owner scope are locked until synchronization finishes.
                            </p>
                        )}
                    </div>

                    <div className="pt-4 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
                        <button
                            onClick={handleTestConnection}
                            disabled={ownerScopeBusy || isTesting || !settings.invokeAiPath}
                            className={`px-6 py-2.5 rounded-xl text-sm font-black tracking-wide transition-all flex items-center gap-2.5 ${!settings.invokeAiPath
                                ? 'bg-gray-100 dark:bg-white/5 text-gray-400 cursor-not-allowed'
                                : 'bg-sage-600 hover:bg-sage-500 text-white shadow-xl shadow-sage-500/20 active:scale-95'
                                }`}
                        >
                            {isTesting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Verifying...
                                </>
                            ) : (
                                <>
                                    <Globe className="w-4 h-4" />
                                    Test Connection
                                </>
                            )}
                        </button>

                        {testResult && (
                            <div className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 animate-in fade-in slide-in-from-right-2 duration-300 ${testResult.success
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                }`}>
                                {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                                {testResult.message}
                            </div>
                        )}
                    </div>
                </div>
            </section>

            {settings.invokeAiPath && (
                <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden">
                    <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-5 flex items-center gap-3">
                        <Users className="w-4 h-4" /> InvokeAI Owner Scope
                    </h4>

                    {ownerScopeInProgress && (
                        <div className="flex items-start gap-3 text-sm text-gray-500" role="status" aria-live="polite">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>
                                <span className="block">
                                    {invokeOwnerScopeState.progress?.message
                                        ?? (invokeOwnerScopeState.status === 'discovering'
                                            ? 'Checking InvokeAI owner information...'
                                            : 'Preparing your InvokeAI library...')}
                                </span>
                                {(invokeOwnerScopeState.progress?.total ?? 0) > 0 && (
                                    <span className="mt-1 block text-[10px] font-mono text-gray-400">
                                        {invokeOwnerScopeState.progress?.current.toLocaleString()} / {invokeOwnerScopeState.progress?.total.toLocaleString()}
                                    </span>
                                )}
                            </span>
                        </div>
                    )}

                    {invokeOwnerScopeState.status === 'error' && (
                        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300">
                            <p className="text-xs font-bold">
                                {invokeOwnerScopeState.failure?.kind === 'source_unavailable'
                                    ? 'InvokeAI connection unavailable'
                                    : 'InvokeAI library preparation failed'}
                            </p>
                            <p className="mt-1 text-[10px] leading-4">
                                {invokeOwnerScopeState.failure?.kind === 'source_unavailable'
                                    ? 'Ambit could not verify this InvokeAI database, so its content remains hidden.'
                                    : 'Ambit could not finish verifying owner visibility, so its content remains hidden.'}
                            </p>
                            {invokeOwnerScopeState.error && (
                                <details className="mt-3 text-[10px]">
                                    <summary className="cursor-pointer font-bold">Technical details</summary>
                                    <p className="mt-1 break-words font-mono">{invokeOwnerScopeState.error}</p>
                                </details>
                            )}
                            <button type="button" onClick={() => void handleOwnerRetry()} className="mt-3 px-3 py-2 rounded-lg bg-rose-500/15 text-[10px] font-black uppercase tracking-wider">
                                Retry
                            </button>
                        </div>
                    )}

                    {invokeOwnerScopeState.status === 'offline_ready' && (
                        <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200">
                            <p className="text-xs font-bold">Using the last verified local view</p>
                            <p className="mt-1 text-[10px] leading-4">
                                InvokeAI is unavailable. Your verified library remains visible, but Sync and Live Watch are paused.
                            </p>
                            {invokeOwnerScopeState.error && (
                                <details className="mt-3 text-[10px]">
                                    <summary className="cursor-pointer font-bold">Technical details</summary>
                                    <p className="mt-1 break-words font-mono">{invokeOwnerScopeState.error}</p>
                                </details>
                            )}
                            <button
                                type="button"
                                disabled={invokeOwnerScopeState.isRetrying}
                                onClick={() => void handleOwnerRetry()}
                                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-[10px] font-black uppercase tracking-wider disabled:cursor-wait disabled:opacity-60"
                            >
                                {invokeOwnerScopeState.isRetrying && <Loader2 className="h-3 w-3 animate-spin" />}
                                {invokeOwnerScopeState.isRetrying ? 'Retrying…' : 'Retry connection'}
                            </button>
                        </div>
                    )}

                    {!ownerScopeBusy
                        && invokeOwnerScopeState.status !== 'error'
                        && invokeOwnerScopeState.status !== 'offline_ready'
                        && invokeOwnerScopeState.warning && (
                        <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-200">
                            {invokeOwnerScopeState.warning}
                        </div>
                    )}

                    {!ownerScopeBusy
                        && invokeOwnerScopeState.status !== 'error'
                        && invokeOwnerScopeState.status !== 'offline_ready'
                        && ownerDiscovery?.schemaMode === 'legacy' && (
                        <div className="p-4 rounded-xl bg-sage-500/10 border border-sage-500/20 text-xs text-gray-600 dark:text-gray-300">
                            This InvokeAI database predates per-user ownership. Ambit keeps the existing unscoped behavior.
                        </div>
                    )}

                    {!ownerScopeBusy
                        && invokeOwnerScopeState.status !== 'error'
                        && invokeOwnerScopeState.status !== 'offline_ready'
                        && singleOwner && (
                        <div className="rounded-xl border border-sage-500/20 bg-sage-500/10 p-4 text-gray-700 dark:text-gray-200">
                            <p className="text-xs font-bold">
                                {singleOwner.displayName || singleOwner.ownerId}
                            </p>
                            <p className="mt-1 text-[10px] font-mono text-gray-500 dark:text-gray-400">
                                {singleOwner.ownerId} · {(singleOwner.imageCount - (singleOwner.intermediateImageCount ?? 0)).toLocaleString()}
                                {singleOwner.intermediateImageCount ? ' standard images' : ' images'}
                            </p>
                            {!!singleOwner.intermediateImageCount && (
                                <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                                    {singleOwner.intermediateImageCount.toLocaleString()} intermediates
                                </p>
                            )}
                            <p className="mt-3 text-xs leading-5 text-gray-600 dark:text-gray-300">
                                Ambit found one InvokeAI owner and selected it automatically. All users would show the same library, so no scope switch is needed.
                            </p>
                        </div>
                    )}

                    {!ownerScopeBusy
                        && invokeOwnerScopeState.status !== 'error'
                        && invokeOwnerScopeState.status !== 'offline_ready'
                        && ownerDiscovery?.schemaMode === 'multi_user'
                        && !singleOwner && (
                        <InvokeOwnerScopeSelector
                            discovery={ownerDiscovery}
                            selection={ownerSelection}
                            disabled={scopeControlsBusy}
                            selectionRequired={invokeOwnerScopeState.status === 'selection_required'}
                            onSelect={handleOwnerSelection}
                        />
                    )}
                </section>
            )}

            {developerFeaturesEnabled && (
                <section className="bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl p-6 shadow-sm relative overflow-hidden group">
                    <h4 className="text-[10px] font-black text-sage-600 dark:text-sage-400 uppercase tracking-[0.2em] mb-6 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Activity className="w-4 h-4" /> System Audit
                        </div>
                        <button
                            type="button"
                            onClick={runDiagnostics}
                            disabled={isDiagLoading || !settings.invokeAiPath}
                            className="text-[10px] bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 px-3 py-1.5 rounded-lg transition-all active:scale-95 font-black uppercase tracking-widest flex items-center gap-2 text-gray-600 dark:text-gray-300"
                        >
                            {isDiagLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
                            {isDiagLoading ? 'Analyzing...' : 'Run Audit'}
                        </button>
                    </h4>

                    {!diagData ? (
                        <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-white/[0.02] rounded-xl border border-gray-200 dark:border-white/5">
                            <div className="p-3 bg-white dark:bg-white/5 rounded-xl shadow-sm">
                                <Search className="w-5 h-5 text-gray-400" />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-gray-700 dark:text-gray-300">Ready for Scan</p>
                                <p className="text-[10px] text-gray-500">Run an audit to compare database entries with local output files.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6 animate-in fade-in slide-in-from-top-2 relative z-10">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-sm group/stat">
                                    <div className="text-[9px] text-gray-500 dark:text-gray-400 uppercase font-black tracking-widest mb-1 flex items-center gap-2">
                                        <Database className="w-3 h-3 text-sage-500" /> InvokeAI Database
                                    </div>
                                    <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums drop-shadow-sm transition-transform group-hover/stat:scale-105 origin-left duration-500">{diagData.totalInDb.toLocaleString()}</div>
                                    <div className="text-[9px] text-gray-500 font-medium">Synced Records</div>
                                </div>
                                <div className="p-4 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-lg shadow-sm group/stat">
                                    <div className="text-[9px] text-gray-500 dark:text-gray-400 uppercase font-black tracking-widest mb-1 flex items-center gap-2">
                                        <Files className="w-3 h-3 text-sage-500" /> Image Repository
                                    </div>
                                    <div className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums drop-shadow-sm transition-transform group-hover/stat:scale-105 origin-left duration-500">{diagData.folder.imageFiles.toLocaleString()}</div>
                                    <div className="text-[10px] text-gray-500 font-medium">Files on Disk</div>
                                </div>
                            </div>

                            {diagData.totalInDb !== diagData.folder.imageFiles && (
                                <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-[11px] text-amber-700 dark:text-amber-400 shadow-lg shadow-amber-500/5">
                                    <div className="font-black uppercase tracking-widest flex items-center gap-2 mb-2">
                                        <AlertTriangle className="w-4 h-4" />
                                        Count Discrepancy Found
                                    </div>
                                    <p className="opacity-90 leading-normal">
                                        There are <strong>{Math.abs(diagData.totalInDb - diagData.folder.imageFiles).toLocaleString()}</strong> {diagData.totalInDb > diagData.folder.imageFiles ? 'extra records in the database' : 'extra files in the outputs folder'}.
                                    </p>
                                    {diagData.totalInDb > diagData.folder.imageFiles && (
                                        <p className="mt-2 text-[10px] font-medium opacity-80 bg-black/5 dark:bg-white/5 p-2 rounded-lg">Recommended: use "Force Full Resync" to re-validate image availability.</p>
                                    )}
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-6 pt-2">
                                <div className="space-y-3">
                                    <div className="text-[9px] text-gray-400 uppercase font-black tracking-widest px-1">Categories (DB)</div>
                                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-2 scrollbar-thin">
                                        {diagData.categories.map((c) => (
                                            <div key={c.image_category} className="flex justify-between text-[10px] p-2.5 bg-gray-100/50 dark:bg-white/[0.02] rounded-xl border border-gray-200 dark:border-white/5 transition-colors hover:bg-gray-200/50 dark:hover:bg-white/[0.05]">
                                                <span className="text-gray-500 dark:text-gray-400 capitalize font-bold">{c.image_category}</span>
                                                <span className="font-black text-gray-900 dark:text-white tabular-nums">{c.count.toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="text-[9px] text-gray-400 uppercase font-black tracking-widest px-1">Origins (DB)</div>
                                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-2 scrollbar-thin">
                                        {diagData.origins.map((o) => (
                                            <div key={o.image_origin} className="flex justify-between text-[10px] p-2.5 bg-gray-100/50 dark:bg-white/[0.02] rounded-xl border border-gray-200 dark:border-white/5 transition-colors hover:bg-gray-200/50 dark:hover:bg-white/[0.05]">
                                                <span className="text-gray-500 dark:text-gray-400 capitalize font-bold">{o.image_origin}</span>
                                                <span className="font-black text-gray-900 dark:text-white tabular-nums">{o.count.toLocaleString()}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="pt-4 border-t border-black/5 dark:border-white/5 space-y-4">
                                <div className="flex items-center justify-between px-1">
                                    <div className="text-[9px] text-gray-400 uppercase font-black tracking-widest">Storage Status</div>
                                    <div className="text-[9px] text-gray-500 font-medium italic">
                                        {diagData.folder.thumbnailFiles.toLocaleString()} Thumbnails active
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                    {Object.entries(diagData.folder.subfolders || {}).map(([folder, count]) => (
                                        <div key={folder} className="flex justify-between items-center text-[10px] p-2 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-all">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <FolderOpen className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                                <span className="text-gray-500 dark:text-gray-400 truncate font-mono">{folder}</span>
                                            </div>
                                            <span className="font-black text-gray-700 dark:text-gray-300 pl-2 tabular-nums">{count.toLocaleString()}</span>
                                        </div>
                                    ))}
                                    {Object.keys(diagData.folder.subfolders || {}).length === 0 && (
                                        <div className="col-span-2 text-[10px] text-gray-500 italic p-3 bg-black/5 dark:bg-black/20 rounded-xl text-center">Output repository is flat (no sub-collections found).</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </section>
            )}

            <SyncSection settings={settings} setSettings={setSettings} />
        </div>
    );
});
