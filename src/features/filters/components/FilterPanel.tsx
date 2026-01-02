import * as React from 'react';
import { Check, Filter, Github } from 'lucide-react';
import { FilterState, Collection, AIImage } from '../../../types';
import { useLibraryContext } from '../../../hooks/useLibraryContext';
import { CollectionsSection } from './CollectionsSection';
import { SmartCollectionsSection } from './SmartCollectionsSection';
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
    isVisible?: boolean;
    className?: string;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({
    filters,
    setFilters,
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
    isVisible = true,
    className
}) => {
    const { collections, smartCollections, facets, clearAllFilters } = useLibraryContext();

    const [expanded, setExpanded] = React.useState<Record<string, boolean>>({
        collections: true,
        smart: true,
        params: true,
        generator: false,
        model: false,
        resources: false,
        embeddings: false,
        hypernetworks: false,
        date: true
    });

    const toggleSection = (section: string) => {
        setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
    };

    const isDirty = !!(filters.collectionId || filters.searchQuery || filters.models.length > 0 || filters.tools.length > 0 || filters.loras.length > 0 || filters.favoritesOnly || filters.pinnedOnly || filters.dateRange !== 'all' || filters.minSteps || filters.maxSteps || filters.minCfg || filters.maxCfg);

    return (
        <div
            className={`bg-white/90 dark:bg-zinc-900/95 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-3xl flex flex-col h-full transition-all duration-500 ease-spring shadow-2xl ${isVisible ? 'w-72 opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4 overflow-hidden'} ${className}`}
        >
            <div className="p-5 border-b border-gray-200 dark:border-white/10 flex items-center justify-between min-w-[18rem]">
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-sage-600 dark:text-sage-400" />
                    <h2 className="font-bold text-sm text-gray-800 dark:text-gray-200 uppercase tracking-wider">Gallery Filters</h2>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col min-w-[18rem]">
                <div className="space-y-6">
                    {/* View All Reset */}
                    <button
                        onClick={() => {
                            if (isDirty) {
                                clearAllFilters();
                            }
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all shadow-sm font-medium flex items-center justify-between group ease-spring duration-300 ${!isDirty
                            ? 'bg-sage-600 text-white shadow-sage-500/20'
                            : 'bg-gray-100 dark:bg-zinc-800/50 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-200 border border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10'
                            }`}
                    >
                        All Photos
                        {!isDirty && <Check className="w-4 h-4" />}
                    </button>

                    <CollectionsSection
                        collections={collections} filters={filters} setFilters={setFilters}
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
                    />

                    <SmartCollectionsSection
                        filters={filters} setFilters={setFilters}
                        smartCollections={smartCollections}
                        isOpen={expanded.smart} onToggle={() => toggleSection('smart')}
                        onSaveSmartCollection={onSaveSmartCollection}
                        onDeleteSmartCollection={onDeleteSmartCollection}
                        onDropOnCollection={onDropOnCollection}
                        onRenameCollection={onRenameCollection}
                        onToggleArchiveCollection={onToggleArchiveCollection}
                        onTogglePinCollection={onTogglePinCollection}
                        onSetCollectionColor={onSetCollectionColor}
                        onPlayCollection={onPlayCollection}
                        onExportCollection={onExportCollection}
                        onResetCollectionThumbnail={onResetCollectionThumbnail}
                        isDirty={isDirty}
                    />

                    <div className="h-px bg-gray-200 dark:bg-white/5" />

                    <ParameterSection
                        filters={filters} setFilters={setFilters}
                        isOpen={expanded.params} onToggle={() => toggleSection('params')}
                    />

                    <GeneratorSection
                        filters={filters} setFilters={setFilters}
                        tools={facets.tools}
                        isOpen={expanded.generator} onToggle={() => toggleSection('generator')}
                    />

                    <ArchitectureSection
                        filters={filters} setFilters={setFilters}
                        models={facets.models}
                        isOpen={expanded.model} onToggle={() => toggleSection('model')}
                    />

                    <ResourceSection
                        title="Resources (LoRA)"
                        type="loras"
                        filters={filters} setFilters={setFilters}
                        data={facets.loras}
                        isOpen={expanded.resources} onToggle={() => toggleSection('resources')}
                    />

                    <ResourceSection
                        title="Resources (Embedding)"
                        type="embeddings"
                        filters={filters} setFilters={setFilters}
                        data={facets.embeddings}
                        isOpen={expanded.embeddings} onToggle={() => toggleSection('embeddings')}
                    />

                    <ResourceSection
                        title="Resources (Hypernet)"
                        type="hypernetworks"
                        filters={filters} setFilters={setFilters}
                        data={facets.hypernetworks}
                        isOpen={expanded.hypernetworks} onToggle={() => toggleSection('hypernetworks')}
                    />
                </div>
            </div>

            <div className="p-4 pt-0 border-t border-transparent">
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
