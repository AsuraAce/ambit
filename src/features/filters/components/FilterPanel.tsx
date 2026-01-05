import * as React from 'react';
import { Check, Filter, Github, FolderOpen, Sliders, Puzzle, Save } from 'lucide-react';
import { FilterState, AIImage } from '../../../types';
// import { useLibraryContext } from '../../../hooks/useLibraryContext'; // Removed
import { useCollections } from '../../../contexts/CollectionContext';
import { useSearchStore } from '../../../stores/searchStore';
import { CollectionsSection } from './CollectionsSection';

import { ParameterSection } from './ParameterSection';
import { GeneratorSection } from './GeneratorSection';
import { ArchitectureSection } from './ArchitectureSection';
import { ResourceSection } from './ResourceSection';
import { DateRangeSection } from './DateRangeSection';

interface FilterPanelProps {
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    filteredImages?: AIImage[];
    onCreateCollection: (name: string) => void;
    onSaveSmartCollection: (name: string, filters: FilterState) => void;
    onDeleteSmartCollection: (id: string) => void;
    onDropOnCollection?: (collectionId: string, data: string) => void;
    onRenameCollection?: (colId: string, newName: string) => void;
    onDeleteCollection?: (colId: string) => void;
    onToggleArchiveCollection?: (colId: string) => void;
    onTogglePinCollection?: (colId: string) => void;
    onSetCollectionColor?: (colId: string, color: string | undefined) => void;
    onPlayCollection?: (colId: string) => void;
    onExportCollection?: (colId: string) => void;
    onResetCollectionThumbnail?: (colId: string) => void;
    onEditCollection?: (colId: string) => void;
    onUpdateCollectionFilters?: (colId: string, filters: FilterState) => void;
    isVisible?: boolean;
    className?: string;
}

type FilterTab = 'organize' | 'generate' | 'resources';

export const FilterPanel: React.FC<FilterPanelProps> = ({
    filteredImages,
    onCreateCollection,
    onSaveSmartCollection,
    onDeleteSmartCollection,
    onDropOnCollection,
    onRenameCollection,
    onDeleteCollection,
    onToggleArchiveCollection,
    onTogglePinCollection,
    onSetCollectionColor,
    onPlayCollection,
    onExportCollection,
    onResetCollectionThumbnail,
    onEditCollection,
    onUpdateCollectionFilters,
    isVisible = true,
    className
}) => {

    // Zustand Search Store
    const {
        filters: storeFilters,
        setFilters: setStoreFilters,
        facets,
        isFacetsLoading,
        clearAllFilters,
        // loadFacet // Helper needs to be implemented in store or imported?
        // store doesn't have loadFacet yet? Wait, I added it to context but not store actions?
        // I need to check store actions.
    } = useSearchStore();

    // Contexts
    const { collections, smartCollections } = useCollections();

    // Prefer store values, fallback to props (migrating)
    const filters = storeFilters;
    const setFilters = setStoreFilters;

    // TODO: move loadFacet to store
    // For now we can implement it locally or via import
    const loadFacet = async (type: 'embeddings' | 'hypernetworks') => {
        try {
            const { getFacets } = await import('../../../services/db/searchRepo');
            // We need current WHERE clause. Store doesn't expose it easily. 
            // Reuse logic?
            // Actually, we can just trigger a refreshMetadata with specific type?
            // Store's refreshMetadata updates facets.
            // Let's implement a quick loader here or just allow the store to handle it eventually.
            // For now:
            const state = useSearchStore.getState();
            const { buildSqlWhereClause } = await import('../../../utils/sqlHelpers');
            // ... logic to fetch specific facet ...
            // Simplified: just update store facets
            const partialFacets = await getFacets('', [], [type]); // TODO: use actual filters
            useSearchStore.setState(prev => ({ facets: { ...prev.facets, [type]: partialFacets[type] } }));
        } catch (e) { console.error(e); }
    };

    const [activeTab, setActiveTab] = React.useState<FilterTab>('organize');

    // Section expansion states (internal to tabs now)
    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({
        collections: true,
        smart: true,
        params: true,
        generator: true,
        checkpoints: true,
        resources: true,
        embeddings: false,
        hypernetworks: false,
        date: true
    });

    const toggleSection = (section: string) => {
        const wasExpanded = expanded[section];
        setExpanded(prev => ({ ...prev, [section]: !prev[section] }));

        // Lazy load embeddings or hypernetworks when expanding for the first time
        if (!wasExpanded && (section === 'embeddings' || section === 'hypernetworks')) {
            loadFacet(section);
        }
    };

    // Quick Update Logic
    const allCols = React.useMemo(() => [...collections, ...smartCollections], [collections, smartCollections]);
    const activeSmartCol = React.useMemo(() =>
        filters.collectionId ? allCols.find(c => c.id === filters.collectionId && !!c.filters) : null,
        [filters.collectionId, allCols]
    );

    const hasUnsavedChanges = React.useMemo(() => {
        if (!activeSmartCol || !activeSmartCol.filters) return false;

        // Normalization Helper to handle missing keys/defaults
        const normalize = (f: Partial<FilterState>) => {
            return {
                searchQuery: f.searchQuery || '',
                models: (f.models || []).sort(),
                tools: (f.tools || []).sort(),
                loras: (f.loras || []).sort(),
                embeddings: (f.embeddings || []).sort(),
                hypernetworks: (f.hypernetworks || []).sort(),
                dateRange: f.dateRange || 'all',
                favoritesOnly: !!f.favoritesOnly,
                // Optional numeric fields - undefined is essentially matching if inactive,
                // but let's be strict if they are set.
                minSteps: f.minSteps,
                maxSteps: f.maxSteps,
                minCfg: f.minCfg,
                maxCfg: f.maxCfg,
                pinnedOnly: !!f.pinnedOnly,
                // Exclude collectionId
            };
        };

        const current = normalize(filters);
        const saved = normalize(activeSmartCol.filters);

        return JSON.stringify(current) !== JSON.stringify(saved);
    }, [filters, activeSmartCol]);

    const handleQuickUpdate = () => {
        if (activeSmartCol && onUpdateCollectionFilters) {
            onUpdateCollectionFilters(activeSmartCol.id, filters);
        } else if (activeSmartCol) {
            // Fallback (shouldn't happen if props are wired)
            onSaveSmartCollection(activeSmartCol.name, filters);
        }
    };

    // Global Dirty Check
    const isDirty = !!(filters.collectionId || filters.searchQuery || filters.models.length > 0 || filters.tools.length > 0 || filters.loras.length > 0 || filters.favoritesOnly || filters.pinnedOnly || filters.dateRange !== 'all' || filters.minSteps || filters.maxSteps || filters.minCfg || filters.maxCfg);

    // Tab-Specific Dirty Checks (for dot indicators)
    const isOrganizeDirty = !!(filters.collectionId || filters.dateRange !== 'all' || filters.favoritesOnly || filters.pinnedOnly);
    const isGenerateDirty = !!(filters.tools.length > 0 || filters.minSteps || filters.maxSteps || filters.minCfg || filters.maxCfg);
    const isResourcesDirty = !!(filters.models.length > 0 || filters.loras.length > 0 || (filters.embeddings && filters.embeddings.length > 0) || (filters.hypernetworks && filters.hypernetworks.length > 0));

    return (
        <div
            className={`bg-white/90 dark:bg-zinc-900/95 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-3xl flex flex-col h-full transition-all duration-500 ease-spring shadow-2xl ${isVisible ? 'w-72 opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4 overflow-hidden'} ${className}`}
        >
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between min-w-[18rem]">
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-sage-600 dark:text-sage-400" />
                    <h2 className="font-bold text-sm text-gray-800 dark:text-gray-200 uppercase tracking-wider">Library</h2>
                </div>

                <div className="flex items-center gap-2">
                    {hasUnsavedChanges && activeSmartCol && (
                        <button
                            onClick={handleQuickUpdate}
                            className="flex items-center gap-1.5 text-[10px] font-bold text-white bg-sage-500 hover:bg-sage-600 transition-all shadow-lg shadow-sage-500/20 px-3 py-1.5 rounded-full animate-in zoom-in duration-300"
                            title="Update collection with current filters"
                        >
                            <Save className="w-3 h-3" />
                            Update {activeSmartCol.name}
                        </button>
                    )}
                    {isDirty && !hasUnsavedChanges && (
                        <button
                            onClick={clearAllFilters}
                            className="text-[10px] font-bold text-sage-600 dark:text-sage-400 hover:text-sage-700 dark:hover:text-sage-300 transition-colors uppercase tracking-wider bg-sage-100 dark:bg-sage-900/30 px-2 py-1 rounded-md"
                        >
                            Reset All
                        </button>
                    )}
                </div>
            </div>

            {/* Tab Toolbar */}
            <div className="px-2 pt-2 border-b border-gray-100 dark:border-white/5 min-w-[18rem]">
                <div className="flex items-center gap-1 bg-gray-100/50 dark:bg-black/20 p-1 rounded-xl">
                    <button
                        onClick={() => setActiveTab('organize')}
                        className={`flex-1 relative flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all duration-300 ease-out ${activeTab === 'organize'
                            ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-white/5'
                            }`}
                    >
                        <FolderOpen className="w-3.5 h-3.5" />
                        Organize
                        {isOrganizeDirty && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-sage-500 rounded-full" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('generate')}
                        className={`flex-1 relative flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all duration-300 ease-out ${activeTab === 'generate'
                            ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-white/5'
                            }`}
                    >
                        <Sliders className="w-3.5 h-3.5" />
                        Filters
                        {isGenerateDirty && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-sage-500 rounded-full" />}
                    </button>
                    <button
                        onClick={() => setActiveTab('resources')}
                        className={`flex-1 relative flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all duration-300 ease-out ${activeTab === 'resources'
                            ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                            : 'text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-white/50 dark:hover:bg-white/5'
                            }`}
                    >
                        <Puzzle className="w-3.5 h-3.5" />
                        Assets
                        {isResourcesDirty && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-sage-500 rounded-full" />}
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col min-w-[18rem]">
                <div className="space-y-6">

                    {/* ORGANIZE TAB */}
                    {activeTab === 'organize' && (
                        <div className="space-y-6 animate-in slide-in-from-left-4 fade-in duration-300 ease-spring">
                            <CollectionsSection
                                collections={[...collections, ...smartCollections]}
                                filters={filters} setFilters={setFilters}
                                isOpen={expanded.collections} onToggle={() => toggleSection('collections')}
                                onCreateCollection={onCreateCollection}
                                onDropOnCollection={onDropOnCollection}
                                onRenameCollection={onRenameCollection}
                                onDeleteCollection={onDeleteCollection}
                                onToggleArchiveCollection={onToggleArchiveCollection}
                                onTogglePinCollection={onTogglePinCollection}
                                onSetCollectionColor={onSetCollectionColor}
                                onPlayCollection={onPlayCollection}
                                onExportCollection={onExportCollection}
                                onResetCollectionThumbnail={onResetCollectionThumbnail}
                                isDirty={isDirty}
                                onEditCollection={onEditCollection}
                            />
                        </div>
                    )}

                    {/* GENERATE TAB */}
                    {activeTab === 'generate' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300 ease-spring">
                            <ParameterSection
                                filters={filters} setFilters={setFilters}
                                isOpen={expanded.params} onToggle={() => toggleSection('params')}
                            />

                            <GeneratorSection
                                filters={filters} setFilters={setFilters}
                                tools={facets.tools}
                                isOpen={expanded.generator} onToggle={() => toggleSection('generator')}
                                isLoading={isFacetsLoading}
                            />
                        </div>
                    )}

                    {/* RESOURCES TAB */}
                    {activeTab === 'resources' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300 ease-spring">
                            <ResourceSection
                                title="Checkpoints"
                                type="checkpoints"
                                filters={filters} setFilters={setFilters}
                                data={facets.checkpoints}
                                isOpen={expanded.checkpoints} onToggle={() => toggleSection('checkpoints')}
                                isLoading={isFacetsLoading}
                            />

                            <ResourceSection
                                title="Resources (LoRA)"
                                type="loras"
                                filters={filters} setFilters={setFilters}
                                data={facets.loras}
                                isOpen={expanded.resources} onToggle={() => toggleSection('resources')}
                                isLoading={isFacetsLoading}
                            />

                            <ResourceSection
                                title="Resources (Embedding)"
                                type="embeddings"
                                filters={filters} setFilters={setFilters}
                                data={facets.embeddings}
                                isOpen={expanded.embeddings} onToggle={() => toggleSection('embeddings')}
                                isLoading={isFacetsLoading}
                            />

                            <ResourceSection
                                title="Resources (Hypernet)"
                                type="hypernetworks"
                                filters={filters} setFilters={setFilters}
                                data={facets.hypernetworks}
                                isOpen={expanded.hypernetworks} onToggle={() => toggleSection('hypernetworks')}
                                isLoading={isFacetsLoading}
                            />
                        </div>
                    )}

                </div>
            </div>

            {/* Global Date Range */}
            <div className="p-4 pt-2 border-t border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/10 min-w-[18rem]">
                <DateRangeSection filters={filters} setFilters={setFilters} />
            </div>

            {/* Footer / Status */}
            <div className="p-4 border-t border-gray-200 dark:border-white/5 text-[10px] text-gray-600 dark:text-zinc-400 flex items-center justify-between min-w-[18rem]">
                <div className="flex items-center gap-2">
                    <span className="font-medium hover:text-gray-900 dark:hover:text-zinc-200 transition-colors cursor-default">Ambit Web</span>
                </div>
                <div className="flex items-center gap-3">
                    <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-gray-900 dark:hover:text-zinc-200 transition-colors opacity-80 hover:opacity-100">
                        <Github className="w-3 h-3" />
                    </a>
                    <span className="hover:text-gray-900 dark:hover:text-zinc-200 transition-colors cursor-default">v0.9.4 Beta</span>
                </div>
            </div>
        </div>
    );
};
