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
    /**
     * Valid tool names for drill-down filtering.
     * - null/undefined: Show all tools (no drill-down filtering active)
     * - string[]: Only show tools in this list (+ always show selected tools)
     */
    validNames?: string[] | null;
}

export const GeneratorSection: React.FC<GeneratorSectionProps> = ({
    filters,
    setFilters,
    tools,
    isOpen,
    onToggle,
    isLoading,
    validNames
}) => {
    const toggleTool = (tool: GeneratorTool) => {
        setFilters(prev => {
            const newTools = prev.tools.includes(tool)
                ? prev.tools.filter(t => t !== tool)
                : [...prev.tools, tool];
            return { ...prev, tools: newTools };
        });
    };

    // Determine availability based on validNames (cross-category drill-down)
    const isToolAvailable = React.useCallback((tool: string): boolean => {
        // Always available if no validNames filtering is active
        if (validNames === null || validNames === undefined) return true;
        // Always available if currently selected (Disjunctive: self-selected are always valid)
        if (filters.tools.includes(tool as GeneratorTool)) return true;
        // Otherwise, check if in validNames
        return validNames.includes(tool);
    }, [validNames, filters.tools]);

    return (
        <div className="space-y-2">
            <SectionHeader title="Generator" isOpen={isOpen} onToggle={onToggle} isLoading={isLoading} />
            {isOpen && (
                <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                    {tools.length > 0 ? tools.map(tool => {
                        const available = isToolAvailable(tool);
                        return (
                            <SelectableRow
                                key={tool}
                                label={tool}
                                isSelected={filters.tools.includes(tool as GeneratorTool)}
                                onClick={() => toggleTool(tool as GeneratorTool)}
                                className={available ? '' : 'opacity-40 line-through'}
                                disabled={!available}
                            />
                        );
                    }) : isLoading ? (
                        <div className="flex flex-col items-center justify-center py-4 space-y-3 border border-dashed border-gray-200 dark:border-white/10 rounded-xl">
                            <div className="w-4 h-4 border-2 border-sage-500/30 border-t-sage-500 rounded-full animate-spin" />
                            <span className="text-[10px] text-gray-400 font-medium animate-pulse">Loading Tools...</span>
                        </div>
                    ) : (
                        <div className="text-xs text-gray-400 text-center py-2 italic border border-dashed border-gray-200 dark:border-white/10 rounded-xl">
                            {validNames !== null && validNames !== undefined ? 'No matching tools in current filter' : 'No specific tools found'}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
