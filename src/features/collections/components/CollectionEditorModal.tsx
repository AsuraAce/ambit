import * as React from 'react';
import { useState, useEffect } from 'react';
import { Collection, FilterState } from '../../../types';
import { X, Save, Trash2, Filter, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getDateFilterLabel } from '../../../utils/dateFilters';

interface CollectionEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    collection: Collection | null;
    filters: FilterState; // Current active filters in global state
    onSave: (id: string, newFilters: FilterState | undefined) => void;
}

export const CollectionEditorModal: React.FC<CollectionEditorModalProps> = ({
    isOpen,
    onClose,
    collection,
    filters,
    onSave
}) => {
    // Local state for editing the saved filters
    const [draftFilters, setDraftFilters] = useState<FilterState | null>(null);

    // Initialize draft filters when collection opens
    useEffect(() => {
        if (collection?.filters) {
            setDraftFilters(collection.filters);
        } else {
            setDraftFilters(null);
        }
    }, [collection]); // Simplified dependency

    if (!collection) return null;

    const hasFilters = !!draftFilters;

    const handleSaveDraft = () => {
        // If all filters are removed/empty, we might want to ask if they want to make it static?
        // For now, just save whatever is in draft.
        onSave(collection.id, draftFilters || undefined);
        onClose();
    };

    const handleUpdateFromGlobal = () => {
        onSave(collection.id, filters);
        onClose();
    };

    const handleClearAll = () => {
        onSave(collection.id, undefined);
        onClose();
    };

    const removeFilter = (key: keyof FilterState, value: unknown) => {
        if (!draftFilters) return;

        setDraftFilters(prev => {
            if (!prev) return null;
            const next = { ...prev };

            if (Array.isArray(next[key])) {
                (next[key] as unknown[]) = (next[key] as unknown[]).filter(item => item !== value);
            } else if (key === 'dateRange') {
                next.dateRange = 'all';
                next.dateFrom = undefined;
                next.dateTo = undefined;
            } else if (key === 'favoritesOnly') {
                next.favoritesOnly = false;
            } else if (key === 'searchQuery') {
                next.searchQuery = '';
            } else if (key === 'minSteps' || key === 'maxSteps') {
                next.minSteps = undefined;
                next.maxSteps = undefined;
            } else if (key === 'minCfg' || key === 'maxCfg') {
                next.minCfg = undefined;
                next.maxCfg = undefined;
            }

            return next;
        });
    };

    const renderChips = () => {
        if (!draftFilters) return null;

        const chips: React.ReactNode[] = [];

        // Search Query
        if (draftFilters.searchQuery) {
            chips.push(
                <div key="query" className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 text-xs border border-gray-200 dark:border-white/10">
                    <span className="font-semibold text-gray-500">Query:</span>
                    <span className="truncate max-w-[150px]">"{draftFilters.searchQuery}"</span>
                    <button onClick={() => removeFilter('searchQuery', null)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        const dateFilterLabel = getDateFilterLabel(draftFilters);
        if (dateFilterLabel) {
            chips.push(
                <div key="date" className="flex items-center gap-1 px-2 py-1 rounded-md bg-sage-100 dark:bg-sage-500/20 text-sage-700 dark:text-sage-200 text-xs border border-sage-200">
                    <span>{dateFilterLabel}</span>
                    <button onClick={() => removeFilter('dateRange', null)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        // Favorites
        if (draftFilters.favoritesOnly) {
            chips.push(
                <div key="fav" className="flex items-center gap-1 px-2 py-1 rounded-md bg-red-100 text-red-700 text-xs border border-red-200">
                    <div className="w-3 h-3 text-red-500">❤️</div>
                    <span>Favorites</span>
                    <button onClick={() => removeFilter('favoritesOnly', null)} className="hover:text-red-700"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        // Numeric Ranges
        if (draftFilters.minSteps !== undefined || draftFilters.maxSteps !== undefined) {
            chips.push(
                <div key="steps" className="flex items-center gap-1 px-2 py-1 rounded-md bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-200 text-xs border border-orange-200 dark:border-orange-500/30">
                    <span>Steps: {draftFilters.minSteps ?? 0}-{draftFilters.maxSteps ?? '∞'}</span>
                    <button onClick={() => removeFilter('minSteps', null)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        if (draftFilters.minCfg !== undefined || draftFilters.maxCfg !== undefined) {
            chips.push(
                <div key="cfg" className="flex items-center gap-1 px-2 py-1 rounded-md bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-200 text-xs border border-yellow-200 dark:border-yellow-500/30">
                    <span>CFG: {draftFilters.minCfg ?? 0}-{draftFilters.maxCfg ?? '∞'}</span>
                    <button onClick={() => removeFilter('minCfg', null)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        // Arrays (Models, Tools, etc)
        const categories = [
            { key: 'models', label: 'Model', color: 'blue' },
            { key: 'tools', label: 'Tool', color: 'amber' },
            { key: 'loras', label: 'LoRA', color: 'purple' },
            { key: 'embeddings', label: 'Embedding', color: 'emerald' },
            { key: 'hypernetworks', label: 'Hypernet', color: 'rose' },
            { key: 'samplers', label: 'Sampler', color: 'indigo' },
            { key: 'generationTypes', label: 'GenType', color: 'cyan' },
        ];

        categories.forEach(({ key, color }) => {
            const values = draftFilters[key as keyof FilterState] as string[];
            if (Array.isArray(values)) {
                values.forEach(val => {
                    // Explicit Tailwind Classes for JIT detection
                    let className = "flex items-center gap-1 px-2 py-1 rounded-md text-xs border ";

                    switch (color) {
                        case 'blue':
                            className += "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-200 border-blue-200 dark:border-blue-500/30";
                            break;
                        case 'amber':
                            className += "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-200 border-amber-200 dark:border-amber-500/30";
                            break;
                        case 'purple':
                            className += "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-200 border-purple-200 dark:border-purple-500/30";
                            break;
                        case 'emerald':
                            className += "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-200 border-emerald-200 dark:border-emerald-500/30";
                            break;
                        case 'rose':
                            className += "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-200 border-rose-200 dark:border-rose-500/30";
                            break;
                        case 'indigo':
                            className += "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-200 border-indigo-200 dark:border-indigo-500/30";
                            break;
                        case 'cyan':
                            className += "bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-200 border-cyan-200 dark:border-cyan-500/30";
                            break;
                        default:
                            className += "bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-white/10";
                    }

                    chips.push(
                        <div key={`${key}-${val}`} className={className}>
                            <span className="truncate max-w-[120px]">{val}</span>
                            <button onClick={() => removeFilter(key as keyof FilterState, val)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                        </div>
                    );
                });
            }
        });

        if (chips.length === 0) {
            return (
                <div className="text-xs text-gray-400 italic py-2">
                    No active rules. This collection behaves like a static folder.
                </div>
            );
        }

        return <div className="flex flex-wrap gap-2 mt-2">{chips}</div>;
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: "spring", stiffness: 350, damping: 25 }}
                        className="w-full max-w-lg bg-white dark:bg-zinc-900 border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl p-6 relative overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                                Edit Collection: {collection.name}
                            </h3>
                            <button
                                onClick={onClose}
                                className="p-2 -mr-2 text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div className="space-y-4">
                                {/* Current Rules Editor */}
                                <div className="p-4 bg-gray-50 dark:bg-zinc-800 rounded-xl border border-gray-200 dark:border-white/5">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                            <Filter className="w-4 h-4 text-sage-500" />
                                            Collection Rules
                                        </div>
                                        {hasFilters ? (
                                            <div className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800">
                                                Dynamic
                                            </div>
                                        ) : (
                                            <div className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/5">
                                                Static
                                            </div>
                                        )}
                                    </div>

                                    {renderChips()}

                                    {/* Save Changes Button (Only if we have a draft that differs? For simplicity always show if hasFilters or creating one) */}
                                    <div className="mt-4 pt-3 border-t border-gray-200 dark:border-white/5 flex justify-end">
                                        <button
                                            onClick={handleSaveDraft}
                                            className="px-3 py-1.5 bg-white dark:bg-zinc-700 border border-gray-200 dark:border-white/10 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-zinc-600 transition-colors shadow-sm"
                                        >
                                            Save Changes
                                        </button>
                                    </div>
                                </div>

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                        <div className="w-full border-t border-gray-200 dark:border-white/10"></div>
                                    </div>
                                    <div className="relative flex justify-center">
                                        <span className="px-2 bg-white dark:bg-zinc-900 text-xs text-gray-500">Quick Actions</span>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="grid grid-cols-1 gap-3">
                                    <button
                                        onClick={handleUpdateFromGlobal}
                                        className="flex items-center justify-center gap-2 p-3 rounded-xl border border-sage-200 dark:border-sage-500/30 bg-sage-50 dark:bg-sage-900/20 text-sage-700 dark:text-sage-300 hover:bg-sage-100 dark:hover:bg-sage-900/40 transition-colors text-sm font-medium group"
                                    >
                                        <Save className="w-4 h-4" />
                                        <div className="flex flex-col items-start text-xs">
                                            <span className="font-bold text-sm">Update with Current View</span>
                                            <span className="text-sage-600/70 dark:text-sage-400/70 group-hover:text-sage-700 dark:group-hover:text-sage-300">Overwrites rules with your active filters</span>
                                        </div>
                                    </button>

                                    {hasFilters && (
                                        <button
                                            onClick={handleClearAll}
                                            className="flex items-center justify-center gap-2 p-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors text-sm font-medium"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                            Remove All Rules (Make Static)
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
