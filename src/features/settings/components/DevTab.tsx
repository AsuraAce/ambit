
import * as React from 'react';
import { useState } from 'react';
import { Database, Zap, AlertTriangle, Loader2 } from 'lucide-react';
import { generateStressTestData } from '../../../utils/dev/dataGenerator';
import { useLibraryContext } from '../../../hooks/useLibraryContext';

export const DevTab: React.FC = () => {
    const { fetchData } = useLibraryContext();
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });
    const [targetCount, setTargetCount] = useState(10000);

    const handleStressTest = async () => {
        setIsGenerating(true);
        try {
            await generateStressTestData(targetCount, (current, total) => {
                setProgress({ current, total });
            });
            await fetchData(false);
        } finally {
            setIsGenerating(false);
            setProgress({ current: 0, total: 0 });
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <section>
                <div className="flex items-center gap-2 mb-4">
                    <Database className="w-5 h-5 text-sage-500" />
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white uppercase tracking-wider">Database Stress Testing</h4>
                </div>

                <div className="p-6 bg-amber-500/10 border border-amber-500/20 rounded-2xl mb-6">
                    <div className="flex gap-4">
                        <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0" />
                        <div>
                            <h5 className="text-sm font-bold text-amber-500 mb-1">Warning: Destructive Operation</h5>
                            <p className="text-xs text-amber-900/70 dark:text-amber-500/70 leading-relaxed">
                                Generating large amounts of data will significantly increase database size and may affect performance on low-end hardware.
                                Use this only for benchmarking virtualization and SQL performance.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Target Image Count</label>
                        <select
                            value={targetCount}
                            onChange={(e) => setTargetCount(Number(e.target.value))}
                            className="w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-sage-500/50 transition-all font-mono text-gray-900 dark:text-gray-100"
                            disabled={isGenerating}
                        >
                            <option value={1000}>1,000 images</option>
                            <option value={5000}>5,000 images</option>
                            <option value={10000}>10,000 images</option>
                            <option value={50000}>50,000 images</option>
                            <option value={100000}>100,000 images</option>
                        </select>
                    </div>

                    <button
                        onClick={handleStressTest}
                        disabled={isGenerating}
                        className="w-full h-[46px] bg-sage-600 hover:bg-sage-500 disabled:bg-gray-300 dark:disabled:bg-white/5 text-white rounded-xl text-sm font-bold shadow-lg shadow-sage-500/20 flex items-center justify-center gap-2 transition-all transform active:scale-95 px-6"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Generating {progress.current.toLocaleString()} / {progress.total.toLocaleString()}...
                            </>
                        ) : (
                            <>
                                <Zap className="w-4 h-4 fill-white" />
                                Start Stress Test
                            </>
                        )}
                    </button>
                </div>
            </section>
        </div>
    );
};
