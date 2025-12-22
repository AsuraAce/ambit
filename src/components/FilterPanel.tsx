import * as React from 'react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Filter, Calendar, Save, Trash2, FolderInput, Plus, Search, Check, Folder, Sparkles, Github, X, Archive, FolderOpen, ArrowUpDown, Pin, Puzzle } from 'lucide-react';
import { FilterState, GeneratorTool, ModelType, SortOption, Collection, AIImage } from '../types';
import { SectionHeader, SelectableRow, FilterSlider } from './filters/FilterPrimitives';
import { useLibraryContext } from '../hooks/useLibraryContext';
import { CollectionContextMenu } from './CollectionContextMenu';

interface FilterPanelProps {
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    filteredImages?: AIImage[]; // For context-sensitive stats
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

type FilterSection = 'collections' | 'smart' | 'params' | 'generator' | 'model' | 'resources' | 'date';

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
    // setFilters passed via Props
    const { collections, smartCollections, stats, facets } = useLibraryContext(); // stats unused here but available if needed

    const [expanded, setExpanded] = useState<Record<FilterSection, boolean>>({
        collections: true,
        smart: true,
        params: true,
        generator: false,
        model: false,
        resources: false,
        date: true
    });

    const [isCreatingCollection, setIsCreatingCollection] = useState(false);
    const [isCreatingSmart, setIsCreatingSmart] = useState(false);
    const [newName, setNewName] = useState('');
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    // Collection Search & Sort
    const [isCollectionSearchOpen, setIsCollectionSearchOpen] = useState(false);
    const [collectionSearchQuery, setCollectionSearchQuery] = useState('');
    const [showArchived, setShowArchived] = useState(false);
    const [collectionSort, setCollectionSort] = useState<'name' | 'date'>('date');
    const collectionSearchInputRef = useRef<HTMLInputElement>(null);

    // Model & LoRA Search
    const [modelSearchQuery, setModelSearchQuery] = useState('');
    const [loraSearchQuery, setLoraSearchQuery] = useState('');

    // Renaming State
    const [editingColId, setEditingColId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, collectionId: string } | null>(null);

    // NOTE: Removed client-side loraStats calculation. Using DB-backed facets.loras

    useEffect(() => {
        if (isCollectionSearchOpen && collectionSearchInputRef.current) {
            collectionSearchInputRef.current.focus();
        }
    }, [isCollectionSearchOpen]);

    const toggleSection = (section: FilterSection) => {
        setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
    };

    const toggleTool = (tool: GeneratorTool) => {
        setFilters(prev => {
            const newTools = prev.tools.includes(tool)
                ? prev.tools.filter(t => t !== tool)
                : [...prev.tools, tool];
            return { ...prev, tools: newTools };
        });
    };

    const toggleModel = (model: string) => {
        setFilters(prev => {
            const newModels = prev.models.includes(model)
                ? prev.models.filter(m => m !== model)
                : [...prev.models, model];
            return { ...prev, models: newModels };
        });
    };

    const toggleLora = (lora: string) => {
        setFilters(prev => {
            const newLoras = prev.loras.includes(lora)
                ? prev.loras.filter(l => l !== lora)
                : [...prev.loras, lora];
            return { ...prev, loras: newLoras };
        });
    };

    const handleCreateCollection = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName.trim()) {
            onCreateCollection(newName);
            setNewName('');
            setIsCreatingCollection(false);
        }
    };

    const handleSaveSmartCollection = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName.trim()) {
            onSaveSmartCollection(newName, filters);
            setNewName('');
            setIsCreatingSmart(false);
        }
    };

    const handleRenameSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (editingColId && editName.trim() && onRenameCollection) {
            onRenameCollection(editingColId, editName);
            setEditingColId(null);
            setEditName('');
        }
    };

    const handleDragEnter = (e: React.DragEvent, colId: string) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setDropTargetId(colId);
    };

    const handleDragOver = (e: React.DragEvent, colId: string) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setDropTargetId(colId);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget.contains(e.relatedTarget as Node)) {
            return;
        }
        setDropTargetId(null);
    };

    const handleDrop = (e: React.DragEvent, colId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDropTargetId(null);
        const data = e.dataTransfer.getData('text/plain');
        console.log('[FilterPanel] Drop on collection:', colId, 'Data:', data);
        if (data && onDropOnCollection) {
            onDropOnCollection(colId, data);
        }
    };

    // Context Menu Actions
    const handleContextMenu = (e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, collectionId: colId });
    };

    const handleRenameContext = () => {
        if (!contextMenu) return;
        const col = collections.find(c => c.id === contextMenu.collectionId);
        if (col) {
            setEditingColId(col.id);
            setEditName(col.name);
        }
        setContextMenu(null);
    };

    const handleArchiveContext = () => {
        if (!contextMenu || !onToggleArchiveCollection) return;
        onToggleArchiveCollection(contextMenu.collectionId);
        setContextMenu(null);
    };

    const handlePinContext = () => {
        if (!contextMenu || !onTogglePinCollection) return;
        onTogglePinCollection(contextMenu.collectionId);
        setContextMenu(null);
    };

    const handleDeleteContext = () => {
        if (!contextMenu || !onDeleteCollection) return;
        onDeleteCollection(contextMenu.collectionId);
        setContextMenu(null);
    };

    const handlePlayContext = () => {
        if (!contextMenu || !onPlayCollection) return;
        onPlayCollection(contextMenu.collectionId);
        setContextMenu(null);
    };

    const handleExportContext = () => {
        if (!contextMenu || !onExportCollection) return;
        onExportCollection(contextMenu.collectionId);
        setContextMenu(null);
    };

    const handleResetThumbContext = () => {
        if (!contextMenu || !onResetCollectionThumbnail) return;
        onResetCollectionThumbnail(contextMenu.collectionId);
        setContextMenu(null);
    };

    const handleColorChange = (color: string | undefined) => {
        if (!contextMenu || !onSetCollectionColor) return;
        onSetCollectionColor(contextMenu.collectionId, color);
        setContextMenu(null);
    };

    // Sort and Filter Collections
    const filteredCollections = collections
        .filter(c => {
            const matchesSearch = c.name.toLowerCase().includes(collectionSearchQuery.toLowerCase());
            const matchesArchive = showArchived ? true : !c.isArchived;
            return matchesSearch && matchesArchive;
        })
        .sort((a, b) => {
            if (collectionSort === 'name') {
                return a.name.localeCompare(b.name);
            } else {
                return b.createdAt - a.createdAt; // Newest first
            }
        });

    const pinnedCollections = filteredCollections.filter(c => c.isPinned);
    const otherCollections = filteredCollections.filter(c => !c.isPinned);

    // Use DB Facets (Dynamic) instead of hardcoded Enum
    const filteredModels = facets.models.filter(m =>
        m.toLowerCase().includes(modelSearchQuery.toLowerCase())
    );

    const filteredLoras = facets.loras.filter(l =>
        l.name.toLowerCase().includes(loraSearchQuery.toLowerCase())
    );

    const isDirty = filters.searchQuery || filters.models.length > 0 || filters.tools.length > 0 || filters.loras.length > 0 || filters.favoritesOnly || filters.dateRange !== 'all' || filters.minSteps || filters.maxSteps || filters.minCfg || filters.maxCfg;

    const getColorClass = (colorName?: string) => {
        if (!colorName) return '';
        // Map basic color names to tailwind classes if stored as simple names
        switch (colorName) {
            case 'red': return 'bg-red-500';
            case 'orange': return 'bg-orange-500';
            case 'green': return 'bg-green-500';
            case 'blue': return 'bg-blue-500';
            case 'purple': return 'bg-purple-500';
            default: return ''; // Assume it might be a class or handle elsewhere
        }
    };

    // Helper to render collection row
    const renderCollectionItem = (col: Collection) => (
        <div
            key={col.id}
            onDragEnter={(e) => handleDragEnter(e, col.id)}
            onDragOver={(e) => handleDragOver(e, col.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, col.id)}
            onContextMenu={(e) => handleContextMenu(e, col.id)}
            className={`relative rounded-xl transition-all duration-300 ease-spring group ${dropTargetId === col.id
                ? 'bg-sage-100 dark:bg-sage-900/50 ring-2 ring-sage-500 z-10 scale-105 overflow-hidden'
                : ''
                }`}
        >
            {editingColId === col.id ? (
                <form onSubmit={handleRenameSubmit} className="p-1">
                    <input
                        autoFocus
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => setEditingColId(null)}
                        className="w-full bg-white dark:bg-zinc-900 border border-sage-500 rounded-lg px-2 py-1 text-sm outline-none text-gray-900 dark:text-white"
                    />
                </form>
            ) : (
                <div
                    onClick={() => setFilters(prev => ({ ...prev, collectionId: col.id }))}
                    className={`relative flex items-center w-full p-2 rounded-xl text-sm transition-colors cursor-pointer overflow-hidden ${filters.collectionId === col.id
                        ? 'bg-gray-200 dark:bg-zinc-700 text-gray-900 dark:text-white font-medium shadow-inner'
                        : 'text-gray-500 dark:text-zinc-400 hover:bg-white/40 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-zinc-200'
                        }`}
                >
                    {/* Name & Icon Section */}
                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-8 pointer-events-none">
                        {dropTargetId === col.id ? (
                            <FolderInput className="w-8 h-8 text-sage-500 animate-pulse flex-shrink-0" />
                        ) : (col.customThumbnail || col.thumbnail) ? (
                            <div className="relative w-8 h-8 flex-shrink-0">
                                <img src={col.customThumbnail || col.thumbnail} className={`w-full h-full rounded-lg object-cover shadow-sm border border-gray-200 dark:border-white/5 ${col.isArchived ? 'grayscale opacity-70' : ''}`} alt="" />
                                {col.color && <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-800 ${getColorClass(col.color)}`} />}
                            </div>
                        ) : (
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center border border-gray-200 dark:border-white/5 flex-shrink-0 relative ${col.isArchived ? 'bg-sage-100/50 dark:bg-zinc-800/50' : 'bg-gray-100 dark:bg-zinc-800'}`}>
                                {col.isArchived ? <Archive className="w-4 h-4 text-gray-400" /> : <Folder className="w-4 h-4 text-gray-400 dark:text-zinc-500" />}
                                {col.color && <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-800 ${getColorClass(col.color)}`} />}
                            </div>
                        )}
                        <span className={`truncate font-sans pointer-events-auto ${col.isArchived ? 'opacity-70 italic text-gray-500 dark:text-gray-500' : ''}`} title={col.name}>{col.name}</span>
                    </div>

                    {/* Pin Icon (if pinned) */}
                    {col.isPinned && (
                        <div className="absolute right-9 top-1/2 -translate-y-1/2 text-sage-500 dark:text-sage-400">
                            <Pin className="w-3 h-3 fill-current" />
                        </div>
                    )}

                    {/* Count Badge */}
                    <span className={`absolute right-2 text-[10px] px-1.5 py-0.5 rounded-full pointer-events-none transition-opacity duration-200 ${filters.collectionId === col.id ? 'bg-gray-300 dark:bg-zinc-600 text-gray-800 dark:text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-500'
                        }`}>
                        {col.count ?? col.imageIds.length}
                    </span>
                </div>
            )}
        </div>
    );

    // Helper for LoRA row display
    const renderLoraRow = (lora: { name: string, count: number }) => {
        const isSelected = filters.loras.includes(lora.name);
        return (
            <div
                key={lora.name}
                onClick={() => toggleLora(lora.name)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-all ease-spring border ${isSelected
                    ? 'bg-sage-100 dark:bg-sage-600/20 border-sage-200 dark:border-sage-500/30 text-sage-800 dark:text-sage-300 font-medium'
                    : 'bg-transparent border-transparent text-gray-500 dark:text-zinc-400 hover:bg-white/40 dark:hover:bg-white/5'
                    }`}
            >
                <div className="flex items-center gap-2 overflow-hidden">
                    <Puzzle className="w-3 h-3 flex-shrink-0 opacity-50" />
                    <span className="truncate" title={lora.name}>{lora.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] bg-gray-100 dark:bg-white/10 px-1.5 rounded-md">{lora.count}</span>
                    {isSelected ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-sage-500 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-gray-600" />
                    )}
                </div>
            </div>
        );
    };

    return (
        <div
            className={`bg-white/90 dark:bg-zinc-900/95 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-3xl ml-4 flex flex-col h-full transition-all duration-500 ease-spring shadow-2xl ${isVisible ? 'w-72 opacity-100 translate-x-0' : 'w-0 opacity-0 -translate-x-4 overflow-hidden'} ${className}`}
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
                        onClick={() => setFilters(prev => ({
                            ...prev,
                            collectionId: null,
                            favoritesOnly: false,
                            minSteps: undefined,
                            maxSteps: undefined,
                            minCfg: undefined,
                            maxCfg: undefined,
                            loras: [] // Reset LoRAs too
                        }))}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all shadow-sm font-medium flex items-center justify-between group ease-spring duration-300 ${!filters.collectionId && !filters.favoritesOnly && !filters.minSteps && filters.loras.length === 0
                            ? 'bg-sage-600 text-white shadow-sage-500/20'
                            : 'bg-gray-100 dark:bg-zinc-800/50 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-200 border border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10'
                            }`}
                    >
                        All Photos
                        {(!filters.collectionId && !filters.favoritesOnly && filters.loras.length === 0) && <Check className="w-4 h-4" />}
                    </button>

                    {/* Collections */}
                    <div className="space-y-2">
                        <SectionHeader
                            title="Collections"
                            isOpen={expanded.collections}
                            onToggle={() => toggleSection('collections')}
                            action={
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowArchived(!showArchived); }}
                                        className={`transition-colors p-1 rounded-md ${showArchived ? 'text-sage-600 dark:text-sage-400 bg-sage-100 dark:bg-sage-900/30' : 'text-gray-400 hover:text-sage-500 dark:hover:text-sage-400'}`}
                                        title={showArchived ? "Hide Archived" : "Include Archived"}
                                    >
                                        <Archive className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setCollectionSort(prev => prev === 'name' ? 'date' : 'name'); }}
                                        className={`transition-colors p-1 rounded-md text-gray-400 hover:text-sage-500 dark:hover:text-sage-400`}
                                        title={collectionSort === 'name' ? "Sorted by Name (A-Z)" : "Sorted by Date (Newest)"}
                                    >
                                        <ArrowUpDown className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (isCollectionSearchOpen) {
                                                setCollectionSearchQuery('');
                                            }
                                            setIsCollectionSearchOpen(!isCollectionSearchOpen);
                                        }}
                                        className={`transition-colors p-1 rounded-md ${isCollectionSearchOpen ? 'text-sage-600 dark:text-sage-400 bg-sage-100 dark:bg-sage-900/30' : 'text-gray-400 hover:text-sage-500 dark:hover:text-sage-400'}`}
                                        title="Search Collections"
                                    >
                                        <Search className="w-3 h-3" />
                                    </button>
                                    <button
                                        id="create-col-btn"
                                        onClick={(e) => { e.stopPropagation(); setIsCreatingCollection(true); }}
                                        className="text-gray-400 hover:text-sage-500 dark:hover:text-sage-400 transition-colors p-1"
                                        title="New Collection"
                                    >
                                        <Plus className="w-3 h-3" />
                                    </button>
                                </div>
                            }
                        />

                        {expanded.collections && (
                            <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                                {isCollectionSearchOpen && (
                                    <div className="px-1 pb-2">
                                        <input
                                            ref={collectionSearchInputRef}
                                            type="text"
                                            value={collectionSearchQuery}
                                            onChange={(e) => setCollectionSearchQuery(e.target.value)}
                                            placeholder="Find collection..."
                                            className="w-full bg-gray-100 dark:bg-zinc-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs focus:border-sage-500 outline-none text-gray-900 dark:text-white transition-all"
                                        />
                                    </div>
                                )}

                                {isCreatingCollection && (
                                    <form onSubmit={handleCreateCollection} className="mb-2 flex items-center gap-1">
                                        <input
                                            autoFocus
                                            type="text"
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            placeholder="Name..."
                                            className="w-full bg-white dark:bg-zinc-900 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1.5 text-xs focus:border-sage-500 outline-none text-gray-900 dark:text-white"
                                            onBlur={() => !newName && setIsCreatingCollection(false)}
                                        />
                                    </form>
                                )}

                                <div className="max-h-[35vh] overflow-y-auto custom-scrollbar space-y-1 pr-1">
                                    {/* Pinned Section */}
                                    {pinnedCollections.length > 0 && (
                                        <div className="mb-2">
                                            <div className="px-2 pb-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-600 uppercase tracking-wider flex items-center gap-1">
                                                <Pin className="w-3 h-3" /> Pinned
                                            </div>
                                            <div className="space-y-1">
                                                {pinnedCollections.map(renderCollectionItem)}
                                            </div>
                                            <div className="h-px bg-gray-200 dark:bg-white/5 my-2 mx-1" />
                                        </div>
                                    )}

                                    {/* Unpinned Section */}
                                    {otherCollections.length > 0 && (
                                        <div className="space-y-1">
                                            {otherCollections.map(renderCollectionItem)}
                                        </div>
                                    )}

                                    {filteredCollections.length === 0 && (
                                        <div className="text-xs text-gray-400 text-center py-2 italic">
                                            No collections found.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Smart Collections */}
                    <div className="space-y-2">
                        <SectionHeader
                            title="Smart Collections"
                            isOpen={expanded.smart}
                            onToggle={() => toggleSection('smart')}
                            action={isDirty && !isCreatingSmart ? (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setIsCreatingSmart(true); }}
                                    className="text-sage-600 dark:text-sage-400 hover:text-sage-800 dark:hover:text-sage-300 transition-colors text-[10px] flex items-center gap-1 font-medium bg-sage-100 dark:bg-sage-900/30 border border-sage-500/30 px-1.5 py-0.5 rounded"
                                    title="Save current filters"
                                >
                                    <Save className="w-3 h-3" /> Save
                                </button>
                            ) : undefined}
                        />

                        {expanded.smart && (
                            <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                                {isCreatingSmart && (
                                    <form onSubmit={handleSaveSmartCollection} className="mb-2 flex items-center gap-1 animate-in fade-in">
                                        <input
                                            autoFocus
                                            type="text"
                                            value={newName}
                                            onChange={(e) => setNewName(e.target.value)}
                                            placeholder="Save filter as..."
                                            className="w-full bg-white dark:bg-zinc-900 border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1 text-xs focus:border-sage-500 outline-none text-gray-900 dark:text-white"
                                            onBlur={() => !newName && setIsCreatingSmart(false)}
                                        />
                                    </form>
                                )}

                                {smartCollections.map(sc => (
                                    <div key={sc.id} className="group relative flex items-center">
                                        <button
                                            onClick={() => setFilters(sc.filters)}
                                            className="flex-1 text-left px-3 py-2 rounded-xl text-sm text-gray-500 dark:text-zinc-400 hover:bg-white/40 dark:hover:bg-white/5 hover:text-sage-700 dark:hover:text-sage-300 truncate flex items-center gap-2 transition-colors"
                                        >
                                            <Sparkles className="w-3.5 h-3.5 text-sage-500" />
                                            {sc.name}
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onDeleteSmartCollection(sc.id); }}
                                            className="absolute right-2 p-1 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                                {smartCollections.length === 0 && !isCreatingSmart && (
                                    <div className="px-3 py-2 text-xs text-gray-500 dark:text-zinc-600 italic">No smart collections saved.</div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="h-px bg-gray-200 dark:bg-white/5" />

                    {/* Params - Sliders */}
                    <div className="space-y-2">
                        <SectionHeader title="Parameters" isOpen={expanded.params} onToggle={() => toggleSection('params')} />
                        {expanded.params && (
                            <div className="space-y-6 animate-in slide-in-from-top-2 duration-300 ease-spring px-1 pt-2">

                                <FilterSlider
                                    label="Steps"
                                    min={0}
                                    max={150}
                                    minValue={filters.minSteps}
                                    maxValue={filters.maxSteps}
                                    onChange={(min, max) => setFilters(prev => ({ ...prev, minSteps: min, maxSteps: max }))}
                                />

                                <FilterSlider
                                    label="CFG Scale"
                                    min={0}
                                    max={30}
                                    step={0.5}
                                    minValue={filters.minCfg}
                                    maxValue={filters.maxCfg}
                                    onChange={(min, max) => setFilters(prev => ({ ...prev, minCfg: min, maxCfg: max }))}
                                />

                            </div>
                        )}
                    </div>

                    {/* Software Source - Selectable Rows */}
                    <div className="space-y-2">
                        <SectionHeader title="Generator" isOpen={expanded.generator} onToggle={() => toggleSection('generator')} />
                        {expanded.generator && (
                            <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                                {Object.values(GeneratorTool).map(tool => (
                                    <SelectableRow
                                        key={tool}
                                        label={tool}
                                        isSelected={filters.tools.includes(tool)}
                                        onClick={() => toggleTool(tool)}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Models - Selectable Rows */}
                    <div className="space-y-2">
                        <SectionHeader
                            title="Model Architecture"
                            isOpen={expanded.model}
                            onToggle={() => toggleSection('model')}
                            action={expanded.model && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setModelSearchQuery(q => q ? '' : ' '); }}
                                    className={`p-1 rounded ${modelSearchQuery ? 'text-sage-500' : 'text-gray-400 hover:text-gray-600'}`}
                                    title="Filter Models"
                                >
                                    <Search className="w-3 h-3" />
                                </button>
                            )}
                        />
                        {expanded.model && (
                            <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                                {modelSearchQuery !== '' && (
                                    <div className="px-1 pb-1 relative">
                                        <input
                                            type="text"
                                            value={modelSearchQuery === ' ' ? '' : modelSearchQuery}
                                            onChange={(e) => setModelSearchQuery(e.target.value)}
                                            placeholder="Search models..."
                                            className="w-full bg-gray-100 dark:bg-zinc-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-xs focus:border-sage-500 outline-none text-gray-900 dark:text-white"
                                            autoFocus
                                        />
                                        {modelSearchQuery && modelSearchQuery !== ' ' && (
                                            <button
                                                onClick={() => setModelSearchQuery('')}
                                                className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                )}
                                <div className={`space-y-1 ${filteredModels.length > 8 ? 'max-h-48 overflow-y-auto custom-scrollbar pr-1' : ''}`}>
                                    {filteredModels.map(model => (
                                        <SelectableRow
                                            key={model}
                                            label={model}
                                            isSelected={filters.models.includes(model)}
                                            onClick={() => toggleModel(model)}
                                        />
                                    ))}
                                    {filteredModels.length === 0 && (
                                        <div className="text-xs text-gray-400 text-center py-2 italic">No models found</div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Resources (LoRAs) */}
                    <div className="space-y-2">
                        <SectionHeader
                            title="Resources (LoRA)"
                            isOpen={expanded.resources}
                            onToggle={() => toggleSection('resources')}
                            action={expanded.resources && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setLoraSearchQuery(q => q ? '' : ' '); }}
                                    className={`p-1 rounded ${loraSearchQuery ? 'text-sage-500' : 'text-gray-400 hover:text-gray-600'}`}
                                    title="Filter LoRAs"
                                >
                                    <Search className="w-3 h-3" />
                                </button>
                            )}
                        />
                        {expanded.resources && (
                            <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                                {loraSearchQuery !== '' && (
                                    <div className="px-1 pb-1 relative">
                                        <input
                                            type="text"
                                            value={loraSearchQuery === ' ' ? '' : loraSearchQuery}
                                            onChange={(e) => setLoraSearchQuery(e.target.value)}
                                            placeholder="Search LoRAs..."
                                            className="w-full bg-gray-100 dark:bg-zinc-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 text-xs focus:border-sage-500 outline-none text-gray-900 dark:text-white"
                                            autoFocus
                                        />
                                        {loraSearchQuery && loraSearchQuery !== ' ' && (
                                            <button
                                                onClick={() => setLoraSearchQuery('')}
                                                className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                )}
                                <div className={`space-y-1 ${filteredLoras.length > 8 ? 'max-h-48 overflow-y-auto custom-scrollbar pr-1' : ''}`}>
                                    {filteredLoras.map(lora => renderLoraRow(lora))}
                                    {filteredLoras.length === 0 && (
                                        <div className="text-xs text-gray-400 text-center py-2 italic">
                                            {facets.loras.length === 0 ? "No LoRAs found in library" : "No matching LoRAs"}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                </div>

                {/* Date Range & Footer */}
                <div className="mt-auto pt-6">
                    <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-white/10">
                        <h3 className="flex items-center gap-2 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                            <Calendar className="w-3 h-3" /> Date Range
                        </h3>
                        <div className="grid grid-cols-2 gap-2">
                            {(['all', 'today', 'week', 'month'] as const).map((range) => (
                                <button
                                    key={range}
                                    onClick={() => setFilters(prev => ({ ...prev, dateRange: range }))}
                                    className={`px-3 py-2 text-xs rounded-lg capitalize transition-all ease-spring duration-300 border ${filters.dateRange === range
                                        ? 'bg-sage-600 text-white border-sage-600 shadow-md shadow-sage-500/20'
                                        : 'bg-gray-100 dark:bg-zinc-800/50 border-gray-200 dark:border-white/5 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-zinc-800 hover:text-gray-900 dark:hover:text-gray-200'
                                        }`}
                                >
                                    {range}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
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

            {contextMenu && createPortal(
                <CollectionContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    collectionId={contextMenu.collectionId}
                    isArchived={collections.find(c => c.id === contextMenu.collectionId)?.isArchived}
                    isPinned={collections.find(c => c.id === contextMenu.collectionId)?.isPinned}
                    hasCustomThumbnail={!!collections.find(c => c.id === contextMenu.collectionId)?.customThumbnail}
                    currentColor={collections.find(c => c.id === contextMenu.collectionId)?.color}
                    onClose={() => setContextMenu(null)}
                    onRename={handleRenameContext}
                    onToggleArchive={handleArchiveContext}
                    onTogglePin={handlePinContext}
                    onDelete={handleDeleteContext}
                    onPlaySlideshow={handlePlayContext}
                    onExport={handleExportContext}
                    onResetThumbnail={handleResetThumbContext}
                    onColorChange={handleColorChange}
                />,
                document.body
            )}
        </div>
    );
};