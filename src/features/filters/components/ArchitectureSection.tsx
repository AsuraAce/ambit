import * as React from 'react';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { FilterState } from '../../../types';
import { SectionHeader, SelectableRow, SearchInput } from './FilterPrimitives';
import { formatModelName } from '../../../utils/formatUtils';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

interface ArchitectureSectionProps {
    filters: FilterState;
    setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
    models: string[];
    isOpen: boolean;
    onToggle: () => void;
}

export const ArchitectureSection: React.FC<ArchitectureSectionProps> = ({
    filters,
    setFilters,
    models,
    isOpen,
    onToggle
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);

    const toggleModel = (model: string) => {
        setFilters(prev => {
            const newModels = prev.models.includes(model)
                ? prev.models.filter(m => m !== model)
                : [...prev.models, model];
            return { ...prev, models: newModels };
        });
    };

    const filteredModels = models.filter(m =>
        m.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-2">
            <SectionHeader
                title="Model Architecture"
                isOpen={isOpen}
                onToggle={onToggle}
                action={isOpen && (
                    <TooltipButton
                        label={isSearchOpen ? 'Hide Model Search' : 'Search Models'}
                        content={isSearchOpen ? 'Hide Model Search' : 'Search Models'}
                        onClick={(e) => { e.stopPropagation(); setIsSearchOpen(!isSearchOpen); }}
                        aria-expanded={isSearchOpen}
                        className={`p-1 rounded ${isSearchOpen ? 'text-sage-500' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        <Search className="w-3 h-3" />
                    </TooltipButton>
                )}
            />
            {isOpen && (
                <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                    {isSearchOpen && (
                        <SearchInput
                            value={searchQuery}
                            onChange={setSearchQuery}
                            placeholder="Search models..."
                            className="px-1 pb-1"
                        />
                    )}
                    <div className={`space-y-1 ${filteredModels.length > 8 ? 'max-h-48 overflow-y-auto custom-scrollbar pr-1' : ''}`}>
                        {filteredModels.map(model => (
                            <SelectableRow
                                key={model}
                                label={formatModelName(model)}
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
    );
};
