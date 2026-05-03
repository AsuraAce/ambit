import * as React from 'react';
import { Check, Filter, Github, FolderOpen, Sliders, Puzzle, Save } from 'lucide-react';
import { AIImage, FilterState } from '../../../types';
import { useSearch } from '../../../contexts/SearchContext';
import { useCollections } from '../../../contexts/CollectionContext';
import { CollectionsSection } from './CollectionsSection';

import { ParameterSection } from './ParameterSection';
import { GeneratorSection } from './GeneratorSection';
import { ArchitectureSection } from './ArchitectureSection';
import { ResourceSection } from './ResourceSection';
import { DateRangeSection } from './DateRangeSection';
import { getDateFilterLabel } from '../../../utils/dateFilters';
import { GuidanceSection } from './GuidanceSection';
import { APP_NAME } from '../../../constants/app';
import { REPOSITORY_URL } from '../../../constants/support';
import { useAppVersion } from '../../../hooks/useAppVersion';
import { openExternalUrl } from '../../../utils/externalLinks';

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
    const appVersion = useAppVersion();

    const {
        filters: storeFilters,
        setFilters: setStoreFilters,
        facets,
        isFacetsLoading,
        clearAllFilters,
        validFacetNames
    } = useSearch();

    // Contexts
    const { collections, smartCollections } = useCollections();

    // Prefer store values, fallback to props (migrating)
    const filters = storeFilters;
    const setFilters = setStoreFilters;

    // loadFacet is now provided by context
    // const loadFacet = ... removed

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
        guidance: true,
        date: true
    });

    const toggleSection = (section: string) => {
        setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
        // All facet data is loaded upfront, no lazy loading needed
    };

    // Quick Update Logic
    const allCols = React.useMemo(() => [...collections, ...smartCollections], [collections, smartCollections]);
    const activeSmartCol = React.useMemo(() =>
        filters.collectionId ? allCols.find(c => c.id === filters.collectionId && !!c.filters) : null,
        [filters.collectionId, allCols]
    );
    const dateFilterLabel = getDateFilterLabel(filters);

    // Check for Manual Edits (ignoring the collection ID itself)
    const hasManualEdits = !!(
        filters.searchQuery ||
        filters.models.length > 0 ||
        filters.tools.length > 0 ||
        filters.loras.length > 0 ||
        filters.embeddings.length > 0 ||
        filters.hypernetworks.length > 0 ||
        filters.favoritesOnly ||
        filters.pinnedOnly ||
        !!dateFilterLabel ||
        filters.minSteps ||
        filters.maxSteps ||
        filters.minCfg ||
        filters.maxCfg ||
        filters.controlNets.length > 0 ||
        filters.ipAdapters.length > 0
    );

    // The Update Button should show if we are in a smart collection AND have added manual edits.
    const showUpdateButton = activeSmartCol && hasManualEdits;

    const handleQuickUpdate = () => {
        if (activeSmartCol && onUpdateCollectionFilters) {
            // MERGE Logic: 
            // We want to ADD manual filters to the existing smart rules.
            // For lists (models, etc.), we UNION them.
            // For scalars (searchQuery), we OVERWRITE if manual is set (user intent to change).

            const saved = activeSmartCol.filters || ({} as any);
            const manual = filters;
            const hasManualDateFilter = !!getDateFilterLabel(manual);

            const mergedFilters: FilterState = {
                ...saved, // Start with saved rules
                // Concatenate scalars if manual is set (Additive refinement)
                searchQuery: [(saved.searchQuery || ''), (manual.searchQuery || '')].filter(Boolean).join(' ').trim(),
                dateRange: hasManualDateFilter ? manual.dateRange : saved.dateRange,
                dateFrom: hasManualDateFilter ? manual.dateFrom : saved.dateFrom,
                dateTo: hasManualDateFilter ? manual.dateTo : saved.dateTo,
                favoritesOnly: manual.favoritesOnly || !!saved.favoritesOnly,
                pinnedOnly: manual.pinnedOnly || !!saved.pinnedOnly,
                minSteps: manual.minSteps || saved.minSteps,
                maxSteps: manual.maxSteps || saved.maxSteps,
                minCfg: manual.minCfg || saved.minCfg,
                maxCfg: manual.maxCfg || saved.maxCfg,

                // Union Lists
                models: Array.from(new Set([...(saved.models || []), ...manual.models])),
                tools: Array.from(new Set([...(saved.tools || []), ...manual.tools])),
                loras: Array.from(new Set([...(saved.loras || []), ...manual.loras])),
                embeddings: Array.from(new Set([...(saved.embeddings || []), ...manual.embeddings])),
                hypernetworks: Array.from(new Set([...(saved.hypernetworks || []), ...manual.hypernetworks])),
                controlNets: Array.from(new Set([...(saved.controlNets || []), ...manual.controlNets])),
                ipAdapters: Array.from(new Set([...(saved.ipAdapters || []), ...manual.ipAdapters])),

                // Keep Collection ID? Usually filters object for a collection definition doesn't contain its own ID or 'collectionId'.
                // But FilterState might. Let's explicitly NOT include collectionId in the saved rule "payload" if possible, 
                // but types might require it. 
                // However, onUpdateCollectionFilters generally treats this as the "rules blob".
                // We'll pass it as is, strict type compliance.
                collectionId: undefined, // Don't save circular self-ref (or keep undefined if that's how it's stored)
                showGrids: saved.showGrids, // Preserve
                showIntermediates: saved.showIntermediates // Preserve
            } as FilterState;

            onUpdateCollectionFilters(activeSmartCol.id, mergedFilters);

            // Clear manual edits immediately so the UI reflects "Saved" state
            // and the Update button disappears.
            setFilters(prev => ({
                ...prev,
                searchQuery: '',
                models: [],
                tools: [],
                loras: [],
                embeddings: [],
                hypernetworks: [],
                dateRange: 'all',
                dateFrom: undefined,
                dateTo: undefined,
                favoritesOnly: false,
                pinnedOnly: false,
                minSteps: undefined,
                maxSteps: undefined,
                minCfg: undefined,
                maxCfg: undefined,
                controlNets: [],
                ipAdapters: []
                // Preserve collectionId and view options
            }));
        } else if (activeSmartCol) {
            // Fallback
            onSaveSmartCollection(activeSmartCol.name, filters);
        }
    };

    // Global Dirty Check (includes collectionId so "Reset All" works to clear selection)
    const isDirty = !!(filters.collectionId || hasManualEdits);

    // Tab-Specific Dirty Checks (for dot indicators)
    // Note: dateRange is NOT included in isOrganizeDirty because Date Range is a global section in the footer, not part of Organize tab
    const isOrganizeDirty = !!(filters.collectionId || filters.favoritesOnly || filters.pinnedOnly);
    const isGenerateDirty = !!(filters.tools.length > 0 || filters.minSteps || filters.maxSteps || filters.minCfg || filters.maxCfg || (filters.samplers && filters.samplers.length > 0) || (filters.generationTypes && filters.generationTypes.length > 0) || filters.controlNets.length > 0 || filters.ipAdapters.length > 0);
    const isResourcesDirty = !!(filters.models.length > 0 || filters.loras.length > 0 || (filters.embeddings && filters.embeddings.length > 0) || (filters.hypernetworks && filters.hypernetworks.length > 0));


    return (
        <div
            className={`bg-white/90 dark:bg-zinc-900/95 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-3xl flex flex-col h-full transition-all duration-500 ease-spring shadow-2xl ${isVisible ? 'w-72 opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4 overflow-hidden'} ${className}`}
        >
            {/* Header */}
            <div className="p-4 border-b border-gray-200 dark:border-white/10 flex items-center justify-between min-w-[18rem]">
                <div className="flex items-center gap-2 h-7">
                    <Filter className="w-4 h-4 text-sage-600 dark:text-sage-400" />
                    <h2 className="font-bold text-sm text-gray-800 dark:text-gray-200 uppercase tracking-wider">Library</h2>
                </div>

                <div className="flex items-center gap-2">
                    {showUpdateButton && (
                        <button
                            onClick={handleQuickUpdate}
                            className="flex items-center gap-1.5 text-[10px] font-bold text-white bg-sage-500 hover:bg-sage-600 transition-all shadow-lg shadow-sage-500/20 px-3 py-1.5 rounded-full animate-in zoom-in duration-300"
                            title={`Update ${activeSmartCol.name} with new filters`}
                        >
                            <Save className="w-3 h-3" />
                            Update
                        </button>
                    )}
                    {isDirty && !showUpdateButton && (
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
                                validNames={validFacetNames?.checkpoints}
                            />
                            <ResourceSection
                                title="Resources (LoRA)"
                                type="loras"
                                filters={filters} setFilters={setFilters}
                                data={facets.loras}
                                isOpen={expanded.resources} onToggle={() => toggleSection('resources')}
                                isLoading={isFacetsLoading}
                                validNames={validFacetNames?.loras}
                            />
                            {facets.embeddings && facets.embeddings.length > 0 && (
                                <ResourceSection
                                    title="Resources (Embedding)"
                                    type="embeddings"
                                    filters={filters} setFilters={setFilters}
                                    data={facets.embeddings}
                                    isOpen={expanded.embeddings} onToggle={() => toggleSection('embeddings')}
                                    isLoading={isFacetsLoading}
                                    validNames={validFacetNames?.embeddings}
                                />
                            )}
                            {facets.hypernetworks && facets.hypernetworks.length > 0 && (
                                <ResourceSection
                                    title="Resources (Hypernet)"
                                    type="hypernetworks"
                                    filters={filters} setFilters={setFilters}
                                    data={facets.hypernetworks}
                                    isOpen={expanded.hypernetworks} onToggle={() => toggleSection('hypernetworks')}
                                    isLoading={isFacetsLoading}
                                    validNames={validFacetNames?.hypernetworks}
                                />
                            )}
                        </div>
                    )}

                    {/* GENERATE TAB */}
                    {activeTab === 'generate' && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 fade-in duration-300 ease-spring">
                            <GeneratorSection
                                filters={filters} setFilters={setFilters}
                                tools={facets.tools}
                                isOpen={expanded.generator} onToggle={() => toggleSection('generator')}
                                isLoading={isFacetsLoading}
                                validNames={validFacetNames?.tools}
                            />

                            <ParameterSection
                                filters={filters} setFilters={setFilters}
                                isOpen={expanded.params} onToggle={() => toggleSection('params')}
                            />

                            <GuidanceSection
                                filters={filters} setFilters={setFilters}
                                isOpen={expanded.guidance} onToggle={() => toggleSection('guidance')}
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
                    <span className="font-medium hover:text-gray-900 dark:hover:text-zinc-200 transition-colors cursor-default">{APP_NAME}</span>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => openExternalUrl(REPOSITORY_URL)}
                        className="hover:text-gray-900 dark:hover:text-zinc-200 transition-colors opacity-80 hover:opacity-100"
                        title="Open Ambit on GitHub"
                    >
                        <Github className="w-3 h-3" />
                    </button>
                    <span className="hover:text-gray-900 dark:hover:text-zinc-200 transition-colors cursor-default">v{appVersion ?? '...'}</span>
                </div>
            </div>
        </div>
    );
};
