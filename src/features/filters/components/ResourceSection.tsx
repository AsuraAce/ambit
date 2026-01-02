import * as React from 'react';
import { useState } from 'react';
import { Search, Puzzle, Check } from 'lucide-react';
import { FilterState } from '../../../types';
import { SectionHeader, SearchInput } from './FilterPrimitives';

interface ResourceSectionProps {
    title: string;
    type: 'loras' | 'embeddings' | 'hypernetworks';
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    data: { name: string; count: number }[];
    isOpen: boolean;
    onToggle: () => void;
}

export const ResourceSection: React.FC<ResourceSectionProps> = ({
    title,
    type,
    filters,
    setFilters,
    data,
    isOpen,
    onToggle
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    const toggleItem = (name: string) => {
        setFilters(prev => {
            const currentList = prev[type] || [];
            const newList = currentList.includes(name)
                ? currentList.filter(l => l !== name)
                : [...currentList, name];
            return { ...prev, [type]: newList };
        });
    };

    const filteredItems = data.filter(l =>
        l.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const renderRow = (item: { name: string, count: number }) => {
        const isSelected = (filters[type] || []).includes(item.name);
        return (
            <div
                key={item.name}
                onClick={() => toggleItem(item.name)}
                className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-all ease-spring border ${isSelected
                    ? 'bg-sage-100 dark:bg-sage-600/20 border-sage-200 dark:border-sage-500/30 text-sage-800 dark:text-sage-300 font-medium'
                    : 'bg-transparent border-transparent text-gray-500 dark:text-zinc-400 hover:bg-white/40 dark:hover:bg-white/5'
                    }`}
            >
                <div className="flex items-center gap-2 overflow-hidden">
                    <Puzzle className="w-3 h-3 flex-shrink-0 opacity-50" />
                    <span className="truncate" title={item.name}>{item.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[10px] bg-gray-100 dark:bg-white/10 px-1.5 rounded-md">{item.count}</span>
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

    const singularType = type === 'loras' ? 'LoRA' : type === 'embeddings' ? 'Embedding' : 'Hypernetwork';

    return (
        <div className="space-y-2">
            <SectionHeader
                title={title}
                isOpen={isOpen}
                onToggle={onToggle}
                action={isOpen && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setIsSearchOpen(!isSearchOpen); }}
                        className={`p-1 rounded ${isSearchOpen ? 'text-sage-500' : 'text-gray-400 hover:text-gray-600'}`}
                        title={`Filter ${singularType}s`}
                    >
                        <Search className="w-3 h-3" />
                    </button>
                )}
            />
            {isOpen && (
                <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                    {isSearchOpen && (
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder={`Search ${singularType}s...`}
                            className="px-1 pb-1"
                        />
                    )}
                    <div className={`space-y-1 ${filteredItems.length > 8 ? 'max-h-48 overflow-y-auto custom-scrollbar pr-1' : ''}`}>
                        {filteredItems.map(item => renderRow(item))}
                        {filteredItems.length === 0 && (
                            <div className="text-xs text-gray-400 text-center py-2 italic">
                                {data.length === 0 ? `No ${singularType}s found in library` : `No matching ${singularType}s`}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
