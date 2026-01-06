import * as React from 'react';
import { FilterState, GeneratorTool } from '../../../types';
import { SectionHeader, SelectableRow } from './FilterPrimitives';

interface GeneratorSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    tools: string[];
    isOpen: boolean;
    onToggle: () => void;
    isLoading?: boolean;
}

export const GeneratorSection: React.FC<GeneratorSectionProps> = ({
    filters,
    setFilters,
    tools,
    isOpen,
    onToggle,
    isLoading
}) => {
    const toggleTool = (tool: GeneratorTool) => {
        setFilters(prev => {
            const newTools = prev.tools.includes(tool)
                ? prev.tools.filter(t => t !== tool)
                : [...prev.tools, tool];
            return { ...prev, tools: newTools };
        });
    };

    return (
        <div className="space-y-2">
            <SectionHeader title="Generator" isOpen={isOpen} onToggle={onToggle} isLoading={isLoading} />
            {isOpen && (
                <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                    {tools.length > 0 ? tools.map(tool => (
                        <SelectableRow
                            key={tool}
                            label={tool}
                            isSelected={filters.tools.includes(tool as GeneratorTool)}
                            onClick={() => toggleTool(tool as GeneratorTool)}
                        />
                    )) : isLoading ? (
                        <div className="flex flex-col items-center justify-center py-4 space-y-3 border border-dashed border-gray-200 dark:border-white/10 rounded-xl">
                            <div className="w-4 h-4 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin" />
                            <span className="text-[10px] text-gray-400 font-medium animate-pulse">Loading Tools...</span>
                        </div>
                    ) : (
                        <div className="text-xs text-gray-400 text-center py-2 italic border border-dashed border-gray-200 dark:border-white/10 rounded-xl">No specific tools found</div>
                    )}
                </div>
            )}
        </div>
    );
};
