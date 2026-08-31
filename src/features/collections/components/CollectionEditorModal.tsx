import * as React from 'react';
import { useState, useEffect } from 'react';
import { Collection, FilterState } from '../../../types';
import { X, Save, Trash2, Filter, Users, RotateCcw, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getDateFilterLabel } from '../../../utils/dateFilters';
import { useInvokeOwnerScopeStore } from '../../../stores/invokeOwnerScopeStore';
import type { AmbitCollectionScopeTarget } from '../../../services/db/collectionRepo';

interface CollectionEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    collection: Collection | null;
    filters: FilterState; // Current active filters in global state
    onSave: (id: string, newFilters: FilterState | undefined) => void;
    onUpdateScope?: (id: string, target: AmbitCollectionScopeTarget) => Promise<boolean>;
    onResetInvokeCollection?: (id: string) => Promise<boolean>;
}

export const CollectionEditorModal: React.FC<CollectionEditorModalProps> = ({
    isOpen,
    onClose,
    collection,
    filters,
    onSave,
    onUpdateScope = async () => false,
    onResetInvokeCollection = async () => false
}) => {
    // Local state for editing the saved filters
    const [draftFilters, setDraftFilters] = useState<FilterState | null>(null);
    const [scopeSelection, setScopeSelection] = useState('global');
    const [isSavingScope, setIsSavingScope] = useState(false);
    const [isResettingInvoke, setIsResettingInvoke] = useState(false);
    const discovery = useInvokeOwnerScopeStore(state => state.ownerScopeState.discovery);

    // Initialize draft filters when collection opens
    useEffect(() => {
        if (collection?.filters) {
            setDraftFilters(collection.filters);
        } else {
            setDraftFilters(null);
        }
        setScopeSelection(collection?.invokeOwnerId
            ? `owner:${collection.invokeOwnerId}`
            : collection?.invokeSourceId
                ? 'all'
                : 'global');
    }, [collection]); // Simplified dependency

    if (!collection) return null;

    const hasFilters = !!draftFilters;
    const canEditScope = collection.source !== 'invoke'
        && discovery?.schemaMode === 'multi_user';
    const scopeChanged = scopeSelection !== (collection.invokeOwnerId
        ? `owner:${collection.invokeOwnerId}`
        : collection.invokeSourceId
            ? 'all'
            : 'global');

    const handleSaveScope = async () => {
        if (!discovery || scopeSelection === 'global') return;
        setIsSavingScope(true);
        const ownerId = scopeSelection.startsWith('owner:')
            ? scopeSelection.slice('owner:'.length)
            : undefined;
        const succeeded = await onUpdateScope(collection.id, {
            mode: ownerId ? 'owner' : 'all',
            dbPath: discovery.dbPath,
            ownerId,
        });
        setIsSavingScope(false);
        if (succeeded) onClose();
    };

    const handleResetInvoke = async () => {
        setIsResettingInvoke(true);
        try {
            if (await onResetInvokeCollection(collection.id)) onClose();
        } finally {
            setIsResettingInvoke(false);
        }
    };

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
        setDraftFilters(prev => {
            // Defend against an event queued while switching collections.
            /* istanbul ignore next */
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
            } else if (key === 'mediaType') {
                next.mediaType = 'all';
            } else if (key === 'minSteps') {
                next.minSteps = undefined;
                next.maxSteps = undefined;
            } else {
                next.minCfg = undefined;
                next.maxCfg = undefined;
            }

            return next;
        });
    };

    const renderChips = () => {
        if (!draftFilters) return null;

        const chips: React.ReactNode[] = [];

        if (draftFilters.mediaType && draftFilters.mediaType !== 'all') {
            chips.push(
                <div key="media-type" className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                    <span>Media: {draftFilters.mediaType === 'video' ? 'Videos' : 'Images'}</span>
                    <button type="button" aria-label="Remove Media Type Rule" onClick={() => removeFilter('mediaType', null)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        // Search Query
        if (draftFilters.searchQuery) {
            chips.push(
                <div key="query" className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-300 text-xs border border-gray-200 dark:border-white/10">
                    <span className="font-semibold text-gray-500">Query:</span>
                    <span className="truncate max-w-[150px]">"{draftFilters.searchQuery}"</span>
                    <button type="button" aria-label="Remove Search Query Rule" onClick={() => removeFilter('searchQuery', null)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        const dateFilterLabel = getDateFilterLabel(draftFilters);
        if (dateFilterLabel) {
            chips.push(
                <div key="date" className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                    <span>{dateFilterLabel}</span>
                    <button type="button" aria-label="Remove Date Rule" onClick={() => removeFilter('dateRange', null)} className="hover:text-red-500"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        // Favorites
        if (draftFilters.favoritesOnly) {
            chips.push(
                <div key="fav" className="flex items-center gap-1 rounded-md border border-red-200 bg-red-100 px-2 py-1 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300">
                    <div className="w-3 h-3 text-red-500 dark:text-red-300">❤️</div>
                    <span>Favorites</span>
                    <button type="button" aria-label="Remove Favorites Rule" onClick={() => removeFilter('favoritesOnly', null)} className="hover:text-red-600"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        // Numeric Ranges
        if (draftFilters.minSteps !== undefined || draftFilters.maxSteps !== undefined) {
            chips.push(
                <div key="steps" className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                    <span>Steps: {draftFilters.minSteps ?? 0}-{draftFilters.maxSteps ?? '∞'}</span>
                    <button type="button" aria-label="Remove Steps Rule" onClick={() => removeFilter('minSteps', null)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        if (draftFilters.minCfg !== undefined || draftFilters.maxCfg !== undefined) {
            chips.push(
                <div key="cfg" className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
                    <span>CFG: {draftFilters.minCfg ?? 0}-{draftFilters.maxCfg ?? '∞'}</span>
                    <button type="button" aria-label="Remove CFG Rule" onClick={() => removeFilter('minCfg', null)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                </div>
            );
        }

        // Arrays (Models, Tools, etc)
        const categories = [
            { key: 'models', label: 'Model' },
            { key: 'tools', label: 'Tool' },
            { key: 'loras', label: 'LoRA' },
            { key: 'embeddings', label: 'Embedding' },
            { key: 'hypernetworks', label: 'Hypernet' },
            { key: 'samplers', label: 'Sampler' },
            { key: 'generationTypes', label: 'GenType' },
        ];

        categories.forEach(({ key }) => {
            const values = draftFilters[key as keyof FilterState] as string[];
            if (Array.isArray(values)) {
                values.forEach(val => {
                    const className = "flex items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2 py-1 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300";

                    chips.push(
                        <div key={`${key}-${val}`} className={className}>
                            <span className="truncate max-w-[120px]">{val}</span>
                            <button type="button" aria-label={`Remove ${val} Rule`} onClick={() => removeFilter(key as keyof FilterState, val)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
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
                                type="button"
                                aria-label="Close Collection Editor"
                                onClick={onClose}
                                className="p-2 -mr-2 text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div className="p-4 bg-gray-50 dark:bg-zinc-800 rounded-xl border border-gray-200 dark:border-white/5">
                                <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2 mb-2">
                                    <Users className="w-4 h-4 text-sage-500" />
                                    Visibility
                                </div>
                                {collection.source === 'invoke' ? (
                                    <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
                                        <p>
                                            Managed by InvokeAI · {discovery?.owners.find(owner => owner.ownerId === collection.invokeOwnerId)?.displayName || collection.invokeOwnerId || 'System'}
                                        </p>
                                        {collection.invokeSourcePresent === false && (
                                            <p className="flex items-center gap-1.5 font-medium text-ember-600 dark:text-ember-300">
                                                <AlertTriangle className="h-3.5 w-3.5" /> Source unavailable
                                            </p>
                                        )}
                                        {collection.invokeSourceName && collection.name !== collection.invokeSourceName && (
                                            <p>
                                                Local name override · InvokeAI: <span className="font-medium text-gray-700 dark:text-gray-200">{collection.invokeSourceName}</span>
                                            </p>
                                        )}
                                    </div>
                                ) : canEditScope ? (
                                    <div className="space-y-3">
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            Choose which InvokeAI library view can show this collection.
                                        </p>
                                        <select
                                            aria-label="Collection visibility"
                                            value={scopeSelection}
                                            onChange={(event) => setScopeSelection(event.target.value)}
                                            className="w-full rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-gray-900 dark:text-white"
                                        >
                                            {scopeSelection === 'global' && (
                                                <option value="global" disabled>Shared (legacy)</option>
                                            )}
                                            <option value="all">All Users</option>
                                            {discovery.owners.map(owner => (
                                                <option key={owner.ownerId} value={`owner:${owner.ownerId}`}>
                                                    {owner.displayName || 'Unnamed owner'}
                                                </option>
                                            ))}
                                        </select>
                                        {scopeChanged && scopeSelection !== 'global' && (
                                            <button
                                                type="button"
                                                onClick={() => void handleSaveScope()}
                                                disabled={isSavingScope}
                                                className="w-full px-3 py-2 rounded-lg bg-sage-600 text-white text-sm font-medium hover:bg-sage-500 disabled:opacity-50"
                                            >
                                                {isSavingScope ? 'Updating…' : 'Update Visibility'}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {collection.invokeOwnerId
                                            ? collection.invokeOwnerId
                                            : collection.invokeSourceId
                                                ? 'All Users'
                                                : 'Shared across library views'}
                                    </p>
                                )}
                            </div>
                            <div className="space-y-4">
                                {/* Current Rules Editor */}
                                {collection.source !== 'invoke' && (
                                <div className="p-4 bg-gray-50 dark:bg-zinc-800 rounded-xl border border-gray-200 dark:border-white/5">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="font-medium text-gray-900 dark:text-white flex items-center gap-2">
                                            <Filter className="w-4 h-4 text-sage-500" />
                                            Collection Rules
                                        </div>
                                        {hasFilters ? (
                                            <div className="rounded-full border border-sage-200 bg-sage-100 px-2 py-0.5 text-[10px] text-sage-600 dark:border-sage-500/30 dark:bg-sage-500/15 dark:text-sage-300">
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
                                )}

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
                                    {collection.source === 'invoke' ? (
                                    <button
                                        type="button"
                                        onClick={() => void handleResetInvoke()}
                                        disabled={collection.invokeSourcePresent === false || isResettingInvoke}
                                        className="flex items-center justify-center gap-2 p-3 rounded-xl border border-sage-200 dark:border-sage-500/30 bg-sage-50 dark:bg-sage-900/20 text-sage-600 dark:text-sage-300 hover:bg-sage-100 dark:hover:bg-sage-900/40 transition-colors text-sm font-medium group disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <RotateCcw className={`w-4 h-4 ${isResettingInvoke ? 'animate-spin' : ''}`} />
                                        <div className="flex flex-col items-start text-xs">
                                            <span className="font-bold text-sm">Reset to InvokeAI</span>
                                            <span className="text-sage-600/70 dark:text-sage-300/70">Restore the source name and membership</span>
                                        </div>
                                    </button>
                                    ) : (
                                    <button
                                        onClick={handleUpdateFromGlobal}
                                        className="flex items-center justify-center gap-2 p-3 rounded-xl border border-sage-200 dark:border-sage-500/30 bg-sage-50 dark:bg-sage-900/20 text-sage-600 dark:text-sage-300 hover:bg-sage-100 dark:hover:bg-sage-900/40 transition-colors text-sm font-medium group"
                                    >
                                        <Save className="w-4 h-4" />
                                        <div className="flex flex-col items-start text-xs">
                                            <span className="font-bold text-sm">Update with Current View</span>
                                            <span className="text-sage-600/70 dark:text-sage-300/70 group-hover:text-sage-600 dark:group-hover:text-sage-300">Overwrites rules with your active filters</span>
                                        </div>
                                    </button>
                                    )}

                                    {collection.source !== 'invoke' && hasFilters && (
                                        <button
                                            onClick={handleClearAll}
                                            className="flex items-center justify-center gap-2 p-3 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors text-sm font-medium"
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
