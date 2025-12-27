import * as React from 'react';
import { FilterState, GeneratorTool } from '../../../types';
import { SectionHeader, SelectableRow } from '../FilterPrimitives';

interface GeneratorSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    tools: string[];
    isOpen: boolean;
    onToggle: () => void;
}

export const GeneratorSection: React.FC<GeneratorSectionProps> = ({
    filters,
    setFilters,
    tools,
    isOpen,
    onToggle
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
            <SectionHeader title="Generator" isOpen={isOpen} onToggle={onToggle} />
            {isOpen && (
                <div className="space-y-1 animate-in slide-in-from-top-2 duration-300 ease-spring">
                    {tools.length > 0 ? tools.map(tool => (
                        <SelectableRow
                            key={tool}
                            label={tool}
                            isSelected={filters.tools.includes(tool as GeneratorTool)}
                            onClick={() => toggleTool(tool as GeneratorTool)}
                        />
                    )) : (
                        <div className="text-xs text-gray-400 text-center py-2 italic">No specific tools found</div>
                    )}
                </div>
            )}
        </div>
    );
};
