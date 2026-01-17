import * as React from 'react';
import { useState } from 'react';
import { Loader2, Shield, RefreshCw, CheckCircle2, Trash2, AlertTriangle, ExternalLink } from 'lucide-react';

interface LibraryHealthProps {
    mode?: 'compact' | 'detailed';
    onNavigateToMaintenance?: () => void;
    onScanComplete?: (missingIds: string[]) => void;
}

const LibraryHealthBase: React.FC<LibraryHealthProps> = ({ mode = 'detailed', onNavigateToMaintenance, onScanComplete }) => {
    const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
    const [pruningStatus, setPruningStatus] = useState<'idle' | 'running' | 'done'>('idle');
    const [rebuildStatus, setRebuildStatus] = useState<'idle' | 'running' | 'done'>('idle');
    const [result, setResult] = useState<{ scanned: number, missingIds: string[], sampleMissingPaths: string[] } | null>(null);
    const [progress, setProgress] = useState(0);

    const handleVerify = async () => {
        setStatus('running');
        setPruningStatus('idle');
        setResult(null);
        setProgress(0);
        if (onScanComplete) onScanComplete([]);
        try {
            const { verifyLibraryIntegrity } = await import('../../../services/db/maintenanceRepo');
            const res = await verifyLibraryIntegrity((curr, total) => {
                setProgress(Math.round((curr / total) * 100));
            });
            setResult(res);
            setStatus('done');
            if (onScanComplete) onScanComplete(res.missingIds);
        } catch (e) {
            console.error(e);
            setStatus('idle');
        }
    };

    const handlePrune = async () => {
        if (!result || result.missingIds.length === 0) return;
        setPruningStatus('running');
        try {
            const { pruneMissingLinks } = await import('../../../services/db/maintenanceRepo');
            await pruneMissingLinks(result.missingIds);
            setPruningStatus('done');
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) {
            console.error(e);
            setPruningStatus('idle');
        }
    };



    if (mode === 'compact') {
        return (
            <div className="bg-sage-50/50 dark:bg-white/[0.02] border border-sage-100 dark:border-white/5 rounded-2xl p-5">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${status === 'done' && result?.missingIds.length === 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-sage-100 dark:bg-white/5 text-sage-600 dark:text-sage-400'}`}>
                            {status === 'running' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Shield className="w-5 h-5" />}
                        </div>
                        <div>
                            <h4 className="text-sm font-bold text-gray-900 dark:text-white">Verify Setup</h4>
                            <p className="text-xs text-gray-500">Run an audit to check for broken file links.</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {status === 'done' && result ? (
                            <div className="flex items-center gap-3">
                                <div className="text-right">
                                    <div className={`text-xs font-black ${result.missingIds.length > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                        {result.missingIds.length > 0 ? `${result.missingIds.length} Broken` : 'Library Healthy'}
                                    </div>
                                    <div className="text-[10px] text-gray-400">{result.scanned} Scanned</div>
                                </div>
                                <button
                                    onClick={onNavigateToMaintenance}
                                    className="p-2.5 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-400 hover:text-sage-500 rounded-xl transition-all border border-gray-100 dark:border-white/5 shadow-sm"
                                    title="Open Maintenance"
                                >
                                    <ExternalLink className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleVerify}
                                disabled={status === 'running'}
                                className="px-5 py-2.5 bg-sage-600 hover:bg-sage-500 text-white rounded-xl text-xs font-black shadow-lg shadow-sage-500/20 transition-all active:scale-95 disabled:opacity-50"
                            >
                                Run Audit
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full space-y-4">
            <div className="flex items-center justify-between p-6 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-white/5 shadow-sm">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-sage-50 dark:bg-sage-900/30 rounded-xl text-sage-600 dark:text-sage-400">
                        <Shield className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Library Health Scan</h3>
                        <p className="text-sm text-gray-500">Deep-scan the database to identify images whose source files are no longer on disk.</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {status === 'running' ? (
                        <div className="flex items-center gap-4 bg-gray-50 dark:bg-black/20 pl-4 pr-1 py-1 rounded-xl border border-gray-100 dark:border-white/5">
                            <div className="flex flex-col text-right">
                                <span className="text-[10px] font-black text-sage-600 uppercase tracking-widest">Scanning...</span>
                                <span className="text-xs font-bold text-gray-400">{progress}%</span>
                            </div>
                            <div className="w-10 h-10 rounded-lg bg-white dark:bg-white/5 flex items-center justify-center">
                                <Loader2 className="w-5 h-5 animate-spin text-sage-500" />
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={handleVerify}
                            disabled={pruningStatus === 'running'}
                            className="flex items-center gap-3 px-6 py-3 bg-sage-600 hover:bg-sage-500 text-white rounded-xl text-sm font-black shadow-xl shadow-sage-500/20 transition-all active:scale-95 disabled:opacity-50"
                        >
                            {status === 'done' ? <RefreshCw className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
                            {status === 'done' ? 'Re-Scan Library' : 'Start Full Audit'}
                        </button>
                    )}
                </div>
            </div>

            {status === 'done' && result && (
                <div className="animate-in fade-in slide-in-from-top-4 duration-500 bg-white/50 dark:bg-black/20 backdrop-blur-md rounded-2xl p-8 border border-gray-200 dark:border-white/5 shadow-2xl relative overflow-hidden group">
                    {/* Background Decorative Element */}
                    <div className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-[100px] opacity-20 transition-colors ${result.missingIds.length > 0 ? 'bg-red-500' : 'bg-emerald-500'}`} />

                    <div className="relative z-10 flex flex-col md:flex-row gap-8 items-start justify-between">
                        <div className="space-y-6 flex-1">
                            <div>
                                <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-4">Audit Summary</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white dark:bg-white/5 p-4 rounded-xl border border-gray-100 dark:border-white/5">
                                        <div className="text-2xl font-black text-gray-900 dark:text-white tabular-nums">{result.scanned.toLocaleString()}</div>
                                        <div className="text-[10px] font-bold text-gray-400 uppercase">Images Scanned</div>
                                    </div>
                                    <div className={`p-4 rounded-xl border transition-colors ${result.missingIds.length > 0 ? 'bg-red-500/5 border-red-500/20' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                                        <div className={`text-2xl font-black tabular-nums ${result.missingIds.length > 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                                            {result.missingIds.length.toLocaleString()}
                                        </div>
                                        <div className="text-[10px] font-bold text-gray-400 uppercase">Broken Links</div>
                                    </div>
                                </div>
                            </div>

                            {result.missingIds.length > 0 && (
                                <div className="space-y-3">
                                    <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.2em]">Sample Missing Paths</h4>
                                    <div className="bg-black/5 dark:bg-black/40 rounded-xl p-4 border border-black/5 dark:border-white/5 font-mono text-[10px] space-y-2 max-h-[150px] overflow-y-auto scrollbar-thin">
                                        {result.sampleMissingPaths.map((path, idx) => (
                                            <div key={idx} className="flex items-center gap-3 text-gray-500 dark:text-gray-400 group/path">
                                                <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                                                <span className="truncate flex-1">{path}</span>
                                            </div>
                                        ))}
                                        {result.missingIds.length > 10 && (
                                            <div className="pt-2 text-gray-500 italic border-t border-white/5">... and {result.missingIds.length - 10} more entries.</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="md:w-72 space-y-6">
                            {result.missingIds.length > 0 ? (
                                <div className="p-6 bg-red-500/5 rounded-2xl border border-red-500/10 space-y-4">
                                    <div className="flex items-center gap-3 text-red-500">
                                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                                        <span className="text-xs font-black uppercase tracking-widest">Action Required</span>
                                    </div>
                                    <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
                                        Purging these records will hide them from your library. This is recommended to maintain database consistency.
                                    </p>
                                    <button
                                        onClick={handlePrune}
                                        disabled={pruningStatus !== 'idle'}
                                        className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl text-sm font-black transition-all active:scale-95 shadow-lg ${pruningStatus === 'done'
                                            ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                                            : 'bg-red-600 hover:bg-red-500 text-white shadow-red-500/20'
                                            }`}
                                    >
                                        {pruningStatus === 'running' ? (
                                            <>
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                Pruning...
                                            </>
                                        ) : pruningStatus === 'done' ? (
                                            <>
                                                <CheckCircle2 className="w-4 h-4" />
                                                Success
                                            </>
                                        ) : (
                                            <>
                                                <Trash2 className="w-4 h-4" />
                                                Prune All Records
                                            </>
                                        )}
                                    </button>
                                </div>
                            ) : (
                                <div className="p-6 bg-emerald-500/5 rounded-2xl border border-emerald-500/10 flex flex-col items-center text-center space-y-3">
                                    <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30 text-white">
                                        <CheckCircle2 className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">Library Perfect</div>
                                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">All database links point to valid files on your disk.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const LibraryHealth = React.memo(LibraryHealthBase);
