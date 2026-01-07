import * as React from 'react';
import { FolderInput, Archive, Folder, Pin, Sparkles, Check } from 'lucide-react';
import { Collection, FilterState } from '../../../types';
import { SmartImage } from '../../library/components/SmartImage';
import { formatCountCompact } from '../../../utils/formatUtils';

interface CollectionItemProps {
    col: Collection;
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    editingColId: string | null;
    editName: string;
    setEditName: (name: string) => void;
    setEditingColId: (id: string | null) => void;
    handleRenameSubmit: (e: React.FormEvent) => void;
    handleDragEnter: (e: React.DragEvent, colId: string) => void;
    handleDragOver: (e: React.DragEvent, colId: string) => void;
    handleDragLeave: (e: React.DragEvent) => void;
    handleDrop: (e: React.DragEvent, colId: string) => void;
    handleContextMenu: (e: React.MouseEvent, colId: string) => void;
    dropTargetId: string | null;
    onToggleArchive?: (colId: string) => void;
    onTogglePin?: (colId: string) => void;
    onSetColor?: (colId: string, color: string | undefined) => void;
    onPlay?: (colId: string) => void;
    onExport?: (colId: string) => void;
    onResetThumbnail?: (colId: string) => void;
    onDelete?: (colId: string) => void;
    viewMode?: 'grid' | 'list';
}

const getColorClass = (colorName?: string) => {
    if (!colorName) return '';
    switch (colorName) {
        case 'red': return 'bg-red-500';
        case 'orange': return 'bg-orange-500';
        case 'green': return 'bg-green-500';
        case 'blue': return 'bg-blue-500';
        case 'purple': return 'bg-purple-500';
        default: return '';
    }
};

export const CollectionItem: React.FC<CollectionItemProps> = ({
    col,
    filters,
    setFilters,
    editingColId,
    editName,
    setEditName,
    setEditingColId,
    handleRenameSubmit,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleContextMenu,
    dropTargetId,
    onResetThumbnail,
    onDelete,
    viewMode = 'list'
}) => {
    const isSelected = filters.collectionId === col.id;
    const thumbUrl = col.customThumbnail || col.thumbnail || '';
    return (
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
            ) : viewMode === 'grid' ? (
                <div
                    onClick={() => {
                        if (!isSelected) {
                            setFilters(prev => ({
                                ...prev,
                                collectionId: col.id,
                                searchQuery: '',
                                models: [],
                                tools: [],
                                loras: [],
                                embeddings: [],
                                hypernetworks: [],
                                dateRange: 'all',
                                favoritesOnly: false,
                            }));
                        }
                    }}
                    onDragEnter={(e) => handleDragEnter(e, col.id)}
                    onDragOver={(e) => handleDragOver(e, col.id)}
                    onDrop={(e) => handleDrop(e, col.id)}
                    onContextMenu={(e) => handleContextMenu(e, col.id)}
                    className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border transition-all duration-300 ease-spring ${isSelected
                        ? 'border-sage-500 ring-2 ring-sage-500/20 shadow-lg shadow-sage-500/10'
                        : 'border-gray-200 dark:border-white/10 hover:border-sage-400/50 hover:shadow-md'
                        } ${dropTargetId === col.id ? 'scale-105 ring-2 ring-sage-500' : ''}`}
                >
                    {/* Thumbnail Area */}
                    <div className={`absolute inset-0 bg-gray-100 dark:bg-zinc-800 transition-colors ${isSelected ? 'bg-sage-50 dark:bg-sage-900/10' : ''}`}>
                        {thumbUrl ? (
                            <SmartImage
                                src={thumbUrl}
                                alt={col.name}
                                wrapperClassName="w-full h-full"
                                imgClassName={`w-full h-full object-cover ${col.isArchived ? 'grayscale opacity-70' : ''}`}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center opacity-20">
                                {col.filters ? <Sparkles className="w-8 h-8 text-sage-500" /> : <Folder className="w-8 h-8" />}
                            </div>
                        )}
                    </div>

                    {/* Overlay Info */}
                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                        <p className={`text-[10px] font-medium text-white line-clamp-2 leading-tight drop-shadow-sm flex items-center gap-1 ${col.isArchived ? 'opacity-70 italic' : ''}`}>
                            {col.name}
                            {col.filters && <Sparkles className="w-2 h-2 text-sage-400" />}
                        </p>
                    </div>

                    {/* Status Indicators */}
                    {isSelected && (
                        <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-sage-500 flex items-center justify-center shadow-sm animate-in zoom-in-50 duration-200">
                            <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                    )}

                    {col.isPinned && !isSelected && (
                        <div className="absolute top-1.5 right-1.5">
                            <Pin className="w-3 h-3 text-sage-500 fill-sage-500 drop-shadow-sm" />
                        </div>
                    )}

                    {col.color && (
                        <div className={`absolute top-1.5 left-1.5 w-2 h-2 rounded-full border border-white/50 shadow-sm ${getColorClass(col.color)}`} />
                    )}

                    {/* Count Badge */}
                    <div className="absolute top-1.5 right-1.5 group-hover:opacity-0 transition-opacity">
                        {!isSelected && !col.isPinned && (
                            <div className="px-1.5 py-0.5 rounded-md bg-black/40 backdrop-blur-sm text-[9px] font-medium text-white/90">
                                {formatCountCompact(col.count ?? col.imageIds.length)}
                            </div>
                        )}
                    </div>

                    {/* Hover Count Badge */}
                    <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="px-1.5 py-0.5 rounded-md bg-black/40 backdrop-blur-sm text-[9px] font-bold text-white/90">
                            {formatCountCompact(col.count ?? col.imageIds.length)}
                        </div>
                    </div>
                </div>
            ) : (
                <div
                    onClick={() => {
                        if (!isSelected) {
                            setFilters(prev => ({
                                ...prev,
                                collectionId: col.id,
                                searchQuery: '',
                                models: [],
                                tools: [],
                                loras: [],
                                embeddings: [],
                                hypernetworks: [],
                                dateRange: 'all',
                                favoritesOnly: false,
                                showGrids: prev.showGrids,
                                showIntermediates: prev.showIntermediates
                            }));
                        }
                    }}
                    className={`relative flex items-center w-full p-2 rounded-xl text-sm transition-colors cursor-pointer overflow-hidden ${isSelected
                        ? 'bg-gradient-to-r from-gray-200 to-transparent dark:from-zinc-700 dark:to-transparent text-gray-900 dark:text-white font-medium shadow-inner'
                        : 'text-gray-500 dark:text-zinc-400 hover:bg-white/40 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-zinc-200'
                        }`}
                >
                    {/* Selection Indicator */}
                    {isSelected && (
                        <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-sage-500 rounded-full" />
                    )}
                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-8 pointer-events-none">
                        {dropTargetId === col.id ? (
                            <FolderInput className="w-8 h-8 text-sage-500 animate-pulse flex-shrink-0" />
                        ) : thumbUrl ? (
                            <div className="relative w-8 h-8 flex-shrink-0">
                                <SmartImage
                                    src={thumbUrl}
                                    alt=""
                                    wrapperClassName="w-full h-full"
                                    imgClassName={`w-full h-full rounded-lg object-cover shadow-sm border border-gray-200 dark:border-white/5 ${col.isArchived ? 'grayscale opacity-70' : ''}`}
                                />
                                {col.color && <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-800 ${getColorClass(col.color)}`} />}
                            </div>
                        ) : (
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center border border-gray-200 dark:border-white/5 flex-shrink-0 relative ${col.isArchived ? 'bg-sage-100/50 dark:bg-zinc-800/50' : 'bg-gray-100 dark:bg-zinc-800'}`}>
                                {col.isArchived ? (
                                    <Archive className="w-4 h-4 text-gray-400" />
                                ) : col.filters ? (
                                    <Sparkles className="w-4 h-4 text-sage-500" />
                                ) : (
                                    <Folder className="w-4 h-4 text-gray-400 dark:text-zinc-500" />
                                )}
                                {col.color && <div className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white dark:border-zinc-800 ${getColorClass(col.color)}`} />}
                            </div>
                        )}
                        <span className={`truncate font-sans pointer-events-auto ${col.isArchived ? 'opacity-70 italic text-gray-500 dark:text-gray-500' : ''} flex items-center gap-1.5`} title={col.name}>
                            {col.name}
                            {col.filters && <Sparkles className="w-2.5 h-2.5 text-sage-500/70" />}
                        </span>
                    </div>

                    {col.isPinned && (
                        <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-sage-500 dark:bg-sage-400 rounded-r-full" />
                    )}

                    <span className={`absolute right-2 text-[10px] px-1.5 py-0.5 rounded-md pointer-events-none transition-opacity duration-200 ${isSelected ? 'bg-gray-300 dark:bg-zinc-600 text-gray-800 dark:text-white' : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 opacity-60 group-hover:opacity-100'
                        }`}>
                        {formatCountCompact(col.count ?? col.imageIds.length)}
                    </span>
                </div>
            )}
        </div>
    );
};
