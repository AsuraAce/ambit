
import * as React from 'react';
import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
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

export const StatsDashboard: React.FC<ChartsProps> = ({ images, onFilter }) => {
    // Use DB-backed global stats
    const { stats, setFilters, isFiltering } = useLibraryContext();
    const { totalGenerations, avgSteps, estSizeMB, modelStats, keywordStats } = stats;

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
                            <button onClick={() => setShowTip(false)} className="absolute top-2 right-2 p-1 text-sage-400 hover:text-sage-600 dark:hover:text-sage-200">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                        <StatCard label="Total Images" value={totalGenerations} />
                        <StatCard label="Avg. Steps" value={avgSteps} />
                        <StatCard label="Disk Usage (Est.)" value={`${estSizeMB} MB`} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Bar Chart */}
                        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-xl p-6 h-80 shadow-sm">
                            <h3 className="text-sm font-bold text-gray-400 mb-6 uppercase tracking-wider">Generations per Model (Click to Filter)</h3>
                            <ResponsiveContainer width="100%" height="85%">
                                <BarChart data={modelStats} style={{ outline: 'none' }}>
                                    <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#71717a', fontSize: 12 }} />
                                    <YAxis stroke="#52525b" tick={{ fill: '#71717a', fontSize: 12 }} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#18181b', borderColor: 'rgba(255,255,255,0.1)', color: '#fff', borderRadius: '0.5rem' }}
                                        cursor={{ fill: '#27272a', opacity: 0.2 }}
                                    />
                                    <Bar
                                        dataKey="count"
                                        radius={[6, 6, 0, 0]}
                                        onClick={(data: any) => {
                                            if (data && data.fullName) {
                                                onFilter('model', data.fullName);
                                            }
                                        }}
                                        cursor="pointer"
                                        activeBar={{
                                            fillOpacity: 0.9,
                                            stroke: '#ffffff',
                                            strokeWidth: 1.5,
                                            strokeOpacity: 0.5
                                        }}
                                    >
                                        {modelStats.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={['#6366f1', '#8b5cf6', '#ec4899', '#14b8a6'][index % 4]}
                                                style={{ outline: 'none' }}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Word Cloud */}
                        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 rounded-xl p-6 h-80 shadow-sm flex flex-col relative overflow-hidden group">
                            <h3 className="text-sm font-bold text-gray-400 mb-4 uppercase tracking-wider flex items-center justify-between">
                                <span>Top Prompt Keywords</span>
                                {isFiltering && <div className="w-4 h-4 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />}
                            </h3>
                            <div className="flex-1 min-h-0">
                                <WordCloud
                                    keywords={isFiltering ? [] : (keywordStats || [])}
                                    totalImages={totalGenerations}
                                    onWordClick={(word) => {
                                        setFilters((prev: any) => ({
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

const StatCard = ({ label, value }: { label: string, value: number | string }) => (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-white/10 p-4 rounded-lg shadow-sm">
        <div className="text-gray-500 dark:text-gray-400 text-xs uppercase mb-1">{label}</div>
        <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
    </div>
);
