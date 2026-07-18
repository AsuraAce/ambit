import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, Copy, Tag, Search, Layers, Filter, Globe, Play } from 'lucide-react';
import { MaintenanceTab } from '../../../hooks/useMaintenanceData';

interface ScanPlaceholderProps {
    tab: MaintenanceTab;
    onStartScan: (tab: MaintenanceTab, scope: 'global' | 'filtered') => void;
}

export const ScanPlaceholder: React.FC<ScanPlaceholderProps> = ({
    tab,
    onStartScan
}) => {
    const [scanScope, setScanScope] = useState<'global' | 'filtered'>('global');

    const metadata: Record<string, { title: string, description: string, icon: React.ReactNode, hasScope: boolean }> = {
        thumbnails: {
            title: "Thumbnail Optimization",
            description: "Check for images that need high-quality thumbnail regeneration to improve browsing speed.",
            icon: <Zap className="w-12 h-12" />,
            hasScope: true
        },
        duplicates: {
            title: "Duplicate Finder",
            description: "Hash candidate files across your library and find exact SHA-256 content matches.",
            icon: <Copy className="w-12 h-12" />,
            hasScope: false
        },
        untagged: {
            title: "Untagged Images",
            description: "Identify images that are missing prompts or relevant metadata for better organization.",
            icon: <Tag className="w-12 h-12" />,
            hasScope: true
        },
        missing: {
            title: "Missing Files",
            description: "Verify that all database records point to actual files on your disk. This will scan your entire collection.",
            icon: <Search className="w-12 h-12" />,
            hasScope: false
        },
        intermediates: {
            title: "Intermediate Images",
            description: "Identify sub-steps, noise previews, or orphan images that lack InvokeAI metadata.",
            icon: <Layers className="w-12 h-12" />,
            hasScope: true
        }
    };

    const config = metadata[tab];
    if (!config) return null;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-20 px-6 text-center max-w-2xl mx-auto"
        >
            <div className="p-8 bg-sage-500/5 dark:bg-sage-400/5 rounded-full mb-8 border border-sage-500/10 shadow-inner">
                <div className="text-sage-600 dark:text-sage-400">
                    {config.icon}
                </div>
            </div>

            <h2 className="text-3xl font-black text-gray-900 dark:text-white mb-4 tracking-tight">{config.title}</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-10 leading-relaxed text-sm">
                {config.description}
            </p>

            <div className="flex flex-col items-center gap-6 w-full max-w-xs">
                {config.hasScope && (
                    <div className="flex items-center gap-1 p-1.5 bg-gray-100 dark:bg-zinc-800 rounded-2xl w-full border border-gray-200 dark:border-white/5 shadow-sm">
                        <button
                            onClick={() => setScanScope('filtered')}
                            className={`flex-1 px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${scanScope === 'filtered' ? 'bg-white dark:bg-zinc-700 text-sage-600 shadow-md' : 'text-gray-400'}`}
                        >
                            <Filter className="w-3.5 h-3.5" /> Current Filter
                        </button>
                        <button
                            onClick={() => setScanScope('global')}
                            className={`flex-1 px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 ${scanScope === 'global' ? 'bg-white dark:bg-zinc-700 text-sage-600 shadow-md' : 'text-gray-400'}`}
                        >
                            <Globe className="w-3.5 h-3.5" /> Global
                        </button>
                    </div>
                )}

                <button
                    onClick={() => onStartScan(tab, scanScope)}
                    className="w-full py-4 bg-sage-600 hover:bg-sage-500 text-white rounded-2xl text-sm font-black shadow-xl shadow-sage-500/30 transition-all active:scale-95 flex items-center justify-center gap-3 group"
                >
                    <Play className="w-5 h-5 fill-current group-hover:scale-110 transition-transform" />
                    Start Maintenance Scan
                </button>

                <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">
                    Intentionally triggered scan
                </p>
            </div>
        </motion.div>
    );
};
