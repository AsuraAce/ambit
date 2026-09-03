import * as React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { ImageKindFilter, SourceKindCounts } from '../../../types';

interface ImageKindScopeDropdownProps {
    value: ImageKindFilter;
    counts: SourceKindCounts;
    onChange: (value: ImageKindFilter) => void;
}

const OPTIONS: Array<{ value: ImageKindFilter; label: string; countKey: keyof SourceKindCounts }> = [
    { value: 'all', label: 'All', countKey: 'all' },
    { value: 'generated', label: 'Generated', countKey: 'generated' },
    { value: 'photograph', label: 'Photos', countKey: 'photograph' },
    { value: 'other', label: 'Other', countKey: 'other' },
];

export const ImageKindScopeDropdown = React.memo(({
    value,
    counts,
    onChange,
}: ImageKindScopeDropdownProps) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
    const selectedOption = OPTIONS.find(option => option.value === value) ?? OPTIONS[0];
    const selectedCount = counts[selectedOption.countKey];

    React.useEffect(() => {
        if (!isOpen) return;

        const selectedIndex = OPTIONS.findIndex(option => option.value === selectedOption.value);
        optionRefs.current[selectedIndex]?.focus();

        const handlePointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
        };
        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isOpen, selectedOption.value]);

    const closeAndRestoreFocus = React.useCallback(() => {
        setIsOpen(false);
        triggerRef.current?.focus();
    }, []);

    const selectOption = React.useCallback((nextValue: ImageKindFilter) => {
        onChange(nextValue);
        closeAndRestoreFocus();
    }, [closeAndRestoreFocus, onChange]);

    const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const currentIndex = optionRefs.current.findIndex(option => option === document.activeElement);
        let nextIndex: number | null = null;

        if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % OPTIONS.length;
        if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + OPTIONS.length) % OPTIONS.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = OPTIONS.length - 1;

        if (nextIndex !== null) {
            event.preventDefault();
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closeAndRestoreFocus();
        }
    };

    const isScoped = selectedOption.value !== 'all';

    return (
        <div ref={containerRef} className="relative shrink-0" data-testid="image-kind-scope">
            <button
                ref={triggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-label={`Image kind: ${selectedOption.label}, ${selectedCount.toLocaleString()}. Change image kind`}
                onClick={() => setIsOpen(open => !open)}
                className={`flex h-10 min-w-[7.5rem] items-center justify-between gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500/60 ${isScoped
                    ? 'border-sage-500/30 bg-sage-500/10 text-sage-700 dark:text-sage-200'
                    : 'border-gray-200 bg-gray-100 text-gray-600 hover:text-gray-900 dark:border-white/10 dark:bg-zinc-800/50 dark:text-zinc-300 dark:hover:text-white'
                    }`}
            >
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{selectedOption.label}</span>
                    <span className="text-[10px] font-medium tabular-nums opacity-70">
                        {selectedCount.toLocaleString()}
                    </span>
                </span>
                <ChevronDown
                    aria-hidden
                    className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen && (
                <div
                    role="dialog"
                    aria-label="Choose image kind"
                    className="absolute left-0 top-full z-[100] mt-2 w-56 rounded-xl border border-gray-200 bg-white p-1.5 shadow-2xl dark:border-white/10 dark:bg-zinc-800"
                >
                    <div
                        role="radiogroup"
                        aria-label="Filter library by image kind"
                        onKeyDown={handleMenuKeyDown}
                    >
                        <div className="px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                            Image kind
                        </div>
                        {OPTIONS.map((option, index) => {
                            const isSelected = option.value === selectedOption.value;
                            return (
                                <button
                                    key={option.value}
                                    ref={element => { optionRefs.current[index] = element; }}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    aria-label={`${option.label}, ${counts[option.countKey].toLocaleString()}`}
                                    onClick={() => selectOption(option.value)}
                                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sage-500/60 ${isSelected
                                        ? 'bg-sage-500/15 text-sage-700 dark:text-sage-200'
                                        : 'text-gray-600 hover:bg-gray-100 dark:text-zinc-300 dark:hover:bg-white/5'
                                        }`}
                                >
                                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                        {isSelected && <Check aria-hidden className="h-3.5 w-3.5" />}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                                    <span className="shrink-0 text-[10px] tabular-nums opacity-70">
                                        {counts[option.countKey].toLocaleString()}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
});
