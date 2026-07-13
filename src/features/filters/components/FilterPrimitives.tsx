
import * as React from 'react';
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Check, Search, X, LucideIcon, ArrowDownWideNarrow } from 'lucide-react';
import { TooltipButton } from '../../../components/ui/InfoTooltip';

// --- Section Header ---
interface SectionHeaderProps {
    title: string;
    isOpen: boolean;
    onToggle: () => void;
    action?: React.ReactNode;
    isLoading?: boolean;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, isOpen, onToggle, action, isLoading }) => (
    <div className="flex items-center justify-between cursor-pointer group py-1 min-w-0" onClick={onToggle}>
        <h3 className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-500 uppercase tracking-wider group-hover:text-gray-900 dark:group-hover:text-gray-200 transition-colors min-w-0 flex-1">
            {isOpen ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
            <span className="truncate">{title}</span>
            {isLoading && (
                <div className="w-2.5 h-2.5 border border-sage-500/30 border-t-sage-500 rounded-full animate-spin flex-shrink-0" />
            )}
        </h3>
        {action}
    </div>
);

// --- Selectable Row ---
interface SelectableRowProps {
    label: string;
    isSelected: boolean;
    onClick: () => void;
    className?: string;
    disabled?: boolean;
}

export const SelectableRow: React.FC<SelectableRowProps> = ({ label, isSelected, onClick, className, disabled }) => (
    <div
        onClick={disabled ? undefined : onClick}
        className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all ease-spring border ${isSelected
            ? 'bg-sage-100 dark:bg-sage-600/20 border-sage-200 dark:border-sage-500/30 text-sage-800 dark:text-sage-300 font-medium'
            : 'bg-transparent border-transparent text-gray-500 dark:text-gray-400 hover:bg-white/40 dark:hover:bg-white/5'
            } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'} ${className || ''}`}
    >
        <span>{label}</span>
        {isSelected ? (
            <div className="w-4 h-4 rounded-full bg-sage-500 flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
            </div>
        ) : (
            <div className="w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600" />
        )}
    </div>
);

// --- Dual Handle Slider Component ---
interface FilterSliderProps {
    label: string;
    min: number;
    max: number;
    step?: number;
    minValue?: number;
    maxValue?: number;
    onChange: (min: number | undefined, max: number | undefined) => void;
}

export const FilterSlider: React.FC<FilterSliderProps> = ({ label, min, max, step = 1, minValue, maxValue, onChange }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState<'min' | 'max' | null>(null);

    // Default visual values from props
    const propCurrentMin = minValue !== undefined ? minValue : min;
    const propCurrentMax = maxValue !== undefined ? maxValue : max;

    // Local state for smooth dragging without triggering constantly
    const [localMin, setLocalMin] = useState(propCurrentMin);
    const [localMax, setLocalMax] = useState(propCurrentMax);

    // Keep track of latest local values for the event handler to read without closure staleness
    const valuesRef = useRef({ min: localMin, max: localMax });

    // Sync local state with props when NOT dragging
    useEffect(() => {
        if (!isDragging) {
            setLocalMin(propCurrentMin);
            setLocalMax(propCurrentMax);
            valuesRef.current = { min: propCurrentMin, max: propCurrentMax };
        }
    }, [propCurrentMin, propCurrentMax, isDragging]);

    // Update ref when local state changes
    useEffect(() => {
        valuesRef.current = { min: localMin, max: localMax };
    }, [localMin, localMax]);

    const getPercentage = (value: number) => ((value - min) / (max - min)) * 100;

    const handleMouseDown = (type: 'min' | 'max') => (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation(); // prevent other drag events
        setIsDragging(type);
    };

    const handleWindowMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || !trackRef.current) return;

        const rect = trackRef.current.getBoundingClientRect();
        const rawPercent = (e.clientX - rect.left) / rect.width;
        const rawValue = min + (rawPercent * (max - min));

        // Snap to step
        const steppedValue = Math.round(rawValue / step) * step;
        const clampedValue = Math.min(Math.max(steppedValue, min), max);

        // Read current latest values to enforce constraints
        const currentVals = valuesRef.current;

        if (isDragging === 'min') {
            // Cannot cross max
            const newMin = Math.min(clampedValue, currentVals.max - step);
            setLocalMin(newMin);
        } else {
            // Cannot cross min
            const newMax = Math.max(clampedValue, currentVals.min + step);
            setLocalMax(newMax);
        }
    }, [isDragging, min, max, step]);

    const handleWindowMouseUp = useCallback(() => {
        setIsDragging(null);

        // Commit changes
        const { min: finalMin, max: finalMax } = valuesRef.current;

        // Convert back to "undefined" if at limit (matching original logic)
        const commitMin = finalMin === min ? undefined : finalMin;
        const commitMax = finalMax === max ? undefined : finalMax;

        onChange(commitMin, commitMax);
    }, [min, max, onChange]);

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mousemove', handleWindowMouseMove);
            window.addEventListener('mouseup', handleWindowMouseUp);
        } else {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [isDragging, handleWindowMouseMove, handleWindowMouseUp]);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="font-bold uppercase tracking-wider">{label}</span>
                <span className="font-mono text-sage-600 dark:text-sage-400">
                    {localMin} - {localMax}
                </span>
            </div>

            <div className="relative h-6 flex items-center select-none" ref={trackRef}>
                {/* Track Background */}
                <div className="absolute left-0 right-0 h-1 bg-gray-300 dark:bg-gray-700 rounded-full" />

                {/* Active Range */}
                <div
                    className="absolute h-1 bg-sage-500 rounded-full shadow-[0_0_10px_rgba(140,163,107,0.5)]"
                    style={{
                        left: `${getPercentage(localMin)}%`,
                        width: `${getPercentage(localMax) - getPercentage(localMin)}%`
                    }}
                />

                {/* Min Thumb */}
                <div
                    className={`absolute w-3.5 h-3.5 bg-white dark:bg-slate-900 border-2 border-sage-500 rounded-full shadow cursor-ew-resize hover:scale-125 transition-transform ease-spring z-10 ${isDragging === 'min' ? 'scale-125 ring-2 ring-sage-500/50' : ''}`}
                    style={{ left: `calc(${getPercentage(localMin)}% - 7px)` }}
                    onMouseDown={handleMouseDown('min')}
                />

                {/* Max Thumb */}
                <div
                    className={`absolute w-3.5 h-3.5 bg-white dark:bg-slate-900 border-2 border-sage-500 rounded-full shadow cursor-ew-resize hover:scale-125 transition-transform ease-spring z-10 ${isDragging === 'max' ? 'scale-125 ring-2 ring-sage-500/50' : ''}`}
                    style={{ left: `calc(${getPercentage(localMax)}% - 7px)` }}
                    onMouseDown={handleMouseDown('max')}
                />
            </div>
        </div>
    );
};

// --- Search Input ---
interface SearchInputProps {
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    className?: string;
}

export const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, placeholder = "Search...", className }) => (
    <div className={`${className}`}>
        <div className="relative group size-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 group-focus-within:text-sage-500 transition-colors pointer-events-none" />
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full bg-gray-100/50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-xl pl-10 pr-10 py-2 text-xs focus:border-sage-500/50 focus:ring-4 focus:ring-sage-500/10 outline-none text-gray-900 dark:text-white transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600"
            />
            {value && (
                <button
                    type="button"
                    aria-label={`Clear ${placeholder}`}
                    onClick={() => onChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg transition-all"
                >
                    <X className="w-3 h-3" />
                </button>
            )}
        </div>
    </div>
);

// --- Sort Dropdown ---
export interface SortOptionItem {
    id: string;
    label: string;
    icon?: LucideIcon;
}

interface SortDropdownProps {
    options: SortOptionItem[];
    currentValue: string;
    onSelect: (id: string) => void;
    title?: string;
    className?: string;
    triggerClassName?: string | ((isOpen: boolean) => string);
    align?: 'left' | 'right';
}

export const SortDropdown: React.FC<SortDropdownProps> = ({
    options,
    currentValue,
    onSelect,
    title,
    className,
    triggerClassName,
    align = 'right'
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const resolvedTriggerClass = typeof triggerClassName === 'function'
        ? triggerClassName(isOpen)
        : triggerClassName || `p-1 rounded transition-colors ${isOpen ? 'text-sage-500 bg-sage-50 dark:bg-sage-900/30' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`;

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            <TooltipButton
                label={title ?? 'Sort Options'}
                content={title ?? 'Sort Options'}
                aria-expanded={isOpen}
                onClick={() => setIsOpen(!isOpen)}
                className={resolvedTriggerClass}
            >
                <ArrowDownWideNarrow className="w-3.5 h-3.5" />
            </TooltipButton>

            {isOpen && (
                <div className={`absolute mt-2 w-48 bg-white dark:bg-zinc-800 border border-gray-100 dark:border-white/10 rounded-xl shadow-2xl z-[100] p-1 animate-in zoom-in-95 duration-200 ${align === 'right' ? 'right-0' : 'left-0'}`}>
                    {title && (
                        <div className="text-[9px] font-bold text-gray-400 dark:text-zinc-500 px-3 py-1.5 uppercase tracking-wider">
                            {title}
                        </div>
                    )}

                    {options.map((opt) => (
                        <button
                            key={opt.id}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect(opt.id);
                                setIsOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg transition-colors ${currentValue === opt.id
                                ? 'bg-sage-50 dark:bg-sage-900/40 text-sage-700 dark:text-sage-300'
                                : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/5'
                                }`}
                        >
                            <div className="flex items-center gap-2 font-medium">
                                {opt.icon && <opt.icon className="w-3 h-3" />}
                                {opt.label}
                            </div>
                            {currentValue === opt.id && <Check className="w-3 h-3" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

// --- Multi-Select Dropdown with Search ---
interface MultiSelectDropdownProps {
    label: string;
    options?: string[];
    groups?: { label: string; items: string[] }[];
    selected: string[];
    onChange: (selected: string[]) => void;
    placeholder?: string;
}

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
    label,
    options = [],
    groups,
    selected,
    onChange,
    placeholder = "Search..."
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Filter logic
    const hasGroups = groups && groups.length > 0;

    // Flatten logic for count retrieval if needed, but 'selected' is already flat strings

    const filteredGroups = useMemo(() => {
        if (!hasGroups || !groups) return [];
        if (!searchTerm) return groups;

        return groups.map(g => ({
            label: g.label,
            items: g.items.filter(item => item.toLowerCase().includes(searchTerm.toLowerCase()))
        })).filter(g => g.items.length > 0);
    }, [groups, searchTerm, hasGroups]);

    const filteredOptions = useMemo(() => {
        if (hasGroups) return []; // Ignore options if groups exist
        return options.filter(opt => opt.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [options, searchTerm, hasGroups]);

    const toggleOption = (opt: string) => {
        if (selected.includes(opt)) {
            onChange(selected.filter(s => s !== opt));
        } else {
            onChange([...selected, opt]);
        }
    };

    const handleClear = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange([]);
    };

    // Helper to render an option item
    const renderOption = (opt: string) => {
        const isSelected = selected.includes(opt);
        return (
            <button
                key={opt}
                onClick={() => toggleOption(opt)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg transition-colors text-left group ${isSelected
                    ? 'bg-sage-50 dark:bg-sage-900/40 text-sage-800 dark:text-sage-200'
                    : 'text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
            >
                <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors shrink-0 ${isSelected
                    ? 'bg-sage-500 border-sage-500'
                    : 'border-gray-300 dark:border-white/20 group-hover:border-gray-400 dark:group-hover:border-white/30'
                    }`}>
                    {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <span className="truncate flex-1">{opt}</span>
            </button>
        );
    };

    return (
        <div className="space-y-2" ref={dropdownRef}>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider flex justify-between items-center">
                <span>{label}</span>
                {selected.length > 0 && (
                    <button
                        onClick={handleClear}
                        className="text-[10px] text-sage-600 dark:text-sage-400 hover:text-sage-800 dark:hover:text-sage-200 transition-colors"
                    >
                        Clear ({selected.length})
                    </button>
                )}
            </div>

            <div className="relative">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className={`w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-sage-500/50 transition-all ${isOpen ? 'ring-2 ring-sage-500/10 border-sage-500/50' : ''}`}
                >
                    <span className="truncate">
                        {selected.length === 0
                            ? 'Select...'
                            : selected.length === 1
                                ? selected[0]
                                : `${selected.length} selected`}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                    <div className="absolute z-50 mt-1 w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-white/10 rounded-xl shadow-xl p-2 animate-in fade-in zoom-in-95 duration-200">
                        {/* Only show search if enough items (arbitrary > 5 total items check difficult with groups, assume always show for groups or > 5 options) */}
                        {(hasGroups || options.length > 5) && (
                            <SearchInput
                                value={searchTerm}
                                onChange={setSearchTerm}
                                placeholder={placeholder}
                                className="mb-2"
                            />
                        )}

                        <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
                            {!hasGroups && filteredOptions.length === 0 && (
                                <div className="text-xs text-center py-4 text-gray-400 italic">No matches found</div>
                            )}

                            {hasGroups && filteredGroups.length === 0 && (
                                <div className="text-xs text-center py-4 text-gray-400 italic">No matches found</div>
                            )}

                            {/* Render Flat List */}
                            {!hasGroups && filteredOptions.map(opt => renderOption(opt))}

                            {/* Render Groups */}
                            {hasGroups && filteredGroups.map(group => (
                                <div key={group.label} className="mb-2 last:mb-0">
                                    <div className="px-2 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50/50 dark:bg-white/5 rounded mb-0.5 sticky top-0 backdrop-blur-sm z-10">
                                        {group.label}
                                    </div>
                                    <div className="space-y-0.5 pl-1">
                                        {group.items.map(opt => renderOption(opt))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

interface ChipSelectProps {
    label: string;
    options: string[];
    selected: string[];
    onChange: (selected: string[]) => void;
    formatLabel?: (value: string) => string;
    /** Optional list of currently available options (for dimming unavailable ones) */
    availableOptions?: string[];
}

/** Chip-style multi-select for categorical filters */
export const ChipSelect: React.FC<ChipSelectProps> = ({ label, options, selected, onChange, formatLabel, availableOptions }) => {
    if (options.length === 0) return null;

    const toggleOption = (opt: string) => {
        if (selected.includes(opt)) {
            onChange(selected.filter(s => s !== opt));
        } else {
            onChange([...selected, opt]);
        }
    };

    const format = formatLabel || ((v: string) => v);

    // If availableOptions is provided, use it for availability check; otherwise all are available
    const isAvailable = (opt: string) => {
        if (!availableOptions) return true;
        if (selected.includes(opt)) return true; // Always show selected as available
        return availableOptions.includes(opt);
    };

    return (
        <div className="space-y-2">
            {label && <div className="text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider px-0.5">{label}</div>}
            <div className="flex flex-wrap gap-1.5">
                {options.map(opt => {
                    const isSelected = selected.includes(opt);
                    const available = isAvailable(opt);
                    const displayLabel = format(opt);

                    return (
                        <button
                            key={opt}
                            type="button"
                            onClick={() => available && toggleOption(opt)}
                            disabled={!available}
                            title={displayLabel}
                            className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all max-w-full ${isSelected
                                ? 'bg-sage-500/10 border-sage-500/50 text-sage-700 dark:text-sage-300 ring-1 ring-sage-500/20 shadow-sm shadow-sage-500/10'
                                : available
                                    ? 'bg-gray-50/50 dark:bg-white/[0.03] border-gray-200 dark:border-white/10 text-gray-600 dark:text-zinc-400 hover:border-sage-400 dark:hover:border-sage-500/30 hover:bg-white dark:hover:bg-white/5'
                                    : 'bg-gray-50/50 dark:bg-white/[0.03] border-gray-200 dark:border-white/10 text-gray-400 dark:text-zinc-600 opacity-50 cursor-not-allowed line-through'
                                }`}
                        >
                            <span className="flex items-center gap-1.5 truncate">
                                {isSelected && <Check className="w-3 h-3 flex-shrink-0" />}
                                <span className="truncate">{displayLabel}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
// --- IconButton Select ---
interface IconButtonOption {
    id: string;
    label: string;
    icon: LucideIcon;
}

interface IconButtonSelectProps {
    label?: string;
    options: IconButtonOption[];
    selected: string[];
    onChange: (selected: string[]) => void;
}

export const IconButtonSelect: React.FC<IconButtonSelectProps> = ({ label, options, selected, onChange }) => {
    const toggleOption = (id: string) => {
        if (selected.includes(id)) {
            onChange(selected.filter(s => s !== id));
        } else {
            onChange([...selected, id]);
        }
    };

    return (
        <div className="space-y-2">
            {label && <div className="text-[10px] font-bold text-gray-500 dark:text-zinc-500 uppercase tracking-wider px-0.5">{label}</div>}
            <div className="grid grid-cols-3 gap-2">
                {options.map(opt => {
                    const isSelected = selected.includes(opt.id);
                    const Icon = opt.icon;
                    return (
                        <button
                            key={opt.id}
                            type="button"
                            onClick={() => toggleOption(opt.id)}
                            className={`flex flex-col items-center justify-center gap-1.5 p-2 rounded-xl border transition-all aspect-square sm:aspect-auto sm:h-auto ${isSelected
                                    ? 'bg-sage-500/10 border-sage-500/50 text-sage-800 dark:text-sage-300 ring-4 ring-sage-500/10 shadow-sm'
                                    : 'bg-white/50 dark:bg-white/[0.03] border-gray-100 dark:border-white/5 text-gray-500 dark:text-zinc-400 hover:bg-white dark:hover:bg-white/5 hover:border-gray-300 dark:hover:border-white/20'
                                }`}
                        >
                            <div className={`p-1.5 rounded-lg transition-colors ${isSelected ? 'bg-sage-500/20' : 'bg-gray-100 dark:bg-white/5'}`}>
                                <Icon className={`w-4 h-4 ${isSelected ? 'text-sage-600 dark:text-sage-400' : 'text-gray-400 dark:text-zinc-500'}`} />
                            </div>
                            <span className="text-[10px] font-semibold truncate w-full text-center">{opt.label}</span>
                        </button>
                    )
                })}
            </div>
        </div>
    );
};
