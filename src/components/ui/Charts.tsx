
import * as React from 'react';
import { useState } from 'react';
import { Lightbulb, X, BarChart3 } from 'lucide-react';
import { AIImage } from '../../types';
// Note: useLibraryStats hook is deprecated for large library performance. Using DB stats.
import { useLibraryContext } from '../../hooks/useLibraryContext';
import { WordCloud } from './stats/WordCloud';

interface ChartsProps {
    images: AIImage[];
    onFilter: (type: 'model' | 'keyword', value: string) => void;
}

const TIPS = [
    "Right-click an image to quickly add it to a collection.",
    "Use 'steps:>50' in the search bar to find high-step generations.",
    "Enable AI Features to search your library using natural language.",
    "Press 'Space' to quickly open the image viewer.",
    "Shift+Click images to select a range.",
    "Double click an image in the viewer to zoom 200%.",
    "Drag and drop images to import them."
];

type ModelChartStat = {
    name: string;
    fullName?: string;
    count: number;
};

const SKELETON_BAR_WIDTHS = ['92%', '76%', '84%', '63%', '71%'];

const formatAnalysisTarget = (globalTotal: number) =>
    globalTotal > 0
        ? `Analyzing ${globalTotal.toLocaleString()} library images`
        : 'Analyzing library images';

export const StatsDashboard: React.FC<ChartsProps> = ({ images, onFilter }) => {
    // Use DB-backed global stats
    const {
        stats,
        setFilters,
        isFiltering,
        globalTotal,
        isStatsSummaryLoading,
        isKeywordStatsLoading
    } = useLibraryContext();
    const { totalGenerations, avgSteps, estSizeMB, modelStats, keywordStats } = stats;
    const modelChartStats: ModelChartStat[] = modelStats ?? [];
    const maxModelCount = Math.max(1, ...modelChartStats.map(stat => stat.count));
    const shouldShowWordCloudLoading = isStatsSummaryLoading || (isKeywordStatsLoading && keywordStats.length === 0);
    const analysisTargetLabel = formatAnalysisTarget(globalTotal);

    const [showTip, setShowTip] = useState(true);

    // Fix: Initialize tip once on mount so it doesn't change when filtering
    const [randomTip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);

    return (
        <div className="h-full flex flex-col overflow-hidden">
            {/* Floating Pill Header - Matching AppHeader & Maintenance Style */}
            <div className="flex-shrink-0 pt-4 pl-6 pr-8 pb-4 z-20">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-lg">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <div className="p-2 bg-sage-100 dark:bg-sage-900/30 rounded-lg text-sage-600 dark:text-sage-400">
                                <BarChart3 className="w-5 h-5" />
                            </div>
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Gallery Statistics</h2>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 pl-1">Analyze your generation habits, models, and prompts.</p>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-8" style={{ scrollbarGutter: 'stable' }}>
                <div className="w-full space-y-6 pb-24">

                    {showTip && (
                        <div className="bg-sage-50 dark:bg-sage-900/10 border border-sage-200 dark:border-sage-500/20 rounded-xl p-4 flex items-start gap-3 relative animate-in fade-in slide-in-from-top-2">
                            <div className="p-2 bg-sage-100 dark:bg-sage-800 rounded-lg text-sage-600 dark:text-sage-400">
                                <Lightbulb className="w-5 h-5" />
                            </div>
                            <div className="flex-1 pr-8">
                                <h4 className="text-sm font-bold text-sage-800 dark:text-sage-200 mb-1">Tip of the Day</h4>
                                <p className="text-sm text-sage-600 dark:text-sage-300">{randomTip}</p>
                            </div>
                            <button type="button" aria-label="Dismiss Tip" onClick={() => setShowTip(false)} className="absolute top-2 right-2 p-1 text-sage-400 hover:text-sage-600 dark:hover:text-sage-200">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                        <StatCard
                            label="Total Images"
                            value={totalGenerations}
                            isLoading={isStatsSummaryLoading}
                            loadingText={analysisTargetLabel}
                        />
                        <StatCard
                            label="Avg. Steps"
                            value={avgSteps}
                            isLoading={isStatsSummaryLoading}
                            loadingText="Computing generation summary"
                        />
                        <StatCard
                            label="Disk Usage (Est.)"
                            value={`${estSizeMB} MB`}
                            isLoading={isStatsSummaryLoading}
                            loadingText="Estimating library footprint"
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Bar Chart */}
                        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-xl p-6 h-80 shadow-sm flex flex-col">
                            <h3 className="text-sm font-bold text-gray-400 mb-6 uppercase tracking-wider flex-shrink-0">Generations per Model (Click to Filter)</h3>
                            <div className="flex-1 min-h-0 w-full overflow-y-auto custom-scrollbar pr-1 space-y-3">
                                {isStatsSummaryLoading ? (
                                    <div className="h-full flex flex-col justify-center gap-4">
                                        <div className="space-y-3">
                                            {SKELETON_BAR_WIDTHS.map((width) => (
                                                <div key={width} className="space-y-2">
                                                    <div className="h-3 w-32 rounded-full bg-gray-200/70 dark:bg-white/10 animate-pulse" />
                                                    <div className="h-2.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
                                                        <div
                                                            className="h-full rounded-full bg-sage-300/70 dark:bg-sage-500/30 animate-pulse"
                                                            style={{ width }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="text-[11px] uppercase tracking-[0.24em] font-semibold text-gray-400 text-center">
                                            {analysisTargetLabel}
                                        </div>
                                    </div>
                                ) : modelChartStats.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-xs uppercase tracking-wider text-gray-400">
                                        No model stats found
                                    </div>
                                ) : modelChartStats.map((stat, index) => {
                                    const widthPercent = Math.max(6, Math.round((stat.count / maxModelCount) * 100));
                                    const colorClass = [
                                        'bg-indigo-500',
                                        'bg-violet-500',
                                        'bg-rose-500',
                                        'bg-teal-500'
                                    ][index % 4];

                                    return (
                                        <button
                                            key={`${stat.fullName ?? stat.name}-${index}`}
                                            type="button"
                                            className="group w-full text-left rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-sage-500/60"
                                            title={stat.fullName ?? stat.name}
                                            onClick={() => {
                                                if (typeof stat.fullName === 'string') {
                                                    onFilter('model', stat.fullName);
                                                }
                                            }}
                                        >
                                            <div className="flex items-center justify-between gap-3 mb-1">
                                                <span className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate">
                                                    {stat.fullName ?? stat.name}
                                                </span>
                                                <span className="text-xs font-mono text-gray-500 dark:text-gray-400 shrink-0">
                                                    {stat.count.toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="h-2.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full ${colorClass} group-hover:opacity-90 transition-all`}
                                                    style={{ width: `${widthPercent}%` }}
                                                />
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Word Cloud */}
                        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-xl p-6 h-80 shadow-sm flex flex-col relative overflow-hidden group">
                            <h3 className="text-sm font-bold text-gray-400 mb-4 uppercase tracking-wider flex items-center justify-between">
                                <span>Top Prompt Keywords</span>
                                {isFiltering && <div className="w-4 h-4 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />}
                            </h3>
                            <div className="flex-1 min-h-0">
                                <WordCloud
                                    keywords={keywordStats || []}
                                    totalImages={totalGenerations}
                                    isLoading={shouldShowWordCloudLoading}
                                    onWordClick={(word) => {
                                        setFilters((prev) => ({
                                            ...prev,
                                            searchQuery: prev.searchQuery ? `${prev.searchQuery.trim()} ${word}` : word
                                        }));
                                    }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatCard = ({
    label,
    value,
    isLoading = false,
    loadingText
}: {
    label: string;
    value: number | string;
    isLoading?: boolean;
    loadingText?: string;
}) => (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 p-4 rounded-lg shadow-sm">
        <div className="text-gray-500 dark:text-gray-400 text-xs uppercase mb-1">{label}</div>
        {isLoading ? (
            <div className="space-y-3">
                <div className="h-9 w-28 rounded-lg bg-gray-200/80 dark:bg-white/10 animate-pulse" />
                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-400">{loadingText}</div>
            </div>
        ) : (
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
        )}
    </div>
);
