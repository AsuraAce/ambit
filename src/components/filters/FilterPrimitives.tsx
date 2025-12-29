
import * as React from 'react';
import { useRef, useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronRight, Check, Search, X } from 'lucide-react';

// --- Section Header ---
interface SectionHeaderProps {
    title: string;
    isOpen: boolean;
    onToggle: () => void;
    action?: React.ReactNode;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, isOpen, onToggle, action }) => (
    <div className="flex items-center justify-between cursor-pointer group py-1" onClick={onToggle}>
        <h3 className="flex items-center gap-2 text-xs font-bold text-gray-500 dark:text-gray-500 uppercase tracking-wider group-hover:text-gray-900 dark:group-hover:text-gray-200 transition-colors">
            {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {title}
        </h3>
        {action}
    </div>
);

// --- Selectable Row ---
interface SelectableRowProps {
    label: string;
    isSelected: boolean;
    onClick: () => void;
}

export const SelectableRow: React.FC<SelectableRowProps> = ({ label, isSelected, onClick }) => (
    <div
        onClick={onClick}
        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-all ease-spring border ${isSelected
            ? 'bg-sage-100 dark:bg-sage-600/20 border-sage-200 dark:border-sage-500/30 text-sage-800 dark:text-sage-300 font-medium'
            : 'bg-transparent border-transparent text-gray-500 dark:text-gray-400 hover:bg-white/40 dark:hover:bg-white/5'
            }`}
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

    // Default visual values if undefined (for the UI)
    const currentMin = minValue !== undefined ? minValue : min;
    const currentMax = maxValue !== undefined ? maxValue : max;

    const getPercentage = (value: number) => ((value - min) / (max - min)) * 100;

    const handleMouseDown = (type: 'min' | 'max') => (e: React.MouseEvent) => {
        e.preventDefault();
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

        if (isDragging === 'min') {
            // Cannot cross max
            const newMin = Math.min(clampedValue, currentMax - step);
            onChange(newMin === min ? undefined : newMin, maxValue);
        } else {
            // Cannot cross min
            const newMax = Math.max(clampedValue, currentMin + step);
            onChange(minValue, newMax === max ? undefined : newMax);
        }
    }, [isDragging, min, max, step, currentMin, currentMax, minValue, maxValue, onChange]);

    const handleWindowMouseUp = useCallback(() => {
        setIsDragging(null);
    }, []);

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
                    {currentMin} - {currentMax}
                </span>
            </div>

            <div className="relative h-6 flex items-center select-none" ref={trackRef}>
                {/* Track Background */}
                <div className="absolute left-0 right-0 h-1 bg-gray-300 dark:bg-gray-700 rounded-full" />

                {/* Active Range */}
                <div
                    className="absolute h-1 bg-sage-500 rounded-full shadow-[0_0_10px_rgba(140,163,107,0.5)]"
                    style={{
                        left: `${getPercentage(currentMin)}%`,
                        width: `${getPercentage(currentMax) - getPercentage(currentMin)}%`
                    }}
                />

                {/* Min Thumb */}
                <div
                    className={`absolute w-3.5 h-3.5 bg-white dark:bg-slate-900 border-2 border-sage-500 rounded-full shadow cursor-ew-resize hover:scale-125 transition-transform ease-spring z-10 ${isDragging === 'min' ? 'scale-125 ring-2 ring-sage-500/50' : ''}`}
                    style={{ left: `calc(${getPercentage(currentMin)}% - 7px)` }}
                    onMouseDown={handleMouseDown('min')}
                />

                {/* Max Thumb */}
                <div
                    className={`absolute w-3.5 h-3.5 bg-white dark:bg-slate-900 border-2 border-sage-500 rounded-full shadow cursor-ew-resize hover:scale-125 transition-transform ease-spring z-10 ${isDragging === 'max' ? 'scale-125 ring-2 ring-sage-500/50' : ''}`}
                    style={{ left: `calc(${getPercentage(currentMax)}% - 7px)` }}
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
                    onClick={() => onChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1.5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg transition-all"
                >
                    <X className="w-3 h-3" />
                </button>
            )}
        </div>
    </div>
);
