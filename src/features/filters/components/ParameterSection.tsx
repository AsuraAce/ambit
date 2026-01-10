import * as React from 'react';
import { normalizeSampler } from '../../../utils/samplerUtils';
import { FilterState } from '../../../types';
import { SectionHeader, FilterSlider, MultiSelectDropdown } from './FilterPrimitives';
import { useParameterRangesQuery } from '../../../hooks/useParameterRangesQuery';
import { Check } from 'lucide-react';

interface ParameterSectionProps {
    filters: FilterState;
    setFilters: (update: (prev: FilterState) => FilterState) => void;
    isOpen: boolean;
    onToggle: () => void;
}

/** Chip-style multi-select for categorical filters */
const ChipSelect: React.FC<{
    label: string;
    options: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
    formatLabel?: (value: string) => string;
}> = ({ label, options, selected, onChange, formatLabel }) => {
    if (options.length === 0) return null;

    const toggleOption = (opt: string) => {
        if (selected.includes(opt)) {
            onChange(selected.filter(s => s !== opt));
        } else {
            onChange([...selected, opt]);
        }
    };

    const format = formatLabel || ((v: string) => v);

    return (
        <div className="space-y-2">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-2">
                {options.map(opt => {
                    const isSelected = selected.includes(opt);
                    return (
                        <button
                            key={opt}
                            onClick={() => toggleOption(opt)}
                            className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${isSelected
                                ? 'bg-sage-100 dark:bg-sage-600/20 border-sage-300 dark:border-sage-500/40 text-sage-700 dark:text-sage-300'
                                : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-zinc-400 hover:border-sage-300 dark:hover:border-sage-500/30'
                                }`}
                        >
                            <span className="flex items-center gap-1">
                                {isSelected && <Check className="w-3 h-3" />}
                                {format(opt)}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

/** Format generation type for display */
const formatGenType = (type: string): string => {
    const labels: Record<string, string> = {
        'txt2img': 'Text to Image',
        'img2img': 'Image to Image',
        'extras': 'Extras/Upscale',
        'grid': 'Grid',
        'saved': 'Saved',
        'unknown': 'Unknown'
    };
    return labels[type] || type;
};

// ... (ChipSelect and formatGenType omitted as they are before)

const groupSamplers = (samplers: string[]) => {
    const groups: Record<string, string[]> = {
        'Euler': [],
        'DPM': [],
        'LMS': [],
        'Heun': [],
        'DDIM': [],
        'UniPC': [],
        'Other': []
    };

    // Use a Set to keep track of unique canonical names per group
    const canonicalSeen = new Set<string>();

    samplers.forEach(s => {
        const canonical = normalizeSampler(s);
        if (canonicalSeen.has(canonical)) return;
        canonicalSeen.add(canonical);

        const lower = canonical.toLowerCase();
        if (lower.includes('euler')) groups['Euler'].push(canonical);
        else if (lower.includes('dpm')) groups['DPM'].push(canonical);
        else if (lower.includes('lms')) groups['LMS'].push(canonical);
        else if (lower.includes('heun')) groups['Heun'].push(canonical);
        else if (lower.includes('ddim')) groups['DDIM'].push(canonical);
        else if (lower.includes('unipc')) groups['UniPC'].push(canonical);
        else groups['Other'].push(canonical);
    });

    return Object.entries(groups)
        .map(([label, items]) => ({ label, items: items.sort() }))
        .filter(g => g.items.length > 0);
};

export const ParameterSection: React.FC<ParameterSectionProps> = ({
    filters,
    setFilters,
    isOpen,
    onToggle
}) => {
    const { data: ranges, isLoading } = useParameterRangesQuery(filters);

    // Check if any parameters have data to show
    const hasSteps = ranges?.steps !== null && ranges?.steps !== undefined;
    const hasCfg = ranges?.cfg !== null && ranges?.cfg !== undefined;
    const hasSamplers = ranges?.samplers && ranges.samplers.length > 0;
    const hasGenTypes = ranges?.generationTypes && ranges.generationTypes.length > 0;

    const hasAnyData = hasSteps || hasCfg || hasSamplers || hasGenTypes;

    // If loading or no data, show appropriate state
    if (!isOpen) {
        return (
            <div className="space-y-2">
                <SectionHeader title="Parameters" isOpen={isOpen} onToggle={onToggle} isLoading={isLoading} />
            </div>
        );
    }

    return (
        <div className="space-y-2">
            <SectionHeader title="Parameters" isOpen={isOpen} onToggle={onToggle} isLoading={isLoading} />
            <div className="space-y-6 animate-in slide-in-from-top-2 duration-300 ease-spring px-4 pt-2">
                {!hasAnyData && !isLoading && (
                    <div className="text-xs text-gray-400 text-center py-4 italic border border-dashed border-gray-200 dark:border-white/10 rounded-xl">
                        No parameter data available
                    </div>
                )}

                {/* Steps Slider - only if data exists */}
                {hasSteps && ranges?.steps && (
                    <FilterSlider
                        label="Steps"
                        min={Math.floor(ranges.steps.min)}
                        max={Math.ceil(ranges.steps.max)}
                        minValue={filters.minSteps}
                        maxValue={filters.maxSteps}
                        onChange={(min, max) => setFilters(prev => ({ ...prev, minSteps: min, maxSteps: max }))}
                    />
                )}

                {/* CFG Scale Slider - only if data exists */}
                {hasCfg && ranges?.cfg && (
                    <FilterSlider
                        label="CFG Scale"
                        min={Math.floor(ranges.cfg.min)}
                        max={Math.ceil(ranges.cfg.max)}
                        step={0.5}
                        minValue={filters.minCfg}
                        maxValue={filters.maxCfg}
                        onChange={(min, max) => setFilters(prev => ({ ...prev, minCfg: min, maxCfg: max }))}
                    />
                )}

                {/* Sampler Filter - only if samplers exist */}
                {hasSamplers && ranges?.samplers && (
                    <MultiSelectDropdown
                        label="Sampler"
                        groups={groupSamplers(ranges.samplers)}
                        selected={filters.samplers || []}
                        onChange={(samplers) => setFilters(prev => ({ ...prev, samplers }))}
                        placeholder="Search samplers..."
                    />
                )}

                {/* Generation Type Filter - only if types exist */}
                {hasGenTypes && ranges?.generationTypes && (
                    <ChipSelect
                        label="Generation Type"
                        options={ranges.generationTypes}
                        selected={filters.generationTypes || []}
                        onChange={(generationTypes) => setFilters(prev => ({ ...prev, generationTypes }))}
                        formatLabel={formatGenType}
                    />
                )}
            </div>
        </div>
    );
};
