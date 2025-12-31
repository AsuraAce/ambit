import * as React from 'react';
import { FilterState } from '../../../types';
import { SectionHeader, FilterSlider } from './FilterPrimitives';

interface ParameterSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    isOpen: boolean;
    onToggle: () => void;
}

export const ParameterSection: React.FC<ParameterSectionProps> = ({
    filters,
    setFilters,
    isOpen,
    onToggle
}) => {
    return (
        <div className="space-y-2">
            <SectionHeader title="Parameters" isOpen={isOpen} onToggle={onToggle} />
            {isOpen && (
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
    );
};
